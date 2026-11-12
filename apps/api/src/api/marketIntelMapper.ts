import {
  poolListSchema,
  poolSummarySchema,
  watchlistMutationSchema,
  watchlistSchema,
  type PoolSummary,
  type Watchlist,
  type WatchlistMutation,
} from '@trident/api-contract';
import type { TrackedPool } from '../services/marketIntel.js';
import type { PoolMarketSnapshotRow } from '../db/marketIntelRepositories.js';

export const VOLUME_UNAVAILABLE_REASON =
  'no verifiable volume source; the public RPC exposes no pinned-block per-pool volume';

export const LOW_CONFIDENCE_REASON =
  'single Uniswap v3 pool; a spot price is not an independent oracle';

const unavailableVolume = {
  status: 'UNAVAILABLE' as const,
  reason: VOLUME_UNAVAILABLE_REASON,
};

function priceMetricFromSnapshot(row: PoolMarketSnapshotRow) {
  if (row.status === 'UNAVAILABLE') {
    return {
      status: 'UNAVAILABLE',
      reason: 'last observation recorded zero liquidity or zero reserves',
    };
  }
  return {
    status: row.status as 'AVAILABLE' | 'STALE',
    blockNumber: BigInt(row.blockNumber).toString(),
    sourceTime: row.sourceTime,
    observedAt: row.observedAt,
    provenance: row.source,
    token1PerToken0: { value: row.priceToken1PerToken0, scale: '1000000000000000000' },
    token0PerToken1: { value: row.priceToken0PerToken1, scale: '1000000000000000000' },
  };
}

function liquidityMetricFromSnapshot(
  row: PoolMarketSnapshotRow,
  decimals0: number,
  decimals1: number,
) {
  if (row.status === 'UNAVAILABLE') {
    return {
      status: 'UNAVAILABLE',
      reason: 'last observation recorded zero liquidity or zero reserves',
    };
  }
  return {
    status: row.status as 'AVAILABLE' | 'STALE',
    blockNumber: BigInt(row.blockNumber).toString(),
    sourceTime: row.sourceTime,
    observedAt: row.observedAt,
    provenance: `${row.source}; reserves via balanceOf at block ${row.blockNumber}`,
    liquidity: row.liquidity,
    reserve0: row.reserve0,
    reserve1: row.reserve1,
    reserve0Decimals: decimals0,
    reserve1Decimals: decimals1,
  };
}

const UNAVAILABLE_PRICE = {
  status: 'UNAVAILABLE' as const,
  reason: 'no observation persisted yet; refresh the pool detail endpoint',
};
const UNAVAILABLE_LIQUIDITY = {
  status: 'UNAVAILABLE' as const,
  reason: 'no observation persisted yet; refresh the pool detail endpoint',
};

/**
 * List view: serves only persisted observations; the chain is never re-read
 * here so one page cannot fan out into N RPC calls.
 */
export function toPoolSummaryFromStored(
  tracked: TrackedPool,
  row: PoolMarketSnapshotRow | null,
  status: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE',
  reason: string | undefined,
  watched: boolean,
): PoolSummary {
  const base = {
    chainId: 4663 as const,
    pool: tracked.pool,
    factory: tracked.factory,
    fee: tracked.fee,
    token0: { address: tracked.token0.address, symbol: tracked.token0.symbol, decimals: tracked.token0.decimals },
    token1: { address: tracked.token1.address, symbol: tracked.token1.symbol, decimals: tracked.token1.decimals },
    venue: tracked.venue,
    firstSeenBlock:
      tracked.firstSeenBlock === null ? null : BigInt(tracked.firstSeenBlock).toString(),
    confidence: 'LOW' as const,
    confidenceReason: LOW_CONFIDENCE_REASON,
    watched,
  };
  if (row === null || status === 'UNAVAILABLE') {
    return poolSummarySchema.parse({
      ...base,
      status: 'UNAVAILABLE',
      reason: reason ?? 'no observation persisted yet; refresh the pool detail endpoint',
      metrics: {
        price: UNAVAILABLE_PRICE,
        liquidity: UNAVAILABLE_LIQUIDITY,
        volume24h: unavailableVolume,
      },
    });
  }
  return poolSummarySchema.parse({
    ...base,
    status,
    ...(reason === undefined ? {} : { reason }),
    metrics: {
      price: priceMetricFromSnapshot(row),
      liquidity: liquidityMetricFromSnapshot(row, tracked.token0.decimals, tracked.token1.decimals),
      volume24h: unavailableVolume,
    },
  });
}

