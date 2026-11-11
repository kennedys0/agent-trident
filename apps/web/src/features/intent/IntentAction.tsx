import { useState, type ReactNode } from 'react';
import { FilePlus2, Fuel, RotateCcw } from 'lucide-react';
import type { GasEstimate } from '@trident/api-contract';
import { ApiError, apiPost } from '../../lib/api/client.js';
import { intentExecution } from '../../lib/api/endpoints.js';
import type { Candidate } from '../../lib/api/endpoints.js';
import type { IntentExecution } from '../../lib/api/endpoints.js';
import { readFlag } from '../../lib/api/system.js';
import { PAIR } from '../../lib/pair.js';
import { formatMoney, formatScaled } from '../../lib/format.js';
import { Badge } from '../../components/Badge.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { RiskDecisionView } from '../risk/RiskDecisionView.js';

type Result = {
  readonly execution: IntentExecution;
  readonly replayed: boolean;
};

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('crypto.randomUUID is unavailable in this browser context');
}

function GasEstimateView({ estimate }: { readonly estimate: GasEstimate }): ReactNode {
  if (estimate.status === 'UNAVAILABLE') {
    return (
      <div className="stack stack--tight" data-testid="gas-estimate">
        <span className="inline">
          <Badge tone="testnet">GAS UNAVAILABLE</Badge>
          <span className="meta">{estimate.reason}</span>
        </span>
        <span className="provenance">{estimate.provenance}</span>
      </div>
    );
  }
  return (
    <div className="stack stack--tight" data-testid="gas-estimate">
      <span className="inline">
        <Badge tone="info" icon={<Fuel size={14} />}>
          GAS ESTIMATED
        </Badge>
        <span className="mono">
          {estimate.gasUnits} gas · {estimate.gasCostWei} wei @ {estimate.gasPriceWei} wei/gas
        </span>
      </span>
      {estimate.gasQuoteCost === undefined ? (
        <span className="meta">
          Quote-currency gas cost is Unavailable: the backend has no sourced ETH/{PAIR.quote.symbol} conversion.
        </span>
      ) : (
        <span className="mono">
          {formatMoney(estimate.gasQuoteCost, { maxFrac: 6 })} {PAIR.quote.symbol}
        </span>
      )}
      <span className="provenance">{estimate.provenance}</span>
    </div>
  );
}

