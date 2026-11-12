import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../src/app.js';
import type { Config } from '../src/config.js';
import { insertSnapshot, upsertPosition } from '../src/db/repositories.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';
import { createFakeQuotePort, makeDb, makeSnapshot, seedEvaluation, TEST_POOL } from './helpers.js';
import type { MarketService } from '../src/services/market.js';
import {
  candidateSchema,
  healthSchema,
  intentExecutionSchema,
  journalPageSchema,
  marketSnapshotSchema,
  portfolioSchema,
  riskDecisionSchema,
  tradeIntentSchema,
  venueSchema,
} from '@trident/api-contract';

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

function makeApp(overrides: Partial<AppDeps> = {}): FastifyInstance {
  const db = makeDb();
  const marketStub = {
    takeSnapshot: async () => makeSnapshot(),
    evaluate: () => {
      throw new Error('not used in API tests');
    },
  } as unknown as MarketService;
  app = buildApp({
    db,
    config,
    pool: TEST_POOL,
    strategyConfig: DEFAULT_STRATEGY_CONFIG,
    market: marketStub,
    quote: createFakeQuotePort(),
    probe: async () => ({ chainId: 4663, headBlock: 111_408_301, latencyMs: 12 }),
    ...overrides,
  });
  return app;
}

/** Persistence effects that a replay must never add to. */
function countEffects(db: ReturnType<typeof makeDb>): Record<string, number> {
  const tables: Record<string, string> = {
    intents: 'order_intents',
    orders: 'orders',
    fills: 'fills',
    riskDecisions: 'risk_decisions',
    ledger: 'ledger_entries',
    audit: 'audit_events',
    positions: 'positions',
  };
  const result: Record<string, number> = {};
  for (const [key, table] of Object.entries(tables)) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number | bigint };
    result[key] = Number(row.count);
  }
  return result;
}

