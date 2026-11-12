import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AddressChip } from '../../../components/AddressChip.js';
import { Badge } from '../../../components/Badge.js';
import { ageSeconds, formatAge, formatDecimalString, formatMoney } from '../../../lib/format.js';
import type {
  LiquidityMetric,
  PoolSummary,
  PriceMetric,
  TokenRef,
} from '@trident/api-contract';
import { QualityBadge } from './QualityBadge.js';

export type WatchLookup = {
  readonly isWatching: (address: string) => boolean;
};

type PoolTableProps = {
  readonly pools: readonly PoolSummary[];
  readonly now: number;
  readonly watch: WatchLookup;
  readonly caption: string;
};

/**
 * S3-02 price metrics scale by the divisor `1e18`, not by a decimal-place
 * count. `formatDecimalString` needs the count, so derive it and fail closed
 * when the scale is not a power of ten.
 */
export function scaleDecimals(scale: string): number | null {
  if (!/^10*$/.test(scale)) {
    return null;
  }
  return scale.length - 1;
}

/** Quote units per whole base token, truncated to `maxFrac` digits. */
export function formatPrice(metric: { readonly value: string; readonly scale: string }): string {
  const decimals = scaleDecimals(metric.scale);
  if (decimals === null) {
    return 'Unavailable';
  }
  return formatDecimalString(metric.value, decimals, { minFrac: 2, maxFrac: 8 });
}

export function trimFraction(text: string): string {
  if (!text.includes('.')) {
    return text;
  }
  const [integer = '', fraction = ''] = text.split('.');
  return `${integer}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`;
}

/** Fee is stored in millionths: 100 → 0.01%, 3000 → 0.3%, 10000 → 1%. */
export function feeLabel(fee: number): string {
  return `${(fee / 10_000).toFixed(2).replace(/\.?0+$/, '')}%`;
}

const LIQUIDITY_RANK: Record<PoolStatus, number> = { AVAILABLE: 0, STALE: 1, UNAVAILABLE: 2 };

type PoolStatus = PoolSummary['status'];

/**
 * Fixed order from the design contract: verified allowlist first, then
 * liquidity AVAILABLE descending → STALE descending → UNAVAILABLE, then pool
 * address ascending. Volume never participates.
 */
export function orderPools(pools: readonly PoolSummary[]): PoolSummary[] {
  return [...pools].sort((left, right) => {
    const venue = Number(left.venue !== 'verified-allowlist') - Number(right.venue !== 'verified-allowlist');
    if (venue !== 0) {
      return venue;
    }
    const liquidity = LIQUIDITY_RANK[left.metrics.liquidity.status] - LIQUIDITY_RANK[right.metrics.liquidity.status];
    if (liquidity !== 0) {
      return liquidity;
    }
    const a = left.metrics.liquidity;
    const b = right.metrics.liquidity;
    if (a.status !== 'UNAVAILABLE' && b.status !== 'UNAVAILABLE' && a.liquidity !== b.liquidity) {
      return BigInt(a.liquidity) > BigInt(b.liquidity) ? -1 : 1;
    }
    return left.pool.toLowerCase().localeCompare(right.pool.toLowerCase());
  });
}

function metricAge(metric: { observedAt: string }, now: number): string {
  const age = ageSeconds(metric.observedAt, now);
  return age === null ? 'unknown age' : formatAge(age);
}

function PriceCell({ pool, now, testId }: { readonly pool: PoolSummary; readonly now: number; readonly testId: string }): ReactNode {
  const metric: PriceMetric = pool.metrics.price;
  if (metric.status === 'UNAVAILABLE') {
    return (
      <div className="metric metric--absent" data-testid={testId}>
        <span className="metric__value">Unavailable</span>
        <span className="metric__reason">{metric.reason}</span>
      </div>
    );
  }
  return (
    <div className="metric" data-testid={testId}>
      <span className="metric__value mono">
        {trimFraction(formatPrice(metric.token1PerToken0))} {pool.token1.symbol}
      </span>
      <span className="metric__prov">per {pool.token0.symbol}</span>
      <span className="metric__prov mono">
        block {metric.blockNumber} · {metricAge(metric, now)}
      </span>
      {metric.status === 'STALE' ? <QualityBadge status="STALE" label="Stale" /> : null}
    </div>
  );
}

