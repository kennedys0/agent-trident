import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { AddressChip } from '../../../components/AddressChip.js';
import { Badge } from '../../../components/Badge.js';
import { Panel } from '../../../components/Panel.js';
import { Provenance } from '../../../components/Provenance.js';
import { formatMoney } from '../../../lib/format.js';
import type { LiquidityMetric, PoolSummary, PriceMetric, VolumeMetric } from '@trident/api-contract';
import { ExplorerLink } from './ExplorerLink.js';
import { QualityBadge } from './QualityBadge.js';
import { feeLabel, formatPrice, trimFraction } from './PoolTable.js';
import { WatchButton } from './WatchButton.js';
import type { WatchlistControls } from '../useWatchlist.js';

function venueLabel(venue: PoolSummary['venue']): string {
  return venue === 'verified-allowlist' ? 'Verified allowlist' : 'S3-01 registry';
}

function PriceSection({
  metric,
  pool,
  now,
  forcedStale,
}: {
  readonly metric: PriceMetric;
  readonly pool: PoolSummary;
  readonly now: number;
  readonly forcedStale: boolean;
}): ReactNode {
  if (metric.status === 'UNAVAILABLE') {
    return (
      <section className="metric metric--absent" aria-label="Price">
        <div className="inline">
          <span className="stat__label">Price (token1 per token0)</span>
          <QualityBadge status="UNAVAILABLE" />
        </div>
        <span className="stat__value">Unavailable</span>
        <span className="meta">{metric.reason}</span>
      </section>
    );
  }
  return (
    <section className="metric" aria-label="Price">
      <div className="inline">
        <span className="stat__label">Price (token1 per token0)</span>
        <QualityBadge status={forcedStale && metric.status === 'AVAILABLE' ? 'STALE' : metric.status} />
      </div>
      <span className="stat__value mono">
        {trimFraction(formatPrice(metric.token1PerToken0))} {pool.token1.symbol}
      </span>
      <span className="meta">
        per {pool.token0.symbol} · inverse {trimFraction(formatPrice(metric.token0PerToken1))}{' '}
        {pool.token0.symbol} per {pool.token1.symbol}
      </span>
      <Provenance
        source={metric.provenance}
        blockNumber={metric.blockNumber}
        sourceTime={metric.sourceTime}
        observedAt={metric.observedAt}
        now={now}
      />
    </section>
  );
}

function LiquiditySection({
  metric,
  pool,
  now,
  forcedStale,
}: {
  readonly metric: LiquidityMetric;
  readonly pool: PoolSummary;
  readonly now: number;
  readonly forcedStale: boolean;
}): ReactNode {
  if (metric.status === 'UNAVAILABLE') {
    return (
      <section className="metric metric--absent" aria-label="Liquidity">
        <div className="inline">
          <span className="stat__label">Liquidity</span>
          <QualityBadge status="UNAVAILABLE" />
        </div>
        <span className="stat__value">Unavailable</span>
        <span className="meta">{metric.reason}</span>
      </section>
    );
  }
  return (
    <section className="metric" aria-label="Liquidity">
      <div className="inline">
        <span className="stat__label">Liquidity (pool reserves)</span>
        <QualityBadge status={forcedStale && metric.status === 'AVAILABLE' ? 'STALE' : metric.status} />
      </div>
      <span className="stat__value mono">
        {trimFraction(formatMoney({ value: metric.reserve0, decimals: metric.reserve0Decimals }, { maxFrac: 6 }))}{' '}
        {pool.token0.symbol}
        <br />
        {trimFraction(formatMoney({ value: metric.reserve1, decimals: metric.reserve1Decimals }, { maxFrac: 6 }))}{' '}
        {pool.token1.symbol}
      </span>
      <span className="meta">
        raw Uniswap L <span className="mono">{metric.liquidity}</span> · unitless, not a USD value
      </span>
      <Provenance
        source={metric.provenance}
        blockNumber={metric.blockNumber}
        sourceTime={metric.sourceTime}
        observedAt={metric.observedAt}
        now={now}
      />
    </section>
  );
}

