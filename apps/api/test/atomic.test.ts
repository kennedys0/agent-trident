import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { getIntentById, getSnapshotAtBlockAny, insertSnapshot, seedOpeningCash } from '../src/db/repositories.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';
import { createMarketService } from '../src/services/market.js';
import { createIntentFromEvaluation, executeIntent } from '../src/services/execution.js';
import { maybeInjectFault, type FaultStage } from '../src/services/faults.js';
import { fakeBlock, createFakeChain, createFakeQuotePort, makeDb, makeSnapshot, seedEvaluation, TEST_POOL } from './helpers.js';

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

function crashAt(stage: FaultStage): { afterEntityWrite: (written: FaultStage) => void } {
  return {
    afterEntityWrite: (written) => {
      if (written === stage) throw new Error(`crash after ${stage}`);
    },
  };
}

function counts(db: ReturnType<typeof makeDb>): Record<string, number> {
  const tables = {
    snapshots: 'market_snapshots',
    evaluations: 'strategy_evaluations',
    intents: 'order_intents',
    risk: 'risk_decisions',
    orders: 'orders',
    fills: 'fills',
    ledger: 'ledger_entries',
    audit: 'audit_events',
    positions: 'positions',
    checkpoints: 'chain_checkpoints',
    reorgs: 'chain_reorgs',
  };
  const result: Record<string, number> = {};
  for (const [key, table] of Object.entries(tables)) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number | bigint };
    result[key] = Number(row.count);
  }
  return result;
}

function auditFor(db: ReturnType<typeof makeDb>, action: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE action = ?').get(action) as { count: number | bigint };
  return Number(row.count);
}

describe('AT-16 atomic snapshot + audit', () => {
  it('writes neither a snapshot nor its audit when the process dies between them', async () => {
    const db = makeDb();
    const chain = createFakeChain([fakeBlock(100, 'aa')]);
    const service = createMarketService({
      db,
      chain,
      pool: TEST_POOL,
      config: DEFAULT_STRATEGY_CONFIG,
      correlationId: 'atomic',
      faults: crashAt('market.snapshot'),
    });

    await expect(service.takeSnapshot()).rejects.toThrow('crash after market.snapshot');

    const after = counts(db);
    expect(after.snapshots).toBe(0);
    expect(after.audit).toBe(0);
    // The checkpoint is part of the same unit of work.
    expect(after.checkpoints).toBe(0);
  });

  it('commits the snapshot, checkpoint, and audit together on success', async () => {
    const db = makeDb();
    const chain = createFakeChain([fakeBlock(100, 'aa')]);
    const service = createMarketService({
      db,
      chain,
      pool: TEST_POOL,
      config: DEFAULT_STRATEGY_CONFIG,
      correlationId: 'atomic',
    });
    await service.takeSnapshot();

    const after = counts(db);
    expect(after.snapshots).toBe(1);
    expect(after.checkpoints).toBe(1);
    expect(auditFor(db, 'market.snapshot.persisted')).toBe(1);
  });
});

describe('AT-16 atomic evaluation + audit', () => {
  it('writes neither an evaluation nor its audit when the process dies between them', async () => {
    const db = makeDb();
    const snapshot = makeSnapshot();
    const service = createMarketService({
      db,
      chain: createFakeChain([fakeBlock(100, 'aa')]),
      pool: TEST_POOL,
      config: DEFAULT_STRATEGY_CONFIG,
      correlationId: 'atomic',
      faults: crashAt('strategy.evaluation'),
    });
    insertSnapshot(db, snapshot);

    expect(() => service.evaluate(snapshot)).toThrow('crash after strategy.evaluation');

    const after = counts(db);
    expect(after.evaluations).toBe(0);
    expect(auditFor(db, 'strategy.evaluation.recorded')).toBe(0);
  });

  it('replays without adding a second audit event', async () => {
    const db = makeDb();
    const service = createMarketService({
      db,
      chain: createFakeChain([fakeBlock(100, 'aa')]),
      pool: TEST_POOL,
      config: DEFAULT_STRATEGY_CONFIG,
      correlationId: 'atomic',
    });
    const snapshot = makeSnapshot();
    insertSnapshot(db, snapshot);

    service.evaluate(snapshot);
    service.evaluate(snapshot);
    expect(counts(db).evaluations).toBe(1);
    expect(auditFor(db, 'strategy.evaluation.recorded')).toBe(1);
  });
});

