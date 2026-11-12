import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useStatus } from '../../app/StatusProvider.js';
import { Panel } from '../../components/Panel.js';
import { StateView, isOfflineError } from '../../components/StateView.js';
import { SubjectHeader } from '../../components/SubjectHeader.js';
import { ApiError } from '../../lib/api/client.js';
import { useResource } from '../../lib/api/hooks.js';
import { poolsEndpoint } from './discoverApi.js';
import type { PoolSummary } from '@trident/api-contract';
import { PoolTable, orderPools, qualitySummary } from './components/PoolTable.js';
import { useWatchlist } from './useWatchlist.js';

export const PAGE_SIZE = 20;

const QUALITIES = ['ANY', 'AVAILABLE', 'STALE', 'UNAVAILABLE'] as const;
type QualityFilter = (typeof QUALITIES)[number];

const VENUES = ['ANY', 'verified-allowlist', 's3-01-registry'] as const;
type VenueFilter = (typeof VENUES)[number];

const VENUE_LABEL: Record<VenueFilter, string> = {
  ANY: 'All venues',
  'verified-allowlist': 'Verified allowlist',
  's3-01-registry': 'S3-01 registry',
};

function firstOf<T extends string>(values: readonly T[], raw: string | null): T {
  return values.find((value) => value === raw) ?? values[0]!;
}

function errorTitle(error: Error): string {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 ? 'Request rejected' : 'Backend error';
}

function errorText(error: Error): string {
  return error instanceof ApiError && error.status >= 400 && error.status < 500
    ? error.message
    : 'The backend could not complete this request.';
}

/** Filters run over the page the backend returned; the label says so. */
function filterPage(pools: readonly PoolSummary[], quality: QualityFilter, venue: VenueFilter, watchedOnly: boolean): PoolSummary[] {
  return pools.filter((pool) => {
    if (quality !== 'ANY' && pool.status !== quality) {
      return false;
    }
    if (venue !== 'ANY' && pool.venue !== venue) {
      return false;
    }
    if (watchedOnly && !pool.watched) {
      return false;
    }
    return true;
  });
}

