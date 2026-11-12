import type { ReactNode } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useStatus } from '../../app/StatusProvider.js';
import { StateView, isOfflineError } from '../../components/StateView.js';
import { ApiError } from '../../lib/api/client.js';
import { useResource } from '../../lib/api/hooks.js';
import { PoolInspector } from './components/PoolInspector.js';
import { poolEndpoint } from './discoverApi.js';
import { useWatchlist } from './useWatchlist.js';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function metaRefreshError(meta: Readonly<Record<string, unknown>>): string | null {
  const value = meta['refreshError'];
  return typeof value === 'string' && value !== '' ? value : null;
}

function errorTitle(error: Error): string {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 ? 'Request rejected' : 'Backend error';
}

function errorText(error: Error): string {
  return error instanceof ApiError && error.status >= 400 && error.status < 500
    ? error.message
    : 'The backend could not complete this request.';
}

export function PoolInspectorPage(): ReactNode {
  const { address = '' } = useParams();
  const { now, online } = useStatus();
  const valid = ADDRESS.test(address);
  const result = useResource(poolEndpoint(address), { intervalMs: 30_000, enabled: valid });
  const watch = useWatchlist();
  const refreshError = metaRefreshError(result.meta) ?? result.error?.message ?? null;

  const back = (
    <Link to="/discover" className="btn btn--quiet">
      <ArrowLeft size={16} aria-hidden="true" />
      Back to Discover
    </Link>
  );

  if (!valid) {
    return (
      <>
        {back}
        <StateView
          kind="empty"
          title="Unknown pool"
          text={`${address || '(empty address)'} is not a valid pool address.`}
          testId="pool-invalid"
        />
      </>
    );
  }

  if (result.isLoading) {
    return (
      <>
        {back}
        <StateView kind="loading" title="Loading the pool…" testId="pool-loading" />
      </>
    );
  }

  if (result.error !== null && result.data === null) {
    if (result.error instanceof ApiError && result.error.status === 404) {
      return (
        <>
          {back}
          <StateView kind="empty" title="Unknown pool" text={address} onRetry={result.refresh} testId="pool-unknown" />
        </>
      );
    }
    return (
      <>
        {back}
        <StateView
          kind={isOfflineError(result.error) && !online ? 'offline' : 'error'}
          title={isOfflineError(result.error) && !online ? 'You are offline' : errorTitle(result.error)}
          text={
            isOfflineError(result.error) && !online
              ? 'Pool data cannot be loaded until the browser reconnects.'
              : errorText(result.error)
          }
          onRetry={result.refresh}
          testId="pool-error"
        />
      </>
    );
  }

  if (result.data === null) {
    return null;
  }

  return (
    <>
      {back}
      {refreshError === null ? null : (
        <p className="banner banner--danger" role="alert" data-testid="pool-refresh-error">
          Pool refresh failed: {refreshError}. Showing the last successful response with stale status.
          <button type="button" className="btn btn--quiet" onClick={result.refresh}>
            <RefreshCw size={16} aria-hidden="true" />
            Retry
          </button>
        </p>
      )}
      {watch.error === null ? null : (
        <p className="banner banner--danger" role="alert" data-testid="pool-watchlist-error">
          Watchlist change failed for <span className="mono">{watch.error.address}</span>: {watch.error.message}
          <button type="button" className="btn btn--quiet" onClick={watch.retry}>
            <RefreshCw size={16} aria-hidden="true" />
            Retry
          </button>
        </p>
      )}
      {watch.message === null ? null : (
        <p className="sr-only" aria-live="polite" data-testid="pool-watchlist-message">
          {watch.message}
        </p>
      )}
      <PoolInspector
        pool={result.data}
        now={now}
        forcedStale={refreshError !== null}
        onRefresh={result.refresh}
        isRefreshing={result.isRefetching}
        watch={watch}
      />
    </>
  );
}