function VolumeSection({ metric }: { readonly metric: VolumeMetric }): ReactNode {
  const reason =
    metric.status === 'UNAVAILABLE'
      ? metric.reason
      : 'Contract mismatch: S3-02 does not provide a verified 24h volume metric.';
  return (
    <section className="metric metric--absent" aria-label="Volume">
      <div className="inline">
        <span className="stat__label">Volume (24h)</span>
        <QualityBadge status="UNAVAILABLE" />
      </div>
      <span className="stat__value">Unavailable</span>
      <span className="meta">{reason}</span>
    </section>
  );
}

/**
 * One pool, everything the backend said about it. Provenance is rendered per
 * metric: price and liquidity can come from different reads and must not be
 * merged into one claim.
 */
export function PoolInspector({
  pool,
  now,
  forcedStale = false,
  onRefresh,
  isRefreshing = false,
  watch,
}: {
  readonly pool: PoolSummary;
  readonly now: number;
  readonly forcedStale?: boolean;
  readonly onRefresh?: (() => void) | undefined;
  readonly isRefreshing?: boolean;
  readonly watch?: WatchlistControls | undefined;
}): ReactNode {
  return (
    <Panel
      title={`${pool.token0.symbol} / ${pool.token1.symbol}`}
      actions={
        <span className="inline">
          <QualityBadge status={forcedStale && pool.status === 'AVAILABLE' ? 'STALE' : pool.status} />
          <Badge tone="wait">LOW CONFIDENCE</Badge>
          {onRefresh === undefined ? null : (
            <button type="button" className="btn btn--quiet" onClick={onRefresh} disabled={isRefreshing}>
              <RefreshCw size={16} aria-hidden="true" />
              {isRefreshing ? 'Refreshing…' : 'Refresh pool'}
            </button>
          )}
        </span>
      }
    >
      <p className="meta">{pool.confidenceReason}</p>
      {pool.reason === undefined ? null : <p className="metric__reason">Pool status: {pool.reason}</p>}

      <dl className="facts facts--two discover-identity">
        <div className="fact">
          <dt>Token 0</dt>
          <dd>
            <AddressChip address={pool.token0.address} full />
            <span className="meta">
              {pool.token0.symbol} · {pool.token0.decimals} decimals
            </span>
            {watch === undefined ? null : (
              <WatchButton
                address={pool.token0.address}
                name={pool.token0.symbol}
                watched={watch.isWatching(pool.token0.address)}
                pending={watch.isPending(pool.token0.address)}
                disabled={watch.isLoading}
                onToggle={() => watch.toggle(pool.token0.address, pool.token0.symbol)}
              />
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>Token 1</dt>
          <dd>
            <AddressChip address={pool.token1.address} full />
            <span className="meta">
              {pool.token1.symbol} · {pool.token1.decimals} decimals
            </span>
            {watch === undefined ? null : (
              <WatchButton
                address={pool.token1.address}
                name={pool.token1.symbol}
                watched={watch.isWatching(pool.token1.address)}
                pending={watch.isPending(pool.token1.address)}
                disabled={watch.isLoading}
                onToggle={() => watch.toggle(pool.token1.address, pool.token1.symbol)}
              />
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>Pool</dt>
          <dd>
            <AddressChip address={pool.pool} full />
          </dd>
        </div>
        <div className="fact">
          <dt>Fee tier</dt>
          <dd className="mono">{feeLabel(pool.fee)}</dd>
        </div>
        <div className="fact">
          <dt>Venue</dt>
          <dd>{venueLabel(pool.venue)}</dd>
        </div>
        <div className="fact">
          <dt>Factory</dt>
          <dd>
            <AddressChip address={pool.factory} full />
          </dd>
        </div>
        <div className="fact">
          <dt>First seen block</dt>
          <dd className="mono">{pool.firstSeenBlock ?? 'Unavailable'}</dd>
        </div>
        <div className="fact">
          <dt>Chain</dt>
          <dd className="mono">{pool.chainId}</dd>
        </div>
      </dl>

      <div className="discover-metrics">
        <PriceSection metric={pool.metrics.price} pool={pool} now={now} forcedStale={forcedStale} />
        <LiquiditySection metric={pool.metrics.liquidity} pool={pool} now={now} forcedStale={forcedStale} />
        <VolumeSection metric={pool.metrics.volume24h} />
      </div>

      <div className="stack stack--tight">
        <h3 className="discover-section-title">Links</h3>
        <AddressChip address={pool.pool} label="Pool contract" full />
        <ExplorerLink address={pool.pool} />
      </div>
    </Panel>
  );
}
