import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/index.js';
import { makeDb, TEST_POOL, REAL_SQRT_PRICE_X96, fakeBlock, createFakeChain } from './helpers.js';
import { buildApp, type AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Config } from '../src/config.js';
import type { MarketService } from '../src/services/market.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';
import { WETH, USDG, VERIFIED_VENUE } from '../src/chain/venue.js';
import {
  addWatchlistEntry,
  listWatchlistEntries,
  latestPoolMarketSnapshot,
  upsertPoolMarketSnapshot,
} from '../src/db/marketIntelRepositories.js';
import { spotPriceScaled, inverseSpotPriceScaled, PRICE_SCALE } from '../src/domain/price.js';
import { loadTrackedPools, refreshTrackedPool, storedStatus } from '../src/services/marketIntel.js';
import type { ChainReadPort } from '../src/chain/client.js';

const config = loadConfig({
  RPC_URL: 'https://rpc.mainnet.chain.robinhood.com',
  DATABASE_PATH: ':memory:',
});

const marketStub = {
  takeSnapshot: async () => null,
  evaluate: () => {
    throw new Error('not used in market intel tests');
  },
} as unknown as MarketService;

function makeApp(overrides: Partial<AppDeps> = {}) {
  return buildApp({
    db: makeDb(),
    config,
    pool: TEST_POOL,
    strategyConfig: DEFAULT_STRATEGY_CONFIG,
    market: marketStub,
    quote: {
      quote: async () => ({ amountOut: 500_000_000n, gasEstimate: 139_283n, blockNumber: 111_408_300 }),
      headBlockNumber: async () => 111_408_300,
      baseFeePerGasAt: async () => 20_014_000n,
    } as never,
    probe: async () => ({ chainId: 4663, headBlock: 111_408_301, latencyMs: 5 }),
    ...overrides,
  });
}

