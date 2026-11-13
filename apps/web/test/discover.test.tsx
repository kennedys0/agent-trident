import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StatusProvider } from '../src/app/StatusProvider.js';
import { DiscoverPage } from '../src/features/discover/DiscoverPage.js';
import { PoolInspectorPage } from '../src/features/discover/PoolInspectorPage.js';
import { orderPools, feeLabel } from '../src/features/discover/components/PoolTable.js';
import {
  poolSummarySchema,
  watchlistMutationSchema,
  watchlistSchema,
} from '@trident/api-contract';
import { setTransport } from '../src/lib/api/client.js';

/**
 * Fixtures are test-shaped responses, never production data: no fixture is
 * imported by application code and none is returned to a user. Addresses are
 * deliberately not chain addresses except the pool, which only appears inside a
 * mocked transport.
 */
const POOL = '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca';
const POOL_B = '0x69bfaf19c9f377bb306a89aed9f6b07e2c1a8d9a';
const WETH = '0x1111111111111111111111111111111111111111';
const USDG = '0x2222222222222222222222222222222222222222';
const FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const PRICE_SCALE = '1000000000000000000';

const observed = {
  blockNumber: '123456',
  sourceTime: '2026-11-12T05:00:00Z',
  observedAt: '2026-11-12T05:00:05Z',
  provenance: 'slot0 at block 123456',
} as const;

const basePool = {
  chainId: 4663,
  pool: POOL,
  factory: FACTORY,
  fee: 100,
  token0: { address: WETH, symbol: 'WETH', decimals: 18 },
  token1: { address: USDG, symbol: 'USDG', decimals: 6 },
  venue: 'verified-allowlist',
  firstSeenBlock: '120000',
  status: 'AVAILABLE',
  metrics: {
    price: { status: 'AVAILABLE', ...observed, token1PerToken0: { value: '2500000000000000000000', scale: PRICE_SCALE }, token0PerToken1: { value: '400000000000000', scale: PRICE_SCALE } },
    liquidity: {
      status: 'AVAILABLE',
      ...observed,
      liquidity: '5000000000000000000',
      reserve0: '10000000000000000000',
      reserve1: '25000000000',
      reserve0Decimals: 18,
      reserve1Decimals: 6,
    },
    volume24h: { status: 'UNAVAILABLE', reason: 'no verifiable volume source' },
  },
  confidence: 'LOW',
  confidenceReason: 'single Uniswap v3 pool; a spot price is not an independent oracle',
  watched: false,
} as const;

const stalePool = {
  ...basePool,
  pool: POOL_B,
  fee: 500,
  venue: 's3-01-registry',
  status: 'STALE',
  metrics: {
    ...basePool.metrics,
    price: { ...basePool.metrics.price, status: 'STALE', token1PerToken0: { value: '2490000000000000000000', scale: PRICE_SCALE } },
    liquidity: { ...basePool.metrics.liquidity, status: 'STALE' },
  },
} as const;

const health = { data: { mode: 'PAPER', chainId: 4663, rpcStatus: 'HEALTHY', headBlock: '123456', lagSeconds: 2 } };

function poolsBody(pools: unknown[], total = pools.length, offset = 0): unknown {
  return { data: { pools, total, offset, limit: 20 }, meta: {} };
}

type Reply = { status?: number; body: unknown };
type Handler = (method: string, path: string) => Reply | Promise<Reply>;

