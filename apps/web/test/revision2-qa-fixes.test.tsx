import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StatusProvider } from '../src/app/StatusProvider.js';
import { OverviewPage } from '../src/features/overview/OverviewPage.js';
import { DiscoverPage } from '../src/features/discover/DiscoverPage.js';
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
const discoverCss = readFileSync(resolve(process.cwd(), 'src/styles/discover.css'), 'utf8');
const portfolioViewSrc = readFileSync(resolve(process.cwd(), 'src/features/portfolio/PortfolioView.tsx'), 'utf8');

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
function mediaBody(css: string, opener: string): string {
  const start = css.indexOf(opener);
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

describe('R-1: the charcoal feature panel reads in the feature muted pair', () => {
  it('scopes muted text and controls inside the panel to --feature-muted', () => {
    for (const selector of [
      '.bento-tile--portfolio .state__text',
      '.bento-tile--portfolio .btn--quiet',
      '.bento-tile--portfolio .meta',
      '.bento-tile--portfolio .muted',
      '.bento-tile--portfolio .row__label',
      '.bento-tile--portfolio .fact dt',
    ]) {
      expect(rulesFor(baseCss, selector).join('\n'), selector).toMatch(/color:\s*var\(--feature-muted\)/);
    }
  });

  it('keeps the quiet retry button on the feature hairline, not the dark border', () => {
    const blocks = rulesFor(baseCss, '.bento-tile--portfolio .btn--quiet').join('\n');
    expect(blocks).toMatch(/color:\s*var\(--feature-muted\)/);
    expect(blocks).toMatch(/border-color:\s*var\(--feature-line\)/);
  });

  it('renders the portfolio error state inside the charcoal panel (fixture)', async () => {
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
    expect(screen.getByRole('heading', { level: 2, name: /Last strategy decision/ })).toBeInTheDocument();
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
  it('renders h1, then the search toolbar, then the intro, then the panel', async () => {
    setTransport(async () =>
      new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'fixture: endpoint off' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderPage(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByTestId('discover-search-input')).toBeInTheDocument();
    });
    const h1 = screen.getByRole('heading', { level: 1, name: 'Discover' });
    const toolbar = screen.getByTestId('discover-search-input').closest('section');
    const intro = screen.getByText(/Pools indexed from Robinhood Chain 4663/);
    expect(toolbar).not.toBeNull();
    expect(h1.compareDocumentPosition(toolbar as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((toolbar as Node).compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The honesty note still renders, unchanged, below the toolbar.
    expect(screen.getByText(/Read-only discovery/)).toBeInTheDocument();
  });

  it('resets the stacked-form flex basis so Search follows the input at 320', () => {
    const media = mediaBody(discoverCss, '@media (max-width: 374px)');
    expect(rulesFor(media, '.discover-field').join('\n')).toMatch(/flex:\s*0 0 auto/);
  });

  it('tightens the mobile topbar row gap and toolbar vertical padding', () => {
    const baseMedia = mediaBody(baseCss, '@media (max-width: 767px)');
    expect(rulesFor(baseMedia, '.topbar').join('\n')).toMatch(/gap:\s*var\(--space-1\)/);
    const discoverMedia = mediaBody(discoverCss, '@media (max-width: 767px)');
    expect(rulesFor(discoverMedia, '.discover-toolbar').join('\n')).toMatch(/padding:\s*var\(--space-1\)\s+var\(--space-2\)/);
  });
});
