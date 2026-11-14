import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { portfolioSchema } from '@trident/api-contract';
import { StatusProvider } from '../src/app/StatusProvider.js';
import { OverviewPage } from '../src/features/overview/OverviewPage.js';
import { DiscoverPage } from '../src/features/discover/DiscoverPage.js';
import { PAIR } from '../src/lib/pair.js';
import { setTransport } from '../src/lib/api/client.js';

/**
 * Regression contracts for the four QA findings on Revision 2
 * (docs/design/qa-soft-bento-rev2.md, fixed by Pixel):
 *
 * R-1 Serious — muted text inside the light-mode charcoal feature panel
 *     fell to 2.07:1; the panel scope now reads in the feature pair.
 * R-3 Moderate — module titles skipped from h1 to h3 (axe heading-order).
 * R-2 Minor — quiet buttons and inline title links under the 48px target.
 * R-4 Minor — Discover first paint put the Search control and chips behind
 *     the fixed bottom-nav band on 375/320.
 *
 * CSS- and DOM-level assertions live here; the runtime geometry proof (rest
 * position bounding boxes vs the nav band) is captured in the committed
 * evidence screenshots and results.json. Fixtures below are test-shaped
 * error responses — never production data.
 */

const baseCss = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');
const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const discoverCss = readFileSync(resolve(process.cwd(), 'src/styles/discover.css'), 'utf8');
const portfolioViewSrc = readFileSync(resolve(process.cwd(), 'src/features/portfolio/PortfolioView.tsx'), 'utf8');

