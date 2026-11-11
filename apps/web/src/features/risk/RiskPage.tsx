import { type ReactNode } from 'react';
import { readFlag } from '../../lib/api/system.js';
import { PAIR } from '../../lib/pair.js';
import { useStatus } from '../../app/StatusProvider.js';
import { Badge } from '../../components/Badge.js';
import { Panel } from '../../components/Panel.js';
import { StateView, isOfflineError } from '../../components/StateView.js';
import { SubjectHeader } from '../../components/SubjectHeader.js';
import { RiskDecisionView } from './RiskDecisionView.js';
import { useIntentDecision, useRiskDecisionScan } from './useIntentDecision.js';

function RiskDecisionCard({ intentId }: { readonly intentId: string }): ReactNode {
  const decision = useIntentDecision(intentId);

  if (decision.isLoading) {
    return <StateView kind="loading" title="Loading risk evidence…" testId="risk-card-loading" />;
  }
  if (decision.error !== null) {
    return (
      <StateView
        kind="error"
        title="Risk evidence could not be loaded"
        text={decision.error.message}
        onRetry={decision.refresh}
        testId="risk-card-error"
      />
    );
  }
  if (decision.data === null || decision.data.riskDecision === null) {
    return (
      <StateView
        kind="empty"
        title="No decision recorded for this intent"
        text="The journal references an intent without a stored risk decision."
        testId="risk-card-empty"
      />
    );
  }
  return <RiskDecisionView decision={decision.data.riskDecision} />;
}

export function RiskPage(): ReactNode {
  const { health, online } = useStatus();
  const scan = useRiskDecisionScan(5);
  const killSwitch = readFlag(health.meta, 'killSwitchEngaged');

  return (
    <>
      <SubjectHeader
        title="Risk"
        description={`Risk gate evidence for the ${PAIR.base.symbol}/${PAIR.quote.symbol} PAPER slice. A rule that cannot be evaluated is shown as UNAVAILABLE, never as a pass.`}
      />

      <Panel title="Entry gate state">
        <div className="rows">
          <div className="row">
            <span className="row__label">Kill switch</span>
            <span className="row__value">
              {killSwitch === null ? (
                <Badge tone="muted">Unavailable</Badge>
              ) : killSwitch ? (
                <Badge tone="danger">ENGAGED — new entries blocked</Badge>
              ) : (
                <Badge tone="success">Released — gate decides per intent</Badge>
              )}
            </span>
          </div>
          <div className="row">
            <span className="row__label">Execution mode</span>
            <span className="row__value">
              <Badge tone="wait">PAPER — simulated fills only</Badge>
            </span>
          </div>
          <div className="row">
            <span className="row__label">Decisions found</span>
            <span className="row__value mono">
              {scan.status === 'loading'
                ? 'scanning the journal…'
                : `${scan.intentIds.length} in ${scan.scanned} recent events`}
            </span>
          </div>
        </div>
        <p className="meta">
          The permanent control lives in the header so it stays reachable from every screen, including on mobile.
        </p>
      </Panel>

      <Panel
        title="Recorded decisions"
        actions={
          <button type="button" className="btn btn--quiet" onClick={scan.refresh}>
            Refresh
          </button>
        }
      >
        {scan.status === 'loading' ? (
          <StateView kind="loading" title="Scanning the audit journal for risk decisions…" testId="risk-journal-loading" />
        ) : scan.status === 'error' ? (
          <StateView
            kind={isOfflineError(scan.error ?? new Error('')) && !online ? 'offline' : 'error'}
            title="The journal could not be loaded"
            text={scan.error?.message ?? 'Unknown error'}
            onRetry={scan.refresh}
            testId="risk-journal-error"
          />
        ) : scan.intentIds.length === 0 ? (
          <StateView
            kind="empty"
            title="No risk decisions in the scanned journal window"
            text={`No PAPER intent was created in the ${scan.scanned} most recent audit events${scan.exhausted ? ', and the journal starts there' : ''}. Risk evidence appears only after an intent is created from an evaluation.`}
            testId="risk-empty"
          />
        ) : (
          <div className="stack">
            {scan.intentIds.map((intentId) => (
              <section className="panel" key={intentId} aria-label={`Risk decision for intent ${intentId}`}>
                <div className="panel__body">
                  <RiskDecisionCard intentId={intentId} />
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}