import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/api/endpoints.js';
import { useResource } from '../../lib/api/hooks.js';
import { readFlag, readNumber, readString } from '../../lib/api/system.js';
import { ageSeconds, formatAge, formatMoney, formatScaled, formatStrength, formatUtc } from '../../lib/format.js';
import { PAIR } from '../../lib/pair.js';
import { useStatus } from '../../app/StatusProvider.js';
import { ActionBadge } from '../../components/ActionBadge.js';
import { Badge } from '../../components/Badge.js';
import { SnapshotBadge } from '../../components/SnapshotBadge.js';
import { StateView, isOfflineError } from '../../components/StateView.js';
import { scanWindowText, useIntentDecision, useRiskDecisionScan } from '../risk/useIntentDecision.js';
import { poolsEndpoint } from '../discover/discoverApi.js';

/** Backend-backed Soft Bento dashboard. Missing data stays unavailable. */
export function OverviewPage(): ReactNode {
  const { health, now, online } = useStatus();
  const snapshot = useResource(endpoints.snapshot(), { intervalMs: 10_000 });
  const candidates = useResource(endpoints.candidates(5), { intervalMs: 10_000 });
  const portfolio = useResource(endpoints.portfolio(), { intervalMs: 10_000 });
  const journal = useResource(endpoints.journal(4), { intervalMs: 30_000 });
  const discovery = useResource(poolsEndpoint({ search: '', limit: 1, offset: 0 }), { intervalMs: 60_000 });
  const riskScan = useRiskDecisionScan(1);

  const latestCandidate = candidates.data?.[0] ?? null;
  const decisionIntentId = riskScan.intentIds[0] ?? null;
  const decision = useIntentDecision(decisionIntentId);

  const healthData = health.data;
  const snapshotData = snapshot.data;
  const snapshotAge =
    snapshotData === undefined || snapshotData === null
      ? null
      : ageSeconds(snapshotData.sourceTime, now);
  const killSwitch = readFlag(health.meta, 'killSwitchEngaged');
  const latency = readNumber(health.meta, 'rpcLatencyMs');

  const portfolioData = portfolio.data;
  const quoteBalance =
    portfolioData?.balances.find((balance) => balance.asset.toLowerCase() === PAIR.quote.address) ?? null;
  const unpriced = portfolioData?.positions.some((position) => position.valuationStatus === 'UNPRICED') ?? false;
  const noCanonicalPrice = snapshotData?.status === 'UNAVAILABLE' || snapshotData?.status === 'INCOMPLETE';
  const unvaluable = unpriced || noCanonicalPrice;

  const registryStatus = readString(discovery.meta, 'registryStatus');
  const trackedPools = readNumber(discovery.meta, 'trackedPools');
  const watchlistEntries = readNumber(discovery.meta, 'watchlistEntries');

  return (
    <>
      <header className="stack stack--tight page-heading">
        <h1>Overview</h1>
        <p className="meta">
          PAPER-only operational state · chain {PAIR.chainId} · {PAIR.base.symbol}/{PAIR.quote.symbol} 0.01% pool. Every value
          comes from the backend API; nothing is generated in the browser.
        </p>
      </header>

      {health.error !== null ? (
        <p className="banner banner--danger" role="alert">
          {isOfflineError(health.error) && !online
            ? 'This browser is offline. Values shown were received before the connection dropped.'
            : `Chain status could not be read: ${health.error.message}`}
        </p>
      ) : null}

      <section className="status-strip" data-testid="overview-strip" aria-label="Operational status">
        <div className="status-strip__item">
          <span className="status-strip__label">Execution</span>
          <span className="status-strip__value">
            <Badge tone="testnet">PAPER — SIMULATED</Badge>
          </span>
        </div>
        <div className="status-strip__item">
          <span className="status-strip__label">Chain health</span>
          <span className="status-strip__value">
            {healthData === null ? (
              <Badge tone="muted">Unavailable</Badge>
            ) : (
              <Badge tone={healthData.rpcStatus === 'HEALTHY' ? 'success' : healthData.rpcStatus === 'DEGRADED' ? 'wait' : 'danger'}>
                RPC {healthData.rpcStatus.toLowerCase()}
              </Badge>
            )}
            <span className="meta">{healthData === null ? 'chain unknown' : `chain ${healthData.chainId}`}</span>
          </span>
        </div>
        <div className="status-strip__item">
          <span className="status-strip__label">Head block</span>
          <span className="status-strip__value status-strip__value--block">
            {healthData?.headBlock ?? 'Unavailable'}
          </span>
          <span className="meta">
            {healthData === null || healthData.lagSeconds === null ? '' : `lag ${healthData.lagSeconds}s`}
            {latency === null ? '' : `${healthData === null || healthData.lagSeconds === null ? '' : ' · '}${latency} ms`}
          </span>
        </div>
        <div className="status-strip__item">
          <span className="status-strip__label">Snapshot freshness</span>
          <span className="status-strip__value">
            {snapshot.isLoading ? (
              <span className="meta">Loading snapshot…</span>
            ) : snapshotData === null && snapshot.error !== null ? (
              <span className="inline">
                <SnapshotBadge status="UNAVAILABLE" />
                <span className="meta">{snapshot.error.message}</span>
              </span>
            ) : snapshotData === null ? (
              <Badge tone="muted">None recorded</Badge>
            ) : (
              <span className="inline">
                <SnapshotBadge status={snapshotData.status} />
                <span className="mono meta">
                  block {snapshotData.blockNumber} · {formatAge(snapshotAge)}
                </span>
              </span>
            )}
          </span>
        </div>
        <div className="status-strip__item">
          <span className="status-strip__label">Kill switch</span>
          <span className="status-strip__value">
            {killSwitch === null ? (
              <Badge tone="muted">State unavailable</Badge>
            ) : killSwitch ? (
              <Badge tone="halted">STOPPED</Badge>
            ) : (
              <Badge tone="success">New entries allowed</Badge>
            )}
          </span>
        </div>
        <div className="status-strip__refresh">
          <button type="button" className="btn btn--quiet" onClick={() => health.refresh()}>
            Refresh
          </button>
        </div>
      </section>

      <div className="bento">
        <section className="bento-tile bento-tile--portfolio" data-testid="overview-portfolio">
          <div className="bento-tile__title">
            <h2>Simulated equity</h2>
            <Badge tone="testnet">SIMULATED</Badge>
          </div>
          {portfolio.isLoading ? (
            <StateView kind="loading" title="Loading the simulated portfolio…" testId="portfolio-loading" />
          ) : portfolio.error !== null ? (
            <StateView
              kind={isOfflineError(portfolio.error) && !online ? 'offline' : 'error'}
              title="Portfolio could not be loaded"
              text={portfolio.error.message}
              onRetry={portfolio.refresh}
              testId="portfolio-error"
            />
          ) : portfolioData === null ? (
            <StateView kind="empty" title="No portfolio projection yet" testId="portfolio-empty" />
          ) : (
            <>
              <span
                className="bento-figure__value bento-figure__value--hero"
                data-testid="overview-equity-value"
              >
                {formatMoney(portfolioData.equityQuote, { maxFrac: 2 })} {PAIR.quote.symbol}
              </span>
              <div className="bento-figures-row">
                <div className="bento-figure">
                  <span className="bento-figure__label">Cash (quote)</span>
                  <span className="bento-figure__value" data-testid="overview-cash-value">
                    {quoteBalance === null
                      ? 'Unavailable'
                      : formatMoney(quoteBalance.available, { maxFrac: 2 })}
                  </span>
                </div>
                <div className="bento-figure">
                  <span className="bento-figure__label">Realised PnL</span>
                  <span
                    className={`bento-figure__value ${pnlTint(portfolioData.realizedPnlQuote)}`}
                    data-testid="overview-pnl-realized"
                  >
                    {formatMoney(portfolioData.realizedPnlQuote, { maxFrac: 2, signed: true })}
                  </span>
                </div>
                <div className="bento-figure">
                  <span className="bento-figure__label">Unrealised PnL</span>
                  <span
                    className={`bento-figure__value ${pnlTint(unvaluable ? null : portfolioData.unrealizedPnlQuote)}`}
                    data-testid="overview-pnl-unrealized"
                  >
                    {unvaluable
                      ? 'Unavailable'
                      : formatMoney(portfolioData.unrealizedPnlQuote, { maxFrac: 2, signed: true })}
                  </span>
                </div>
              </div>
              <p className="meta">
                {unvaluable
                  ? 'Unrealised PnL cannot be valued without a complete canonical snapshot.'
                  : `Backend valuation · ${formatUtc(portfolioData.asOf)} · ${portfolioData.mode}`}
              </p>
            </>
          )}
        </section>

        <section className="bento-tile bento-tile--strategy" data-testid="overview-strategy">
          <div className="bento-tile__title">
            <h2>Strategy signal</h2>
            <Link to="/candidates">All candidates</Link>
          </div>
          {candidates.isLoading ? (
            <StateView kind="loading" title="Loading the latest evaluation…" testId="candidates-loading" />
          ) : candidates.error !== null ? (
            <StateView
              kind={isOfflineError(candidates.error) && !online ? 'offline' : 'error'}
              title="Evaluations could not be loaded"
              text={candidates.error.message}
              onRetry={candidates.refresh}
              testId="candidates-error"
            />
          ) : latestCandidate === null ? (
            <StateView
              kind="empty"
              title="No eligible candidates in the latest scan"
              text="The backend returned an empty evaluation list."
              testId="candidates-empty"
            />
          ) : (
            <>
              <div className="strategy-signal">
                <ActionBadge action={latestCandidate.evaluation.action} />
                <div className="bento-figure">
                  <span className="bento-figure__label">Strength</span>
                  <span className="bento-figure__value">
                    {formatStrength(latestCandidate.evaluation.signalStrength)}
                  </span>
                </div>
              </div>
              <dl className="rows">
                <div className="row">
                  <dt className="row__label">Strategy</dt>
                  <dd className="row__value mono">
                    {latestCandidate.evaluation.strategyId} · {latestCandidate.evaluation.configVersion}
                  </dd>
                </div>
                <div className="row">
                  <dt className="row__label">Evaluated</dt>
                  <dd className="row__value mono">
                    {formatUtc(latestCandidate.evaluation.evaluatedAt)} ·{' '}
                    {formatAge(Math.max(0, Math.floor((now - new Date(latestCandidate.evaluation.evaluatedAt).getTime()) / 1000)))}
                  </dd>
                </div>
              </dl>
              <p className="meta">Evaluation only — not an order, fill, or open position.</p>
            </>
          )}
        </section>

        <section className="bento-tile bento-tile--risk bento-tile--interactive" data-testid="overview-risk">
          <div className="bento-tile__title">
            <h2>Risk state</h2>
            {killSwitch === true ? <Badge tone="halted">HALTED</Badge> : null}
          </div>
          {riskScan.status === 'loading' ? (
            <StateView kind="loading" title="Scanning the journal for risk decisions…" testId="risk-loading" />
          ) : riskScan.status === 'error' ? (
            <StateView
              kind={isOfflineError(riskScan.error ?? new Error('')) && !online ? 'offline' : 'error'}
              title="The audit journal could not be read"
              text={riskScan.error?.message ?? 'Unknown error'}
              onRetry={riskScan.refresh}
              testId="risk-error"
            />
          ) : decisionIntentId === null ? (
            <StateView
              kind="empty"
              title="No risk decision in the scanned window"
              text={`The risk gate records evidence only when a PAPER intent is created from an evaluation. None was found in ${scanWindowText(riskScan, now)}.`}
              testId="risk-empty"
            />
          ) : decision.isLoading ? (
            <StateView kind="loading" title="Loading the risk decision…" testId="risk-loading" />
          ) : decision.error !== null ? (
            <StateView
              kind={isOfflineError(decision.error) && !online ? 'offline' : 'error'}
              title="Risk decision could not be loaded"
              text={decision.error.message}
              onRetry={decision.refresh}
              testId="risk-error"
            />
          ) : decision.data?.riskDecision === null || decision.data === null ? (
            <StateView
              kind="empty"
              title="Risk decision is not available"
              text="The intent exists but the backend returned no decision record for it."
              testId="risk-missing"
            />
          ) : (
            <>
              <div className="bento-figure">
                <span className="bento-figure__label">Last verdict</span>
                <span className="bento-figure__value">
                  <Badge tone={decision.data.riskDecision.verdict === 'APPROVED' ? 'success' : 'danger'}>
                    {decision.data.riskDecision.verdict}
                  </Badge>
                </span>
              </div>
              <p className="meta">
                <span className="mono">{decision.data.riskDecision.policyVersion}</span> ·{' '}
                <span className="mono">{formatUtc(decision.data.riskDecision.evaluatedAt)}</span>
              </p>
              <p className="meta">
                {decision.data.riskDecision.reasons[0] ?? 'Approved intent; no PAPER fill is implied.'}
              </p>
            </>
          )}
          <div className="bento-tile__foot">
            <Link to="/risk">Open risk</Link>
          </div>
        </section>

        <section className="bento-tile bento-tile--market" data-testid="overview-market">
          <div className="bento-tile__title">
            <h2>Market & pool</h2>
          </div>
          {snapshot.isLoading ? (
            <StateView kind="loading" title="Loading the market snapshot…" testId="market-loading" />
          ) : snapshot.error !== null || snapshotData === null ? (
            <StateView
              kind={isOfflineError(snapshot.error ?? new Error('')) && !online ? 'offline' : 'error'}
              title="Market snapshot unavailable"
              text={snapshot.error?.message ?? 'No market snapshot has been recorded yet.'}
              onRetry={snapshot.refresh}
              testId="market-error"
            />
          ) : (
            <>
              <div className="row">
                <span className="row__label">Snapshot</span>
                <SnapshotBadge status={snapshotData.status} />
              </div>
              <dl className="rows">
                <div className="row">
                  <dt className="row__label">Observed</dt>
                  <dd className="row__value mono">
                    block {snapshotData.blockNumber} · {formatAge(snapshotAge)}
                  </dd>
                </div>
                <div className="row">
                  <dt className="row__label">Source</dt>
                  <dd className="row__value mono">{snapshotData.source}</dd>
                </div>
                <div className="row">
                  <dt className="row__label">Reference price</dt>
                  <dd className="row__value">
                    {snapshotData.status === 'INCOMPLETE' || snapshotData.status === 'UNAVAILABLE'
                      ? 'Unavailable'
                      : `${formatScaled(snapshotData.price)} ${PAIR.quote.symbol}/${PAIR.base.symbol}`}
                  </dd>
                </div>
              </dl>
              {snapshotData.status === 'UNAVAILABLE' ? (
                <p className="meta">{snapshotData.reason}</p>
              ) : snapshotData.status === 'INCOMPLETE' ? (
                <p className="meta">Missing inputs: {snapshotData.missingInputs.join(', ')}</p>
              ) : null}
            </>
          )}
        </section>

        <section className="bento-tile bento-tile--discovery bento-tile--interactive" data-testid="overview-discovery">
          <div className="bento-tile__title">
            <h2>Discovery</h2>
          </div>
          {discovery.isLoading ? (
            <StateView kind="loading" title="Loading the pool registry…" testId="discovery-loading" />
          ) : discovery.error !== null ? (
            <StateView
              kind={isOfflineError(discovery.error) && !online ? 'offline' : 'error'}
              title="Discovery state could not be read"
              text={discovery.error.message}
              onRetry={discovery.refresh}
              testId="discovery-error"
            />
          ) : (
            <>
              <div className="row">
                <span className="row__label">Registry</span>
                <Badge tone={registryStatus === 'OK' ? 'success' : 'muted'}>
                  {registryStatus ?? 'Unavailable'}
                </Badge>
              </div>
              <div className="bento-figures-row">
                <div className="bento-figure">
                  <span className="bento-figure__label">Pools tracked</span>
                  <span className="bento-figure__value" data-testid="overview-tracked-pools">
                    {trackedPools ?? 'Unavailable'}
                  </span>
                </div>
                <div className="bento-figure">
                  <span className="bento-figure__label">Watchlist</span>
                  <span className="bento-figure__value" data-testid="overview-watchlist">
                    {watchlistEntries ?? 'Unavailable'}
                  </span>
                </div>
              </div>
            </>
          )}
          <div className="bento-tile__foot">
            <Link to="/discover">Open Discover</Link>
          </div>
        </section>

        <section className="bento-tile bento-tile--activity bento-tile--interactive" data-testid="overview-activity">
          <div className="bento-tile__title">
            <h2>Recent PAPER activity</h2>
            <Link to="/journal">Open journal</Link>
          </div>
          {journal.isLoading ? (
            <StateView kind="loading" title="Loading the audit journal…" testId="activity-loading" />
          ) : journal.error !== null ? (
            <StateView
              kind={isOfflineError(journal.error) && !online ? 'offline' : 'error'}
              title="The audit journal could not be read"
              text={journal.error.message}
              onRetry={journal.refresh}
              testId="activity-error"
            />
          ) : journal.data === null || journal.data.events.length === 0 ? (
            <StateView
              kind="empty"
              title="No PAPER activity recorded yet"
              text="The audit journal is empty; entries appear here once the strategy produces a PAPER intent."
              testId="activity-empty"
            />
          ) : (
            <ul className="bento-list">
              {journal.data.events.map((event) => (
                <li className="bento-list__item" key={event.id}>
                  <span className="mono">{event.type}</span>
                  <span className="meta mono">{formatUtc(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/** Semantic tint for PnL figures: negative is red, positive is emerald, zero stays neutral. */
function pnlTint(amount: { readonly value: string } | null): string {
  if (amount === null || amount.value === '0' || amount.value === '') {
    return '';
  }
  return amount.value.startsWith('-') ? 'bento-figure__value--negative' : 'bento-figure__value--positive';
}
