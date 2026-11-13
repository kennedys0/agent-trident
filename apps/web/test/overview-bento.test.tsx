import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { candidateSchema, portfolioSchema, riskDecisionSchema, tradeIntentSchema } from '@trident/api-contract';
import { StatusProvider } from '../src/app/StatusProvider.js';
import { OverviewPage } from '../src/features/overview/OverviewPage.js';
import { PAIR } from '../src/lib/pair.js';
import { setTransport } from '../src/lib/api/client.js';

/**
 * Bento Overview (issue #39) against a labelled fixture transport.
 *
 * The tile contract under test: every figure on the dashboard is a backend
 * value, missing data renders an explicit unavailable/empty state instead of a
 * fabricated number, and the kill switch keeps its own filled STOPPED state.
 * Fixtures are test-shaped responses, never production data.
 */
const POOL = '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca';
const WETH = '0x1111111111111111111111111111111111111111';
const USDG = '0x2222222222222222222222222222222222222222';

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

const snapshot = {
  chainId: 4663,
  poolAddress: POOL,
  baseToken: WETH,
  quoteToken: USDG,
  blockNumber: '123456',
  blockHash: `0x${'b'.repeat(64)}`,
  sourceTime: '2026-11-12T05:00:00Z',
  observedAt: '2026-11-12T05:00:05Z',
  source: 'slot0 at block 123456',
  status: 'COMPLETE',
  reservesBase: { value: '10000000000000000000', decimals: 18 },
  reservesQuote: { value: '25000000000', decimals: 6 },
  price: { value: '2500000000000000000000', scale: '1000000000000000000' },
  liquidityQuote: { value: '50000000000', decimals: 6 },
} as const;

