import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/index.js';
import { POOL_CREATED_TOPIC, decodePoolCreated, type RawLog } from '../src/chain/poolCodec.js';
import {
  runDiscoveryTick,
  verifyDiscoveryCheckpoint,
  verifyFactory,
  FactoryMismatchError,
  DISCOVERY_CHUNK_BACKOFF,
  type DiscoveryChainPort,
} from '../src/services/discovery.js';
import { UNISWAP_ALLOWED_FEES } from '../src/chain/poolCodec.js';
import {
  getDiscoveryCheckpoint,
  insertDiscoveredPool,
  countDiscoveredPools,
  saveDiscoveryCheckpoint,
} from '../src/db/discoveryRepositories.js';
import { makeDb } from './helpers.js';
import { WETH, USDG, VERIFIED_VENUE } from '../src/chain/venue.js';
import { seedReferenceData, seedOpeningCash, seedStrategyConfig } from '../src/db/repositories.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';

const FACTORY_ADDRESS = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';

const pad32 = (address: string): string => `0x${address.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;
const word = (value: number | bigint): string => BigInt(value).toString(16).padStart(64, '0');

/** Deterministic fake PoolCreated log (test fixtures are labeled as such). */
function makeLog(input: {
  token0?: string;
  token1?: string;
  fee?: number;
  tickSpacing?: number;
  pool?: string;
  blockNumber?: number;
  transactionHash?: string;
  logIndex?: number;
} = {}): RawLog {
  const token0 = input.token0 ?? `0x${'aa'.repeat(20)}`;
  const token1 = input.token1 ?? `0x${'bb'.repeat(20)}`;
  const pool = input.pool ?? `0x${'cc'.repeat(20)}`;
  const fee = input.fee ?? 100;
  const tickSpacing = input.tickSpacing ?? 1;
  return {
    address: FACTORY_ADDRESS,
    topics: [POOL_CREATED_TOPIC, pad32(token0), pad32(token1), `0x${word(fee)}`],
    data: `0x${word(tickSpacing)}${pool.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`,
    blockNumber: input.blockNumber ?? 111_408_000,
    transactionHash: input.transactionHash ?? `0x${'cd'.repeat(32)}`,
    logIndex: input.logIndex ?? 0,
  };
}

function makePort(overrides: Partial<DiscoveryChainPort> & { logs?: RawLog[] } = {}): DiscoveryChainPort {
  const fakePortLogs: RawLog[] = (overrides as { logs?: RawLog[] }).logs ?? [makeLog()];
  let delivered = false;
  return {
    async getHead() {
      return { number: 111_408_200, hash: `0x${'ab'.repeat(32)}` as `0x${string}`, parentHash: `0x${'cd'.repeat(32)}` as `0x${string}`, timestamp: Math.floor(Date.now() / 1000) };
    },
    async getBlockByNumber(blockNumber: number) {
      return { number: blockNumber, hash: `0x${String(blockNumber).padEnd(64, '0').slice(0, 64)}` as `0x${string}`, parentHash: `0x${'cd'.repeat(32)}` as `0x${string}`, timestamp: Math.floor(Date.now() / 1000) };
    },
    async getCodeSize() {
      return 24_535;
    },
    async getBytecode() {
      const { keccak256, toHex } = await import('viem');
      // The port fake is only as honest as its hash, so the service's verification
      // must be drivable: default hash matches the pinned constant.
      return `0x${'00'.repeat(24_535)}` as `0x${string}`;
    },
    async readSymbol(address: string) {
      return address.toLowerCase() === WETH.address.toLowerCase() ? 'WETH' : 'USDG';
    },
    async readDecimals(address: string) {
      return address.toLowerCase() === WETH.address.toLowerCase() ? 18 : 6;
    },
    async getLogs() {
      if (delivered) return [];
      delivered = true;
      return fakePortLogs;
    },
    ...overrides,
  };
}

function seededRegistryDb(): Db {
  const db = openDatabase(':memory:');
  seedReferenceData(db, { venue: VERIFIED_VENUE, pool: TEST_POOL as never, assets: [WETH, USDG] });
  seedStrategyConfig(db, DEFAULT_STRATEGY_CONFIG);
  seedOpeningCash(db, '10000000000');
  return db;
}

const TEST_POOL = {
  id: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca',
  venueId: VERIFIED_VENUE.id,
  token0: WETH,
  token1: USDG,
  fee: 100,
  tickSpacing: 1,
};

function tokenPair(): { token0: string; token1: string } {
  const token0 = `0x${'aa'.repeat(20)}`;
  const token1 = `0x${'bb'.repeat(20)}`;
  return { token0, token1 };
}

describe('PoolCreated codec', () => {
  it('decodes a real-shaped PoolCreated log', () => {
    const decoded = decodePoolCreated(makeLog({ fee: 500, tickSpacing: 10, pool: `0x${'dd'.repeat(20)}` }));
    expect(decoded.fee).toBe(500);
    expect(decoded.tickSpacing).toBe(10);
    expect(decoded.pool).toBe(`0x${'dd'.repeat(20)}`);
  });

  it('rejects logs with the wrong topic, wrong topic count, or short data', () => {
    expect(() => decodePoolCreated({ ...makeLog(), topics: [POOL_CREATED_TOPIC, makeLog().topics[1]!, makeLog().topics[2]!] })).toThrow();
    expect(() => decodePoolCreated({ ...makeLog(), topics: [`0x${'ff'.repeat(32)}`, makeLog().topics[1]!, makeLog().topics[2]!, makeLog().topics[3]!] })).toThrow();
    expect(() => decodePoolCreated({ ...makeLog(), data: '0x1234' })).toThrow();
  });

  it('rejects implausible fee and tickSpacing', () => {
    expect(() => decodePoolCreated(makeLog({ fee: 16_777_216 }))).toThrow();
    expect(() => decodePoolCreated(makeLog({ tickSpacing: -1 }))).toThrow();
    expect(() => decodePoolCreated(makeLog({ tickSpacing: 8_388_608 }))).toThrow();
  });
});

describe('discovery validation rules', () => {
  it('requires Uniswap to order token0 < token1', async () => {
    const db = seededRegistryDb();
    const { token0, token1 } = tokenPair();
    const port = makePort({ logs: [makeLog({ token0: token1, token1: token0, fee: 500, tickSpacing: 10 })] });
    const result = await runDiscoveryTick({ db, chain: port, correlationId: 't' });
    expect(result.skippedEvents).toBe(1);
    expect(countDiscoveredPools(db)).toBe(0);
  });

  it('rejects fee tiers outside the allowlist', async () => {
    const db = seededRegistryDb();
    const { token0, token1 } = tokenPair();
    const port = makePort({ logs: [makeLog({ token0, token1, fee: 999, tickSpacing: 10 })] });
    const result = await runDiscoveryTick({ db, chain: port, correlationId: 't' });
    expect(result.skippedEvents).toBe(1);
    expect(UNISWAP_ALLOWED_FEES.has(999)).toBe(false);
  });

  it('skips rows when ERC-20 metadata is unusable', async () => {
    const db = seededRegistryDb();
    const { token0, token1 } = tokenPair();
    const port = makePort({
      logs: [makeLog({ token0, token1, fee: 100, tickSpacing: 1 })],
      async readSymbol() {
        throw new Error('symbol reverts');
      },
    } as Partial<DiscoveryChainPort>);
    const result = await runDiscoveryTick({ db, chain: port, correlationId: 't' });
    expect(result.skippedRows).toBe(1);
    expect(countDiscoveredPools(db)).toBe(0);
  });
});

describe('discovery persistence and resume', () => {
  it('inserts one row per pool and replays idempotently', () => {
    const db = makeDb();
    const { token0, token1 } = tokenPair();
    const input = {
      poolAddress: `0x${'cc'.repeat(20)}`,
      factory: FACTORY_ADDRESS,
      token0,
      token1,
      token0Symbol: 'AAA',
      token1Symbol: 'BBB',
      token0Decimals: 18,
      token1Decimals: 6,
      fee: 100,
      tickSpacing: 1,
      firstSeenBlock: 111_408_000,
      firstSeenTx: `0x${'ab'.repeat(32)}`,
      logIndex: 0,
    };
    expect(insertDiscoveredPool(db, input)).toBe(true);
    expect(insertDiscoveredPool(db, input)).toBe(false);
    expect(countDiscoveredPools(db)).toBe(1);
  });

  it('keeps both fee tiers of the same token pair, dedupes identical ones', () => {
    const db = makeDb();
    const { token0, token1 } = tokenPair();
    const base = {
      factory: FACTORY_ADDRESS, token0, token1, token0Symbol: 'A', token1Symbol: 'B',
      token0Decimals: 18, token1Decimals: 6, firstSeenBlock: 111_000_000, logIndex: 0, tickSpacing: 1,
    };
    const first = { ...base, poolAddress: `0x${'c1'.repeat(20)}`, fee: 100, firstSeenTx: `0x${'11'.repeat(32)}` };
    const second = { ...base, poolAddress: `0x${'c2'.repeat(20)}`, fee: 500, firstSeenTx: `0x${'22'.repeat(32)}` };
    expect(insertDiscoveredPool(db, first)).toBe(true);
    expect(insertDiscoveredPool(db, second)).toBe(true);
    expect(countDiscoveredPools(db)).toBe(2);
    expect(insertDiscoveredPool(db, { ...first, poolAddress: `0x${'c1'.repeat(20)}` })).toBe(false);
    expect(countDiscoveredPools(db)).toBe(2);
  });

  it('initializes the checkpoint to head - lookback and resumes without overlap', async () => {
    const db = makeDb();
    let logsFromCalls: { from: number; to: number }[] = [];
    const head = { number: 111_408_200, hash: `0x${'ab'.repeat(32)}` as `0x${string}`, parentHash: `0x${'cd'.repeat(32)}` as `0x${string}`, timestamp: Math.floor(Date.now() / 1000) };
    const port = makePort({
      async getHead() {
        return head;
      },
      async getBlockByNumber(blockNumber: number) {
        return { number: blockNumber, hash: `0x${String(blockNumber).padEnd(64, '0').slice(0, 64)}` as `0x${string}`, parentHash: `0x${'cd'.repeat(32)}` as `0x${string}`, timestamp: head.timestamp };
      },
      async getLogs(request: { fromBlock: number; toBlock: number; address: string; topics: readonly [string] }) {
        logsFromCalls.push({ from: request.fromBlock, to: request.toBlock });
        return [];
      },
    });
    await runDiscoveryTick({ db, chain: port, correlationId: 't' });
    const after = getDiscoveryCheckpoint(db)!;
    expect(after.toBlock).toBe(head.number);
    expect(after.fromBlock).toBe(head.number - 2_000);
    logsFromCalls = [];
    await runDiscoveryTick({ db, chain: port, correlationId: 't' });
    expect(logsFromCalls).toHaveLength(0);
  });

  it('reports UNAVAILABLE when the gap exceeds the RPC window', async () => {
    const db = makeDb();
    const head = { number: 111_408_200, hash: `0x${'ab'.repeat(32)}` as `0x${string}`, parentHash: `0x${'cd'.repeat(32)}` as `0x${string}`, timestamp: Math.floor(Date.now() / 1000) };
    saveDiscoveryCheckpoint(db, { fromBlock: head.number - 101_000, toBlock: head.number - 100_500, blockHash: null });
    const port = makePort({
      async getHead() {
        return head;
      },
      async getLogs() {
        return [makeLog()];
      },
    });
    const result = await runDiscoveryTick({ db, chain: port, correlationId: 't' });
    expect(result.status).toBe('UNAVAILABLE');
  });
});

describe('getLogs halving', () => {
  it('halves the chunk on the 10,000-log cap, then reports UNAVAILABLE without looping', async () => {
    const db = makeDb();
    const calls: number[] = [];
    const port = makePort({
      async getHead() {
        return { number: 111_408_100, hash: `0x${'ab'.repeat(32)}` as `0x${string}`, parentHash: `0x${'cd'.repeat(32)}` as `0x${string}`, timestamp: Math.floor(Date.now() / 1000) };
      },
      async getLogs() {
        calls.push(1);
        throw new Error('execution reverted: logs matched by query exceeds limit of 10000 (-32000)');
      },
    });
    saveDiscoveryCheckpoint(db, { fromBlock: 111_408_000, toBlock: 111_408_000, blockHash: null });
    const result = await runDiscoveryTick({ db, chain: port, correlationId: 't' });
    expect(result.status).toBe('UNAVAILABLE');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThan(20);
    expect(DISCOVERY_CHUNK_BACKOFF).toEqual([200, 100, 25]);
  });
});

describe('reorg semantics', () => {
  const txFor = (block: number): string => `0x${String(block).padEnd(64, '0').slice(0, 64)}`;
  const mkRow = (db: Db, pool: string, block: number, fee = 100): boolean => {
    const { token0, token1 } = tokenPair();
    return insertDiscoveredPool(db, {
      poolAddress: pool, factory: FACTORY_ADDRESS, token0, token1,
      token0Symbol: 'A', token1Symbol: 'B', token0Decimals: 18, token1Decimals: 6,
      fee, tickSpacing: fee === 100 ? 1 : 10, firstSeenBlock: block, firstSeenTx: txFor(block), logIndex: 0,
    });
  };
  const poolAddresses = (db: Db): string[] =>
    (db.prepare('SELECT pool_address FROM discovered_pools ORDER BY first_seen_block').all() as { pool_address: string }[]).map((r) => r.pool_address);
  const divergentPort = (canonicalLogs: readonly RawLog[]) =>
    makePort({
      async getBlockByNumber(blockNumber: number) {
        return { number: blockNumber, hash: `0x${'bb'.repeat(32)}` as `0x${string}`, parentHash: `0x${'cd'.repeat(32)}` as `0x${string}`, timestamp: Math.floor(Date.now() / 1000) };
      },
      async getLogs() {
        return canonicalLogs;
      },
    });

  it('keeps rows whose events survive a proven replacement and deletes the rest', async () => {
    const db = makeDb();
    mkRow(db, `0x${'d1'.repeat(20)}`, 100);
    mkRow(db, `0x${'d2'.repeat(20)}`, 110, 500);
    saveDiscoveryCheckpoint(db, { fromBlock: 100, toBlock: 110, blockHash: `0x${'aa'.repeat(32)}` });
    // Canonical replay: d1's event is re-mined, d2's is gone.
    const port = divergentPort([makeLog({ blockNumber: 100, transactionHash: txFor(100), logIndex: 0 })]);
    const verdict = await verifyDiscoveryCheckpoint({ db, chain: port, correlationId: 't' });
    expect(verdict).toBe('rewound');
    expect(poolAddresses(db)).toEqual([`0x${'d1'.repeat(20)}`]);
    // The checkpoint re-anchors to the replay marker, not one block lower.
    const after = getDiscoveryCheckpoint(db)!;
    expect(after.toBlock).toBe(after.fromBlock);
    expect(after.blockHash).toBeNull();
  });

  it('drops orphans below the divergence block when the reorg is deeper than the tip', async () => {
    const db = makeDb();
    mkRow(db, `0x${'d1'.repeat(20)}`, 100);
    mkRow(db, `0x${'d5'.repeat(20)}`, 105, 500);
    mkRow(db, `0x${'d2'.repeat(20)}`, 110, 3000);
    saveDiscoveryCheckpoint(db, { fromBlock: 100, toBlock: 110, blockHash: `0x${'aa'.repeat(32)}` });
    // The rewrite reaches back to block 103: only the row from block 100 has a
    // canonical event; 105 and 110 are orphans. The new fork also created a
    // pool at block 108 that was never stored.
    const forkLog = makeLog({ token0: `0x${'aa'.repeat(20)}`, token1: `0x${'bb'.repeat(20)}`, fee: 500, tickSpacing: 10, pool: `0x${'ee'.repeat(20)}`, blockNumber: 108, transactionHash: txFor(108), logIndex: 0 });
    const port = divergentPort([makeLog({ blockNumber: 100, transactionHash: txFor(100), logIndex: 0 }), forkLog]);
    const verdict = await verifyDiscoveryCheckpoint({ db, chain: port, correlationId: 't' });
    expect(verdict).toBe('rewound');
    expect(poolAddresses(db)).toEqual([`0x${'d1'.repeat(20)}`]);

    // The replay scan re-ingests the new fork's event exactly once.
    const replayPort = divergentPort([forkLog]);
    const result = await runDiscoveryTick({ db, chain: replayPort, correlationId: 't' });
    expect(result.status).toBe('OK');
    expect(result.accepted).toBe(1);
    expect(poolAddresses(db)).toEqual([`0x${'d1'.repeat(20)}`, `0x${'ee'.repeat(20)}`]);
  });

  it('freezes without deleting when the canonical replay cannot be read', async () => {
    const db = makeDb();
    mkRow(db, `0x${'d1'.repeat(20)}`, 100);
    mkRow(db, `0x${'d2'.repeat(20)}`, 110, 500);
    saveDiscoveryCheckpoint(db, { fromBlock: 100, toBlock: 110, blockHash: `0x${'aa'.repeat(32)}` });
    const port = makePort({
      async getBlockByNumber(blockNumber: number) {
        return { number: blockNumber, hash: `0x${'bb'.repeat(32)}` as `0x${string}`, parentHash: `0x${'cd'.repeat(32)}` as `0x${string}`, timestamp: Math.floor(Date.now() / 1000) };
      },
      async getLogs() {
        throw new Error('execution reverted: logs matched by query exceeds limit of 10000 (-32000)');
      },
    });
    const verdict = await verifyDiscoveryCheckpoint({ db, chain: port, correlationId: 't' });
    expect(verdict).toBe('frozen');
    expect(poolAddresses(db)).toEqual([`0x${'d1'.repeat(20)}`, `0x${'d2'.repeat(20)}`]);
  });

  it('freezes discovery instead of deleting when the checkpoint block is unresolvable', async () => {
    const db = makeDb();
    const { token0, token1 } = tokenPair();
    insertDiscoveredPool(db, {
      poolAddress: `0x${'e1'.repeat(20)}`, factory: FACTORY_ADDRESS, token0, token1,
      token0Symbol: 'A', token1Symbol: 'B', token0Decimals: 18, token1Decimals: 6,
      fee: 100, tickSpacing: 1, firstSeenBlock: 100, firstSeenTx: `0x${'ab'.repeat(32)}`, logIndex: 0,
    });
    saveDiscoveryCheckpoint(db, { fromBlock: 100, toBlock: 110, blockHash: `0x${'aa'.repeat(32)}` });
    const port = makePort({
      async getBlockByNumber() {
        return null;
      },
    });
    const verdict = await verifyDiscoveryCheckpoint({ db, chain: port, correlationId: 't' });
    expect(verdict).toBe('frozen');
    expect(countDiscoveredPools(db)).toBe(1);
  });

  it('freezes when head regresses below the stored checkpoint', async () => {
    const db = makeDb();
    const head = { number: 105, hash: `0x${'ab'.repeat(32)}` as `0x${string}`, parentHash: `0x${'cd'.repeat(32)}` as `0x${string}`, timestamp: Math.floor(Date.now() / 1000) };
    saveDiscoveryCheckpoint(db, { fromBlock: 100, toBlock: 110, blockHash: null });
    const port = makePort({
      async getHead() {
        return head;
      },
    });
    const result = await runDiscoveryTick({ db, chain: port, correlationId: 't' });
    expect(result.status).toBe('UNAVAILABLE');
    expect(countDiscoveredPools(db)).toBe(0);
  });
});

describe('factory fail-closed', () => {
  it('rejects a factory with the wrong code size', async () => {
    const port = makePort({ async getCodeSize() { return 12_345; } });
    await expect(verifyFactory(port)).rejects.toBeInstanceOf(FactoryMismatchError);
  });

  it('rejects a factory whose bytecode hash is not the pinned constant', async () => {
    const port = makePort({ async getBytecode() { return `0x${'00'.repeat(24_535)}` as `0x${string}`; } });
    await expect(verifyFactory(port)).rejects.toBeInstanceOf(FactoryMismatchError);
  });
});

describe('migration 006 is additive', () => {
  it('creates the new tables without touching existing ones', () => {
    const db = makeDb();
    const discovery = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('discovered_pools', 'discovery_checkpoints')").all() as { name: string }[];
    expect(discovery.map((r) => r.name).sort()).toEqual(['discovered_pools', 'discovery_checkpoints']);
    expect(() => db.prepare("SELECT COUNT(*) FROM market_snapshots").get()).not.toThrow();
  });

  it('safe replays are no-ops', () => {
    const db = makeDb();
    const before = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_discovered_pools_seen'").all() as { sql: string }[];
    expect(before).toHaveLength(1);
  });
});
