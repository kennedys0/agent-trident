import { randomUUID } from 'node:crypto';
import { PRICE_SCALE, spotPriceScaled } from './price.js';
import type { PoolSnapshot, PoolIdentity, SnapshotStatus } from './types.js';

export type SnapshotInput = {
  readonly pool: PoolIdentity;
  readonly blockNumber: number;
  readonly blockHash: `0x${string}`;
  /** Chain block timestamp in seconds; becomes `sourceTime`. */
  readonly blockTimestampSeconds: number;
  readonly sqrtPriceX96: bigint;
  readonly tick: number;
  readonly liquidity: bigint;
  readonly reserve0: bigint;
  readonly reserve1: bigint;
  readonly observedAt: Date;
  readonly freshnessSeconds: number;
};

/**
 * Builds a block-pinned snapshot. `sourceTime` is the chain block timestamp,
 * `observedAt` is when this process read it; both are kept so staleness is a
 * derived fact rather than an assumption.
 */
export function buildSnapshot(input: SnapshotInput, id: string = randomUUID()): PoolSnapshot {
  const quoteIsToken1 = input.pool.token1.id === 'USDG';
  const baseDecimals = quoteIsToken1 ? input.pool.token0.decimals : input.pool.token1.decimals;
  const quoteDecimals = quoteIsToken1 ? input.pool.token1.decimals : input.pool.token0.decimals;

  const priceScaled = spotPriceScaled(input.sqrtPriceX96, baseDecimals, quoteDecimals, PRICE_SCALE).toString();
  const sourceTime = new Date(input.blockTimestampSeconds * 1000).toISOString();
  const observedAt = input.observedAt.toISOString();
  const blockAgeSeconds = Math.max(0, (input.observedAt.getTime() - input.blockTimestampSeconds * 1000) / 1000);
  const status: SnapshotStatus =
    input.liquidity === 0n || input.reserve0 === 0n || input.reserve1 === 0n
      ? 'INCOMPLETE'
      : blockAgeSeconds > input.freshnessSeconds
        ? 'STALE'
        : 'COMPLETE';

  return {
    id,
    poolId: input.pool.id,
    chainId: 4663,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    sqrtPriceX96: input.sqrtPriceX96.toString(),
    tick: input.tick,
    liquidity: input.liquidity.toString(),
    reserve0: input.reserve0.toString(),
    reserve1: input.reserve1.toString(),
    priceScaled,
    priceScale: PRICE_SCALE,
    source: 'uniswap-v3-pool+quoter',
    status,
    sourceTime,
    observedAt,
  };
}

/** Freshness is recomputed at read time; a stored COMPLETE row can become STALE. */
export function effectiveStatus(snapshot: PoolSnapshot, now: Date, freshnessSeconds: number): SnapshotStatus {
  if (snapshot.status === 'INCOMPLETE') return 'INCOMPLETE';
  const ageSeconds = (now.getTime() - new Date(snapshot.observedAt).getTime()) / 1000;
  return ageSeconds > freshnessSeconds ? 'STALE' : snapshot.status;
}

export function ageSeconds(snapshot: PoolSnapshot, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(snapshot.observedAt).getTime()) / 1000));
}