export function DiscoverPage(): ReactNode {
  const { now, online } = useStatus();
  const [params, setParams] = useSearchParams();

  const query = params.get('q') ?? '';
  const quality = firstOf(QUALITIES, params.get('quality'));
  const venue = firstOf(VENUES, params.get('venue'));
  const watchedOnly = params.get('watched') === '1';
  const offset = Math.max(0, Number.parseInt(params.get('offset') ?? '0', 10) || 0);
  const [draft, setDraft] = useState(query);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  const navigate = (next: {
    readonly q?: string;
    readonly quality?: QualityFilter;
    readonly venue?: VenueFilter;
    readonly watched?: boolean;
    readonly offset?: number;
  }): void => {
    const nextQuery = (next.q ?? draft).trim();
    const nextQuality = next.quality ?? quality;
    const nextVenue = next.venue ?? venue;
    const nextWatched = next.watched ?? watchedOnly;
    const nextOffset = next.offset ?? 0;
    const search = new URLSearchParams();
    if (nextQuery !== '') {
      search.set('q', nextQuery);
    }
    if (nextQuality !== 'ANY') {
      search.set('quality', nextQuality);
    }
    if (nextVenue !== 'ANY') {
      search.set('venue', nextVenue);
    }
    if (nextWatched) {
      search.set('watched', '1');
    }
    if (nextOffset > 0) {
      search.set('offset', String(nextOffset));
    }
    setParams(search);
  };

  // Pixel's contract: 300ms debounce, Enter applies immediately.
  useEffect(() => {
    if (draft.trim() === query.trim()) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      navigate({ q: draft, offset: 0 });
    }, 300);
    return () => window.clearTimeout(timer);
    // `navigate` is derived from the current params and draft; re-creating the
    // timer on every render would reset it, so the input list is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, query]);

  const pools = useResource(poolsEndpoint({ search: query, limit: PAGE_SIZE, offset }), { intervalMs: 30_000 });
  const watch = useWatchlist();

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    navigate({ q: draft, offset: 0 });
  };

  const filtersActive = query !== '' || quality !== 'ANY' || venue !== 'ANY' || watchedOnly;
  const loaded = pools.data?.pools ?? [];
  const visible = orderPools(filterPage(loaded, quality, venue, watchedOnly));
  const total = pools.data?.total ?? 0;
  const first = offset + 1;
  const last = offset + loaded.length;

  return (
    <>
      <SubjectHeader
        title="Discover"
        description="Pools indexed from Robinhood Chain 4663. Price and liquidity each carry their own status and provenance; anything the backend could not verify is marked unavailable, never zero."
        meta="Read-only discovery. No trading control exists on this page."
      />

      <section className="discover-toolbar" aria-labelledby="discover-filters">
        <h2 className="discover-toolbar__title" id="discover-filters">
          Find a pool
        </h2>
        <form role="search" className="discover-search" onSubmit={onSubmit}>
          <label className="discover-field">
            <span className="discover-field__label">Search address or symbol</span>
            <input
              type="search"
              className="discover-input mono"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="0x… or USDG"
              autoComplete="off"
              spellCheck={false}
              data-testid="discover-search-input"
            />
          </label>
          <button type="submit" className="btn btn--primary" data-testid="discover-search-submit">
            <Search size={16} aria-hidden="true" />
            Search
          </button>
          {filtersActive ? (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setDraft('');
                setParams(new URLSearchParams());
              }}
              data-testid="discover-clear"
            >
              <X size={16} aria-hidden="true" />
              Clear
            </button>
          ) : null}
        </form>

        <div className="discover-filters" role="group" aria-label="Quality filter, on this page">
          <span className="discover-filters__label">Quality · on this page</span>
          {QUALITIES.map((value) => (
            <button
              key={value}
              type="button"
              className="filter-chip"
              aria-pressed={quality === value}
              onClick={() => navigate({ quality: value, offset: 0 })}
              data-testid={`filter-quality-${value}`}
            >
              {value === 'ANY' ? 'All' : value === 'AVAILABLE' ? 'Available' : value === 'STALE' ? 'Stale' : 'Unavailable'}
            </button>
          ))}
        </div>

        <div className="discover-filters" role="group" aria-label="Venue filter, on this page">
          <span className="discover-filters__label">Venue · on this page</span>
          {VENUES.map((value) => (
            <button
              key={value}
              type="button"
              className="filter-chip"
              aria-pressed={venue === value}
              onClick={() => navigate({ venue: value, offset: 0 })}
              data-testid={`filter-venue-${value}`}
            >
              {VENUE_LABEL[value]}
            </button>
          ))}
        </div>

        <div className="discover-filters" role="group" aria-label="Watchlist filter, on this page">
          <button
            type="button"
            className="filter-chip"
            aria-pressed={watchedOnly}
            onClick={() => navigate({ watched: !watchedOnly, offset: 0 })}
            data-testid="filter-watched"
          >
            Watched only · on this page
          </button>
        </div>

        <p className="meta">
          Search runs on the backend. Quality, venue and watchlist filters apply only to the page already loaded, so the
          totals below keep describing what the API returned.
        </p>
      </section>

      {pools.error !== null && pools.data !== null ? (
        <p className="banner banner--danger" role="alert" data-testid="discover-refresh-error">
          Refresh failed: {pools.error.message}. Showing the last successful response, which may be out of date.
          <button type="button" className="btn btn--quiet" onClick={pools.refresh}>
            <RefreshCw size={16} aria-hidden="true" />
            Retry
          </button>
        </p>
      ) : null}

      {watch.error === null ? null : (
        <p className="banner banner--danger" role="alert" data-testid="watchlist-error">
          Watchlist change failed for <span className="mono">{watch.error.address}</span>: {watch.error.message}
          <button type="button" className="btn btn--quiet" onClick={watch.retry}>
            <RefreshCw size={16} aria-hidden="true" />
            Retry
          </button>
        </p>
      )}

      {watch.message === null ? null : (
        <p className="sr-only" aria-live="polite" data-testid="watchlist-message">
          {watch.message}
        </p>
      )}

      <Panel
        title="Indexed pools"
        actions={
          <button
            type="button"
            className="btn btn--quiet"
            onClick={pools.refresh}
            disabled={pools.isRefetching}
            data-testid="discover-refresh"
          >
            <RefreshCw size={16} aria-hidden="true" />
            {pools.isRefetching ? 'Refreshing…' : 'Refresh'}
          </button>
        }
        foot={
          pools.data === null ? undefined : (
            <div className="discover-foot">
              <span data-testid="discover-count" aria-live="polite">
                Showing {first}–{last} of {total} indexed pools · {visible.length} visible after on-page filters ·{' '}
                {qualitySummary(visible)}
              </span>
              <span className="inline">
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => navigate({ offset: Math.max(0, offset - PAGE_SIZE) })}
                  disabled={offset === 0}
                  data-testid="discover-prev"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  Prev
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => navigate({ offset: offset + PAGE_SIZE })}
                  disabled={offset + PAGE_SIZE >= total}
                  data-testid="discover-next"
                >
                  Next
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </span>
            </div>
          )
        }
      >
        {pools.isLoading ? (
          <StateView kind="loading" title="Loading pools…" testId="discover-loading" />
        ) : pools.error !== null && pools.data === null ? (
          <StateView
            kind={isOfflineError(pools.error) && !online ? 'offline' : 'error'}
            title={isOfflineError(pools.error) && !online ? 'You are offline' : errorTitle(pools.error)}
            text={isOfflineError(pools.error) && !online ? 'Pools cannot be loaded until the browser reconnects.' : errorText(pools.error)}
            onRetry={pools.refresh}
            testId="discover-error"
          />
        ) : visible.length === 0 ? (
          <StateView
            kind="empty"
            title={filtersActive ? 'No pools match this search' : 'No pools discovered yet'}
            text={
              filtersActive
                ? 'Nothing matches this query. Clear the search to see all pools.'
                : 'Discovery has not published any pools yet.'
            }
            onRetry={pools.refresh}
            testId="discover-empty"
          />
        ) : (
          <PoolTable pools={visible} now={now} watch={watch} caption="Indexed Uniswap v3 pools on chain 4663" />
        )}
      </Panel>

      <p className="meta discover-contract-note">
        Frontend fields are parsed by <span className="mono">@trident/api-contract</span>. A payload that does not match
        the S3-02 contract is reported as a contract mismatch instead of being displayed partially.
      </p>
    </>
  );
}
