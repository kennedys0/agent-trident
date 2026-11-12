import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useStatus } from '../../app/StatusProvider.js';
import { AddressChip } from '../../components/AddressChip.js';
import { Panel } from '../../components/Panel.js';
import { StateView, isOfflineError } from '../../components/StateView.js';
import { SubjectHeader } from '../../components/SubjectHeader.js';
import { ApiError } from '../../lib/api/client.js';
import { useResource } from '../../lib/api/hooks.js';
import { poolsEndpoint } from './discoverApi.js';
import type { PoolSummary, TokenRef } from './discoverContract.js';
import { ExplorerLink } from './components/ExplorerLink.js';
import { PoolInspectorResource } from './components/PoolInspectorResource.js';
import { WatchButton } from './components/WatchButton.js';
import { useWatchlist } from './useWatchlist.js';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function includesToken(pool: PoolSummary, address: string): boolean {
  const needle = address.toLowerCase();
  return pool.token0.address.toLowerCase() === needle || pool.token1.address.toLowerCase() === needle;
}

function tokenFrom(pool: PoolSummary, address: string): TokenRef {
  return pool.token0.address.toLowerCase() === address.toLowerCase() ? pool.token0 : pool.token1;
}

function errorTitle(error: Error): string {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 ? 'Request rejected' : 'Backend error';
}

function errorText(error: Error): string {
  return error instanceof ApiError && error.status >= 400 && error.status < 500
    ? error.message
    : 'The backend could not complete this request.';
}

export function TokenInspectorPage(): ReactNode {
  const { address = '' } = useParams();
  const { now, online } = useStatus();
  const valid = ADDRESS.test(address);
  // S3-02 exposes no token endpoint. `search` is the only honest way to reach a
  // token: it returns the pools that mention the address, and the page keeps
  // only pools whose token0/token1 is exactly this address.
  const result = useResource(poolsEndpoint({ search: address, limit: 50, offset: 0 }), {
    intervalMs: 30_000,
    enabled: valid,
  });
  const watch = useWatchlist();

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
          title="That is not a token address"
          text="A token address is 0x followed by 40 hexadecimal characters. Nothing was looked up."
          testId="token-invalid"
        />
      </>
    );
  }

  const matched = result.data?.pools ?? [];
  const containing = matched.filter((pool) => includesToken(pool, address));
  const token = containing.length === 0 ? null : tokenFrom(containing[0]!, address);

  if (result.isLoading) {
    return (
      <>
        {back}
        <StateView kind="loading" title="Loading the token…" testId="token-loading" />
      </>
    );
  }

  if (result.error !== null) {
    return (
      <>
        {back}
        <StateView
          kind={isOfflineError(result.error) && !online ? 'offline' : 'error'}
          title={isOfflineError(result.error) && !online ? 'You are offline' : errorTitle(result.error)}
          text={isOfflineError(result.error) && !online ? 'Token data cannot be loaded until the browser reconnects.' : errorText(result.error)}
          onRetry={result.refresh}
          testId="token-error"
        />
      </>
    );
  }

  if (token === null) {
    return (
      <>
        {back}
        <StateView
          kind="empty"
          title="This token is not indexed"
          text={`Discovery has no published pool that includes ${address}. Nothing is shown because this page does not invent token metadata.`}
          onRetry={result.refresh}
          testId="token-not-indexed"
        />
      </>
    );
  }

  const watched = watch.isWatching(token.address);
  const pending = watch.isPending(token.address);

  return (
    <>
      {back}

      <SubjectHeader
        title={token.symbol}
        description="Token contract and every indexed pool that includes it on Robinhood Chain 4663. Read-only: no trading control exists on this page."
        meta={`${address} · ${token.decimals} decimals`}
      />

      <Panel
        title="Token contract"
        actions={
          <WatchButton
            address={token.address}
            name={token.symbol}
            watched={watched}
            pending={pending}
            disabled={watch.isLoading}
            onToggle={() => watch.toggle(token.address, token.symbol)}
          />
        }
      >
        <dl className="facts facts--two">
          <div className="fact">
            <dt>Address</dt>
            <dd>
              <AddressChip address={token.address} full />
            </dd>
          </div>
          <div className="fact">
            <dt>Symbol</dt>
            <dd className="mono">{token.symbol}</dd>
          </div>
          <div className="fact">
            <dt>Decimals</dt>
            <dd className="mono">{token.decimals}</dd>
          </div>
          <div className="fact">
            <dt>Chain</dt>
            <dd className="mono">4663</dd>
          </div>
          <div className="fact">
            <dt>Explorer</dt>
            <dd>
              <ExplorerLink address={token.address} />
            </dd>
          </div>
          <div className="fact">
            <dt>Watchlist</dt>
            <dd>{watched ? 'This token is on the server-persisted watchlist.' : 'This token is not watched.'}</dd>
          </div>
        </dl>
        <p className="meta">
          The watchlist is stored by the backend. Adding or removing a token here changes the same list every browser
          reads; nothing is kept in this tab.
        </p>
      </Panel>

      {watch.error === null ? null : (
        <p className="banner banner--danger" role="alert" data-testid="token-watchlist-error">
          Watchlist change failed for <span className="mono">{watch.error.address}</span>: {watch.error.message}
          <button type="button" className="btn btn--quiet" onClick={watch.retry}>
            <RefreshCw size={16} aria-hidden="true" />
            Retry
          </button>
        </p>
      )}

      {watch.message === null ? null : (
        <p className="sr-only" aria-live="polite" data-testid="token-watchlist-message">
          {watch.message}
        </p>
      )}

      <p className="meta" data-testid="token-match-count" aria-live="polite">
        {containing.length} indexed pool{containing.length === 1 ? '' : 's'} include this token
        {matched.length > containing.length
          ? ` (the address also appears in ${matched.length - containing.length} search match${
              matched.length - containing.length === 1 ? '' : 'es'
            } that are not pools of this token)`
          : ''}
        .
      </p>

      {containing.map((pool) => (
        <PoolInspectorResource key={pool.pool} initialPool={pool} now={now} />
      ))}
    </>
  );
}
