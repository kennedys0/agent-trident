import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StatusProvider } from '../src/app/StatusProvider.js';
import { OverviewPage } from '../src/features/overview/OverviewPage.js';
import { setTransport } from '../src/lib/api/client.js';

/**
 * Revision 2 design contract (CEO brief: visual hierarchy, Bento composition,
 * motion fidelity). CSS- and token-level assertions live here; the figure and
 * honesty contracts stay in overview-bento.test.tsx. Fixtures below are
 * test-shaped error responses — never production data.
 */

const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const baseCss = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');

function tokenRaw(name: string, theme: 'light' | 'dark'): string {
  const marker = tokensCss.indexOf("[data-theme='dark']");
  const source = theme === 'light' ? tokensCss.slice(0, marker) : tokensCss.slice(marker);
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(source);
  if (match === null || match[1] === undefined) {
    throw new Error(`token --${name} not found for ${theme}`);
  }
  return match[1].trim();
}

function cssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Anchor at line start (indented media blocks allowed) so compound selectors
  // like `.bento-tile--portfolio .bento-figure__value` do not shadow the plain one.
  const match = new RegExp(`(?:^|\\n)[ \\t]*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null || match[1] === undefined) {
    throw new Error(`selector ${selector} not found`);
  }
  return match[1];
}

describe('Revision 2: dark surface ladder', () => {
  it('separates canvas, card and raised layers in dark mode', () => {
    const canvas = tokenRaw('canvas', 'dark');
    const surface = tokenRaw('surface', 'dark');
    const raised = tokenRaw('surface-raised', 'dark');
    expect(canvas).not.toBe(surface);
    expect(surface).not.toBe(raised);
    expect(canvas).not.toBe('#000000');
  });

  it('carries feature-panel tokens in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(tokenRaw('feature-bg', theme)).toMatch(/^#/);
      expect(tokenRaw('feature-ink', theme)).toMatch(/^#/);
      expect(tokenRaw('feature-muted', theme)).toMatch(/^#/);
    }
  });

  it('light feature panel is charcoal on the soft gray canvas', () => {
    expect(tokenRaw('feature-bg', 'light')).toBe('#222123');
    expect(tokenRaw('canvas', 'light')).toBe('#e9e9e9');
    expect(tokenRaw('feature-bg', 'light')).not.toBe(tokenRaw('canvas', 'light'));
  });
});

describe('Revision 2: typography contract', () => {
  it('declares system stacks with no webfont downloads', () => {
    expect(tokenRaw('font-sans', 'light')).toContain('system-ui');
    expect(tokenRaw('font-mono', 'light')).toContain('ui-monospace');
    expect(tokensCss).not.toMatch(/'Inter'|'Space Grotesk'|'JetBrains Mono'/);
  });

  it('adds a hero figure scale for the dominant portfolio module', () => {
    expect(tokenRaw('text-hero', 'light')).toBe('40px');
    const heroBlock = cssBlock(baseCss, '.bento-figure__value--hero');
    expect(heroBlock).toMatch(/font-size:\s*var\(--text-hero\)/);
  });

  it('reads financial figures in the sans stack with tabular numerals', () => {
    const valueBlock = cssBlock(baseCss, '.bento-figure__value');
    expect(valueBlock).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(valueBlock).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('keeps small labels sentence case — no uppercase transforms outside badges', () => {
    for (const selector of ['.bento-tile__title', '.bento-figure__label', '.status-strip__label', '.panel__title', '.stat__label']) {
      expect(cssBlock(baseCss, selector), selector).not.toMatch(/text-transform:\s*uppercase/);
    }
    expect(cssBlock(baseCss, '.table th')).not.toMatch(/text-transform:\s*uppercase/);
    expect(cssBlock(baseCss, '.badge')).toMatch(/text-transform:\s*uppercase/);
  });
});

describe('Revision 2: motion fidelity', () => {
  it('sits inside the CEO brief ranges: press 80–140, hover 150–200, panel/page 180–240', () => {
    const fast = Number.parseInt(tokenRaw('motion-fast', 'light'), 10);
    const hover = Number.parseInt(tokenRaw('motion', 'light'), 10);
    const slow = Number.parseInt(tokenRaw('motion-slow', 'light'), 10);
    expect(fast).toBeGreaterThanOrEqual(80);
    expect(fast).toBeLessThanOrEqual(140);
    expect(hover).toBeGreaterThanOrEqual(150);
    expect(hover).toBeLessThanOrEqual(200);
    expect(slow).toBeGreaterThanOrEqual(180);
    expect(slow).toBeLessThanOrEqual(240);
  });
});

describe('Revision 2: bento composition', () => {
  it('desktop grid: dominant portfolio 7×2, market 5×2, compact 3/3/6 row', () => {
    const wideBlock = baseCss.slice(baseCss.indexOf('@media (min-width: 1280px)'));
    expect(cssBlock(wideBlock, '.bento-tile--portfolio')).toMatch(/grid-column:\s*span 7/);
    expect(cssBlock(wideBlock, '.bento-tile--portfolio')).toMatch(/grid-row:\s*span 2/);
    expect(cssBlock(wideBlock, '.bento-tile--market')).toMatch(/grid-column:\s*span 5/);
    expect(cssBlock(wideBlock, '.bento-tile--market')).toMatch(/grid-row:\s*span 2/);
    expect(cssBlock(wideBlock, '.bento-tile--risk')).toMatch(/grid-column:\s*span 3/);
    expect(cssBlock(wideBlock, '.bento-tile--discovery')).toMatch(/grid-column:\s*span 3/);
    expect(cssBlock(wideBlock, '.bento-tile--activity')).toMatch(/grid-column:\s*span 6/);
  });

  it('feature tile binds the charcoal package; market tile binds the well', () => {
    const featureBlock = cssBlock(baseCss, '.bento-tile--portfolio');
    expect(featureBlock).toMatch(/background:\s*var\(--feature-bg\)/);
    expect(featureBlock).toMatch(/color:\s*var\(--feature-ink\)/);
    expect(cssBlock(baseCss, '.bento-tile--market')).toMatch(/background:\s*var\(--surface-well\)/);
  });

  it('renders strip, then portfolio, market (with strategy), risk, discovery, activity', async () => {
    setTransport(async () =>
      new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'fixture: endpoint off' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(
      <StatusProvider>
        <MemoryRouter initialEntries={['/']}>
          <OverviewPage />
        </MemoryRouter>
      </StatusProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('overview-strip')).toBeInTheDocument();
    });
    const strip = screen.getByTestId('overview-strip');
    const portfolio = screen.getByTestId('overview-portfolio');
    const market = screen.getByTestId('overview-market');
    const risk = screen.getByTestId('overview-risk');
    const discovery = screen.getByTestId('overview-discovery');
    const activity = screen.getByTestId('overview-activity');
    // DOM order encodes the composition: strip first, then the two feature
    // modules, then the compact support row.
    const order: readonly HTMLElement[] = [strip, portfolio, market, risk, discovery, activity];
    for (let i = 1; i < order.length; i += 1) {
      const prev = order[i - 1];
      const next = order[i];
      if (prev === undefined || next === undefined) {
        throw new Error('composition order array is shorter than expected');
      }
      expect(prev.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // The strategy decision lives inside the market module (testid preserved).
    expect(market.contains(screen.getByTestId('overview-strategy'))).toBe(true);
    // Honest failure: with every endpoint down, no figures are invented.
    expect(screen.queryByTestId('overview-equity-value')).not.toBeInTheDocument();
  });
});