const DISCOVERED_POOL = '0xd00df00dd00df00dd00df00dd00df00dd00df00d';
const RAD = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const USDC = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function seedDiscoveredPools(db: ReturnType<typeof makeDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_pools (
      pool_address TEXT PRIMARY KEY,
      factory TEXT NOT NULL,
      token0 TEXT NOT NULL,
      token1 TEXT NOT NULL,
      token0_symbol TEXT NOT NULL,
      token1_symbol TEXT NOT NULL,
      token0_decimals INTEGER NOT NULL,
      token1_decimals INTEGER NOT NULL,
      fee INTEGER NOT NULL,
      first_seen_block INTEGER NOT NULL
    );
  `);
  db.prepare(
    'INSERT INTO discovered_pools VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(DISCOVERED_POOL, VERIFIED_VENUE.factory, USDC, RAD, 'USDC', 'RAD', 6, 18, 10000, 112_000_000);
}

describe('price math', () => {
  it('computes USDG-per-WETH and its inverse with the real sqrtPriceX96', () => {
    const fwd = spotPriceScaled(REAL_SQRT_PRICE_X96, 18, 6, PRICE_SCALE);
    const rev = inverseSpotPriceScaled(REAL_SQRT_PRICE_X96, 18, 6, PRICE_SCALE);
    expect(fwd).toBeGreaterThan(2_000_000_000_000_000_000_000n);
    expect(fwd).toBeLessThan(2_200_000_000_000_000_000_000n);
    expect(rev).toBeGreaterThan(460_000_000_000_000n);
    expect(rev).toBeLessThan(520_000_000_000_000n);
    // Product of both directions is 1e36 within floor-division loss (<2e-15).
    const product = fwd * rev;
    expect(product).toBeGreaterThan(10n ** 36n - 10n ** 22n);
    expect(product).toBeLessThanOrEqual(10n ** 36n);
  });

  it('round-trips through both directions near the real price range', () => {
    // Extreme prices can underflow to zero in one direction; the round trip
    // only holds where both integer prices stay representable.
    for (const sqrtP of [2n ** 90n, 3596635876533259452022784n, 2n ** 96n]) {
      const fwd = spotPriceScaled(sqrtP, 18, 6, PRICE_SCALE);
      const rev = inverseSpotPriceScaled(sqrtP, 18, 6, PRICE_SCALE);
      const err = 10n ** 36n - fwd * rev;
      expect(err >= 0n && err * 10n ** 6n < 10n ** 36n).toBe(true);
    }
  });
});

describe('market intel persistence and freshness', () => {
  it('persists one snapshot per pool/block idempotently', async () => {
    const db = makeDb();
    const tracked = loadTrackedPools(db, { pool: TEST_POOL, venueFactory: VERIFIED_VENUE.factory, verifiedAssets: [WETH, USDG] }).pools[0]!;
    const chain = createFakeChain([fakeBlock(111_408_300, 'aa')]);
    const input = { db, chain: chain as ChainReadPort, tracked, freshnessSeconds: 30 };
    await refreshTrackedPool(input);
    await refreshTrackedPool(input);
    const rows = db.prepare("SELECT COUNT(*) AS count FROM pool_market_snapshots WHERE pool = ?").get(tracked.pool) as { count: number };
    expect(Number(rows.count)).toBe(1);
    expect(latestPoolMarketSnapshot(db, tracked.pool)!.blockNumber).toBe(111_408_300);
  });

  it('returns UNAVAILABLE (never a fake zero) when the pool is empty', async () => {
    const db = makeDb();
    const tracked = loadTrackedPools(db, { pool: TEST_POOL, venueFactory: VERIFIED_VENUE.factory, verifiedAssets: [WETH, USDG] }).pools[0]!;
    const chain = {
      async getHead() {
        return { number: 111_408_300, hash: `0x${'ab'.repeat(32)}` as `0x${string}`, parentHash: `0x${'cd'.repeat(32)}` as `0x${string}`, timestamp: Math.floor(Date.now() / 1000) };
      },
      async getBlockByNumber() { return null; },
      async readPoolState() {
        return { sqrtPriceX96: REAL_SQRT_PRICE_X96, tick: 0, liquidity: 0n, token0: WETH.address, token1: USDG.address };
      },
      async readBalance() { return 0n; },
    } satisfies ChainReadPort;
    const result = await refreshTrackedPool({ db, chain, tracked, freshnessSeconds: 30 });
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.reason).toMatch(/zero liquidity|zero reserves/);
    expect(result.priceToken1PerToken0).toBeNull();
  });

  it('enforces the STALE boundary deterministically', () => {
    const db = makeDb();
    upsertPoolMarketSnapshot(db, {
      pool: TEST_POOL.id.toLowerCase(),
      blockNumber: 100,
      sqrtPriceX96: REAL_SQRT_PRICE_X96.toString(),
      tick: 0,
      liquidity: '1',
      reserve0: '1',
      reserve1: '1',
      priceToken1PerToken0: '1',
      priceToken0PerToken1: '1',
      confidence: 'LOW',
      status: 'AVAILABLE',
      source: 'test',
      sourceTime: new Date(Date.now() - 30_000).toISOString(),
      observedAt: new Date().toISOString(),
    });
    const atWindow = storedStatus(latestPoolMarketSnapshot(db, TEST_POOL.id.toLowerCase()), 30, new Date());
    expect(atWindow.status).toBe('AVAILABLE');
    const beyond = new Date(Date.now() + 1_000);
    const agedRow = latestPoolMarketSnapshot(db, TEST_POOL.id.toLowerCase())!;
    // Re-derive with a clock one second past the window.
    const aged = storedStatus(
      { ...agedRow, sourceTime: new Date(beyond.getTime() - 31_000).toISOString() },
      30,
      beyond,
    );
    expect(aged.status).toBe('STALE');
    expect(storedStatus(null, 30, new Date()).status).toBe('UNAVAILABLE');
  });
});

describe('watchlist persistence', () => {
  it('adds, lists, removes, and survives a database reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trident-intel-'));
    const path = join(dir, 'test.sqlite');
    try {
      const db1 = openDatabase(path);
      expect(addWatchlistEntry(db1, WETH.address.toLowerCase())).toBe('ADDED');
      expect(addWatchlistEntry(db1, WETH.address.toLowerCase())).toBe('EXISTING');
      expect(listWatchlistEntries(db1)).toHaveLength(1);
      db1.close();

      const db2 = openDatabase(path);
      const entries = listWatchlistEntries(db2);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.address).toBe(WETH.address.toLowerCase());
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('HTTP API', () => {
  it('lists the verified pool with LOW confidence and UNAVAILABLE volume', async () => {
    const app = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/pools' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const pool = body.data.pools.find((p: { pool: string }) => p.pool === TEST_POOL.id.toLowerCase());
    expect(pool).toBeDefined();
    expect(pool.confidence).toBe('LOW');
    expect(pool.metrics.volume24h.status).toBe('UNAVAILABLE');
    expect(body.meta.registryStatus).toBe('ABSENT');
  });

  it('detail refresh reports real metrics and persists them', async () => {
    const chain = createFakeChain([fakeBlock(111_408_300, 'aa')]);
    const app = makeApp({ chain: chain as ChainReadPort });
    const response = await app.inject({ method: 'GET', url: `/api/v1/pools/${TEST_POOL.id.toLowerCase()}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.metrics.price.status).toBe('AVAILABLE');
    expect(body.data.metrics.price.token1PerToken0.value).toMatch(/^[0-9]+$/);
    expect(body.data.metrics.liquidity.status).toBe('AVAILABLE');
    expect(body.data.metrics.volume24h.status).toBe('UNAVAILABLE');
    expect(body.data.confidence).toBe('LOW');
  });

  it('includes discovered registry pools and serves them after observation', async () => {
    const db = makeDb();
    seedDiscoveredPools(db);
    const chain = createFakeChain([fakeBlock(111_408_300, 'aa')]);
    const app = makeApp({ db, chain: chain as ChainReadPort });
    const list = await app.inject({ method: 'GET', url: '/api/v1/pools' });
    const pools = list.json().data.pools as { pool: string; venue: string; status: string }[];
    expect(pools.some((p) => p.pool === DISCOVERED_POOL && p.venue === 's3-01-registry')).toBe(true);
    const unobserved = pools.find((p) => p.pool === DISCOVERED_POOL)!;
    expect(unobserved.status).toBe('UNAVAILABLE');

    const detail = await app.inject({ method: 'GET', url: `/api/v1/pools/${DISCOVERED_POOL}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.metrics.price.status).toBe('AVAILABLE');
    const after = await app.inject({ method: 'GET', url: '/api/v1/pools' });
    expect(after.json().data.pools.find((p: { pool: string }) => p.pool === DISCOVERED_POOL).status).toBe('AVAILABLE');
  });

  it('fails closed to the verified pool when the registry is malformed', async () => {
    const db = makeDb();
    db.exec('CREATE TABLE discovered_pools (only_pool TEXT PRIMARY KEY)');
    const app = makeApp({ db });
    const response = await app.inject({ method: 'GET', url: '/api/v1/pools' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.meta.registryStatus).toBe('UNAVAILABLE');
    expect(body.data.pools.some((p: { pool: string }) => p.pool === TEST_POOL.id.toLowerCase())).toBe(true);
  });

  it('filters pools by address/symbol search', async () => {
    const app = makeApp();
    const byToken = await app.inject({ method: 'GET', url: `/api/v1/pools?search=${USDG.address.toLowerCase()}` });
    expect(byToken.json().data.total).toBe(1);
    const bySymbol = await app.inject({ method: 'GET', url: '/api/v1/pools?search=weth' });
    expect(bySymbol.json().data.total).toBe(1);
    const none = await app.inject({ method: 'GET', url: '/api/v1/pools?search=zzz-no-such-token' });
    expect(none.json().data.total).toBe(0);
    expect(none.json().data.pools).toHaveLength(0);
    const bad = await app.inject({ method: 'GET', url: '/api/v1/pools?limit=abc' });
    expect(bad.statusCode).toBe(400);
  });

  it('watchlist: rejects unknown and malformed assets; round-trips known assets', async () => {
    const app = makeApp();
    const unknown = await app.inject({ method: 'POST', url: '/api/v1/watchlist', payload: { address: '0x000000000000000000000000000000000000dEaD' } });
    expect(unknown.statusCode).toBe(404);
    const malformed = await app.inject({ method: 'POST', url: '/api/v1/watchlist', payload: { address: '0xZZZZ' } });
    expect(malformed.statusCode).toBe(400);

    const added = await app.inject({ method: 'POST', url: '/api/v1/watchlist', payload: { address: WETH.address } });
    expect(added.statusCode).toBe(201);
    expect(added.json().data.result).toBe('ADDED');
    const again = await app.inject({ method: 'POST', url: '/api/v1/watchlist', payload: { address: WETH.address } });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.result).toBe('EXISTING');

    const list = await app.inject({ method: 'GET', url: '/api/v1/watchlist' });
    expect(list.json().data.entries).toHaveLength(1);
    expect(list.json().data.entries[0].known).toBe(true);
    expect(list.json().data.entries[0].symbol).toBe('WETH');

    const removed = await app.inject({ method: 'DELETE', url: `/api/v1/watchlist/${WETH.address}` });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().data.result).toBe('REMOVED');
    const absent = await app.inject({ method: 'DELETE', url: `/api/v1/watchlist/${WETH.address}` });
    expect(absent.json().data.result).toBe('ABSENT');
    const empty = await app.inject({ method: 'GET', url: '/api/v1/watchlist' });
    expect(empty.json().data.entries).toHaveLength(0);
  });

  it('discovered-pool evaluations can never produce an intent (read-only)', async () => {
    const db = makeDb();
    seedDiscoveredPools(db);
    const discoveredPool = DISCOVERED_POOL;
    const at = new Date().toISOString();
    db.prepare(
      "INSERT INTO assets (id, symbol, address, decimals, kind, created_at) VALUES ('RAD', 'RAD', ?, 18, 'STABLECOIN', ?)",
    ).run(RAD, at);
    db.prepare(
      "INSERT INTO assets (id, symbol, address, decimals, kind, created_at) VALUES ('USDC', 'USDC', ?, 6, 'STABLECOIN', ?)",
    ).run(USDC, at);
    db.prepare(
      "INSERT INTO pools (id, venue_id, token0_id, token1_id, fee, tick_spacing, created_at) VALUES (?, 'uniswap-v3-robinhood', 'USDC', 'RAD', 10000, 200, ?)",
    ).run(discoveredPool, at);
    db.prepare(
      "INSERT INTO market_snapshots (id, pool_id, chain_id, block_number, block_hash, sqrt_price_x96, tick, liquidity, reserve0, reserve1, price_scaled, price_scale, source, status, source_time, observed_at, created_at) VALUES ('snap-x', ?, 4663, 100, ?, '1000', 0, '1', '1', '1', '1', 18, 'test', 'COMPLETE', ?, ?, ?)",
    ).run(discoveredPool, `0x${'ab'.repeat(32)}`, at, at, at);
    const { insertEvaluation } = await import('../src/db/repositories.js');
    const { evaluation } = insertEvaluation(db, {
      snapshotId: 'snap-x',
      strategyId: DEFAULT_STRATEGY_CONFIG.strategyId,
      configVersion: '1.0.0',
      inputHash: `0x${'cd'.repeat(32)}`,
      action: 'BUY',
      signalStrength: 50,
      proposedAmountIn: '500000000',
      invalidation: 'test',
      reasons: ['test'],
    });
    const response = await makeApp({ db }).inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { evaluationId: evaluation.id, idempotencyKey: 'intel-guard-key-1' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INTENT_NOT_ACTIONABLE');
  });
});