describe('AT-16 atomic intent + audit', () => {
  it('writes neither an intent nor its audit when the process dies between them', () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot(), 'BUY', '500000000');

    expect(() =>
      createIntentFromEvaluation(db, {
        evaluation,
        idempotencyKey: 'atomic-intent-1',
        correlationId: 'atomic',
        mode: 'PAPER',
        faults: crashAt('order.intent'),
      }),
    ).toThrow('crash after order.intent');

    const after = counts(db);
    expect(after.intents).toBe(0);
    expect(auditFor(db, 'intent.created')).toBe(0);
  });

  it('commits the intent and its audit together on success', () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot(), 'BUY', '500000000');
    createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'atomic-intent-2',
      correlationId: 'atomic',
      mode: 'PAPER',
    });

    expect(counts(db).intents).toBe(1);
    expect(auditFor(db, 'intent.created')).toBe(1);
  });
});

describe('AT-16 atomic expiry + audit', () => {
  it('keeps the PENDING status when the expiry transaction dies before the audit', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot(), 'BUY', '500000000');
    const intent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'atomic-expiry-1',
      correlationId: 'atomic',
      mode: 'PAPER',
    });

    await expect(
      executeIntent(
        {
          db,
          quote: createFakeQuotePort(),
          pool: TEST_POOL,
          config: DEFAULT_STRATEGY_CONFIG,
          mode: 'PAPER',
          correlationId: 'atomic',
          now: () => new Date(Date.now() + 10 * 60 * 1000),
          faults: crashAt('intent.expired'),
        },
        intent.id,
      ),
    ).rejects.toThrow('crash after intent.expired');

    expect(getIntentById(db, intent.id)!.status).toBe('PENDING');
    expect(auditFor(db, 'intent.expired')).toBe(0);
  });

  it('commits EXPIRED and its audit together', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot(), 'BUY', '500000000');
    const intent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'atomic-expiry-2',
      correlationId: 'atomic',
      mode: 'PAPER',
    });

    await expect(
      executeIntent(
        {
          db,
          quote: createFakeQuotePort(),
          pool: TEST_POOL,
          config: DEFAULT_STRATEGY_CONFIG,
          mode: 'PAPER',
          correlationId: 'atomic',
          now: () => new Date(Date.now() + 10 * 60 * 1000),
        },
        intent.id,
      ),
    ).rejects.toThrow(/expired/i);

    expect(getIntentById(db, intent.id)!.status).toBe('EXPIRED');
    expect(auditFor(db, 'intent.expired')).toBe(1);
  });
});

describe('AT-16 atomic risk decision, fill, and ledger + audit', () => {
  it('writes no risk decision without its audit', async () => {
    const db = makeDb();
    seedOpeningCash(db, '10000000000');
    const evaluation = seedEvaluation(db, makeSnapshot(), 'BUY', '500000000');
    const intent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'atomic-risk-1',
      correlationId: 'atomic',
      mode: 'PAPER',
    });

    await expect(
      executeIntent(
        {
          db,
          quote: createFakeQuotePort(),
          pool: TEST_POOL,
          config: DEFAULT_STRATEGY_CONFIG,
          mode: 'PAPER',
          correlationId: 'atomic',
          faults: crashAt('risk.decision'),
        },
        intent.id,
      ),
    ).rejects.toThrow('crash after risk.decision');

    const after = counts(db);
    expect(after.risk).toBe(0);
    expect(auditFor(db, 'risk.decision.recorded')).toBe(0);
    expect(getIntentById(db, intent.id)!.status).toBe('PENDING');
  });

  it('writes no fill, ledger, or position without their audit', async () => {
    const db = makeDb();
    seedOpeningCash(db, '10000000000');
    const before = counts(db);
    const evaluation = seedEvaluation(db, makeSnapshot(), 'BUY', '500000000');
    const intent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'atomic-fill-1',
      correlationId: 'atomic',
      mode: 'PAPER',
    });

    await expect(
      executeIntent(
        {
          db,
          quote: createFakeQuotePort(),
          pool: TEST_POOL,
          config: DEFAULT_STRATEGY_CONFIG,
          mode: 'PAPER',
          correlationId: 'atomic',
          faults: crashAt('paper.fill'),
        },
        intent.id,
      ),
    ).rejects.toThrow('crash after paper.fill');

    const after = counts(db);
    expect(after.fills).toBe(before.fills);
    expect(after.orders).toBe(before.orders);
    expect(after.risk).toBe(before.risk);
    expect(after.ledger).toBe(before.ledger);
    expect(after.positions).toBe(before.positions);
    expect(auditFor(db, 'paper.fill.recorded')).toBe(0);
    expect(getIntentById(db, intent.id)!.status).toBe('PENDING');
  });
});

