import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/api/endpoints.js';
import { useResource } from '../../lib/api/hooks.js';
import { readFlag, readNumber, readString } from '../../lib/api/system.js';
import { ageSeconds, formatAge, formatScaled, formatUtc } from '../../lib/format.js';
import { PAIR } from '../../lib/pair.js';
import { useStatus } from '../../app/StatusProvider.js';
import { Badge } from '../../components/Badge.js';
import { Panel } from '../../components/Panel.js';
import { SnapshotBadge } from '../../components/SnapshotBadge.js';
import { StateView, isOfflineError } from '../../components/StateView.js';
import { CandidateDecisionView } from '../candidates/CandidateDecisionView.js';
import { RiskDecisionSummary } from '../risk/RiskDecisionView.js';
import { scanWindowText, useIntentDecision, useRiskDecisionScan } from '../risk/useIntentDecision.js';
import { PortfolioView } from '../portfolio/PortfolioView.js';

export function OverviewPage(): ReactNode {
  const { health, now, online } = useStatus();
  const snapshot = useResource(endpoints.snapshot(), { intervalMs: 10_000 });
  const candidates = useResource(endpoints.candidates(5), { intervalMs: 10_000 });
  const portfolio = useResource(endpoints.portfolio(), { intervalMs: 10_000 });
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
  const strategyId = readString(candidates.meta, 'strategyId');
  const configVersion = readString(candidates.meta, 'configVersion');
  const killSwitch = readFlag(health.meta, 'killSwitchEngaged');
  const latency = readNumber(health.meta, 'rpcLatencyMs');
  const scanAge = candidates.receivedAt === null ? null : Math.max(0, Math.floor((now - candidates.receivedAt) / 1000));

  return (
    <>
      <header className="stack stack--tight">
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

      <Panel
        title="System status"
        actions={
          <button type="button" className="btn btn--quiet" onClick={() => health.refresh()}>
            Refresh
          </button>
        }
      >
        <div className="rows">
          <div className="row">
            <span className="row__label">Execution mode</span>
            <span className="row__value">
              <Badge tone="wait">PAPER — SIMULATED</Badge>
            </span>
          </div>
          <div className="row">
            <span className="row__label">Chain</span>
            <span className="row__value mono">
              {healthData === null ? 'Unavailable' : `${healthData.chainId} · RPC ${healthData.rpcStatus.toLowerCase()}`}
              {latency === null ? '' : ` · ${latency} ms`}
            </span>
          </div>
          <div className="row">
            <span className="row__label">Head block</span>
            <span className="row__value mono">
              {healthData?.headBlock ?? 'Unavailable'}
              {healthData?.lagSeconds === null || healthData === null ? '' : ` · lag ${healthData.lagSeconds}s`}
            </span>
          </div>
          <div className="row">
            <span className="row__label">Snapshot freshness</span>
            <span className="row__value">
              {snapshot.isLoading ? (
                <span className="meta">Loading snapshot…</span>
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
          <div className="row">
            <span className="row__label">Reference price</span>
            <span className="row__value mono">
              {snapshotData === null || snapshotData.status === 'INCOMPLETE' || snapshotData.status === 'UNAVAILABLE'
                ? 'Unavailable'
                : `${formatScaled(snapshotData.price)} ${PAIR.quote.symbol}/${PAIR.base.symbol}`}
            </span>
          </div>
          <div className="row">
            <span className="row__label">Strategy</span>
            <span className="row__value mono">
              {strategyId === null ? 'Unavailable' : `${strategyId} · ${configVersion ?? 'version unavailable'}`}
            </span>
          </div>
          <div className="row">
            <span className="row__label">New entries</span>
            <span className="row__value">
              {killSwitch === null ? (
                <Badge tone="muted">Kill-switch state unavailable</Badge>
              ) : killSwitch ? (
                <Badge tone="danger">STOPPED</Badge>
              ) : (
                <Badge tone="success">Allowed by kill switch</Badge>
              )}
            </span>
          </div>
          <div className="row">
            <span className="row__label">Last scan</span>
            <span className="row__value mono">
              {candidates.receivedAt === null ? 'Unavailable' : `${formatAge(scanAge)} (${formatUtc(new Date(candidates.receivedAt).toISOString())})`}
            </span>
          </div>
        </div>
      </Panel>

      <div className="grid grid--12">
        <div className="col-8">
          <Panel
            title="Latest decision"
            actions={
              <Link className="btn btn--quiet" to="/candidates">
                All candidates
              </Link>
            }
          >
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
                text={
                  scanAge === null
                    ? 'The backend returned an empty evaluation list.'
                    : `The scan completed ${formatAge(scanAge)}; no token passed the current filters.`
                }
                testId="candidates-empty"
              />
            ) : (
              <CandidateDecisionView candidate={latestCandidate} now={now} compact />
            )}
          </Panel>
        </div>

        <div className="col-4">
          <Panel title="Latest recorded risk decision">
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
              <RiskDecisionSummary decision={decision.data.riskDecision} />
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Paper portfolio"
        actions={
          <Link className="btn btn--quiet" to="/portfolio">
            Open portfolio
          </Link>
        }
      >
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
        ) : portfolio.data === null ? (
          <StateView kind="empty" title="No portfolio projection yet" testId="portfolio-empty" />
        ) : (
          <PortfolioView portfolio={portfolio.data} venues={null} compact />
        )}
      </Panel>
    </>
  );
}