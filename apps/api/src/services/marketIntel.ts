import type { Db } from '../db/index.js';
import {
  isWatchlisted,
  latestPoolMarketSnapshot,
  latestPoolMarketSnapshots,
  listWatchlistEntries,
  readDiscoveredPools,
  registryTableExists,
  RegistryUnreadableError,
  upsertPoolMarketSnapshot,
  type DiscoveredPoolRecord,
  type PoolMarketSnapshotRow,
} from '../db/marketIntelRepositories.js';
import { inverseSpotPriceScaled, spotPriceScaled, PRICE_SCALE } from '../domain/price.js';
import type { ChainReadPort } from '../chain/client.js';
import type { AssetIdentity, PoolIdentity } from '../domain/types.js';

export type TrackedPool = {
  readonly pool: string;
  readonly factory: string;
  readonly fee: number;
  readonly token0: { address: string; symbol: string; decimals: number };
  readonly token1: { address: string; symbol: string; decimals: number };
  readonly firstSeenBlock: number | null;
  readonly venue: 'verified-allowlist' | 's3-01-registry';
};

export type TrackedPoolLoad = {
  readonly pools: TrackedPool[];
  readonly registryStatus: 'OK' | 'ABSENT' | 'UNAVAILABLE';
  readonly registrySkipped: number;
};

const evmAddressRe = /^0x[0-9a-fA-F]{40}$/;

function sanitizePool(record: DiscoveredPoolRecord): TrackedPool | null {
  try {
    if (!evmAddressRe.test(record.poolAddress)) return null;
    if (!evmAddressRe.test(record.factory)) return null;
    if (!evmAddressRe.test(record.token0)) return null;
    if (!evmAddressRe.test(record.token1)) return null;
    if (!Number.isInteger(record.token0Decimals) || record.token0Decimals < 0 || record.token0Decimals > 255) return null;
    if (!Number.isInteger(record.token1Decimals) || record.token1Decimals < 0 || record.token1Decimals > 255) return null;
    if (!Number.isInteger(record.fee) || record.fee <= 0 || record.fee > 1_000_000) return null;
    if (!record.token0Symbol?.trim() || !record.token1Symbol?.trim()) return null;
    if (record.token0Symbol.length > 64 || record.token1Symbol.length > 64) return null;
    if (record.token0.toLowerCase() === record.token1.toLowerCase()) return null;
    return {
      pool: record.poolAddress.toLowerCase(),
      factory: record.factory.toLowerCase(),
      fee: record.fee,
      token0: { address: record.token0.toLowerCase(), symbol: record.token0Symbol, decimals: record.token0Decimals },
      token1: { address: record.token1.toLowerCase(), symbol: record.token1Symbol, decimals: record.token1Decimals },
      firstSeenBlock: record.firstSeenBlock,
      venue: 's3-01-registry',
    };
  } catch {
    return null;
  }
}

export function loadTrackedPools(
  db: Db,
  verified: { pool: PoolIdentity; venueFactory: string; verifiedAssets: readonly AssetIdentity[] },
): TrackedPoolLoad {
  const verifiedPool: TrackedPool = {
    pool: verified.pool.id.toLowerCase(),
    factory: verified.venueFactory.toLowerCase(),
    fee: verified.pool.fee,
    token0: assetRef(verified.pool.token0.id, byId(verified.verifiedAssets, verified.pool.token0.id)),
    token1: assetRef(verified.pool.token1.id, byId(verified.verifiedAssets, verified.pool.token1.id)),
    firstSeenBlock: null,
    venue: 'verified-allowlist',
  };

  // The verified allowlist is always tracked; S3-01 rows extend it when present.
  let registryStatus: TrackedPoolLoad['registryStatus'] = 'ABSENT';
  let discovered: DiscoveredPoolRecord[] = [];
  let registrySkipped = 0;
  if (!registryTableExists(db)) {
    registryStatus = 'ABSENT';
  } else {
    try {
      discovered = readDiscoveredPools(db);
      registryStatus = 'OK';
    } catch (error) {
      if (error instanceof RegistryUnreadableError) {
        registryStatus = 'UNAVAILABLE';
        discovered = [];
      } else {
        throw error;
      }
    }
  }

  const tracked = new Map<string, TrackedPool>();
  tracked.set(verifiedPool.pool, verifiedPool);
  for (const record of discovered) {
    const clean = sanitizePool(record);
    if (clean === null) {
      registrySkipped += 1;
      continue;
    }
    if (!tracked.has(clean.pool)) tracked.set(clean.pool, clean);
  }
  return { pools: [...tracked.values()], registryStatus, registrySkipped };
}

function byId(assets: readonly AssetIdentity[], id: string): AssetIdentity {
  const asset = assets.find((a) => a.id === id);
  if (!asset) throw new Error(`verified asset ${id} is missing from the allowlist`);
  return asset;
}

function assetRef(_id: string, asset: AssetIdentity) {
  return { address: asset.address.toLowerCase(), symbol: asset.symbol, decimals: asset.decimals };
}

export type RefreshResult = {
  readonly status: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE';
  readonly reason?: string;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly sourceTime: string;
  readonly observedAt: string;
  readonly priceToken1PerToken0: bigint | null;
  readonly priceToken0PerToken1: bigint | null;
  readonly liquidity: string | null;
  readonly reserve0: bigint | null;
  readonly reserve1: bigint | null;
  readonly source: string;
  readonly freshnessSeconds: number;
};