const candidate = candidateSchema.parse({
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

const intent = tradeIntentSchema.parse({
  id: 'intent-1',
  evaluationId: 'eval-1',
  idempotencyKey: 'key-12345',
  mode: 'PAPER',
  side: 'BUY',
  token: PAIR.base.address,
  quoteToken: PAIR.quote.address,
  baseQty: '243530914141316398',
  limitPrice: { value: '2500000000000000000000', scale: '1000000000000000000' },
  snapshotId: 'snap-1',
  expiresAt: '2026-11-11T05:00:00Z',
  status: 'APPROVED',
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

const decisionEvent = {
  id: 'evt-1',
  type: 'risk.decision.recorded',
  aggregateId: 'intent-1',
  payload: { intentId: 'intent-1' },
  createdAt: '2026-11-11T04:00:00Z',
} as const;

const paperEvent = {
  id: 'evt-2',
  type: 'paper.entry.executed',
  aggregateId: 'intent-1',
  payload: { intentId: 'intent-1' },
  createdAt: '2026-11-11T04:01:00Z',
} as const;

type Body = { data: unknown; meta?: Record<string, unknown> };
type FixtureEvent = {
  readonly id: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
};
type Options = {
  readonly killSwitch?: boolean;
  readonly discoveryMeta?: Record<string, unknown> | null;
  readonly journalEvents?: readonly FixtureEvent[];
  readonly portfolioStatus?: number;
};

function useTransport(options: Options = {}): void {
  const { killSwitch = false, discoveryMeta = { registryStatus: 'OK', trackedPools: 2, watchlistEntries: 1 }, journalEvents = [paperEvent], portfolioStatus = 200 } = options;
  setTransport(async (path) => {
    const ok = (body: Body): Response =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path === '/health') {
      return ok({
        data: { mode: 'PAPER', chainId: 4663, rpcStatus: 'HEALTHY', headBlock: '123456', lagSeconds: 2 },
        meta: { killSwitchEngaged: killSwitch, rpcLatencyMs: 42 },
      });
    }
    if (path === '/api/v1/portfolio') {
      return new Response(JSON.stringify({ data: portfolio, meta: {} }), {
        status: portfolioStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path === '/api/v1/markets/weth-usdg/snapshot') {
      return ok({ data: snapshot, meta: {} });
    }
    if (path.startsWith('/api/v1/candidates')) {
      return ok({ data: [candidate], meta: { strategyId: 'paper-momentum', configVersion: '1.0.0' } });
    }
    if (path.startsWith('/api/v1/journal')) {
      return ok({ data: { events: [...journalEvents], nextCursor: null }, meta: {} });
    }
    if (path.startsWith('/api/v1/intents/')) {
      return ok({ data: { intent, riskDecision: approved }, meta: {} });
    }
    if (path.startsWith('/api/v1/pools')) {
      return ok({ data: { pools: [], total: 0, offset: 0, limit: 1 }, meta: discoveryMeta ?? {} });
    }
    throw new Error(`Unhandled fixture path: ${path}`);
  });
}

function renderOverview(): void {
  render(
    <StatusProvider>
      <MemoryRouter initialEntries={['/']}>
        <OverviewPage />
      </MemoryRouter>
    </StatusProvider>,
  );
}

describe('Overview bento binds backend values', () => {
  it('renders the simulated equity, cash and PnL figures from the portfolio endpoint', async () => {
    useTransport();
    renderOverview();
    expect(await screen.findByTestId('overview-equity-value')).toHaveTextContent('9,999.89');
    expect(screen.getByTestId('overview-cash-value')).toHaveTextContent('9,499.95');
    expect(screen.getByTestId('overview-pnl-realized')).toHaveTextContent('0.00');
    expect(screen.getByTestId('overview-pnl-unrealized')).toHaveTextContent('−0.10');
    expect(screen.getByTestId('overview-pnl-unrealized').className).toContain('bento-figure__value--negative');
  });

  it('keeps PAPER execution mode visible on the status strip', async () => {
    useTransport();
    renderOverview();
    expect(await screen.findByText('PAPER — SIMULATED')).toBeInTheDocument();
    expect(screen.getByText('SIMULATED')).toBeInTheDocument();
    expect(within(screen.getByTestId('overview-strip')).getByText(/chain 4663/)).toBeInTheDocument();
  });

  it('reads registry status, tracked pools and watchlist size from the pools meta', async () => {
    useTransport();
    renderOverview();
    expect(await screen.findByText('OK')).toBeInTheDocument();
    expect(screen.getByTestId('overview-tracked-pools')).toHaveTextContent('2');
    expect(screen.getByText('1 watchlisted token')).toBeInTheDocument();
  });

  it('shows the latest strategy decision with its strategy id from meta', async () => {
    useTransport();
    renderOverview();
    const tile = within(screen.getByTestId('overview-strategy'));
    expect((await tile.findAllByText('BUY')).length).toBeGreaterThan(0);
    expect((await tile.findAllByText(/paper-momentum · 1.0.0/)).length).toBeGreaterThan(0);
  });

  it('lists recent PAPER activity from the journal', async () => {
    useTransport({ journalEvents: [paperEvent, decisionEvent] });
    renderOverview();
    expect(await screen.findByText('paper.entry.executed')).toBeInTheDocument();
    expect(screen.getByText('risk.decision.recorded')).toBeInTheDocument();
  });

  it('shows the risk verdict from the journalled decision', async () => {
    useTransport({ journalEvents: [decisionEvent] });
    renderOverview();
    const tile = within(screen.getByTestId('overview-risk'));
    expect((await tile.findAllByText('APPROVED')).length).toBeGreaterThan(0);
  });
});

describe('Overview bento states are honest', () => {
  it('renders the filled STOPPED state when the kill switch is engaged', async () => {
    useTransport({ killSwitch: true });
    renderOverview();
    expect(await screen.findByText('STOPPED')).toBeInTheDocument();
    expect(screen.queryByText('New entries allowed')).not.toBeInTheDocument();
  });

  it('reports entries allowed only when the kill switch state is known and off', async () => {
    useTransport();
    renderOverview();
    expect(await screen.findByText('New entries allowed')).toBeInTheDocument();
  });

  it('says Unavailable instead of inventing discovery numbers when meta is missing', async () => {
    useTransport({ discoveryMeta: {} });
    renderOverview();
    expect(await screen.findByTestId('overview-tracked-pools')).toHaveTextContent('Unavailable');
    expect(screen.getByText('watchlist size unavailable')).toBeInTheDocument();
  });

  it('labels an empty journal instead of implying activity', async () => {
    useTransport({ journalEvents: [] });
    renderOverview();
    expect(await screen.findByText('No PAPER activity recorded yet')).toBeInTheDocument();
  });

  it('surfaces a portfolio load failure without showing figures', async () => {
    useTransport({ portfolioStatus: 500 });
    renderOverview();
    expect(await screen.findByTestId('portfolio-error')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-equity-value')).not.toBeInTheDocument();
    expect(screen.queryByTestId('overview-pnl-realized')).not.toBeInTheDocument();
  });

  it('states the scan window when no risk decision exists', async () => {
    useTransport({ journalEvents: [paperEvent] });
    renderOverview();
    await waitFor(() => {
      expect(screen.getByTestId('risk-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/None was found in/)).toBeInTheDocument();
  });
});
