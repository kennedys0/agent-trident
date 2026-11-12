import {
  createWatchlistEntrySchema,
  poolListSchema,
  poolSummarySchema,
  watchlistMutationSchema,
  watchlistSchema,
  type PoolList,
  type PoolSummary,
  type Watchlist,
  type WatchlistMutation,
} from '@trident/api-contract';
import type { Endpoint } from '../../lib/api/endpoints.js';

const BASE = '/api/v1';
const MAX_LIMIT = 50;

export type PoolQuery = {
  readonly search: string;
  readonly limit: number;
  readonly offset: number;
};

/**
 * `GET /api/v1/pools` filters and pages on the backend (substring over pool
 * address, token addresses and symbols). The UI never filters the returned page
 * for text, because that would disagree with `total`.
 */
export const poolsEndpoint = (query: PoolQuery): Endpoint<PoolList> => {
  const params = new URLSearchParams();
  const search = query.search.trim();
  if (search !== '') {
    params.set('search', search);
  }
  params.set('limit', String(Math.min(MAX_LIMIT, Math.max(1, query.limit))));
  params.set('offset', String(Math.max(0, query.offset)));
  return { path: `${BASE}/pools?${params.toString()}`, schema: poolListSchema };
};

/** `GET /api/v1/pools/:address` refreshes one tracked pool; 404 when unknown. */
export const poolEndpoint = (address: string): Endpoint<PoolSummary> => ({
  path: `${BASE}/pools/${encodeURIComponent(address)}`,
  schema: poolSummarySchema,
});

/** `GET /api/v1/watchlist` — server-persisted token addresses. */
export const watchlistEndpoint = (): Endpoint<Watchlist> => ({
  path: `${BASE}/watchlist`,
  schema: watchlistSchema,
});

export const watchlistAddPath = `${BASE}/watchlist`;
export const watchlistRemovePath = (address: string): string =>
  `${BASE}/watchlist/${encodeURIComponent(address)}`;

export const createWatchlistEntry = createWatchlistEntrySchema;
export const watchlistMutation = watchlistMutationSchema;

export type { PoolList, PoolSummary, Watchlist, WatchlistMutation };
export { MAX_LIMIT };