function LiquidityCell({ pool, now, testId }: { readonly pool: PoolSummary; readonly now: number; readonly testId: string }): ReactNode {
  const metric: LiquidityMetric = pool.metrics.liquidity;
  if (metric.status === 'UNAVAILABLE') {
    return (
      <div className="metric metric--absent" data-testid={testId}>
        <span className="metric__value">Unavailable</span>
        <span className="metric__reason">{metric.reason}</span>
      </div>
    );
  }
  return (
    <div className="metric" data-testid={testId}>
      <span className="metric__value mono">
        {trimFraction(formatMoney({ value: metric.reserve0, decimals: metric.reserve0Decimals }, { maxFrac: 4 }))}{' '}
        {pool.token0.symbol}
      </span>
      <span className="metric__prov mono">
        {trimFraction(formatMoney({ value: metric.reserve1, decimals: metric.reserve1Decimals }, { maxFrac: 4 }))}{' '}
        {pool.token1.symbol} reserves
      </span>
      <span className="metric__prov mono">
        block {metric.blockNumber} · {metricAge(metric, now)}
      </span>
      {metric.status === 'STALE' ? <QualityBadge status="STALE" label="Stale" /> : null}
    </div>
  );
}

function PoolLink({ pool, token }: { readonly pool: string; readonly token: TokenRef }): ReactNode {
  return (
    <Link className="token-link" to={`/discover/pools/${pool}`}>
      {token.symbol}
      <span className="sr-only"> in pool inspector, pool contract {pool}</span>
    </Link>
  );
}

/**
 * Watchlist is per token in S3-02, so a pool row cannot honestly own one
 * toggle: a row has two tokens and the backend `watched` flag is true when
 * either is watched. The row reports that state; the pool Inspector exposes
 * one control per token, where each address is unambiguous.
 */
function WatchCell({ pool, watch }: { readonly pool: PoolSummary; readonly watch: WatchLookup }): ReactNode {
  const watched = pool.watched || watch.isWatching(pool.token0.address) || watch.isWatching(pool.token1.address);
  return watched ? <Badge tone="wait">Watched</Badge> : <span className="meta">Not watched</span>;
}

/** Contract-bound pool listing used by Discover. */
export function PoolTable({ pools, now, watch, caption }: PoolTableProps): ReactNode {
  return (
    <div className="table-wrap">
      <table className="table discover-table">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col className="discover-col--pair" />
          <col className="discover-col--fee" />
          <col className="discover-col--price" />
          <col className="discover-col--liquidity" />
          <col className="discover-col--quality" />
          <col className="discover-col--watch" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Pair</th>
            <th scope="col" className="num">
              Fee
            </th>
            <th scope="col" className="num">
              Price
            </th>
            <th scope="col" className="num">
              Liquidity
            </th>
            <th scope="col">Quality</th>
            <th scope="col">Watch</th>
          </tr>
        </thead>
        <tbody>
          {orderPools(pools).map((pool) => (
            <tr key={pool.pool} data-testid={`pool-row-${pool.pool}`}>
              <td data-label="Pair">
                <span className="pair">
                  <PoolLink pool={pool.pool} token={pool.token0} />
                  <span aria-hidden="true"> / </span>
                  <PoolLink pool={pool.pool} token={pool.token1} />
                </span>
                <AddressChip address={pool.pool} label="pool" />
              </td>
              <td data-label="Fee" className="num mono">
                {feeLabel(pool.fee)}
              </td>
              <td data-label="Price" className="num">
                <PriceCell pool={pool} now={now} testId={`pool-price-${pool.pool}`} />
              </td>
              <td data-label="Liquidity" className="num">
                <LiquidityCell pool={pool} now={now} testId={`pool-liquidity-${pool.pool}`} />
              </td>
              <td data-label="Quality">
                <QualityBadge status={pool.status} />
              </td>
              <td data-label="Watch">
                <WatchCell pool={pool} watch={watch} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Real counts of the statuses the backend reported for the rows on screen. */
export function qualitySummary(pools: readonly PoolSummary[]): string {
  const counts: Record<PoolStatus, number> = { AVAILABLE: 0, STALE: 0, UNAVAILABLE: 0 };
  for (const pool of pools) {
    counts[pool.status] += 1;
  }
  return `${counts.AVAILABLE} available · ${counts.STALE} stale · ${counts.UNAVAILABLE} unavailable`;
}

