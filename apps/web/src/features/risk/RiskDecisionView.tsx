import type { ReactNode } from 'react';
import type { RiskDecision } from '@trident/api-contract';
import { Link } from 'react-router-dom';
import { CheckCircle2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { PAIR } from '../../lib/pair.js';
import { formatMoney, formatUtc } from '../../lib/format.js';
import { Badge } from '../../components/Badge.js';

function evidence(value: string | number | boolean | null): string {
  if (value === null) {
    return 'null';
  }
  return String(value);
}

function RuleStatus({ status }: { readonly status: 'PASS' | 'FAIL' | 'UNAVAILABLE' }): ReactNode {
  if (status === 'PASS') {
    return (
      <Badge tone="success" icon={<CheckCircle2 size={14} />}>
        PASS
      </Badge>
    );
  }
  if (status === 'FAIL') {
    return (
      <Badge tone="danger" icon={<ShieldAlert size={14} />}>
        FAIL
      </Badge>
    );
  }
  return (
    <Badge tone="testnet" icon={<ShieldQuestion size={14} />}>
      UNAVAILABLE
    </Badge>
  );
}

export function RiskDecisionView({ decision }: { readonly decision: RiskDecision }): ReactNode {
  const approved = decision.verdict === 'APPROVED';
  return (
    <div className="stack">
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <Badge tone={approved ? 'success' : 'danger'} icon={approved ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}>
          {decision.verdict}
        </Badge>
        <span className="meta mono">policy {decision.policyVersion} · {formatUtc(decision.evaluatedAt)}</span>
      </div>

      <dl className="facts facts--two">
        <div className="fact">
          <dt>Portfolio version</dt>
          <dd className="mono">{decision.portfolioVersion}</dd>
        </div>
        <div className="fact">
          <dt>{approved ? 'Approved base qty' : 'Rules evaluated'}</dt>
          <dd className="mono">
            {approved
              ? `${formatMoney(decision.approvedBaseQty, { maxFrac: 6, minFrac: 4 })} ${PAIR.base.symbol}`
              : decision.rules.length}
          </dd>
        </div>
        {approved ? (
          <div className="fact">
            <dt>Maximum quote cost</dt>
            <dd className="mono">
              {formatMoney(decision.maximumQuoteCost, { maxFrac: 2 })} {PAIR.quote.symbol}
            </dd>
          </div>
        ) : null}
        <div className="fact">
          <dt>Intent</dt>
          <dd className="mono">{decision.intentId.slice(0, 18)}…</dd>
        </div>
      </dl>

      {approved ? null : (
        <div className="reasons">
          {decision.reasons.map((reason) => (
            <p className="reason reason--fail" key={reason}>
              {reason}
            </p>
          ))}
        </div>
      )}

      <div className="rule-grid" data-testid="risk-rules">
        {decision.rules.map((rule) => (
          <article className="rule" key={rule.rule}>
            <div className="rule__head">
              <span className="mono">{rule.rule}</span>
              <RuleStatus status={rule.status} />
            </div>
            <div className="rule__pair">
              <span>
                observed: <strong>{evidence(rule.observed)}</strong>
              </span>
              <span>
                threshold: <strong>{evidence(rule.threshold)}</strong>
              </span>
            </div>
            {rule.status === 'PASS' && rule.reason === undefined ? null : <p className="meta">{rule.reason}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}

/**
 * Compact form for the Overview: the full per-rule evidence lives on /risk, so the
 * dashboard shows the verdict, the approved units, and only the rules that did not pass.
 */
export function RiskDecisionSummary({ decision }: { readonly decision: RiskDecision }): ReactNode {
  const approved = decision.verdict === 'APPROVED';
  const notPassing = decision.rules.filter((rule) => rule.status !== 'PASS');

  return (
    <div className="stack stack--tight">
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <Badge tone={approved ? 'success' : 'danger'} icon={approved ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}>
          {decision.verdict}
        </Badge>
        <span className="meta mono">
          {decision.policyVersion} · {formatUtc(decision.evaluatedAt)}
        </span>
      </div>

      <dl className="facts">
        <div className="fact">
          <dt>Rules</dt>
          <dd className="mono">
            {decision.rules.length - notPassing.length}/{decision.rules.length} PASS
          </dd>
        </div>
        {approved ? (
          <div className="fact">
            <dt>Approved size</dt>
            <dd className="mono">
              {formatMoney(decision.approvedBaseQty, { maxFrac: 6, minFrac: 4 })} {PAIR.base.symbol}
            </dd>
          </div>
        ) : null}
      </dl>

      {notPassing.length === 0 ? (
        <p className="meta">Every rule passed. Open the risk page for the per-rule thresholds.</p>
      ) : (
        <ul className="reasons">
          {notPassing.map((rule) => (
            <li className="reason reason--fail" key={rule.rule}>
              <span className="mono">{rule.rule}</span> — {rule.status}
              {rule.reason === undefined ? '' : `: ${rule.reason}`}
            </li>
          ))}
        </ul>
      )}

      <Link className="btn btn--quiet" to="/risk">
        Full risk evidence
      </Link>
    </div>
  );
}