describe('HTTP API', () => {
  it('reports chain identity and mode on /health', async () => {
    const server = makeApp();
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.chainId).toBe(4663);
    expect(body.data.mode).toBe('PAPER');
    expect(body.data.rpcStatus).toBe('HEALTHY');
    expect(body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
    // The payload is the ratified contract, not a lookalike.
    expect(() => healthSchema.parse(body.data)).not.toThrow();
  });

  it('returns 503 when the chain probe reports the wrong chain id', async () => {
    const server = makeApp({ probe: async () => ({ chainId: 46630, headBlock: 1, latencyMs: 5 }) });
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json().data.rpcStatus).toBe('DEGRADED');
    expect(response.json().meta.chainOk).toBe(false);
  });

  it('exposes the verified venue and pool allowlist', async () => {
    const server = makeApp();
    const response = await server.inject({ method: 'GET', url: '/api/v1/venues' });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    // The contract types `data` as an array, not a wrapped object.
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].pool).toBe(TEST_POOL.id);
    expect(body.data[0].chainId).toBe(4663);
    expect(body.data[0].provenance.length).toBeGreaterThan(0);
    expect(body.meta.assets).toHaveLength(2);
    for (const venue of body.data as unknown[]) expect(() => venueSchema.parse(venue)).not.toThrow();
  });

  it('returns 404 for a market snapshot before any observation exists', async () => {
    const server = makeApp();
    const response = await server.inject({ method: 'GET', url: '/api/v1/markets/weth-usdg/snapshot' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('serves a stored snapshot with derived freshness', async () => {
    const db = makeDb();
    insertSnapshot(db, makeSnapshot());
    const server = makeApp({ db });
    const response = await server.inject({ method: 'GET', url: '/api/v1/markets/weth-usdg/snapshot' });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.data.status).toBe('COMPLETE');
    expect(body.data.chainId).toBe(4663);
    expect(body.data.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => marketSnapshotSchema.parse(body.data)).not.toThrow();
    expect(body.data.blockNumber).toBe(String(111_408_300));
    // Provenance that the wire contract cannot carry stays in meta.
    expect(body.meta.sqrtPriceX96).toBe('3596635876533259452022784');
  });

  it('rejects an intent with an unknown evaluation', async () => {
    const server = makeApp();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { evaluationId: '00000000-0000-4000-8000-000000000000', idempotencyKey: 'abc12345' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('validates the intent body at the boundary', async () => {
    const server = makeApp();
    const response = await server.inject({ method: 'POST', url: '/api/v1/intents', payload: { idempotencyKey: 'x' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('executes a paper BUY and replays it idempotently', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const server = makeApp({ db });
    const payload = { evaluationId: evaluation.id, idempotencyKey: 'api-idem-1' };

    const first = await server.inject({ method: 'POST', url: '/api/v1/intents', payload });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();

    // The whole envelope is the ratified IntentExecution contract.
    expect(() => intentExecutionSchema.parse(firstBody.data)).not.toThrow();
    expect(() => tradeIntentSchema.parse(firstBody.data.intent)).not.toThrow();
    expect(() => riskDecisionSchema.parse(firstBody.data.riskDecision)).not.toThrow();
    // The route meta is strict: no fee/orderId/fillId workaround survives.
    expect(Object.keys(firstBody.meta).sort()).toEqual(['observedAt', 'replayed', 'requestId']);
    expect(firstBody.meta.replayed).toBe(false);

    const approved = firstBody.data.riskDecision;
    expect(approved.verdict).toBe('APPROVED');
    expect(firstBody.data.intent.status).toBe('FILLED');
    expect(approved.approvedBaseQty.decimals).toBe(18);
    expect(approved.maximumQuoteCost.decimals).toBe(6);
    expect(approved.rules.length).toBeGreaterThan(0);
    expect(approved.rules.every((rule: { status: string }) => rule.status === 'PASS')).toBe(true);

    expect(firstBody.data.order).not.toBeNull();
    expect(firstBody.data.order.intentId).toBe(firstBody.data.intent.id);
    expect(firstBody.data.order.status).toBe('FILLED');
    const fill = firstBody.data.fill;
    expect(fill).not.toBeNull();
    expect(fill.orderId).toBe(firstBody.data.order.id);
    expect(fill.snapshotId).toBe(firstBody.data.intent.snapshotId);
    expect(fill.feeQuote.decimals).toBe(6);
    // Gas is sourced from the pinned block, and the cost is consistent with it.
    expect(fill.gasEstimate.status).toBe('AVAILABLE');
    expect(BigInt(fill.gasEstimate.gasCostWei)).toBe(
      BigInt(fill.gasEstimate.gasUnits) * BigInt(fill.gasEstimate.gasPriceWei),
    );
    expect(fill.gasEstimate.gasPriceWei).toBe('20014000');
    expect(fill.gasEstimate.gasQuoteCost).toBeUndefined();

    const second = await server.inject({ method: 'POST', url: '/api/v1/intents', payload });
    expect(second.statusCode).toBe(200);
    const replay = second.json();
    expect(replay.meta.replayed).toBe(true);
    expect(replay.data.fill.orderId).toBe(fill.orderId);
    expect(replay.data.fill.filledAt).toBe(fill.filledAt);
    expect(() => intentExecutionSchema.parse(replay.data)).not.toThrow();

    // Follow-up route keeps its own {intent, riskDecision} shape (recorded in MIGRATION.md).
    const detail = await server.inject({ method: 'GET', url: `/api/v1/intents/${firstBody.data.intent.id}` });
    expect(detail.statusCode).toBe(200);
    expect(() => tradeIntentSchema.parse(detail.json().data.intent)).not.toThrow();
    expect(() => riskDecisionSchema.parse(detail.json().data.riskDecision)).not.toThrow();
  });

  it('replays the stored execution when a new key targets an evaluation that already ran', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const server = makeApp({ db });

    const first = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { evaluationId: evaluation.id, idempotencyKey: 'api-seq-1' },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();
    const effects = countEffects(db);

    // A different key on the same evaluation is a replay, never a second insert
    // and never a 500 from the evaluation_id unique constraint.
    const second = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { evaluationId: evaluation.id, idempotencyKey: 'api-seq-2' },
    });
    expect(second.statusCode).toBe(200);
    const replay = second.json();
    expect(replay.meta.replayed).toBe(true);
    expect(replay.data.intent.id).toBe(firstBody.data.intent.id);
    expect(replay.data.order.id).toBe(firstBody.data.order.id);
    expect(replay.data.fill.orderId).toBe(firstBody.data.fill.orderId);
    expect(replay.data.fill.filledAt).toBe(firstBody.data.fill.filledAt);
    expect(() => intentExecutionSchema.parse(replay.data)).not.toThrow();
    expect(countEffects(db)).toEqual(effects);

    // The same key keeps working too.
    const third = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { evaluationId: evaluation.id, idempotencyKey: 'api-seq-1' },
    });
    expect(third.statusCode).toBe(200);
    expect(third.json().meta.replayed).toBe(true);
    expect(third.json().data.intent.id).toBe(firstBody.data.intent.id);
    expect(countEffects(db)).toEqual(effects);
  });

  it('serializes concurrent submissions of one evaluation into a single execution', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const server = makeApp({ db });

    const responses = await Promise.all(
      ['api-race-1', 'api-race-2', 'api-race-3'].map((idempotencyKey) =>
        server.inject({ method: 'POST', url: '/api/v1/intents', payload: { evaluationId: evaluation.id, idempotencyKey } }),
      ),
    );

    const bodies = responses.map((response) => response.json());
    for (const response of responses) expect([200, 201]).toContain(response.statusCode);
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(new Set(bodies.map((body) => body.data.intent.id)).size).toBe(1);
    expect(new Set(bodies.map((body) => body.data.fill.orderId)).size).toBe(1);
    expect(bodies.filter((body) => body.meta.replayed === false)).toHaveLength(1);
    for (const body of bodies) expect(() => intentExecutionSchema.parse(body.data)).not.toThrow();

    const effects = countEffects(db);
    expect(effects).toMatchObject({ intents: 1, orders: 1, fills: 1, riskDecisions: 1 });
  });

  it('replays a rejected evaluation as rejected even after the kill switch is released', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const server = makeApp({ db });
    await server.inject({ method: 'POST', url: '/api/v1/system/halt', payload: { engaged: true } });

    const rejected = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { evaluationId: evaluation.id, idempotencyKey: 'api-reject-1' },
    });
    expect(rejected.statusCode).toBe(200);
    const rejectedBody = rejected.json();
    expect(rejectedBody.data.riskDecision.verdict).toBe('REJECTED');
    expect(rejectedBody.data.fill).toBeNull();

    // Releasing the switch writes its own audit entry, so measure after it.
    await server.inject({ method: 'POST', url: '/api/v1/system/halt', payload: { engaged: false } });
    const effects = countEffects(db);
    const replay = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { evaluationId: evaluation.id, idempotencyKey: 'api-reject-2' },
    });
    expect(replay.statusCode).toBe(200);
    const replayBody = replay.json();
    expect(replayBody.meta.replayed).toBe(true);
    expect(replayBody.data.intent.id).toBe(rejectedBody.data.intent.id);
    expect(replayBody.data.riskDecision.verdict).toBe('REJECTED');
    expect(replayBody.data.order).toBeNull();
    expect(replayBody.data.fill).toBeNull();
    expect(() => intentExecutionSchema.parse(replayBody.data)).not.toThrow();
    expect(countEffects(db)).toEqual(effects);
  });

  it('returns an explicit null order/fill when the risk gate rejects', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const server = makeApp({ db });
    await server.inject({ method: 'POST', url: '/api/v1/system/halt', payload: { engaged: true } });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { evaluationId: evaluation.id, idempotencyKey: 'api-rejected-1' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.riskDecision.verdict).toBe('REJECTED');
    expect(body.data.intent.status).toBe('REJECTED');
    expect(body.data.order).toBeNull();
    expect(body.data.fill).toBeNull();
    expect(Object.keys(body.meta).sort()).toEqual(['observedAt', 'replayed', 'requestId']);
    expect(() => intentExecutionSchema.parse(body.data)).not.toThrow();
  });

  it('reports gas as UNAVAILABLE when the block exposes no base fee', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const server = makeApp({ db, quote: createFakeQuotePort({ baseFeePerGas: null }) });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { evaluationId: evaluation.id, idempotencyKey: 'api-gas-unavailable' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    const gas = body.data.fill.gasEstimate;
    expect(gas.status).toBe('UNAVAILABLE');
    expect(gas.reason).toContain('did not report baseFeePerGas');
    expect(gas.provenance).toContain('eth_getBlockByNumber');
    expect(gas.gasUnits).toBeUndefined();
    expect(gas.gasCostWei).toBeUndefined();
    expect(() => intentExecutionSchema.parse(body.data)).not.toThrow();
  });

  it('reports a simulated portfolio and an append-only journal', async () => {
    const db = makeDb();
    const evaluation = seedEvaluation(db, makeSnapshot());
    const server = makeApp({ db });
    await server.inject({ method: 'POST', url: '/api/v1/intents', payload: { evaluationId: evaluation.id, idempotencyKey: 'api-journal' } });

    const portfolio = await server.inject({ method: 'GET', url: '/api/v1/portfolio' });
    expect(portfolio.statusCode).toBe(200);
    expect(portfolio.json().meta.simulated).toBe(true);
    expect(portfolio.json().data.positions).toHaveLength(1);
    expect(portfolio.json().data.positions[0].valuationStatus).toBe('VALUED');
    expect(portfolio.json().data.positions[0].valuationSnapshotId).toBeTruthy();
    expect(portfolio.json().data.mode).toBe('PAPER');
    expect(() => portfolioSchema.parse(portfolio.json().data)).not.toThrow();

    const candidates = await server.inject({ method: 'GET', url: '/api/v1/candidates?limit=5' });
    expect(candidates.statusCode).toBe(200);
    const candidateList = candidates.json().data as unknown[];
    expect(Array.isArray(candidateList)).toBe(true);
    for (const candidate of candidateList) {
      expect(() => candidateSchema.parse(candidate)).not.toThrow();
    }

    const journal = await server.inject({ method: 'GET', url: '/api/v1/journal?limit=10' });
    expect(journal.statusCode).toBe(200);
    const journalBody = journal.json().data;
    expect(() => journalPageSchema.parse(journalBody)).not.toThrow();
    const types = (journalBody.events as { type: string }[]).map((event) => event.type);
    expect(types).toContain('paper.fill.recorded');
    expect(types).toContain('risk.decision.recorded');
  });

  it('marks a position UNPRICED when no snapshot can value it', async () => {
    const db = makeDb();
    upsertPosition(db, { assetId: 'WETH', quantity: '242701000000000000', costBasis: '500050000' });
    const server = makeApp({ db });
    const response = await server.inject({ method: 'GET', url: '/api/v1/portfolio' });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    const position = body.data.positions[0];
    expect(position.valuationStatus).toBe('UNPRICED');
    expect(position.reason).toBeTruthy();
    expect(position.unrealizedPnlQuote).toBeUndefined();
    expect(body.data.equityQuote.value).toBe('10000000000');
    expect(() => portfolioSchema.parse(body.data)).not.toThrow();
  });

  it('engages and reports the persisted kill switch', async () => {
    const server = makeApp();
    const halt = await server.inject({ method: 'POST', url: '/api/v1/system/halt', payload: { engaged: true } });
    expect(halt.statusCode).toBe(200);
    const health = await server.inject({ method: 'GET', url: '/health' });
    expect(health.json().meta.killSwitchEngaged).toBe(true);
  });

  it('exposes the halt reason in /health and /api/v1/system/halt meta', async () => {
    const server = makeApp();
    const before = await server.inject({ method: 'GET', url: '/health' });
    expect(before.json().meta.haltReason).toBeNull();
    const halt = await server.inject({ method: 'POST', url: '/api/v1/system/halt', payload: { engaged: true } });
    expect(halt.json().data.haltReason).toBe('OPERATOR');
    const engaged = await server.inject({ method: 'GET', url: '/health' });
    expect(engaged.json().meta.haltReason).toBe('OPERATOR');
    const release = await server.inject({ method: 'POST', url: '/api/v1/system/halt', payload: { engaged: false } });
    expect(release.json().data.haltReason).toBeNull();
    const after = await server.inject({ method: 'GET', url: '/health' });
    expect(after.json().meta.haltReason).toBeNull();
  });

  it('returns a structured 404 envelope for unknown routes', async () => {
    const server = makeApp();
    const response = await server.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({ code: 'NOT_FOUND' });
  });
});