import { randomUUID } from 'node:crypto';
import type { Db } from './index.js';
import { nowIso } from './index.js';

type Row = Record<string, unknown>;

// --- discovered pool registry (owned by S3-01; read-only here) ---

export type DiscoveredPoolRecord = {
  readonly poolAddress: string;
  readonly factory: string;
  readonly token0: string;
  readonly token1: string;
  readonly token0Symbol: string;
  readonly token1Symbol: string;
  readonly token0Decimals: number;
  readonly token1Decimals: number;
  readonly fee: number;
  readonly firstSeenBlock: number | null;
};

export class RegistryUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryUnreadableError';
  }
}

/** S3-02 consumes the registry S3-01 owns; absence means zero discovered pools, not an error. */
export function registryTableExists(db: Db): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'discovered_pools'")
    .get() as Row | undefined;
  return row !== undefined;
}

/**
 * Reads S3-01's discovered_pools table with the column contract documented in
 * docs/s3-02-market-intelligence.md. Any deviation fails closed.
 */
export function readDiscoveredPools(db: Db): DiscoveredPoolRecord[] {
  if (!registryTableExists(db)) return [];
  const columns = (db.prepare('PRAGMA table_info(discovered_pools)').all() as Row[]).map((r) => String(r['name']));
  const required = ['pool_address', 'factory', 'token0', 'token1', 'token0_symbol', 'token1_symbol', 'token0_decimals', 'token1_decimals', 'fee', 'first_seen_block'];
  const missing = required.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    throw new RegistryUnreadableError(`discovered_pools is missing expected columns: ${missing.join(', ')}`);
  }
  const rows = db.prepare('SELECT pool_address, factory, token0, token1, token0_symbol, token1_symbol, token0_decimals, token1_decimals, fee, first_seen_block FROM discovered_pools').all() as Row[];
  return rows.map((row) => ({
    poolAddress: String(row['pool_address']),
    factory: String(row['factory']),
    token0: String(row['token0']),
    token1: String(row['token1']),
    token0Symbol: String(row['token0_symbol']),
    token1Symbol: String(row['token1_symbol']),
    token0Decimals: Number(row['token0_decimals']),
    token1Decimals: Number(row['token1_decimals']),
    fee: Number(row['fee']),
    firstSeenBlock: row['first_seen_block'] === null || row['first_seen_block'] === undefined ? null : Number(row['first_seen_block']),
  }));
}

// --- persisted market snapshots (owned by S3-02) ---

export type PoolMarketSnapshotRow = {
  readonly id: string;
  readonly pool: string;
  readonly blockNumber: number;
  readonly sqrtPriceX96: string;
  readonly tick: number;
  readonly liquidity: string;
  readonly reserve0: string;
  readonly reserve1: string;
  readonly priceToken1PerToken0: string;
  readonly priceToken0PerToken1: string;
  readonly confidence: 'LOW';
  readonly status: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE';
  readonly source: string;
  readonly sourceTime: string;
  readonly observedAt: string;
};

/** Idempotent: one row per (pool, block). */
export function upsertPoolMarketSnapshot(
  db: Db,
  input: Omit<PoolMarketSnapshotRow, 'id'> & { readonly id?: string },
): { created: boolean } {
  const result = db
    .prepare(
      `INSERT INTO pool_market_snapshots
         (id, pool, block_number, sqrt_price_x96, tick, liquidity, reserve0, reserve1,
          price_token1_per_token0, price_token0_per_token1, confidence, status, source,
          source_time, observed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pool, block_number) DO NOTHING`,
    )
    .run(
      input.id ?? randomUUID(),
      input.pool,
      input.blockNumber,
      input.sqrtPriceX96,
      input.tick,
      input.liquidity,
      input.reserve0,
      input.reserve1,
      input.priceToken1PerToken0,
      input.priceToken0PerToken1,
      input.confidence,
      input.status,
      input.source,
      input.sourceTime,
      input.observedAt,
      nowIso(),
    );
  return { created: Number(result.changes) === 1 };
}

export function latestPoolMarketSnapshot(db: Db, pool: string): PoolMarketSnapshotRow | null {
  const row = db
    .prepare('SELECT * FROM pool_market_snapshots WHERE pool = ? ORDER BY block_number DESC LIMIT 1')
    .get(pool) as Row | undefined;
  return row ? mapMarketSnapshot(row) : null;
}

/** Latest stored snapshot per tracked pool, one row per pool. */
export function latestPoolMarketSnapshots(db: Db): PoolMarketSnapshotRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM pool_market_snapshots s
       WHERE s.block_number = (SELECT MAX(block_number) FROM pool_market_snapshots WHERE pool = s.pool)`,
    )
    .all() as Row[];
  return rows.map(mapMarketSnapshot);
}

function mapMarketSnapshot(row: Row): PoolMarketSnapshotRow {
  return {
    id: String(row['id']),
    pool: String(row['pool']),
    blockNumber: Number(row['block_number']),
    sqrtPriceX96: String(row['sqrt_price_x96']),
    tick: Number(row['tick']),
    liquidity: String(row['liquidity']),
    reserve0: String(row['reserve0']),
    reserve1: String(row['reserve1']),
    priceToken1PerToken0: String(row['price_token1_per_token0']),
    priceToken0PerToken1: String(row['price_token0_per_token1']),
    confidence: 'LOW',
    status: String(row['status']) as PoolMarketSnapshotRow['status'],
    source: String(row['source']),
    sourceTime: String(row['source_time']),
    observedAt: String(row['observed_at']),
  };
}

// --- watchlist (persistent, server-side) ---

export function addWatchlistEntry(db: Db, address: string): 'ADDED' | 'EXISTING' {
  const result = db
    .prepare('INSERT INTO watchlist_entries (address, added_at) VALUES (?, ?) ON CONFLICT(address) DO NOTHING')
    .run(address, nowIso());
  return Number(result.changes) === 1 ? 'ADDED' : 'EXISTING';
}

export function removeWatchlistEntry(db: Db, address: string): 'REMOVED' | 'ABSENT' {
  const result = db.prepare('DELETE FROM watchlist_entries WHERE address = ?').run(address);
  return Number(result.changes) === 1 ? 'REMOVED' : 'ABSENT';
}

export function listWatchlistEntries(db: Db): { address: string; addedAt: string }[] {
  const rows = db.prepare('SELECT address, added_at FROM watchlist_entries ORDER BY added_at ASC, address ASC').all() as Row[];
  return rows.map((row) => ({ address: String(row['address']), addedAt: String(row['added_at']) }));
}

export function isWatchlisted(db: Db, address: string): boolean {
  return db.prepare('SELECT 1 FROM watchlist_entries WHERE address = ?').get(address) !== undefined;
}
