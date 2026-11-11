import type { ReactNode } from 'react';
import type { Candidate } from '../../lib/api/endpoints.js';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PAIR } from '../../lib/pair.js';
import { formatAge, formatMoney, formatScaled, formatStrength, formatUtc } from '../../lib/format.js';
import { ActionBadge } from '../../components/ActionBadge.js';
import { SnapshotBadge } from '../../components/SnapshotBadge.js';

export function CandidateDecisionView({
  candidate,
  now,
  compact = false,
}: {
  readonly candidate: Candidate;
  readonly now: number;
  readonly compact?: boolean;
}): ReactNode {
  const { evaluation } = candidate;
  const age = Math.max(0, Math.floor((now - new Date(evaluation.evaluatedAt).getTime()) / 1000));
  const qty =
    'proposedBaseQty' in evaluation && evaluation.proposedBaseQty !== undefined
      ? `${formatMoney({ value: evaluation.proposedBaseQty, decimals: PAIR.base.decimals }, { maxFrac: 6, minFrac: 4 })} ${PAIR.base.symbol}`
      : 'No size proposed';

  return (
    <div className="stack">
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <div className="inline">
          <ActionBadge action={evaluation.action} />
          <SnapshotBadge status={evaluation.snapshotStatus} />
          <span className="meta">strength {formatStrength(evaluation.signalStrength)}</span>
        </div>
        <span className="meta mono">evaluated {formatUtc(evaluation.evaluatedAt)} · {formatAge(age)}</span>
      </div>

      <p className="action-strong">{evaluation.action}</p>

      <dl className="facts facts--two">
        <div className="fact">
          <dt>Proposed size</dt>
          <dd>{qty}</dd>
        </div>
        <div className="fact">
          <dt>Strategy</dt>
          <dd className="mono">
            {evaluation.strategyId} · {evaluation.configVersion}
          </dd>
        </div>
        <div className="fact">
          <dt>Invalidation</dt>
          <dd>{evaluation.invalidation}</dd>
        </div>
        <div className="fact">
          <dt>Snapshot</dt>
          <dd className="mono">{evaluation.snapshotId.slice(0, 18)}…</dd>
        </div>
      </dl>

      {compact ? null : (
        <div className="stack stack--tight">
          <h3 className="panel__title">Reasons</h3>
          {evaluation.reasons.length === 0 ? (
            <p className="meta">The strategy attached no reasons to this evaluation.</p>
          ) : (
            <ul className="reasons">
              {evaluation.reasons.map((reason) => (
                <li className="reason" key={reason}>
                  {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {compact ? (
        <Link className="btn btn--quiet" to={`/candidates/${encodeURIComponent(evaluation.id)}`} data-testid="open-candidate">
          Open candidate <ExternalLink size={14} aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

export function CandidatePriceView({ price }: { readonly price: { value: string; scale: string } }): ReactNode {
  return <span className="mono">{formatScaled(price)}</span>;
}