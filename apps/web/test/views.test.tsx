import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { candidateSchema, portfolioSchema, riskDecisionSchema } from '@trident/api-contract';
import { PAIR } from '../src/lib/pair.js';
import { PortfolioView } from '../src/features/portfolio/PortfolioView.js';
import { RiskDecisionView } from '../src/features/risk/RiskDecisionView.js';
import { CandidateDecisionView } from '../src/features/candidates/CandidateDecisionView.js';
import { StateView } from '../src/components/StateView.js';
import { IntentAction } from '../src/features/intent/IntentAction.js';
import { setTransport } from '../src/lib/api/client.js';

const portfolio = portfolioSchema.parse({
  mode: 'PAPER',
  asOf: '2026-11-11T04:00:00Z',
  balances: [
    { asset: PAIR.quote.address, available: { value: '9499950000', decimals: 6 }, reserved: { value: '0', decimals: 6 } },
  ],
  positions: [
    {
      asset: PAIR.base.address,
      quantity: { value: '243530914141316398', decimals: 18 },
      costBasisQuote: { value: '500050000', decimals: 6 },
      valuationStatus: 'VALUED',
      unrealizedPnlQuote: { value: '-102077', decimals: 6 },
      valuationSnapshotId: 'snap-1',
    },
  ],
  equityQuote: { value: '9999897923', decimals: 6 },
  realizedPnlQuote: { value: '0', decimals: 6 },
  unrealizedPnlQuote: { value: '-102077', decimals: 6 },
});

const unpricedPortfolio = portfolioSchema.parse({
  ...portfolio,
  positions: [
    {
      asset: PAIR.base.address,
      quantity: { value: '243530914141316398', decimals: 18 },
      costBasisQuote: { value: '500050000', decimals: 6 },
      valuationStatus: 'UNPRICED',
      reason: 'No market snapshot is available to value this position',
    },
  ],
});

const approved = riskDecisionSchema.parse({
  intentId: 'intent-1',
  policyVersion: 'paper-risk-v1',
  portfolioVersion: 'ledger:3',
  verdict: 'APPROVED',
  reasons: [],
  evaluatedAt: '2026-11-11T04:00:00Z',
  rules: [{ rule: 'R01_chain', observed: 4663, threshold: 4663, status: 'PASS' }],
  approvedBaseQty: { value: '243530914141316398', decimals: 18 },
  maximumQuoteCost: { value: '500050000', decimals: 6 },
});

const rejected = riskDecisionSchema.parse({
  intentId: 'intent-2',
  policyVersion: 'paper-risk-v1',
  portfolioVersion: 'ledger:3',
  verdict: 'REJECTED',
  reasons: ['R02_kill_switch: Kill switch is engaged; new entries are blocked'],
  evaluatedAt: '2026-11-11T04:00:00Z',
  rules: [
    { rule: 'R02_kill_switch', observed: true, threshold: false, status: 'FAIL', reason: 'Kill switch is engaged' },
    { rule: 'R14_gas', observed: null, threshold: 'required', status: 'UNAVAILABLE', reason: 'Gas estimate unavailable' },
  ],
});

const buyCandidate = candidateSchema.parse({
  token: PAIR.base.address,
  snapshotId: 'snap-1',
  evaluation: {
    id: 'eval-1',
    snapshotId: 'snap-1',
    snapshotStatus: 'COMPLETE',
    strategyId: 'paper-momentum',
    configVersion: '1.0.0',
    inputHash: `0x${'a'.repeat(64)}`,
    action: 'BUY',
    signalStrength: 6250,
    invalidation: 'Price falls below the entry band',
    reasons: ['Liquidity above threshold'],
    evaluatedAt: '2026-11-11T04:00:00Z',
    proposedBaseQty: '243530914141316398',
  },
});

const avoidCandidate = candidateSchema.parse({
  ...buyCandidate,
  evaluation: {
    ...buyCandidate.evaluation,
    id: 'eval-2',
    action: 'AVOID',
    snapshotStatus: 'STALE',
  },
});