describe('AT-16 atomic halt + audit', () => {
  it('does not change the kill switch when its audit write fails', async () => {
    const db = makeDb();
    app = buildApp({
      db,
      config,
      pool: TEST_POOL,
      strategyConfig: DEFAULT_STRATEGY_CONFIG,
      market: createMarketService({
        db,
        chain: createFakeChain([fakeBlock(100, 'aa')]),
        pool: TEST_POOL,
        config: DEFAULT_STRATEGY_CONFIG,
        correlationId: 'atomic',
      }),
      quote: createFakeQuotePort(),
      probe: async () => ({ chainId: 4663, headBlock: 100, latencyMs: 1 }),
      faults: crashAt('automation.state'),
    });

    const response = await app.inject({ method: 'POST', url: '/api/v1/system/halt', payload: { engaged: true } });
    expect(response.statusCode).toBe(500);
    const row = db.prepare("SELECT value FROM automation_state WHERE key = 'new_entries_halted'").get() as
      | { value: string }
      | undefined;
    expect(row?.value).not.toBe('true');
    expect(auditFor(db, 'system.halt.engaged')).toBe(0);
  });

  it('commits the kill switch and its audit together', async () => {
    const db = makeDb();
    app = buildApp({
      db,
      config,
      pool: TEST_POOL,
      strategyConfig: DEFAULT_STRATEGY_CONFIG,
      market: createMarketService({
        db,
        chain: createFakeChain([fakeBlock(100, 'aa')]),
        pool: TEST_POOL,
        config: DEFAULT_STRATEGY_CONFIG,
        correlationId: 'atomic',
      }),
      quote: createFakeQuotePort(),
      probe: async () => ({ chainId: 4663, headBlock: 100, latencyMs: 1 }),
    });

    const response = await app.inject({ method: 'POST', url: '/api/v1/system/halt', payload: { engaged: true } });
    expect(response.statusCode).toBe(200);
    const row = db.prepare("SELECT value FROM automation_state WHERE key = 'new_entries_halted'").get();
    expect(row).toEqual({ value: 'true' });
    expect(auditFor(db, 'system.halt.engaged')).toBe(1);
  });
});

describe('AT-16 no entity without an audit event', () => {
  it('keeps one audit event per persisted entity across a full paper cycle', async () => {
    const db = makeDb();
    seedOpeningCash(db, '10000000000');
    const chain = createFakeChain([fakeBlock(100, 'aa')]);
    const service = createMarketService({
      db,
      chain,
      pool: TEST_POOL,
      config: DEFAULT_STRATEGY_CONFIG,
      correlationId: 'atomic',
    });
    const snapshot = await service.takeSnapshot();
    const evaluation = service.evaluate(snapshot!);
    const intent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'atomic-cycle-1',
      correlationId: 'atomic',
      mode: 'PAPER',
    });
    await executeIntent(
      { db, quote: createFakeQuotePort(), pool: TEST_POOL, config: DEFAULT_STRATEGY_CONFIG, mode: 'PAPER', correlationId: 'atomic' },
      intent.id,
    );

    expect(auditFor(db, 'market.snapshot.persisted')).toBe(1);
    expect(auditFor(db, 'strategy.evaluation.recorded')).toBe(1);
    expect(auditFor(db, 'intent.created')).toBe(1);
    expect(auditFor(db, 'risk.decision.recorded')).toBe(1);
    // Every fill has exactly one audit event, and no audit event names a
    // missing entity.
    const fills = db.prepare('SELECT id FROM fills').all() as { id: string }[];
    for (const fill of fills) {
      const row = db
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'paper.fill.recorded' AND entity_id = ?")
        .get(fill.id) as { count: number };
      expect(Number(row.count)).toBe(1);
    }
    expect(getSnapshotAtBlockAny(db, TEST_POOL.id, 100)).not.toBeNull();
    // The fault seam is a no-op when no hooks are installed.
    expect(() => maybeInjectFault(undefined, 'paper.fill')).not.toThrow();
  });
});