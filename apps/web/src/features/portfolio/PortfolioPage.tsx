import { type ReactNode } from 'react';
import { endpoints } from '../../lib/api/endpoints.js';
import { useResource } from '../../lib/api/hooks.js';
import { readString } from '../../lib/api/system.js';
import { PAIR } from '../../lib/pair.js';
import { useStatus } from '../../app/StatusProvider.js';
import { Panel } from '../../components/Panel.js';
import { StateView, isOfflineError } from '../../components/StateView.js';
import { SubjectHeader } from '../../components/SubjectHeader.js';
import { PortfolioView, type PriceStatus } from './PortfolioView.js';

const PRICE_STATUSES: readonly PriceStatus[] = ['COMPLETE', 'STALE', 'INCOMPLETE', 'UNAVAILABLE'];

function priceStatusOf(meta: Record<string, unknown>): PriceStatus | null {
  const value = readString(meta, 'priceStatus');
  return value !== null && (PRICE_STATUSES as readonly string[]).includes(value) ? (value as PriceStatus) : null;
}

export function PortfolioPage(): ReactNode {
  const { online } = useStatus();
  const portfolio = useResource(endpoints.portfolio(), { intervalMs: 10_000 });
  const venues = useResource(endpoints.venues(), { intervalMs: 60_000 });

  return (
    <>
      <SubjectHeader
        title="Paper portfolio"
        description={`Simulated balances, positions, and PnL for the ${PAIR.base.symbol}/${PAIR.quote.symbol} slice. Values that are not available are labelled Unavailable rather than zero.`}
      />

      <Panel
        title="Projection"
        actions={
          <button type="button" className="btn btn--quiet" onClick={portfolio.refresh} disabled={portfolio.isRefetching}>
            Refresh
          </button>
        }
      >
        {portfolio.isLoading ? (
          <StateView kind="loading" title="Loading portfolio projection…" testId="portfolio-loading" />
        ) : portfolio.error !== null ? (
          <StateView
            kind={isOfflineError(portfolio.error) && !online ? 'offline' : 'error'}
            title="The portfolio could not be loaded"
            text={portfolio.error.message}
            onRetry={portfolio.refresh}
            testId="portfolio-error"
          />
        ) : portfolio.data === null ? (
          <StateView kind="empty" title="No portfolio projection yet" testId="portfolio-empty" />
        ) : (
          <PortfolioView
            portfolio={portfolio.data}
            venues={venues.data}
            priceStatus={priceStatusOf(portfolio.meta)}
            priceAsOf={readString(portfolio.meta, 'priceAsOf')}
          />
        )}
      </Panel>
    </>
  );
}