import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/api/endpoints.js';
import { useResource } from '../../lib/api/hooks.js';
import { ageSeconds, formatAge, formatUtc } from '../../lib/format.js';
import { useStatus } from '../../app/StatusProvider.js';
import { ActionBadge } from '../../components/ActionBadge.js';
import { SubjectHeader } from '../../components/SubjectHeader.js';
import { Panel } from '../../components/Panel.js';
import { SnapshotBadge } from '../../components/SnapshotBadge.js';
import { StateView, isOfflineError } from '../../components/StateView.js';

export function CandidatesPage(): ReactNode {
  const { now, online } = useStatus();
  const candidates = useResource(endpoints.candidates(20), { intervalMs: 10_000 });

  return (
    <>
      <SubjectHeader
        title="Candidates"
        description="Strategy evaluations recorded by the backend, newest first. Each row opens the full evaluation with its snapshot provenance."
      />

      <Panel
        title="Latest evaluations"
        actions={
          <button type="button" className="btn btn--quiet" onClick={candidates.refresh} disabled={candidates.isRefetching}>
            Refresh
          </button>
        }
      >
        {candidates.isLoading ? (
          <StateView kind="loading" title="Loading evaluations…" testId="candidates-loading" />
        ) : candidates.error !== null ? (
          <StateView
            kind={isOfflineError(candidates.error) && !online ? 'offline' : 'error'}
            title="Evaluations could not be loaded"
            text={candidates.error.message}
            onRetry={candidates.refresh}
            testId="candidates-error"
          />
        ) : candidates.data === null || candidates.data.length === 0 ? (
          <StateView
            kind="empty"
            title="No eligible candidates in the latest scan"
            text="The backend returned an empty evaluation list. Nothing is being hidden."
            testId="candidates-empty"
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Snapshot</th>
                  <th scope="col" className="num">
                    Strength
                  </th>
                  <th scope="col">Evaluated</th>
                  <th scope="col">Open</th>
                </tr>
              </thead>
              <tbody>
                {candidates.data.map((candidate) => {
                  const age = ageSeconds(candidate.evaluation.evaluatedAt, now);
                  return (
                    <tr key={candidate.evaluation.id}>
                      <td data-label="Action">
                        <ActionBadge action={candidate.evaluation.action} />
                      </td>
                      <td data-label="Snapshot">
                        <SnapshotBadge status={candidate.evaluation.snapshotStatus} />
                      </td>
                      <td className="num" data-label="Strength">
                        {(candidate.evaluation.signalStrength / 100).toFixed(1)}%
                      </td>
                      <td data-label="Evaluated">
                        <span className="mono">{formatUtc(candidate.evaluation.evaluatedAt)}</span>
                        <br />
                        <span className="meta">{formatAge(age)}</span>
                      </td>
                      <td data-label="Open">
                        <Link to={`/candidates/${encodeURIComponent(candidate.evaluation.id)}`}>Details</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}