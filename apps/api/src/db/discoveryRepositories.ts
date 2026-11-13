import { randomUUID } from 'node:crypto';
import type { Db } from './index.js';
import { nowIso } from './index.js';

type Row = Record<string, unknown>;

/** Singleton discovery checkpoint. One row total (id = 1). */
export type DiscoveryCheckpoint = {
  readonly fromBlock: number;
  readonly toBlock: number;
  readonly blockHash: string | null;
  readonly updatedAt: string;
};

export function getDiscoveryCheckpoint(db: Db): DiscoveryCheckpoint | null {
  const row = db.prepare('SELECT from_block, to_block, block_hash, updated_at FROM discovery_checkpoints WHERE id = 1').get() as Row | undefined;
  if (!row) return null;
  return {
    fromBlock: Number(row['from_block']),
    toBlock: Number(row['to_block']),
    blockHash: row['block_hash'] === null || row['block_hash'] === undefined ? null : String(row['block_hash']),
    updatedAt: String(row['updated_at']),
  };
}

export function saveDiscoveryCheckpoint(
  db: Db,
  input: { readonly fromBlock: number; readonly toBlock: number; readonly blockHash: string | null },
): void {
  db.prepare(
    `INSERT INTO discovery_checkpoints (id, chain_id, from_block, to_block, block_hash, updated_at)
     VALUES (1, 4663, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET from_block = excluded.from_block, to_block = excluded.to_block, block_hash = excluded.block_hash, updated_at = excluded.updated_at`,
  ).run(input.fromBlock, input.toBlock, input.blockHash, nowIso());
}

export type DiscoveredPoolRow = {
  readonly poolAddress: string;
};

/** Idempotent insert keyed by pool address; returns true when the row was new. */
export function insertDiscoveredPool(
  db: Db,
  input: {
    readonly poolAddress: string;
    readonly factory: string;
    readonly token0: string;
    readonly token1: string;
    readonly token0Symbol: string;
    readonly token1Symbol: string;
    readonly token0Decimals: number;
    readonly token1Decimals: number;
    readonly fee: number;
    readonly tickSpacing: number;
    readonly firstSeenBlock: number;
    readonly firstSeenTx: string;
    readonly logIndex: number;
  },
): boolean {
  const result = db
    .prepare(
      `INSERT INTO discovered_pools
         (pool_address, factory, token0, token1, token0_symbol, token1_symbol,
          token0_decimals, token1_decimals, fee, tick_spacing,
          first_seen_block, first_seen_tx, log_index, discovered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pool_address) DO NOTHING`,
    )
    .run(
      input.poolAddress.toLowerCase(),
      input.factory.toLowerCase(),
      input.token0.toLowerCase(),
      input.token1.toLowerCase(),
      input.token0Symbol,
      input.token1Symbol,
      input.token0Decimals,
      input.token1Decimals,
      input.fee,
      input.tickSpacing,
      input.firstSeenBlock,
      input.firstSeenTx.toLowerCase(),
      input.logIndex,
      nowIso(),
    );
  return Number(result.changes) === 1;
}

/** Rows whose first_seen_block is at or above the divergence block are deleted by a proven rewind. */
export function deleteDiscoveredPoolsFrom(db: Db, divergenceBlock: number): DiscoveredPoolRow[] {
  const rows = db
    .prepare('SELECT pool_address FROM discovered_pools WHERE first_seen_block >= ?')
    .all(divergenceBlock) as Row[];
  db.prepare('DELETE FROM discovered_pools WHERE first_seen_block >= ?').run(divergenceBlock);
  return rows.map((row) => ({ poolAddress: String(row['pool_address']) }));
}

/**
 * Proven-rewind delete: rows at/above the divergence block are always removed
 * (their block was replaced); rows below it survive only when their
 * (first_seen_tx, log_index) still exists in the canonical replay. Every
 * deletion is per-row and parameterized.
 */
export function deleteDiscoveredPoolsNotCanonical(
  db: Db,
  divergenceBlock: number,
  canonicalKeys: ReadonlySet<string>,
): DiscoveredPoolRow[] {
  const rows = db
    .prepare('SELECT pool_address, first_seen_tx, log_index FROM discovered_pools')
    .all() as Row[];
  const doomed = rows.filter((row) => {
    if (Number(row['first_seen_block']) >= divergenceBlock) return true;
    return !canonicalKeys.has(`${String(row['first_seen_tx']).toLowerCase()}:${Number(row['log_index'])}`);
  });
  const byAddress = db.prepare('DELETE FROM discovered_pools WHERE pool_address = ?');
  for (const row of doomed) byAddress.run(String(row['pool_address']));
  return doomed.map((row) => ({ poolAddress: String(row['pool_address']) }));
}

export function countDiscoveredPools(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM discovered_pools').get() as Row;
  return Number(row['count']);
}