export function IntentAction({
  candidate,
  onCreated,
}: {
  readonly candidate: Candidate;
  readonly onCreated?: () => void;
}): ReactNode {
  const { evaluation } = candidate;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const tradable = evaluation.action === 'BUY' || evaluation.action === 'SELL';
  const eligible = tradable && evaluation.snapshotStatus === 'COMPLETE';
  const disabledReason = !tradable
    ? `This evaluation is ${evaluation.action}; the strategy did not propose a trade.`
    : evaluation.snapshotStatus !== 'COMPLETE'
      ? `The snapshot is ${evaluation.snapshotStatus}; a ${evaluation.action} intent requires a COMPLETE snapshot.`
      : null;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const envelope = await apiPost(
        '/api/v1/intents',
        { evaluationId: evaluation.id, idempotencyKey: newIdempotencyKey() },
        intentExecution,
      );
      setResult({ execution: envelope.data, replayed: readFlag(envelope.meta, 'replayed') === true });
      setOpen(false);
      onCreated?.();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'CONTRACT_MISMATCH') {
        setError(
          'The backend response does not match the amended intent-execution contract: it must return intent, riskDecision, order, and fill. The API branch has to adopt contract 0fb7be6 before this action can complete.',
        );
      } else {
        setError(cause instanceof Error ? cause.message : 'The intent request failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const approval =
    result !== null && result.execution.riskDecision.verdict === 'APPROVED'
      ? result.execution.riskDecision
      : null;

  const qty =
    'proposedBaseQty' in evaluation && evaluation.proposedBaseQty !== undefined
      ? formatMoney({ value: evaluation.proposedBaseQty, decimals: PAIR.base.decimals }, { maxFrac: 6, minFrac: 4 })
      : null;

  return (
    <section className="stack" aria-label="Create a paper intent">
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <h2 className="panel__title">PAPER execution</h2>
        <Badge tone="wait">Simulated — no real money</Badge>
      </div>

      <p className="meta">
        A paper intent is derived by the backend from this evaluation. The risk gate evaluates it and, if approved, records a
        simulated order and fill. No transaction is signed.
      </p>

      <div className="inline">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!eligible}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          {...(disabledReason === null ? {} : { 'aria-describedby': 'intent-disabled-reason' })}
          data-testid="create-intent"
        >
          <FilePlus2 size={16} aria-hidden="true" />
          Create PAPER intent
        </button>
        {result === null ? null : (
          <button type="button" className="btn btn--quiet" onClick={() => setResult(null)} data-testid="clear-intent-result">
            <RotateCcw size={16} aria-hidden="true" />
            Clear result
          </button>
        )}
      </div>

      {disabledReason === null ? null : (
        <p className="meta" id="intent-disabled-reason" data-testid="intent-disabled-reason">
          Disabled: {disabledReason}
        </p>
      )}

      {error === null ? null : (
        <p className="banner banner--danger" role="alert" data-testid="intent-error">
          {error}
        </p>
      )}

      {result === null ? null : (
        <div className="stack" data-testid="intent-result">
          <div className="inline">
            <Badge tone={result.execution.riskDecision.verdict === 'APPROVED' ? 'success' : 'danger'}>
              {result.execution.riskDecision.verdict}
            </Badge>
            <span className="meta mono">intent {result.execution.intent.id.slice(0, 18)}…</span>
            {result.replayed ? (
              <span data-testid="intent-replayed">
                <Badge tone="info">REPLAYED — no new fill</Badge>
              </span>
            ) : null}
          </div>

          {result.replayed ? (
            <p className="banner banner--info" role="status">
              This idempotency key already produced an execution. The backend replayed the stored result; no new order, fill,
              or ledger entry was written.
            </p>
          ) : null}

          <dl className="facts facts--two">
            <div className="fact">
              <dt>Intent status</dt>
              <dd className="mono" data-testid="intent-status">
                {result.execution.intent.status}
              </dd>
            </div>
            <div className="fact">
              <dt>Order</dt>
              <dd className="mono" data-testid="intent-order">
                {result.execution.order === null ? 'None — rejected' : result.execution.order.id}
              </dd>
            </div>
            <div className="fact">
              <dt>Fill</dt>
              <dd className="mono" data-testid="intent-fill">
                {result.execution.fill === null ? 'None — rejected' : result.execution.fill.orderId}
              </dd>
            </div>
            {approval === null ? null : (
              <>
                <div className="fact">
                  <dt>Approved size</dt>
                  <dd className="mono">
                    {formatMoney(approval.approvedBaseQty, { maxFrac: 6, minFrac: 4 })} {PAIR.base.symbol}
                  </dd>
                </div>
                <div className="fact">
                  <dt>Maximum quote cost</dt>
                  <dd className="mono">
                    {formatMoney(approval.maximumQuoteCost, { maxFrac: 2 })} {PAIR.quote.symbol}
                  </dd>
                </div>
              </>
            )}
            {result.execution.fill === null ? null : (
              <>
                <div className="fact">
                  <dt>Filled quantity</dt>
                  <dd className="mono">
                    {formatMoney({ value: result.execution.fill.baseQty, decimals: PAIR.base.decimals }, { maxFrac: 6, minFrac: 4 })}{' '}
                    {PAIR.base.symbol}
                  </dd>
                </div>
                <div className="fact">
                  <dt>Execution price</dt>
                  <dd className="mono">
                    {formatScaled(result.execution.fill.executionPrice)} {PAIR.quote.symbol}/{PAIR.base.symbol}
                  </dd>
                </div>
                <div className="fact">
                  <dt>Fee</dt>
                  <dd className="mono">
                    {formatMoney(result.execution.fill.feeQuote, { maxFrac: 6 })} {PAIR.quote.symbol}
                  </dd>
                </div>
              </>
            )}
          </dl>

          {result.execution.fill === null ? null : <GasEstimateView estimate={result.execution.fill.gasEstimate} />}

          <RiskDecisionView decision={result.execution.riskDecision} />
        </div>
      )}

      <ConfirmDialog
        open={open}
        title="Create a simulated PAPER intent?"
        confirmLabel="Create paper intent"
        busy={busy}
        error={error}
        onCancel={() => setOpen(false)}
        onConfirm={() => void submit()}
      >
        <p>
          Side: <strong>{evaluation.action}</strong>
          {qty === null ? null : (
            <>
              {' '}
              · proposed size{' '}
              <strong>
                {qty} {PAIR.base.symbol}
              </strong>
            </>
          )}
        </p>
        <p>No wallet, key, or transaction is involved. The risk gate may reject this intent.</p>
        <p className="meta">Success is reported only after the backend returns its decision.</p>
      </ConfirmDialog>
    </section>
  );
}