/**
 * Detail view: the chain read already happened; values come from the fresh
 * pull. UNAVAILABLE means the read failed or the pool is empty, never fabricated.
 */
export function toPoolSummaryFromRefresh(
  tracked: TrackedPool,
  refresh: {
    status: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE';
    reason?: string | undefined;
    blockNumber: number;
    blockHash: string;
    sourceTime: string;
    observedAt: string;
    priceToken1PerToken0: bigint | null;
    priceToken0PerToken1: bigint | null;
    liquidity: string | null;
    reserve0: bigint | null;
    reserve1: bigint | null;
    source: string;
  },
  watched: boolean,
): PoolSummary {
  const base = {
    chainId: 4663 as const,
    pool: tracked.pool,
    factory: tracked.factory,
    fee: tracked.fee,
    token0: { address: tracked.token0.address, symbol: tracked.token0.symbol, decimals: tracked.token0.decimals },
    token1: { address: tracked.token1.address, symbol: tracked.token1.symbol, decimals: tracked.token1.decimals },
    venue: tracked.venue,
    firstSeenBlock:
      tracked.firstSeenBlock === null ? null : BigInt(tracked.firstSeenBlock).toString(),
    confidence: 'LOW' as const,
    confidenceReason: LOW_CONFIDENCE_REASON,
    watched,
  };

  if (
    refresh.status === 'UNAVAILABLE' ||
    refresh.priceToken1PerToken0 === null ||
    refresh.priceToken0PerToken1 === null ||
    refresh.liquidity === null ||
    refresh.reserve0 === null ||
    refresh.reserve1 === null
  ) {
    return poolSummarySchema.parse({
      ...base,
      status: 'UNAVAILABLE',
      reason: refresh.reason ?? 'pool observation unavailable',
      metrics: {
        price: { status: 'UNAVAILABLE', reason: refresh.reason ?? 'pool observation unavailable' },
        liquidity: { status: 'UNAVAILABLE', reason: refresh.reason ?? 'pool observation unavailable' },
        volume24h: unavailableVolume,
      },
    });
  }

  const blockNumber = BigInt(refresh.blockNumber).toString();
  const okStatus = refresh.status as 'AVAILABLE' | 'STALE';
  const provenance = `${refresh.source}; reserves via balanceOf at block ${blockNumber}; blockHash ${refresh.blockHash}`;
  return poolSummarySchema.parse({
    ...base,
    status: okStatus,
    metrics: {
      price: {
        status: okStatus,
        blockNumber,
        sourceTime: refresh.sourceTime,
        observedAt: refresh.observedAt,
        provenance,
        token1PerToken0: { value: refresh.priceToken1PerToken0.toString(), scale: '1000000000000000000' },
        token0PerToken1: { value: refresh.priceToken0PerToken1.toString(), scale: '1000000000000000000' },
      },
      liquidity: {
        status: okStatus,
        blockNumber,
        sourceTime: refresh.sourceTime,
        observedAt: refresh.observedAt,
        provenance,
        liquidity: refresh.liquidity,
        reserve0: refresh.reserve0.toString(),
        reserve1: refresh.reserve1.toString(),
        reserve0Decimals: tracked.token0.decimals,
        reserve1Decimals: tracked.token1.decimals,
      },
      volume24h: unavailableVolume,
    },
  });
}

export function toPoolList(pools: PoolSummary[], offset: number, limit: number, total: number) {
  return poolListSchema.parse({
    pools,
    total,
    offset,
    limit,
  });
}

export function toWatchlist(
  entries: { address: string; addedAt: string }[],
  known: (address: string) => { known: boolean; symbol?: string | undefined },
): Watchlist {
  return watchlistSchema.parse({
    entries: entries.map((entry) => {
      const info = known(entry.address);
      return {
        address: entry.address,
        addedAt: entry.addedAt,
        known: info.known,
        ...(info.symbol === undefined ? {} : { symbol: info.symbol }),
      };
    }),
  });
}

export function toWatchlistMutation(address: string, result: WatchlistMutation['result']): WatchlistMutation {
  return watchlistMutationSchema.parse({ address, result });
}