/**
 * Pinned-block refresh for one tracked pool. A failed read returns UNAVAILABLE
 * with the reason; nothing is invented. The snapshot row is persisted
 * idempotently (one row per pool/block).
 */
export async function refreshTrackedPool(input: {
  readonly db: Db;
  readonly chain: ChainReadPort;
  readonly tracked: TrackedPool;
  readonly freshnessSeconds: number;
  readonly now?: Date;
}): Promise<RefreshResult> {
  const now = input.now ?? new Date();
  const head = await input.chain.getHead();
  const [state, balance0, balance1] = await Promise.all([
    input.chain.readPoolState(input.tracked.pool as `0x${string}`, head.number),
    input.chain.readBalance(input.tracked.token0.address as `0x${string}`, input.tracked.pool as `0x${string}`, head.number),
    input.chain.readBalance(input.tracked.token1.address as `0x${string}`, input.tracked.pool as `0x${string}`, head.number),
  ]);

  const blockNumber = head.number;
  const sourceTime = new Date(head.timestamp * 1000).toISOString();
  const observedAt = now.toISOString();
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - head.timestamp * 1000) / 1000));

  if (state.liquidity === 0n || balance0 === 0n || balance1 === 0n) {
    persist(input.db, input.tracked, { blockNumber, state, balance0, balance1, sourceTime, observedAt, status: 'UNAVAILABLE', priceFwd: 0n, priceRev: 0n });
    return {
      status: 'UNAVAILABLE',
      reason: 'pool reports zero liquidity or zero reserves',
      blockNumber,
      blockHash: head.hash,
      sourceTime,
      observedAt,
      priceToken1PerToken0: null,
      priceToken0PerToken1: null,
      liquidity: null,
      reserve0: null,
      reserve1: null,
      source: 'uniswap-v3-slot0+balanceOf',
      freshnessSeconds: input.freshnessSeconds,
    };
  }

  const priceFwd = spotPriceScaled(state.sqrtPriceX96, input.tracked.token0.decimals, input.tracked.token1.decimals, PRICE_SCALE);
  const priceRev = inverseSpotPriceScaled(state.sqrtPriceX96, input.tracked.token0.decimals, input.tracked.token1.decimals, PRICE_SCALE);

  const status: 'AVAILABLE' | 'STALE' = ageSeconds > input.freshnessSeconds ? 'STALE' : 'AVAILABLE';
  const row = persist(input.db, input.tracked, { blockNumber, state, balance0, balance1, sourceTime, observedAt, status, priceFwd, priceRev });

  return {
    status: row.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : status,
    blockNumber,
    blockHash: head.hash,
    sourceTime,
    observedAt,
    priceToken1PerToken0: priceFwd,
    priceToken0PerToken1: priceRev,
    liquidity: state.liquidity.toString(),
    reserve0: balance0,
    reserve1: balance1,
    source: `uniswap-v3-slot0+balanceOf@block-${blockNumber}`,
    freshnessSeconds: input.freshnessSeconds,
  };
}

function persist(
  db: Db,
  tracked: TrackedPool,
  input: {
    blockNumber: number;
    state: { sqrtPriceX96: bigint; tick: number; liquidity: bigint };
    balance0: bigint;
    balance1: bigint;
    sourceTime: string;
    observedAt: string;
    status: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE';
    priceFwd: bigint;
    priceRev: bigint;
  },
): PoolMarketSnapshotRow {
  upsertPoolMarketSnapshot(db, {
    pool: tracked.pool,
    blockNumber: input.blockNumber,
    sqrtPriceX96: input.state.sqrtPriceX96.toString(),
    tick: input.state.tick,
    liquidity: input.state.liquidity.toString(),
    reserve0: input.balance0.toString(),
    reserve1: input.balance1.toString(),
    priceToken1PerToken0: input.priceFwd.toString(),
    priceToken0PerToken1: input.priceRev.toString(),
    confidence: 'LOW',
    status: input.status,
    source: `uniswap-v3-slot0+balanceOf@block-${input.blockNumber}`,
    sourceTime: input.sourceTime,
    observedAt: input.observedAt,
  });
  return latestPoolMarketSnapshot(db, tracked.pool)!;
}

/** Freshness state for the stored (list) view; never re-reads chain data. */
export function storedStatus(
  row: PoolMarketSnapshotRow | null,
  freshnessSeconds: number,
  now: Date,
): { status: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE'; reason?: string } {
  if (row === null) {
    return { status: 'UNAVAILABLE', reason: 'no observation persisted yet; refresh the pool detail endpoint' };
  }
  if (row.status === 'UNAVAILABLE') {
    return { status: 'UNAVAILABLE', reason: 'last observation recorded zero liquidity or zero reserves' };
  }
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - new Date(row.sourceTime).getTime()) / 1000));
  return ageSeconds > freshnessSeconds
    ? { status: 'STALE', reason: `observation is ${ageSeconds}s old (freshness window ${freshnessSeconds}s)` }
    : { status: 'AVAILABLE' };
}

export function isKnownAsset(db: Db, verifiedAssets: readonly AssetIdentity[], address: string): boolean {
  const lower = address.toLowerCase();
  if (verifiedAssets.some((asset) => asset.address.toLowerCase() === lower)) return true;
  const rows = readDiscoveredPools(db).flatMap((r) => [r.token0, r.token1]);
  return rows.some((token) => token.toLowerCase() === lower);
}

export { isWatchlisted, listWatchlistEntries };
export type { DiscoveredPoolRecord };