function useTransport(handler: Handler): { calls: string[] } {
  const calls: string[] = [];
  setTransport(async (path, init) => {
    const method = init.method ?? 'GET';
    calls.push(`${method} ${path}`);
    if (path === '/health') {
      return new Response(JSON.stringify(health), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const reply = await handler(method, path);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { calls };
}

function renderAt(entry: string): void {
  render(
    <StatusProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/discover/pools/:address" element={<PoolInspectorPage />} />
        </Routes>
      </MemoryRouter>
    </StatusProvider>,
  );
}

describe('S3-02 wire contract', () => {
  it('accepts the real pool summary shape', () => {
    const parsed = poolSummarySchema.parse(basePool);
    expect(parsed.metrics.price.status).toBe('AVAILABLE');
    expect(parsed.venue).toBe('verified-allowlist');
  });

  it('rejects a metric without provenance', () => {
    const broken = {
      ...basePool,
      metrics: { ...basePool.metrics, price: { status: 'AVAILABLE', token1PerToken0: { value: '1', scale: PRICE_SCALE }, token0PerToken1: { value: '1', scale: PRICE_SCALE } } },
    };
    expect(poolSummarySchema.safeParse(broken).success).toBe(false);
  });

  it('rejects an UNAVAILABLE metric without a reason', () => {
    const broken = { ...basePool, metrics: { ...basePool.metrics, volume24h: { status: 'UNAVAILABLE' } } };
    expect(poolSummarySchema.safeParse(broken).success).toBe(false);
  });

  it('rejects an unknown field instead of ignoring it', () => {
    expect(poolSummarySchema.safeParse({ ...basePool, liquidityScore: 99 }).success).toBe(false);
  });

  it('accepts the watchlist mutation shapes', () => {
    expect(watchlistSchema.safeParse({ entries: [] }).success).toBe(true);
    expect(watchlistMutationSchema.safeParse({ address: WETH, result: 'ADDED' }).success).toBe(true);
    expect(watchlistMutationSchema.safeParse({ address: WETH, result: 'WATCHED' }).success).toBe(false);
  });
});

describe('DiscoverPage', () => {
  it('uses the fixed venue, liquidity-status, liquidity-descending and address ordering', () => {
    const low = poolSummarySchema.parse({
      ...basePool,
      pool: '0x0000000000000000000000000000000000000002',
      metrics: { ...basePool.metrics, liquidity: { ...basePool.metrics.liquidity, liquidity: '10' } },
    });
    const high = poolSummarySchema.parse({
      ...basePool,
      pool: '0x0000000000000000000000000000000000000003',
      metrics: { ...basePool.metrics, liquidity: { ...basePool.metrics.liquidity, liquidity: '20' } },
    });
    const registry = poolSummarySchema.parse({
      ...basePool,
      pool: '0x0000000000000000000000000000000000000001',
      venue: 's3-01-registry',
      metrics: { ...basePool.metrics, liquidity: { ...basePool.metrics.liquidity, liquidity: '999' } },
    });
    expect(orderPools([registry, low, high]).map((pool) => pool.pool)).toEqual([high.pool, low.pool, registry.pool]);
  });

  it('renders backend values, provenance and the status summary', async () => {
    useTransport((method) =>
      method === 'GET' ? { body: poolsBody([basePool]) } : { body: { data: { entries: [] }, meta: {} } },
    );
    renderAt('/discover');

    expect(await screen.findByRole('link', { name: /WETH/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /USDG/ })).toBeInTheDocument();
    expect(screen.getByText('0.01%')).toBeInTheDocument();
    const price = screen.getByTestId(`pool-price-${POOL}`);
    expect(price).toHaveTextContent('2,500.00 USDG');
    expect(price).toHaveTextContent('per WETH');
    expect(price).toHaveTextContent('block 123456');
    const liquidity = screen.getByTestId(`pool-liquidity-${POOL}`);
    expect(liquidity).toHaveTextContent('10.00 WETH');
    expect(liquidity).toHaveTextContent('25,000.00 USDG reserves');
    expect(screen.getByTestId('discover-count')).toHaveTextContent('1 available · 0 stale · 0 unavailable');
  });

  it('shows UNAVAILABLE with the backend reason and never a zero', async () => {
    const pool = {
      ...basePool,
      status: 'UNAVAILABLE',
      reason: 'no observation persisted yet',
      metrics: {
        ...basePool.metrics,
        price: { status: 'UNAVAILABLE', reason: 'no observation persisted yet' },
      },
    };
    useTransport(() => ({ body: poolsBody([pool]) }));
    renderAt('/discover');

    const price = await screen.findByTestId(`pool-price-${POOL}`);
    expect(price).toHaveTextContent('Unavailable');
    expect(price).toHaveTextContent('no observation persisted yet');
    expect(price).not.toHaveTextContent('0.00');
  });

  it('keeps a STALE value visible and marks it stale', async () => {
    useTransport(() => ({ body: poolsBody([stalePool]) }));
    renderAt('/discover');

    const price = await screen.findByTestId(`pool-price-${POOL_B}`);
    expect(price).toHaveTextContent('2,490.00 USDG');
    expect(price).toHaveTextContent('Stale');
    expect(screen.getByTestId('discover-count')).toHaveTextContent('0 available · 1 stale · 0 unavailable');
  });

  it('renders the discovered-empty copy before any pool exists', async () => {
    useTransport(() => ({ body: poolsBody([]) }));
    renderAt('/discover');
    expect(await screen.findByTestId('discover-empty')).toHaveTextContent('No pools discovered yet');
    expect(screen.getByTestId('discover-empty')).toHaveTextContent('Discovery has not published any pools yet.');
  });

  it('renders search-empty copy when a query returns nothing', async () => {
    useTransport(() => ({ body: poolsBody([]) }));
    renderAt('/discover?q=ZZZ');
    expect(await screen.findByTestId('discover-empty')).toHaveTextContent('No pools match this search');
  });

  it('renders a backend error with a retry control', async () => {
    useTransport(() => ({ status: 503, body: { error: { code: 'RPC_UNAVAILABLE', message: 'RPC is unreachable' } } }));
    renderAt('/discover');

    const error = await screen.findByTestId('discover-error');
    expect(error).toHaveTextContent('Backend error');
    expect(error).toHaveTextContent('The backend could not complete this request.');
    expect(screen.getByTestId('discover-error-retry')).toBeInTheDocument();
  });

  it('shows the server message for a rejected request', async () => {
    useTransport(() => ({ status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' } } }));
    renderAt('/discover?q=%00');

    const error = await screen.findByTestId('discover-error');
    expect(error).toHaveTextContent('Request rejected');
    expect(error).toHaveTextContent('Invalid query parameters');
  });

  it('labels a 200 response that violates the contract as a contract mismatch', async () => {
    useTransport(() => ({ body: { data: { pools: 'not-an-array' }, meta: {} } }));
    renderAt('/discover');

    const error = await screen.findByTestId('discover-error');
    expect(error).toHaveTextContent('Contract mismatch');
    expect(error).toHaveTextContent('does not match the S3-02 contract');
  });

  it('formats every fee tier without collapsing sub-basis-point fees to 0%', () => {
    expect(feeLabel(100)).toBe('0.01%');
    expect(feeLabel(500)).toBe('0.05%');
    expect(feeLabel(3000)).toBe('0.3%');
    expect(feeLabel(10000)).toBe('1%');
    expect(feeLabel(10)).toBe('0.001%');
    expect(feeLabel(1)).toBe('0.0001%');
  });

  it('searches on the backend after the debounce', async () => {
    const { calls } = useTransport(() => ({ body: poolsBody([basePool]) }));
    renderAt('/discover');
    await screen.findByTestId(`pool-row-${POOL}`);

    await userEvent.type(screen.getByTestId('discover-search-input'), 'USDG');
    await waitFor(() => expect(calls.some((call) => call.includes('search=USDG'))).toBe(true), { timeout: 2000 });
  });

  it('filters the loaded page without another request', async () => {
    const { calls } = useTransport(() => ({ body: poolsBody([basePool, stalePool]) }));
    renderAt('/discover');
    await screen.findByTestId(`pool-row-${POOL}`);
    const before = calls.filter((call) => call.includes('/api/v1/pools?')).length;

    await userEvent.click(screen.getByTestId('filter-quality-STALE'));

    await waitFor(() => expect(screen.queryByTestId(`pool-row-${POOL}`)).toBeNull());
    expect(screen.getByTestId(`pool-row-${POOL_B}`)).toBeInTheDocument();
    expect(calls.filter((call) => call.includes('/api/v1/pools?')).length).toBe(before);
  });

  it('narrows the loaded page to watched pools when the watchlist filter is clicked', async () => {
    useTransport((method, path) => {
      if (method === 'GET' && path.startsWith('/api/v1/watchlist')) {
        return { body: { data: { entries: [] }, meta: {} } };
      }
      return { body: poolsBody([{ ...basePool, watched: true }, stalePool]) };
    });
    renderAt('/discover');
    await screen.findByTestId(`pool-row-${POOL}`);
    expect(screen.getByTestId(`pool-row-${POOL_B}`)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('filter-watched'));

    expect(screen.getByTestId('filter-watched')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(`pool-row-${POOL}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId(`pool-row-${POOL_B}`)).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId('filter-watched'));

    expect(screen.getByTestId('filter-watched')).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(screen.getByTestId(`pool-row-${POOL_B}`)).toBeInTheDocument());
  });

  it('pages with the backend offset and keeps totals honest', async () => {
    const pools = Array.from({ length: 20 }, (_, index) => ({ ...basePool, pool: `0x${String(index + 1).padStart(40, '0')}` }));
    const { calls } = useTransport((_method, path) => {
      const offset = Number(new URLSearchParams(path.split('?')[1] ?? '').get('offset') ?? '0');
      return { body: poolsBody(offset === 0 ? pools : [pools[0]], 45, offset) };
    });
    renderAt('/discover');
    await screen.findByTestId('discover-count');

    expect(screen.getByTestId('discover-count')).toHaveTextContent('Showing 1–20 of 45');
    await userEvent.click(screen.getByTestId('discover-next'));
    await waitFor(() => expect(calls.some((call) => call.includes('offset=20'))).toBe(true));
  });

  it('marks a watched pool from the backend flag', async () => {
    useTransport((method, path) => {
      if (method === 'GET' && path.startsWith('/api/v1/watchlist')) {
        return { body: { data: { entries: [] }, meta: {} } };
      }
      return { body: poolsBody([{ ...basePool, watched: true }]) };
    });
    renderAt('/discover');
    expect(await screen.findByText('Watched')).toBeInTheDocument();
  });

  it('reports a failed refresh without pretending the old page is fresh', async () => {
    let failures = 0;
    useTransport(() => {
      failures += 1;
      return failures === 1 ? { body: poolsBody([basePool]) } : { status: 503, body: { error: { code: 'RPC_UNAVAILABLE', message: 'RPC failed' } } };
    });
    renderAt('/discover');
    await screen.findByTestId(`pool-row-${POOL}`);

    await userEvent.click(screen.getByTestId('discover-refresh'));

    const banner = await screen.findByTestId('discover-refresh-error');
    expect(banner).toHaveTextContent('Showing the last successful response');
    expect(screen.getByTestId(`pool-row-${POOL}`)).toBeInTheDocument();
  });
});

describe('PoolInspectorPage', () => {
  const watchEntries = (addresses: string[]): unknown => ({
    data: { entries: addresses.map((address) => ({ address, addedAt: '2026-11-12T05:00:00Z', known: true })) },
    meta: {},
  });

  function poolTransport(options: { watched?: boolean; mutation?: (method: string) => string } = {}): { calls: string[] } {
    return useTransport((method, path) => {
      if (method === 'GET' && path.startsWith('/api/v1/watchlist')) {
        return { body: watchEntries(options.watched === true ? [WETH] : []) };
      }
      if (method === 'GET' && path === `/api/v1/pools/${POOL}`) {
        return { body: { data: basePool, meta: {} } };
      }
      if (method === 'POST' || method === 'DELETE') {
        return { body: { data: { address: WETH, result: options.mutation?.(method) ?? (method === 'POST' ? 'ADDED' : 'REMOVED') }, meta: {} } };
      }
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Unknown' } } };
    });
  }

  it('loads the pinned-block pool detail from the per-pool endpoint', async () => {
    const { calls } = poolTransport();
    renderAt(`/discover/pools/${POOL}`);

    expect(await screen.findByText('LOW CONFIDENCE')).toBeInTheDocument();
    expect(screen.getAllByText(/source: slot0 at block 123456/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/single Uniswap v3 pool/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'WETH / USDG' })).toBeInTheDocument();
    expect(calls).toContain(`GET /api/v1/pools/${POOL}`);
  });

  it('marks retained pool detail stale when the pinned-block refresh fails', async () => {
    useTransport((method, path) => {
      if (method === 'GET' && path.startsWith('/api/v1/watchlist')) {
        return { body: watchEntries([]) };
      }
      if (method === 'GET' && path === `/api/v1/pools/${POOL}`) {
        return {
          body: { data: basePool, meta: { refreshError: 'RPC read failed at pinned block' } },
        };
      }
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Unknown' } } };
    });
    renderAt(`/discover/pools/${POOL}`);

    const banner = await screen.findByTestId('pool-refresh-error');
    expect(banner).toHaveTextContent('RPC read failed at pinned block');
    expect(banner).toHaveTextContent('stale status');
    expect(screen.getAllByText('Stale').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('2,500.00 USDG')).toBeInTheDocument();
  });

  it('shows volume as unavailable with its reason and no number', async () => {
    poolTransport();
    renderAt(`/discover/pools/${POOL}`);
    const volume = await screen.findByRole('region', { name: 'Volume' });
    expect(volume).toHaveTextContent('Unavailable');
    expect(volume).toHaveTextContent('no verifiable volume source');
  });

  it('never renders a volume number when a payload violates the slice rule', async () => {
    const invalidVolumePool = {
      ...basePool,
      metrics: {
        ...basePool.metrics,
        volume24h: {
          status: 'AVAILABLE',
          ...observed,
          volumeQuote24h: { value: '999999', decimals: 6 },
        },
      },
    };
    useTransport((method, path) => {
      if (method === 'GET' && path.startsWith('/api/v1/watchlist')) {
        return { body: watchEntries([]) };
      }
      return { body: { data: invalidVolumePool, meta: {} } };
    });
    renderAt(`/discover/pools/${POOL}`);

    const volume = await screen.findByRole('region', { name: 'Volume' });
    expect(volume).toHaveTextContent('Unavailable');
    expect(volume).toHaveTextContent('Contract mismatch');
    expect(volume).not.toHaveTextContent('999999');
  });

  it('toggles the watchlist through the server and only then changes state', async () => {
    const { calls } = poolTransport();
    renderAt(`/discover/pools/${POOL}`);

    const button = await screen.findByTestId(`watch-${WETH}`);
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    expect(calls).toContain('POST /api/v1/watchlist');
    expect(screen.getByTestId('pool-watchlist-message')).toHaveTextContent('WETH added to watchlist');

    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'));
    expect(calls).toContain(`DELETE /api/v1/watchlist/${WETH}`);
  });

  it('starts watched from the persisted watchlist', async () => {
    poolTransport({ watched: true });
    renderAt(`/discover/pools/${POOL}`);
    const button = await screen.findByTestId(`watch-${WETH}`);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
  });

  it('keeps server state and reports a failed watch change', async () => {
    useTransport((method, path) => {
      if (method === 'GET' && path.startsWith('/api/v1/watchlist')) {
        return { body: watchEntries([]) };
      }
      if (method === 'POST') {
        return { status: 500, body: { error: { code: 'DB_WRITE_FAILED', message: 'Watchlist write failed' } } };
      }
      if (method === 'GET' && path === `/api/v1/pools/${POOL}`) {
        return { body: { data: basePool, meta: {} } };
      }
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Unknown' } } };
    });
    renderAt(`/discover/pools/${POOL}`);

    const button = await screen.findByTestId(`watch-${WETH}`);
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    expect(await screen.findByTestId('pool-watchlist-error')).toHaveTextContent('Watchlist write failed');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports a missing explorer URL instead of linking to a guessed host', async () => {
    poolTransport();
    renderAt(`/discover/pools/${POOL}`);
    const notes = await screen.findAllByTestId('explorer-unavailable');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toHaveTextContent('no chain-4663 explorer URL');
    expect(screen.queryByTestId('explorer-link')).toBeNull();
  });

  it('shows the exact unknown-pool state for a backend 404', async () => {
    useTransport((method, path) => {
      if (method === 'GET' && path.startsWith('/api/v1/watchlist')) {
        return { body: watchEntries([]) };
      }
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Pool is not tracked' } } };
    });
    renderAt(`/discover/pools/${POOL}`);
    const state = await screen.findByTestId('pool-unknown');
    expect(state).toHaveTextContent('Unknown pool');
    expect(state).toHaveTextContent(POOL);
  });

  it('rejects a malformed address without calling the pool API', async () => {
    const { calls } = poolTransport();
    renderAt('/discover/pools/not-an-address');
    expect(await screen.findByTestId('pool-invalid')).toHaveTextContent('Unknown pool');
    expect(calls.some((call) => call.includes('/api/v1/pools/'))).toBe(false);
  });
});

describe('Watchlist click flow across pages', () => {
  it('watches a token in the inspector and sees it on the listing, then unwatches it', async () => {
    let entries: string[] = [];
    const { calls } = useTransport((method, path) => {
      if (method === 'GET' && path.startsWith('/api/v1/watchlist')) {
        return {
          body: {
            data: { entries: entries.map((address) => ({ address, addedAt: '2026-11-13T05:00:00Z', known: true })) },
            meta: {},
          },
        };
      }
      if (method === 'POST') {
        entries = [WETH];
        return { body: { data: { address: WETH, result: 'ADDED' }, meta: {} } };
      }
      if (method === 'DELETE') {
        entries = [];
        return { body: { data: { address: WETH, result: 'REMOVED' }, meta: {} } };
      }
      if (path === `/api/v1/pools/${POOL}`) {
        return { body: { data: basePool, meta: {} } };
      }
      return { body: poolsBody([{ ...basePool, watched: false }]) };
    });
    renderAt('/discover');

    // Listing → Inspector through the row link.
    await userEvent.click(await screen.findByRole('link', { name: /WETH/ }));
    const button = await screen.findByTestId(`watch-${WETH}`);
    await waitFor(() => expect(button).toBeEnabled());

    // The pressed state only moves after the server persisted the write.
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    expect(calls).toContain('POST /api/v1/watchlist');

    // Back on the listing the row reports the watched token.
    await userEvent.click(await screen.findByRole('link', { name: /Back to Discover/ }));
    await screen.findByTestId(`pool-row-${POOL}`);
    expect(await screen.findByText('Watched')).toBeInTheDocument();

    // Unwatch from the inspector, again server-first.
    await userEvent.click(await screen.findByRole('link', { name: /WETH/ }));
    const unwatch = await screen.findByTestId(`watch-${WETH}`);
    await waitFor(() => expect(unwatch).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(unwatch);
    await waitFor(() => expect(unwatch).toHaveAttribute('aria-pressed', 'false'));
    expect(calls).toContain(`DELETE /api/v1/watchlist/${WETH}`);

    // The listing reports the removal too.
    await userEvent.click(await screen.findByRole('link', { name: /Back to Discover/ }));
    await screen.findByTestId(`pool-row-${POOL}`);
    expect(await screen.findByText('Not watched')).toBeInTheDocument();
  });
});
