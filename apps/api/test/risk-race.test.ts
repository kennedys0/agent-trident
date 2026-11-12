import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import {
  createIntent,
  engageHalt,
  getIntentById,
  getPortfolio,
  getRiskDecisionByIntent,
} from '../src/db/repositories.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';
import type { StrategyConfig } from '../src/domain/types.js';
import { createMarketService } from '../src/services/market.js';
import { createIntentFromEvaluation, executeIntent, type ExecutionDeps } from '../src/services/execution.js';
import { AppError } from '../src/errors.js';
import { createFakeChain, createFakeQuotePort, fakeBlock, makeDb, makeSnapshot, seedEvaluation, TEST_POOL } from './helpers.js';

const config: Config = {
  mode: 'PAPER',
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  rpcAllowedHosts: ['rpc.mainnet.chain.robinhood.com'],
  expectedChainId: 4663,
  databasePath: ':memory:',
  port: 0,
  host: '127.0.0.1',
  logLevel: 'silent',
  marketFreshnessSeconds: 30,
  openingCashUsdgBase: '10000000000',
};

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

function count(db: ReturnType<typeof makeDb>, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number | bigint };
  return Number(row.count);
}

function cash(db: ReturnType<typeof makeDb>): string {
  return getPortfolio(db, null, 18).cashUsdg;
}

function deps(
  db: ReturnType<typeof makeDb>,
  quote = createFakeQuotePort({ headBlock: 201 }),
  strategyConfig: StrategyConfig = DEFAULT_STRATEGY_CONFIG,
): ExecutionDeps {
  return {
    db,
    quote,
    pool: TEST_POOL,
    config: strategyConfig,
    mode: 'PAPER',
    correlationId: 'race-test',
  };
}

/** A quote port that runs `duringQuote` exactly once, inside the first quote. */
function quotePortThatRunsOnce(duringQuote: () => Promise<void>) {
  const base = createFakeQuotePort({ headBlock: 201 });
  let fired = false;
  return {
    async quote(request: Parameters<typeof base.quote>[0]) {
      if (!fired) {
        fired = true;
        await duringQuote();
      }
      return base.quote(request);
    },
    headBlockNumber: () => base.headBlockNumber(),
    baseFeePerGasAt: (blockNumber: number) => base.baseFeePerGasAt(blockNumber),
  };
}

describe('Sentinel F1 / Nova A2: risk inputs are re-read inside the write transaction', () => {
  it('rejects when the kill switch is pressed while the intent is being quoted', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot({ blockNumber: 200 }), 'BUY', '500000000');
    const intent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'halt-during-quote',
      correlationId: 'race',
      mode: 'PAPER',
    });
    const effectsBefore = {
      orders: count(db, 'orders'),
      fills: count(db, 'fills'),
      ledger: count(db, 'ledger_entries'),
      positions: count(db, 'positions'),
    };
    const cashBefore = cash(db);

    // The operator presses STOP NEW ENTRIES after the quote was requested but
    // before the intent reaches the risk gate.
    const quote = quotePortThatRunsOnce(async () => {
      engageHalt(db, 'OPERATOR');
    });

    const view = await executeIntent(deps(db, quote), intent.id);

    // The gate sees the halt inside the transaction and rejects with no effects.
    expect(view.riskDecision).not.toBeNull();
    expect(view.riskDecision!.verdict).toBe('REJECTED');
    expect(view.riskDecision!.rules.find((rule) => rule.rule === 'R02_kill_switch')!.status).toBe('FAIL');
    expect(view.intent.status).toBe('REJECTED');
    expect(view.orderId).toBeNull();
    expect(view.fillId).toBeNull();
    expect(getIntentById(db, intent.id)!.status).toBe('REJECTED');
    expect(count(db, 'orders')).toBe(effectsBefore.orders);
    expect(count(db, 'fills')).toBe(effectsBefore.fills);
    expect(count(db, 'ledger_entries')).toBe(effectsBefore.ledger);
    expect(count(db, 'positions')).toBe(effectsBefore.positions);
    expect(cash(db)).toBe(cashBefore);
  });

  it('rejects the second of two intents that were both sized against the same cash', async () => {
    const db = makeDb();
    // 100% allocation cap so only the cash rule can stop the second intent.
    const strategyConfig: StrategyConfig = { ...DEFAULT_STRATEGY_CONFIG, maxAllocationBps: 10_000 };
    const firstEvaluation = seedEvaluation(db, makeSnapshot({ blockNumber: 200 }), 'BUY', '6000000000');
    const secondEvaluation = seedEvaluation(db, makeSnapshot({ blockNumber: 201 }), 'BUY', '6000000000');
    const first = createIntentFromEvaluation(db, {
      evaluation: firstEvaluation,
      idempotencyKey: 'same-cash-1',
      correlationId: 'race',
      mode: 'PAPER',
    });
    const second = createIntentFromEvaluation(db, {
      evaluation: secondEvaluation,
      idempotencyKey: 'same-cash-2',
      correlationId: 'race',
      mode: 'PAPER',
    });
    const cashBefore = cash(db);

    // The second intent starts, and its first quote call lets the first intent
    // commit a fill. Its own write transaction must then see the new balance.
    const quote = quotePortThatRunsOnce(async () => {
      const firstView = await executeIntent(deps(db, createFakeQuotePort({ headBlock: 201 }), strategyConfig), first.id);
      expect(firstView.riskDecision!.verdict).toBe('APPROVED');
    });

    const view = await executeIntent(deps(db, quote, strategyConfig), second.id);

    const cashAfter = cash(db);
    expect(cashAfter).toBe('3999400000');
    expect(BigInt(cashAfter)).toBeGreaterThanOrEqual(0n);
    expect(BigInt(cashAfter)).toBeLessThan(BigInt(cashBefore));
    expect(count(db, 'fills')).toBe(1);
    expect(view.riskDecision!.verdict).toBe('REJECTED');
    expect(view.intent.status).toBe('REJECTED');
    expect(view.orderId).toBeNull();
    expect(view.fillId).toBeNull();
    // The stale pre-transaction balance would have passed; the fresh one fails.
    const cashRule = view.riskDecision!.rules.find((rule) => rule.rule === 'R11_cash_available')!;
    expect(cashRule.status).toBe('FAIL');
    expect(cashRule.observed).toBe('3999400000');
  });

  it('records the portfolio version it actually decided on', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot({ blockNumber: 200 }), 'BUY', '500000000');
    const intent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'version-1',
      correlationId: 'race',
      mode: 'PAPER',
    });

    const view = await executeIntent(deps(db), intent.id);

    const stored = getRiskDecisionByIntent(db, intent.id)!;
    expect(view.riskDecision!.verdict).toBe('APPROVED');
    expect(stored.portfolioVersion).toMatch(/^ledger:\d+$/);
    // A fill posts ledger rows, so a decision made before the fill cannot claim
    // a version that already includes it.
    const current = getPortfolio(db, null, 18).portfolioVersion;
    expect(current).not.toBe(stored.portfolioVersion);
  });
});

