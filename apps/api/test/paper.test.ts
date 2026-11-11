import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/index.js';
import {
  appendAudit,
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

  it('returns the same intent for a repeated idempotency key and refuses a second intent per evaluation', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const first = createIntentFromEvaluation(db, { evaluation, idempotencyKey: 'idem-same', correlationId: 'test', mode: 'PAPER' });
    const again = createIntentFromEvaluation(db, { evaluation, idempotencyKey: 'idem-same', correlationId: 'test', mode: 'PAPER' });
    expect(again.id).toBe(first.id);
    expect(count(db, 'order_intents')).toBe(1);

    expect(() =>
      createIntentFromEvaluation(db, { evaluation, idempotencyKey: 'idem-other', correlationId: 'test', mode: 'PAPER' }),
    ).toThrow();
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

  it('survives a restart without duplicating fills or ledger entries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trident-db-'));
    tempDirs.push(dir);
    const path = join(dir, 'paper.sqlite');

    const first = seedTestDb(openDatabase(path));
    const evaluation = seedEvaluation(first, makeSnapshot());
    const intent = createIntentFromEvaluation(first, { evaluation, idempotencyKey: 'idem-restart', correlationId: 'test', mode: 'PAPER' });
    const view = await executeIntent(deps(first), intent.id);
    const ledgerCount = count(first, 'ledger_entries');
    first.close();

    const reopened = openDatabase(path);
    const replay = await executeIntent(deps(reopened), intent.id);
    expect(replay.replayed).toBe(true);
    expect(replay.fillId).toBe(view.fillId);
    expect(count(reopened, 'fills')).toBe(1);
    expect(count(reopened, 'ledger_entries')).toBe(ledgerCount);
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