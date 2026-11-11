import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/index.js';
import {
  appendAudit,
  createIntent,
  getFillByOrder,
  getPortfolio,
  getPosition,
  insertSnapshot,
  isKillSwitchEngaged,
  KILL_SWITCH_KEY,
  setState,
} from '../src/db/repositories.js';
import { assertBalanced } from '../src/domain/ledger.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';
import { createIntentFromEvaluation, executeIntent, type ExecutionDeps } from '../src/services/execution.js';
import { createFakeQuotePort, FAKE_BUY_OUT, makeDb, makeSnapshot, seedEvaluation, seedTestDb, TEST_POOL } from './helpers.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function deps(db: Db, overrides: Partial<ExecutionDeps> = {}): ExecutionDeps {
  return {
    db,
    quote: createFakeQuotePort(),
    pool: TEST_POOL,
    config: DEFAULT_STRATEGY_CONFIG,
    mode: 'PAPER',
    correlationId: 'test-correlation',
    ...overrides,
  };
}

function count(db: Db, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number | bigint };
  return Number(row.count);
}

describe('paper execution and persistence', () => {
  it('turns an approved BUY intent into exactly one fill with a balanced ledger', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const intent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'idem-buy-1',
      correlationId: 'test',
      mode: 'PAPER',
    });

    const view = await executeIntent(deps(db), intent.id);
    expect(view.riskDecision?.verdict).toBe('APPROVED');
    // Approval is expressed in explicit units: WETH base qty and the USDG cost
    // including the 0.01% fee the fill will charge.
    expect(view.riskDecision?.approvedBaseQty).toBe(FAKE_BUY_OUT.toString());
    expect(view.riskDecision?.approvedQuoteAmount).toBe('500050000');
    expect(view.replayed).toBe(false);
    expect(count(db, 'orders')).toBe(1);
    expect(count(db, 'fills')).toBe(1);
    assertBalanced(db, view.fillId as string);

    const fill = getFillByOrder(db, view.orderId as string);
    expect(fill?.['amount_in']).toBe('500000000');
    expect(fill?.['amount_out']).toBe(FAKE_BUY_OUT.toString());

    const position = getPosition(db, 'WETH');
    expect(position?.quantity).toBe(FAKE_BUY_OUT.toString());
    const portfolio = getPortfolio(db, makeSnapshot().priceScaled, 18);
    expect(BigInt(portfolio.cashUsdg)).toBeLessThan(10_000_000_000n);
    expect(portfolio.positions).toHaveLength(1);
  });

  it('replays the same intent without duplicating any effect', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const intent = createIntentFromEvaluation(db, { evaluation, idempotencyKey: 'idem-replay', correlationId: 'test', mode: 'PAPER' });

    const first = await executeIntent(deps(db), intent.id);
    const ledgerBefore = count(db, 'ledger_entries');
    const second = await executeIntent(deps(db), intent.id);

    expect(second.replayed).toBe(true);
    expect(second.fillId).toBe(first.fillId);
    expect(count(db, 'orders')).toBe(1);
    expect(count(db, 'fills')).toBe(1);
    expect(count(db, 'ledger_entries')).toBe(ledgerBefore);
  });

  it('returns the same intent for a repeated key and replays it for a new key on the same evaluation', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const first = createIntentFromEvaluation(db, { evaluation, idempotencyKey: 'idem-same', correlationId: 'test', mode: 'PAPER' });
    const again = createIntentFromEvaluation(db, { evaluation, idempotencyKey: 'idem-same', correlationId: 'test', mode: 'PAPER' });
    expect(again.id).toBe(first.id);
    expect(count(db, 'order_intents')).toBe(1);

    // `evaluation_id` is the business key: a new key must not insert or throw.
    const differentKey = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'idem-other',
      correlationId: 'test',
      mode: 'PAPER',
    });
    expect(differentKey.id).toBe(first.id);
    expect(count(db, 'order_intents')).toBe(1);
  });

  it('falls back to the existing row when two inserts race on the unique evaluation key', () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const input = {
      evaluationId: evaluation.id,
      mode: 'PAPER' as const,
      side: 'BUY' as const,
      tokenInId: 'USDG',
      tokenOutId: 'WETH',
      amountIn: '500000000',
      minAmountOut: '0',
      snapshotId: evaluation.snapshotId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    // Both writes carry a distinct idempotency key but the same evaluation, so
    // the second INSERT hits the evaluation unique constraint.
    const first = createIntent(db, { ...input, idempotencyKey: 'race-key-1' });
    const second = createIntent(db, { ...input, idempotencyKey: 'race-key-2' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.intent.id).toBe(first.intent.id);
    expect(count(db, 'order_intents')).toBe(1);
  });

  it('replays a completed execution for a new key without new persistence effects', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const intent = createIntentFromEvaluation(db, { evaluation, idempotencyKey: 'idem-done-1', correlationId: 'test', mode: 'PAPER' });
    const first = await executeIntent(deps(db), intent.id);
    const before = {
      intents: count(db, 'order_intents'),
      orders: count(db, 'orders'),
      fills: count(db, 'fills'),
      ledger: count(db, 'ledger_entries'),
      audit: count(db, 'audit_events'),
    };

    const replayIntent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'idem-done-2',
      correlationId: 'test',
      mode: 'PAPER',
    });
    const replay = await executeIntent(deps(db), replayIntent.id);

    expect(replayIntent.id).toBe(intent.id);
    expect(replay.replayed).toBe(true);
    expect(replay.fillId).toBe(first.fillId);
    expect(count(db, 'order_intents')).toBe(before.intents);
    expect(count(db, 'orders')).toBe(before.orders);
    expect(count(db, 'fills')).toBe(before.fills);
    expect(count(db, 'ledger_entries')).toBe(before.ledger);
    expect(count(db, 'audit_events')).toBe(before.audit);
  });

  it('replays a rejected evaluation without re-evaluating it later', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const intent = createIntentFromEvaluation(db, { evaluation, idempotencyKey: 'idem-reject-1', correlationId: 'test', mode: 'PAPER' });
    setState(db, KILL_SWITCH_KEY, 'true');
    const rejected = await executeIntent(deps(db), intent.id);
    expect(rejected.riskDecision?.verdict).toBe('REJECTED');
    const auditBefore = count(db, 'audit_events');
    const decisionsBefore = count(db, 'risk_decisions');

    // Release the switch; the stored rejection must still replay as rejected.
    setState(db, KILL_SWITCH_KEY, 'false');
    const replayIntent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'idem-reject-2',
      correlationId: 'test',
      mode: 'PAPER',
    });
    const replay = await executeIntent(deps(db), replayIntent.id);

    expect(replay.replayed).toBe(true);
    expect(replay.riskDecision?.verdict).toBe('REJECTED');
    expect(replay.fillId).toBeNull();
    expect(count(db, 'orders')).toBe(0);
    expect(count(db, 'fills')).toBe(0);
    expect(count(db, 'risk_decisions')).toBe(decisionsBefore);
    expect(count(db, 'audit_events')).toBe(auditBefore);
  });

  it('rejects a stale snapshot and leaves no order behind', async () => {
    const db = makeDb();
    const stale = makeSnapshot({ observedAt: new Date(Date.now() - 120_000) });
    const evaluation = seedEvaluation(db, stale);
    const intent = createIntentFromEvaluation(db, { evaluation, idempotencyKey: 'idem-stale', correlationId: 'test', mode: 'PAPER' });

    const view = await executeIntent(deps(db), intent.id);
    expect(view.riskDecision?.verdict).toBe('REJECTED');
    expect(count(db, 'orders')).toBe(0);
    expect(count(db, 'fills')).toBe(0);
    expect(count(db, 'ledger_entries')).toBe(2); // genesis cash only
  });

  it('rejects when the kill switch is engaged', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const intent = createIntentFromEvaluation(db, { evaluation, idempotencyKey: 'idem-halt', correlationId: 'test', mode: 'PAPER' });
    setState(db, KILL_SWITCH_KEY, 'true');
    expect(isKillSwitchEngaged(db)).toBe(true);

    const view = await executeIntent(deps(db), intent.id);
    expect(view.riskDecision?.verdict).toBe('REJECTED');
    const killSwitch = view.riskDecision?.rules.find((rule) => rule.rule === 'R02_kill_switch');
    expect(killSwitch?.status).toBe('FAIL');
    expect(killSwitch?.reason).toBeTruthy();
    expect(view.riskDecision?.rules.every((rule) => rule.status === 'PASS' || (rule.reason?.length ?? 0) > 0)).toBe(true);
    expect(count(db, 'fills')).toBe(0);
  });

  it('survives a restart and replays a new key on the same evaluation without new effects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trident-db-'));
    tempDirs.push(dir);
    const path = join(dir, 'paper.sqlite');

    const first = seedTestDb(openDatabase(path));
    const evaluation = seedEvaluation(first, makeSnapshot());
    const intent = createIntentFromEvaluation(first, { evaluation, idempotencyKey: 'idem-restart-1', correlationId: 'test', mode: 'PAPER' });
    const view = await executeIntent(deps(first), intent.id);
    const before = {
      intents: count(first, 'order_intents'),
      orders: count(first, 'orders'),
      fills: count(first, 'fills'),
      ledger: count(first, 'ledger_entries'),
      audit: count(first, 'audit_events'),
      risk: count(first, 'risk_decisions'),
    };
    first.close();

    const reopened = openDatabase(path);
    const replay = await executeIntent(deps(reopened), intent.id);
    expect(replay.replayed).toBe(true);
    expect(replay.fillId).toBe(view.fillId);

    // A brand-new idempotency key after the restart must still resolve to the
    // same stored execution, because `evaluation_id` is the business key.
    const replayIntent = createIntentFromEvaluation(reopened, {
      evaluation,
      idempotencyKey: 'idem-restart-2',
      correlationId: 'test',
      mode: 'PAPER',
    });
    expect(replayIntent.id).toBe(intent.id);
    const secondReplay = await executeIntent(deps(reopened), replayIntent.id);
    expect(secondReplay.replayed).toBe(true);
    expect(secondReplay.fillId).toBe(view.fillId);

    expect(count(reopened, 'order_intents')).toBe(before.intents);
    expect(count(reopened, 'orders')).toBe(before.orders);
    expect(count(reopened, 'fills')).toBe(before.fills);
    expect(count(reopened, 'ledger_entries')).toBe(before.ledger);
    expect(count(reopened, 'audit_events')).toBe(before.audit);
    expect(count(reopened, 'risk_decisions')).toBe(before.risk);
    reopened.close();
  });

  it('keeps the audit trail append-only', () => {
    const db = makeDb();
    appendAudit(db, { actor: 'test', action: 'test.action', entity: 'test', entityId: '1', correlationId: 'c' });
    expect(() => db.prepare("UPDATE audit_events SET action = 'tampered'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_events').run()).toThrow(/append-only/);
  });

  it('refuses to create an intent from a WAIT evaluation', () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot(), 'WAIT');
    expect(() =>
      createIntentFromEvaluation(db, { evaluation, idempotencyKey: 'idem-wait', correlationId: 'test', mode: 'PAPER' }),
    ).toThrow(/cannot produce a paper intent/);
  });

  it('settles a buy then sell cycle with a balanced journal and realized PnL', async () => {
    const db = makeDb();
    const snapshot = makeSnapshot();
    insertSnapshot(db, snapshot);
    const buyEvaluation = seedEvaluation(db, snapshot, 'BUY', '500000000');
    const buyIntent = createIntentFromEvaluation(db, { evaluation: buyEvaluation, idempotencyKey: 'cycle-buy', correlationId: 'test', mode: 'PAPER' });
    const buy = await executeIntent(deps(db), buyIntent.id);
    expect(buy.riskDecision?.verdict).toBe('APPROVED');

    const position = getPosition(db, 'WETH');
    const sellSnapshot = makeSnapshot({ blockNumber: snapshot.blockNumber + 10 });
    insertSnapshot(db, sellSnapshot);
    const sellEvaluation = seedEvaluation(db, sellSnapshot, 'SELL', position?.quantity as string);
    const sellIntent = createIntentFromEvaluation(db, { evaluation: sellEvaluation, idempotencyKey: 'cycle-sell', correlationId: 'test', mode: 'PAPER' });
    const sell = await executeIntent(deps(db), sellIntent.id);

    expect(sell.riskDecision?.verdict).toBe('APPROVED');
    // A SELL approves the base units sold and the net quote proceeds it is bounded to.
    expect(sell.riskDecision?.approvedBaseQty).toBe(position?.quantity);
    expect(BigInt(sell.riskDecision?.approvedQuoteAmount as string)).toBeGreaterThan(0n);
    assertBalanced(db, sell.fillId as string);
    expect(getPosition(db, 'WETH')?.quantity).toBe('0');
    expect(count(db, 'fills')).toBe(2);
  });
});