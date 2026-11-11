import { type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { endpoints } from '../../lib/api/endpoints.js';
import { useResource } from '../../lib/api/hooks.js';
import { formatMoney, formatScaled, formatUtc } from '../../lib/format.js';
import { PAIR } from '../../lib/pair.js';
import { useStatus } from '../../app/StatusProvider.js';
import { AddressChip } from '../../components/AddressChip.js';
import { Panel } from '../../components/Panel.js';
import { Provenance } from '../../components/Provenance.js';
import { SnapshotBadge } from '../../components/SnapshotBadge.js';
import { StateView, isOfflineError } from '../../components/StateView.js';
import { SubjectHeader } from '../../components/SubjectHeader.js';
import { CandidateDecisionView } from './CandidateDecisionView.js';
import { IntentAction } from '../intent/IntentAction.js';

export function CandidateDetailPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const { now, online } = useStatus();
  const candidates = useResource(endpoints.candidates(50), { intervalMs: 10_000 });
  const snapshot = useResource(endpoints.snapshot(), { intervalMs: 10_000 });

  const candidate = candidates.data?.find((entry) => entry.evaluation.id === id) ?? null;
  const snapshotData = snapshot.data;

  return (
    <>
      <Link className="btn btn--quiet" to="/candidates" style={{ alignSelf: 'flex-start' }}>
        <ArrowLeft size={16} aria-hidden="true" />
        All candidates
      </Link>

      <SubjectHeader
        title="Candidate"
        description="Strategy evaluation, the market snapshot it was derived from, and the PAPER execution path."
        {...(id === undefined ? {} : { meta: `evaluation ${id}` })}
      />

      {candidates.isLoading ? (
        <StateView kind="loading" title="Loading the evaluation…" testId="candidate-loading" />
      ) : candidates.error !== null ? (
        <StateView
          kind={isOfflineError(candidates.error) && !online ? 'offline' : 'error'}
          title="The evaluation could not be loaded"
          text={candidates.error.message}
          onRetry={candidates.refresh}
          testId="candidate-error"
        />
      ) : candidate === null ? (
        <StateView
          kind="empty"
          title="Candidate not found"
          text="This evaluation is not in the latest evaluations returned by the backend. It may have been pruned from the page window."
          testId="candidate-empty"
        />
      ) : (
        <>
          <Panel title="Evaluation">
            <CandidateDecisionView candidate={candidate} now={now} />
          </Panel>

          <Panel
            title="Market snapshot"
            actions={snapshotData === null ? null : <SnapshotBadge status={snapshotData.status} />}
          >
            {snapshot.isLoading ? (
              <StateView kind="loading" title="Loading the market snapshot…" testId="snapshot-loading" />
            ) : snapshot.error !== null ? (
              <StateView
                kind={isOfflineError(snapshot.error) && !online ? 'offline' : 'error'}
                title="The market snapshot could not be loaded"
                text={snapshot.error.message}
                onRetry={snapshot.refresh}
                testId="snapshot-error"
              />
            ) : snapshotData === null ? (
              <StateView kind="empty" title="No snapshot recorded" testId="snapshot-empty" />
            ) : (
              <div className="stack">
                <dl className="facts facts--two">
                  <div className="fact">
                    <dt>Pool</dt>
                    <dd>
                      <AddressChip address={snapshotData.poolAddress} />
                    </dd>
                  </div>
                  <div className="fact">
                    <dt>Block</dt>
                    <dd className="mono">{snapshotData.blockNumber}</dd>
                  </div>
                  <div className="fact">
                    <dt>Block hash</dt>
                    <dd className="mono">{snapshotData.blockHash}</dd>
                  </div>
                  <div className="fact">
                    <dt>Price</dt>
                    <dd className="mono">
                      {snapshotData.status === 'INCOMPLETE' || snapshotData.status === 'UNAVAILABLE'
                        ? 'Unavailable'
                        : `${formatScaled(snapshotData.price)} ${PAIR.quote.symbol}/${PAIR.base.symbol}`}
                    </dd>
                  </div>
                  {snapshotData.status === 'COMPLETE' || snapshotData.status === 'STALE' ? (
                    <>
                      <div className="fact">
                        <dt>Reserves (base)</dt>
                        <dd className="mono">
                          {formatMoney(snapshotData.reservesBase, { maxFrac: 4 })} {PAIR.base.symbol}
                        </dd>
                      </div>
                      <div className="fact">
                        <dt>Reserves (quote)</dt>
                        <dd className="mono">
                          {formatMoney(snapshotData.reservesQuote, { maxFrac: 2 })} {PAIR.quote.symbol}
                        </dd>
                      </div>
                      <div className="fact">
                        <dt>Liquidity (quote)</dt>
                        <dd className="mono">{formatMoney(snapshotData.liquidityQuote, { maxFrac: 2 })}</dd>
                      </div>
                    </>
                  ) : null}
                  {snapshotData.status === 'INCOMPLETE' ? (
                    <div className="fact">
                      <dt>Missing inputs</dt>
                      <dd>{snapshotData.missingInputs.join(', ')}</dd>
                    </div>
                  ) : null}
                  {snapshotData.status === 'UNAVAILABLE' ? (
                    <div className="fact">
                      <dt>Reason</dt>
                      <dd>{snapshotData.reason}</dd>
                    </div>
                  ) : null}
                  <div className="fact">
                    <dt>Source time</dt>
                    <dd className="mono">{formatUtc(snapshotData.sourceTime)}</dd>
                  </div>
                </dl>
                <Provenance
                  source={snapshotData.source}
                  blockNumber={snapshotData.blockNumber}
                  sourceTime={snapshotData.sourceTime}
                  observedAt={snapshotData.observedAt}
                  now={now}
                />
              </div>
            )}
          </Panel>

          <Panel title="Execution">
            <IntentAction candidate={candidate} onCreated={candidates.refresh} />
          </Panel>
        </>
      )}
    </>
  );
}