describe('PortfolioView', () => {
  it('labels the projection as simulated and shows the contract values', () => {
    render(
      <MemoryRouter>
        <PortfolioView portfolio={portfolio} venues={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText('SIMULATED')).toBeInTheDocument();
    expect(screen.getByTestId('portfolio-equity')).toHaveTextContent('9,999.89');
    expect(screen.getByTestId('portfolio-cash')).toHaveTextContent('9,499.95');
    expect(screen.getByTestId('portfolio-unrealized')).toHaveTextContent('−0.10');
    expect(screen.getByText('VALUED')).toBeInTheDocument();
  });

  it('never presents an unpriced position as a zero PnL', () => {
    render(
      <MemoryRouter>
        <PortfolioView portfolio={unpricedPortfolio} venues={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText('UNPRICED')).toBeInTheDocument();
    expect(screen.getByText('No market snapshot is available to value this position')).toBeInTheDocument();
    expect(screen.queryByText('+0.00')).not.toBeInTheDocument();
  });

  it('labels assumptions the backend does not expose as unavailable', () => {
    render(
      <MemoryRouter>
        <PortfolioView portfolio={portfolio} venues={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Slippage and gas model')).toBeInTheDocument();
    expect(screen.getAllByText('UNAVAILABLE').length).toBeGreaterThan(0);
  });
});

describe('RiskDecisionView', () => {
  it('shows per-rule evidence for an approved decision', () => {
    render(<RiskDecisionView decision={approved} />);
    expect(screen.getByText('APPROVED')).toBeInTheDocument();
    expect(screen.getByText('R01_chain')).toBeInTheDocument();
    expect(screen.getByText('PASS')).toBeInTheDocument();
    expect(screen.getByText(/0\.2435/)).toBeInTheDocument();
  });

  it('shows FAIL and UNAVAILABLE rules without turning either into a pass', () => {
    render(<RiskDecisionView decision={rejected} />);
    expect(screen.getByText('REJECTED')).toBeInTheDocument();
    expect(screen.getByText('FAIL')).toBeInTheDocument();
    expect(screen.getByText('UNAVAILABLE')).toBeInTheDocument();
    expect(screen.getAllByText(/Kill switch is engaged/).length).toBeGreaterThan(0);
    expect(screen.queryByText('PASS')).not.toBeInTheDocument();
  });
});

describe('CandidateDecisionView', () => {
  it('renders the proposed size for a BUY evaluation', () => {
    render(<MemoryRouter><CandidateDecisionView candidate={buyCandidate} now={Date.parse('2026-11-11T04:00:30Z')} /></MemoryRouter>);
    expect(screen.getAllByText('BUY').length).toBeGreaterThan(0);
    expect(screen.getByText(/0\.243530 WETH/)).toBeInTheDocument();
    expect(screen.getByText(/Price falls below/)).toBeInTheDocument();
  });

  it('keeps a stale AVOID evaluation visible as AVOID rather than a trade', () => {
    render(<MemoryRouter><CandidateDecisionView candidate={avoidCandidate} now={Date.parse('2026-11-11T04:00:30Z')} /></MemoryRouter>);
    expect(screen.getAllByText('AVOID').length).toBeGreaterThan(0);
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });
});

describe('StateView', () => {
  it('renders a truthful empty state with a working retry affordance', async () => {
    const onRetry = vi.fn();
    render(<StateView kind="empty" title="No eligible candidates in the latest scan" onRetry={onRetry} testId="empty" />);
    expect(screen.getByText('No eligible candidates in the latest scan')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('empty-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('announces errors with role=alert', () => {
    render(<StateView kind="error" title="Portfolio could not be loaded" text="NETWORK_ERROR" testId="error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('NETWORK_ERROR');
  });

  it('marks loading with aria-busy and no fake content', () => {
    render(<StateView kind="loading" title="Loading portfolio projection…" testId="loading" />);
    expect(screen.getByTestId('loading')).toHaveAttribute('aria-busy', 'true');
  });
});

const ORDER_ID = 'order-11111111-1111-4111-8111-111111111111';
const INTENT_ID = 'intent-22222222-2222-4222-8222-222222222222';

function executedBody(gas: Record<string, unknown>) {
  return {
    data: {
      intent: {
        id: INTENT_ID,
        evaluationId: 'eval-1',
        idempotencyKey: 'test-idempotency-key-0001',
        mode: 'PAPER',
        side: 'BUY',
        token: PAIR.base.address,
        quoteToken: PAIR.quote.address,
        baseQty: '243530914141316398',
        limitPrice: { value: '2066130000000000000000', scale: '18' },
        snapshotId: 'snap-1',
        expiresAt: '2026-11-11T04:10:00.000Z',
        status: 'FILLED',
      },
      riskDecision: {
        intentId: INTENT_ID,
        policyVersion: 'paper-risk-v1',
        portfolioVersion: 'ledger:3',
        verdict: 'APPROVED',
        reasons: [],
        evaluatedAt: '2026-11-11T04:00:00.000Z',
        rules: [{ rule: 'R01_chain', observed: 4663, threshold: 4663, status: 'PASS' }],
        approvedBaseQty: { value: '243530914141316398', decimals: 18 },
        maximumQuoteCost: { value: '500050000', decimals: 6 },
      },
      order: {
        id: ORDER_ID,
        intentId: INTENT_ID,
        riskDecisionId: 'risk-33333333-3333-4333-8333-333333333333',
        status: 'FILLED',
        createdAt: '2026-11-11T04:00:01.000Z',
      },
      fill: {
        orderId: ORDER_ID,
        snapshotId: 'snap-1',
        baseQty: '243530914141316398',
        quoteQty: '500050000',
        feeQuote: { value: '50005', decimals: 6 },
        gasEstimate: gas,
        executionPrice: { value: '2066130000000000000000', scale: '18' },
        assumptionsVersion: 'paper-v1',
        filledAt: '2026-11-11T04:00:01.000Z',
      },
    },
    meta: { requestId: 'req-1', observedAt: '2026-11-11T04:00:02.000Z', replayed: false },
  };
}

function rejectedBody() {
  return {
    data: {
      intent: {
        id: INTENT_ID,
        evaluationId: 'eval-1',
        idempotencyKey: 'test-idempotency-key-0002',
        mode: 'PAPER',
        side: 'BUY',
        token: PAIR.base.address,
        quoteToken: PAIR.quote.address,
        baseQty: '243530914141316398',
        limitPrice: { value: '2066130000000000000000', scale: '18' },
        snapshotId: 'snap-1',
        expiresAt: '2026-11-11T04:10:00.000Z',
        status: 'REJECTED',
      },
      riskDecision: {
        intentId: INTENT_ID,
        policyVersion: 'paper-risk-v1',
        portfolioVersion: 'ledger:3',
        verdict: 'REJECTED',
        reasons: ['R02_kill_switch: Kill switch is engaged; new entries are blocked'],
        evaluatedAt: '2026-11-11T04:00:00.000Z',
        rules: [
          { rule: 'R02_kill_switch', observed: true, threshold: false, status: 'FAIL', reason: 'Kill switch is engaged' },
        ],
      },
      order: null,
      fill: null,
    },
    meta: { requestId: 'req-2', observedAt: '2026-11-11T04:00:02.000Z', replayed: false },
  };
}

describe('IntentAction', () => {
  it('renders the executed order and shows an unavailable gas estimate as unavailable, never zero', async () => {
    setTransport(async () =>
      new Response(
        JSON.stringify(
          executedBody({
            status: 'UNAVAILABLE',
            reason: 'No ETH/USDG price source is configured',
            provenance: 'quoter gasEstimate + block baseFee, no ETH price source',
          }),
        ),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(
      <MemoryRouter>
        <IntentAction candidate={buyCandidate} />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByTestId('create-intent'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(await screen.findByTestId('intent-result')).toBeInTheDocument();
    expect(screen.getByTestId('intent-order')).toHaveTextContent(ORDER_ID);
    expect(screen.getByTestId('intent-status')).toHaveTextContent('FILLED');
    expect(screen.getByText('GAS UNAVAILABLE')).toBeInTheDocument();
    expect(screen.getByText(/No ETH\/USDG price source/)).toBeInTheDocument();
    expect(screen.queryByText(/0 wei/)).not.toBeInTheDocument();
  });

  it('shows a rejected execution without inventing an order id', async () => {
    setTransport(async () =>
      new Response(JSON.stringify(rejectedBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(
      <MemoryRouter>
        <IntentAction candidate={buyCandidate} />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByTestId('create-intent'));
    await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(await screen.findByTestId('intent-result')).toBeInTheDocument();
    expect(screen.getByTestId('intent-order')).toHaveTextContent('None — rejected');
    expect(screen.getByTestId('intent-fill')).toHaveTextContent('None — rejected');
    expect(screen.queryByTestId('gas-estimate')).not.toBeInTheDocument();
  });
});