function tokenBlock(opener: string): string {
  const match = new RegExp(`${opener.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(tokensCss);
  if (match?.[1] === undefined) {
    throw new Error(`Missing token block ${opener}`);
  }
  return match[1];
}

const lightTokens = tokenBlock(':root');
const darkTokens = tokenBlock("[data-theme='dark']");

function tokenRaw(name: string, theme: 'light' | 'dark'): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(theme === 'dark' ? darkTokens : lightTokens);
  if (match?.[1] === undefined) {
    throw new Error(`Missing token --${name} in ${theme}`);
  }
  return match[1].trim();
}

/** Returns the declaration blocks of every rule whose selector list contains
 * exactly `selector` (compound group selectors included); comments stripped
 * so group rules introduced by a comment still parse cleanly. */
function rulesFor(css: string, selector: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: string[] = [];
  const rule = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(stripped)) !== null) {
    const selectors = match[1]?.split(',').map((part) => part.trim());
    if (selectors !== undefined && selectors.includes(selector) && match[2] !== undefined) {
      blocks.push(match[2]);
    }
  }
  if (blocks.length === 0) {
    throw new Error(`no CSS rule for selector ${selector}`);
  }
  return blocks;
}

/** Slices the inner declarations of a media block: the prelude is skipped so
 * its first rule still parses as a normal selector block. */
function mediaBody(css: string, opener: string, occurrence = 0): string {
  let start = -1;
  for (let index = 0; index <= occurrence; index += 1) start = css.indexOf(opener, start + 1);
  if (start === -1) {
    throw new Error(`media block ${opener} not found`);
  }
  const open = css.indexOf('{', start);
  return css.slice(open + 1);
}

function renderPage(node: Parameters<typeof render>[0]): ReturnType<typeof render> {
  return render(
    <StatusProvider>
      <MemoryRouter initialEntries={['/']}>{node}</MemoryRouter>
    </StatusProvider>,
  );
}

describe('Rev 3: the lime equity panel keeps a high-contrast foreground', () => {
  it('scopes text and controls to the brand foreground', () => {
    for (const selector of [
      '.bento-tile--portfolio .state__text',
      '.bento-tile--portfolio .btn--quiet',
      '.bento-tile--portfolio .meta',
    ]) {
      expect(rulesFor(baseCss, selector).join('\n'), selector).toMatch(/color:\s*var\(--brand-on-accent\)/);
    }
  });

  it('keeps the quiet retry button on a visible border', () => {
    const blocks = rulesFor(baseCss, '.bento-tile--portfolio .btn--quiet').join('\n');
    expect(blocks).toMatch(/color:\s*var\(--brand-on-accent\)/);
    expect(blocks).toMatch(/border-color:\s*var\(--border-strong\)/);
  });

  it('renders the portfolio error state inside the lime equity panel (fixture)', async () => {
    setTransport(async () =>
      new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'fixture: endpoint off' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderPage(<OverviewPage />);
    await waitFor(() => {
      expect(screen.getByTestId('portfolio-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('overview-portfolio').contains(screen.getByTestId('portfolio-error'))).toBe(true);
    expect(screen.getByTestId('portfolio-error-retry')).toBeInTheDocument();
  });
});

describe('R-3: heading order is valid on every touched page', () => {
  it('Overview has one h1, module titles at h2, and no h3 skips', async () => {
    setTransport(async () =>
      new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'fixture: endpoint off' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderPage(<OverviewPage />);
    await waitFor(() => {
      expect(screen.getByTestId('overview-strip')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: /Strategy signal/ })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('Portfolio section titles are h2, not h3 directly under the page h1', () => {
    expect(portfolioViewSrc).not.toMatch(/<h3 className="panel__title"/);
    expect(portfolioViewSrc).toMatch(/<h2 className="panel__title"/);
  });
});

describe('R-2: interactive targets reach the 48px tap minimum', () => {
  it('binds every button to --tap in both pointer modes', () => {
    expect(rulesFor(baseCss, '.btn').join('\n')).toMatch(/min-height:\s*var\(--tap\)/);
  });

  it('gives inline title links a 48px hit area without inflating their row', () => {
    const block = rulesFor(baseCss, '.bento-tile__title a').join('\n');
    expect(block).toMatch(/min-height:\s*var\(--tap\)/);
    expect(block).toMatch(/margin:\s*-14px/);
  });
});

describe('R-4: Discover first paint clears the fixed bottom-nav band', () => {
  it('renders h1, then compact search/filter controls and the table panel', async () => {
    setTransport(async () =>
      new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'fixture: endpoint off' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderPage(<DiscoverPage />);
    await waitFor(() => expect(screen.getByTestId('discover-search-input')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Discover' })).toBeInTheDocument();
    expect(screen.getByTestId('filter-quality')).toBeInTheDocument();
    expect(screen.getByTestId('filter-venue')).toBeInTheDocument();
    expect(screen.getByTestId('filter-watched')).toBeInTheDocument();
    expect(screen.getByText(/Search runs on the backend · Filters apply only to this loaded page/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Indexed pools' })).toBeInTheDocument();
  });

  it('resets the stacked-form flex basis so Search follows the input at 320', () => {
    const media = mediaBody(discoverCss, '@media (max-width: 374px)');
    expect(rulesFor(media, '.discover-field').join('\n')).toMatch(/flex:\s*0 0 auto/);
  });

  it('keeps compact mobile topbar and toolbar padding', () => {
    const baseMedia = mediaBody(baseCss, '@media (max-width: 767px)', 1);
    expect(rulesFor(baseMedia, '.topbar').join('\n')).toMatch(/gap:\s*var\(--space-1\)/);
    const discoverMedia = mediaBody(discoverCss, '@media (max-width: 767px)');
    expect(rulesFor(discoverMedia, '.discover-toolbar').join('\n')).toMatch(/padding:\s*var\(--space-1\)\s+var\(--space-2\)/);
  });
});

describe('Rev 3: equity PnL contrast on lime', () => {
  const panelPositive = '.bento-tile--portfolio .bento-figure__value--positive';
  const panelNegative = '.bento-tile--portfolio .bento-figure__value--negative';

  it('uses the dark brand foreground for both PnL directions', () => {
    expect(rulesFor(baseCss, panelPositive).join('\n')).toMatch(/color:\s*var\(--brand-on-accent\)/);
    expect(rulesFor(baseCss, panelNegative).join('\n')).toMatch(/color:\s*var\(--brand-on-accent\)/);
  });

  it('keeps both PnL directions readable instead of using status colours on lime', () => {
    expect(tokenRaw('brand-on-accent', 'light')).toBe('#171717');
    expect(tokenRaw('brand-on-accent', 'dark')).toBe('#171717');
  });

  it('leaves the semantic status fg (outside the panel) untouched', () => {
    expect(tokenRaw('status-positive-fg', 'light')).toBe('#065f46');
    expect(tokenRaw('status-negative-fg', 'light')).toBe('#991b1b');
  });

  it('renders realised/unrealised PnL with the tint classes inside the lime equity panel (fixture)', async () => {
    const portfolio = portfolioSchema.parse({
      mode: 'PAPER',
      asOf: '2026-11-13T04:00:00Z',
      balances: [
        { asset: PAIR.quote.address, available: { value: '9499950000', decimals: 6 }, reserved: { value: '0', decimals: 6 } },
      ],
      positions: [
        {
          asset: PAIR.base.address,
          quantity: { value: '243530914141316398', decimals: 18 },
          costBasisQuote: { value: '485050000', decimals: 6 },
          valuationStatus: 'VALUED',
          unrealizedPnlQuote: { value: '-102077', decimals: 6 },
          valuationSnapshotId: 'snap-1',
        },
      ],
      equityQuote: { value: '10149989793', decimals: 6 },
      realizedPnlQuote: { value: '150000', decimals: 6 },
      unrealizedPnlQuote: { value: '-102077', decimals: 6 },
    });
    setTransport(async (path) => {
      const ok = (body: unknown): Response =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (path === '/health') {
        return ok({
          data: { mode: 'PAPER', chainId: 4663, rpcStatus: 'HEALTHY', headBlock: '123456', lagSeconds: 2 },
          meta: { killSwitchEngaged: false, rpcLatencyMs: 42 },
        });
      }
      if (path === '/api/v1/portfolio') {
        return ok({ data: portfolio, meta: {} });
      }
      if (path === '/api/v1/markets/weth-usdg/snapshot') {
        return ok({
          data: {
            chainId: 4663,
            poolAddress: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca',
            baseToken: '0x1111111111111111111111111111111111111111',
            quoteToken: '0x2222222222222222222222222222222222222222',
            blockNumber: '123456',
            blockHash: `0x${'b'.repeat(64)}`,
            sourceTime: '2026-11-13T05:00:00Z',
            observedAt: '2026-11-13T05:00:05Z',
            source: 'slot0 at block 123456',
            status: 'COMPLETE',
            reservesBase: { value: '10000000000000000000', decimals: 18 },
            reservesQuote: { value: '25000000000', decimals: 6 },
            price: { value: '2500000000000000000000', scale: '1000000000000000000' },
            liquidityQuote: { value: '50000000000', decimals: 6 },
          },
          meta: {},
        });
      }
      if (path.startsWith('/api/v1/candidates')) {
        return ok({ data: [], meta: { strategyId: 'paper-momentum', configVersion: '1.0.0' } });
      }
      if (path.startsWith('/api/v1/journal')) {
        return ok({ data: { events: [], nextCursor: null }, meta: {} });
      }
      if (path.startsWith('/api/v1/intents/')) {
        return new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'fixture: none' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path.startsWith('/api/v1/pools')) {
        return ok({ data: { pools: [], total: 0, offset: 0, limit: 1 }, meta: { registryStatus: 'OK', trackedPools: 0, watchlistEntries: 0 } });
      }
      throw new Error(`Unhandled fixture path: ${path}`);
    });
    renderPage(<OverviewPage />);
    await waitFor(() => {
      expect(screen.getByTestId('overview-pnl-realized')).toBeInTheDocument();
    });
    const panel = screen.getByTestId('overview-portfolio');
    const realized = screen.getByTestId('overview-pnl-realized');
    const unrealized = screen.getByTestId('overview-pnl-unrealized');
    expect(realized.className).toContain('bento-figure__value--positive');
    expect(unrealized.className).toContain('bento-figure__value--negative');
    expect(panel.contains(realized)).toBe(true);
    expect(panel.contains(unrealized)).toBe(true);
  });
});
