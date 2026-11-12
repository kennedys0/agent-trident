import type { ReactNode } from 'react';
import { useResource } from '../../../lib/api/hooks.js';
import { poolEndpoint } from '../discoverApi.js';
import type { PoolSummary } from '../discoverContract.js';
import { PoolInspector } from './PoolInspector.js';

function refreshError(meta: Readonly<Record<string, unknown>>): string | null {
  const value = meta['refreshError'];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The token search identifies matching pools; the detail endpoint owns the
 * pinned-block refresh for each pool. Until it answers, the list response is
 * retained. A failed refresh never makes that older response look current.
 */
export function PoolInspectorResource({ initialPool, now }: { readonly initialPool: PoolSummary; readonly now: number }): ReactNode {
  const result = useResource(poolEndpoint(initialPool.pool), { intervalMs: 30_000 });
  const pool = result.data ?? initialPool;
  const metaError = refreshError(result.meta);
  const requestError = result.error?.message ?? null;
  const staleReason = metaError ?? requestError;

  return (
    <>
      {staleReason === null ? null : (
        <p className="banner banner--danger" role="alert" data-testid={`pool-refresh-error-${initialPool.pool}`}>
          Pool refresh failed: {staleReason}. Showing the last successful response with stale status.
        </p>
      )}
      <PoolInspector
        pool={pool}
        now={now}
        forcedStale={staleReason !== null}
        onRefresh={result.refresh}
        isRefreshing={result.isLoading || result.isRefetching}
      />
    </>
  );
}
