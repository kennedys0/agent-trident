import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../src/app.js';
import type { Config } from '../src/config.js';
import { insertSnapshot } from '../src/db/repositories.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';
import { createFakeQuotePort, makeDb, makeSnapshot, seedEvaluation, TEST_POOL } from './helpers.js';
import type { MarketService } from '../src/services/market.js';
import {
  candidateSchema,
  healthSchema,
  journalPageSchema,
  marketSnapshotSchema,
  portfolioSchema,
  venueSchema,
} from '@trident/api-contract';

const config: Config = {
  mode: 'PAPER',
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
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
    expect(body.data.venues[0].pool).toBe(TEST_POOL.id);
    expect(body.data.venues[0].chainId).toBe(4663);
    expect(body.data.venues[0].provenance.length).toBeGreaterThan(0);
    expect(body.meta.assets).toHaveLength(2);
    expect(() => venueSchema.parse(body.data.venues[0])).not.toThrow();
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
    expect(firstBody.data.riskDecision.verdict).toBe('APPROVED');
    expect(firstBody.data.fillId).toBeTruthy();

    const second = await server.inject({ method: 'POST', url: '/api/v1/intents', payload });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.replayed).toBe(true);
    expect(second.json().data.fillId).toBe(firstBody.data.fillId);
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
    expect(portfolio.json().data.mode).toBe('PAPER');
    expect(() => portfolioSchema.parse(portfolio.json().data)).not.toThrow();

    const candidates = await server.inject({ method: 'GET', url: '/api/v1/candidates?limit=5' });
    expect(candidates.statusCode).toBe(200);
    for (const candidate of candidates.json().data.candidates as unknown[]) {
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

  it('engages and reports the persisted kill switch', async () => {
    const server = makeApp();
    const halt = await server.inject({ method: 'POST', url: '/api/v1/system/halt', payload: { engaged: true } });
    expect(halt.statusCode).toBe(200);
    const health = await server.inject({ method: 'GET', url: '/health' });
    expect(health.json().meta.killSwitchEngaged).toBe(true);
  });

  it('returns a structured 404 envelope for unknown routes', async () => {
    const server = makeApp();
    const response = await server.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({ code: 'NOT_FOUND' });
  });
});