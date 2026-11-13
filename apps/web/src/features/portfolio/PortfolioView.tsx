import type { ReactNode } from 'react';
import type { MarketSnapshot, Portfolio } from '@trident/api-contract';
import type { Venue } from '../../lib/api/endpoints.js';
import { Link } from 'react-router-dom';
import { PAIR, symbolFor } from '../../lib/pair.js';
import { formatMoney, formatUtc } from '../../lib/format.js';
import { Badge } from '../../components/Badge.js';
import { AddressChip } from '../../components/AddressChip.js';
import { SnapshotBadge } from '../../components/SnapshotBadge.js';

export type PriceStatus = MarketSnapshot['status'];

export function PortfolioView({
  portfolio,
  venues,
  compact = false,
  priceStatus = null,
  priceAsOf = null,
}: {
  readonly portfolio: Portfolio;
  readonly venues: Venue[] | null;
  readonly compact?: boolean;
  readonly priceStatus?: PriceStatus | null;
  readonly priceAsOf?: string | null;
}): ReactNode {
  const quoteBalance = portfolio.balances.find((balance) => balance.asset.toLowerCase() === PAIR.quote.address);
  const fee = venues?.[0]?.fee ?? null;
  const unpriced = portfolio.positions.some((position) => position.valuationStatus === 'UNPRICED');
  const noCanonicalPrice = priceStatus === 'UNAVAILABLE' || priceStatus === 'INCOMPLETE';
  const unvaluable = unpriced || noCanonicalPrice;

  return (
    <div className="stack">
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <Badge tone="wait">SIMULATED</Badge>
        <span className="meta mono">as of {formatUtc(portfolio.asOf)} · mode {portfolio.mode}</span>
      </div>

      {priceStatus === null || priceStatus === 'COMPLETE' ? null : (
        <p
          className={`banner ${priceStatus === 'STALE' ? 'banner--info' : 'banner--danger'}`}
          role="status"
          data-testid="portfolio-price-status"
        >
          <span className="inline">
            <SnapshotBadge status={priceStatus} />
            <strong>
              {priceStatus === 'STALE' ? 'Prices are stale' : priceStatus === 'INCOMPLETE' ? 'Prices are incomplete' : 'Valuation unavailable'}
            </strong>
          </span>{' '}
          {priceStatus === 'STALE' ? (
            <>
              The backend priced this projection with a snapshot from {priceAsOf === null ? 'an unknown time' : formatUtc(priceAsOf)}.
              Values below are the last known valuation, not live prices.
            </>
          ) : (
            <>
              The backend has no complete canonical market snapshot, so open positions cannot be priced.
              {unpriced ? ' Equity below excludes unpriced position value.' : ''}
            </>
          )}
        </p>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat__label">Equity</span>
          <span className="stat__value" data-testid="portfolio-equity">
            {formatMoney(portfolio.equityQuote, { maxFrac: 2 })}
          </span>
          <span className="meta">
            {unpriced
              ? `${PAIR.quote.symbol} · excludes unpriced positions`
              : noCanonicalPrice
                ? `${PAIR.quote.symbol} · no canonical price`
                : PAIR.quote.symbol}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">Cash (quote)</span>
          <span className="stat__value" data-testid="portfolio-cash">
            {quoteBalance === undefined ? 'Unavailable' : formatMoney(quoteBalance.available, { maxFrac: 2 })}
          </span>
          <span className="meta">{PAIR.quote.symbol}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Realized PnL</span>
          <span className="stat__value" data-testid="portfolio-realized">
            {formatMoney(portfolio.realizedPnlQuote, { maxFrac: 2, signed: true })}
          </span>
          <span className="meta">{PAIR.quote.symbol}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Unrealized PnL</span>
          <span className="stat__value" data-testid="portfolio-unrealized">
            {unvaluable ? 'Unavailable' : formatMoney(portfolio.unrealizedPnlQuote, { maxFrac: 2, signed: true })}
          </span>
          <span className="meta">{unvaluable ? 'cannot be valued without a canonical snapshot' : PAIR.quote.symbol}</span>
        </div>
      </div>

      <section className="stack stack--tight" aria-label="Open paper positions">
        <h2 className="panel__title">Open positions</h2>
        {portfolio.positions.length === 0 ? (
          <p className="meta">No open paper positions.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col" className="num">
                    Quantity
                  </th>
                  <th scope="col" className="num">
                    Cost basis
                  </th>
                  <th scope="col">Valuation</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.positions.map((position) => (
                  <tr key={position.asset}>
                    <td data-label="Asset">
                      {symbolFor(position.asset, PAIR.base.address, PAIR.base.symbol)}
                    </td>
                    <td className="num" data-label="Quantity">
                      {formatMoney(position.quantity, { maxFrac: 6, minFrac: 4 })}
                    </td>
                    <td className="num" data-label="Cost basis">
                      {formatMoney(position.costBasisQuote, { maxFrac: 2 })} {PAIR.quote.symbol}
                    </td>
                    <td data-label="Valuation">
                      {position.valuationStatus === 'VALUED' ? (
                        <span className="inline">
                          <Badge tone="info">VALUED</Badge>
                          <span className="mono">
                            {formatMoney(position.unrealizedPnlQuote, { maxFrac: 2, signed: true })} {PAIR.quote.symbol}
                          </span>
                        </span>
                      ) : (
                        <span className="inline">
                          <Badge tone="testnet">UNPRICED</Badge>
                          <span className="meta">{position.reason}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {compact ? null : (
        <>
      <section className="stack stack--tight" aria-label="Paper balances">
        <h2 className="panel__title">Balances</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col" className="num">
                  Available
                </th>
                <th scope="col" className="num">
                  Reserved
                </th>
              </tr>
            </thead>
            <tbody>
              {portfolio.balances.map((balance) => (
                <tr key={balance.asset}>
                  <td data-label="Asset">
                    <AddressChip address={balance.asset} />
                  </td>
                  <td className="num" data-label="Available">
                    {formatMoney(balance.available, { maxFrac: 6, minFrac: 2 })}
                  </td>
                  <td className="num" data-label="Reserved">
                    {formatMoney(balance.reserved, { maxFrac: 6, minFrac: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack stack--tight" aria-label="Execution assumptions">
        <h2 className="panel__title">Assumptions</h2>
        <dl className="facts facts--two">
          <div className="fact">
            <dt>Pool fee tier</dt>
            <dd className="mono">{fee === null ? 'Unavailable' : `${(fee / 10_000).toFixed(2)}%`}</dd>
          </div>
          <div className="fact">
            <dt>Slippage and gas model</dt>
            <dd>
              <Badge tone="testnet">UNAVAILABLE</Badge>{' '}
              <span className="meta">The backend does not expose these assumptions on this endpoint.</span>
            </dd>
          </div>
          <div className="fact">
            <dt>Mode</dt>
            <dd>
              <Badge tone="wait">PAPER — no real money</Badge>
            </dd>
          </div>
          <div className="fact">
            <dt>Journal</dt>
            <dd>
              <Link to="/journal">Open the audit journal</Link>
            </dd>
          </div>
        </dl>
      </section>
        </>
      )}
    </div>
  );
}