describe('Nova A3: intent read-back prefers the evaluation business key', () => {
  it('returns CONFLICT when the idempotency key belongs to another evaluation', () => {
    const db = makeDb();
    const firstEvaluation = seedEvaluation(db, makeSnapshot({ blockNumber: 300 }), 'BUY', '500000000');
    const secondEvaluation = seedEvaluation(db, makeSnapshot({ blockNumber: 301 }), 'BUY', '500000000');
    createIntentFromEvaluation(db, {
      evaluation: firstEvaluation,
      idempotencyKey: 'shared-key',
      correlationId: 'readback',
      mode: 'PAPER',
    });

    expect(() =>
      createIntentFromEvaluation(db, {
        evaluation: secondEvaluation,
        idempotencyKey: 'shared-key',
        correlationId: 'readback',
        mode: 'PAPER',
      }),
    ).toThrowError(AppError);

    // The repository refuses the same race even after the service-level check:
    // the insert conflicts and must not return an arbitrary row.
    expect(() =>
      createIntent(db, {
        evaluationId: secondEvaluation.id,
        idempotencyKey: 'shared-key',
        mode: 'PAPER',
        side: 'BUY',
        tokenInId: 'USDG',
        tokenOutId: 'WETH',
        amountIn: '500000000',
        minAmountOut: '0',
        snapshotId: secondEvaluation.snapshotId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toThrowError(/different evaluation/);

    expect(count(db, 'order_intents')).toBe(1);
  });

  it('replays the stored intent for a brand-new key without inserting a second row', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot({ blockNumber: 300 }), 'BUY', '500000000');
    const first = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'original-key',
      correlationId: 'readback',
      mode: 'PAPER',
    });

    const replay = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'fresh-key',
      correlationId: 'readback',
      mode: 'PAPER',
    });

    expect(replay.id).toBe(first.id);
    expect(replay.idempotencyKey).toBe('original-key');
    expect(count(db, 'order_intents')).toBe(1);
  });

  it('returns 409 through the API when evaluation and key disagree', async () => {
    const db = makeDb();
    const firstEvaluation = seedEvaluation(db, makeSnapshot({ blockNumber: 300 }), 'BUY', '500000000');
    const secondEvaluation = seedEvaluation(db, makeSnapshot({ blockNumber: 301 }), 'BUY', '500000000');
    createIntentFromEvaluation(db, {
      evaluation: firstEvaluation,
      idempotencyKey: 'shared-key',
      correlationId: 'readback',
      mode: 'PAPER',
    });

    app = buildApp({
      db,
      config,
      pool: TEST_POOL,
      strategyConfig: DEFAULT_STRATEGY_CONFIG,
      market: createMarketService({
        db,
        chain: createFakeChain([fakeBlock(300, 'aa'), fakeBlock(301, 'bb', fakeBlock(300, 'aa').hash)]),
        pool: TEST_POOL,
        config: DEFAULT_STRATEGY_CONFIG,
        correlationId: 'readback',
      }),
      quote: createFakeQuotePort(),
      probe: async () => ({ chainId: 4663, headBlock: 301, latencyMs: 1 }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { evaluationId: secondEvaluation.id, idempotencyKey: 'shared-key' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
    expect(count(db, 'order_intents')).toBe(1);
  });
});

describe('Sentinel F1: a fresh rejection is terminal and replay-safe', () => {
  it('keeps one stored risk decision and no effects when a rejected intent is replayed', async () => {
    const db = makeDb();
    engageHalt(db, 'OPERATOR');
    const evaluation = seedEvaluation(db, makeSnapshot({ blockNumber: 200 }), 'BUY', '500000000');
    const intent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'reject-once',
      correlationId: 'race',
      mode: 'PAPER',
    });

    const first = await executeIntent(deps(db), intent.id);
    const second = await executeIntent(deps(db), intent.id);

    expect(first.riskDecision!.verdict).toBe('REJECTED');
    expect(second.replayed).toBe(true);
    expect(second.riskDecision!.id).toBe(first.riskDecision!.id);
    expect(count(db, 'risk_decisions')).toBe(1);
    expect(count(db, 'orders')).toBe(0);
    expect(count(db, 'fills')).toBe(0);
  });
});