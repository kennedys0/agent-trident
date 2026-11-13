/**
 * Soft Bento design-exploration evidence harness (issue #39).
 *
 * This script drives the built app in Chromium and captures screenshots, an
 * interaction recording, axe results, honest-state captures and a reduced
 * motion probe for the Overview (Bento) and Discover (dense table) prototype.
 *
 * Every API response it serves is a labelled fixture intercepted in the
 * browser: nothing here reads a chain or a live backend, so no screenshot can
 * be mistaken for production data. The fixture label is repeated in
 * results.json and README.md.
 *
 * Usage: build and preview the web app, then
 *   node apps/web/e2e/soft-bento-evidence.mjs [baseUrl]
 * (default baseUrl http://127.0.0.1:4473).
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4473';
const OUT = new URL('../../../docs/design/evidence/soft-bento/', import.meta.url).pathname;

const POOL = '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca';
const POOL_B = '0x69bfaf19c9f377bb306a89aed9f6b07e2c1a8d9a';
const POOL_C = '0x00000000000000000000000000000000000000c3';
const WETH = '0x1111111111111111111111111111111111111111';
const USDG = '0x2222222222222222222222222222222222222222';
const FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const SCALE = '1000000000000000000';

const WIDTHS = [320, 375, 768, 1024, 1440];

const observed = {
  blockNumber: '123456',
  sourceTime: '2026-11-13T05:00:00Z',
  observedAt: '2026-11-13T05:00:05Z',
  provenance: 'slot0 at block 123456',
};

function pool(overrides = {}) {
  return {
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
      price: {
        status: 'AVAILABLE',
        ...observed,
        token1PerToken0: { value: '2500000000000000000000', scale: SCALE },
        token0PerToken1: { value: '400000000000000', scale: SCALE },
      },
      liquidity: {
        status: 'AVAILABLE',
        ...observed,
        liquidity: '5000000000000000000',
        reserve0: '10000000000000000000',
        reserve1: '25000000000',
        reserve0Decimals: 18,
        reserve1Decimals: 6,
      },
      volume24h: {
        status: 'UNAVAILABLE',
        reason: 'no verifiable volume source; the public RPC exposes no pinned-block per-pool volume',
      },
    },
    confidence: 'LOW',
    confidenceReason: 'single Uniswap v3 pool; a spot price is not an independent oracle',
    watched: false,
    ...overrides,
  };
}

const STALE_POOL = {
  ...pool({ pool: POOL_B, fee: 500, venue: 's3-01-registry', status: 'STALE', watched: true }),
  metrics: {
    ...pool().metrics,
    price: {
      ...pool().metrics.price,
      status: 'STALE',
      token1PerToken0: { value: '2490000000000000000000', scale: SCALE },
    },
    liquidity: { ...pool().metrics.liquidity, status: 'STALE' },
  },
};

const UNAVAILABLE_POOL = {
  ...pool({ pool: POOL_C, fee: 3000, venue: 's3-01-registry', status: 'UNAVAILABLE' }),
  reason: 'no observation persisted yet; refresh the pool detail endpoint',
  metrics: {
    price: { status: 'UNAVAILABLE', reason: 'no observation persisted yet; refresh the pool detail endpoint' },
    liquidity: { status: 'UNAVAILABLE', reason: 'no observation persisted yet; refresh the pool detail endpoint' },
    volume24h: {
      status: 'UNAVAILABLE',
      reason: 'no verifiable volume source; the public RPC exposes no pinned-block per-pool volume',
    },
  },
};

const HEALTH = (killSwitchEngaged = false) => ({
  data: { mode: 'PAPER', chainId: 4663, rpcStatus: 'HEALTHY', headBlock: '123456', lagSeconds: 2 },
  meta: { killSwitchEngaged, rpcLatencyMs: 42 },
});

const PORTFOLIO = {
  data: {
    mode: 'PAPER',
    asOf: '2026-11-13T04:00:00Z',
    balances: [
      { asset: USDG, available: { value: '9499950000', decimals: 6 }, reserved: { value: '0', decimals: 6 } },
    ],
    positions: [
      {
        asset: WETH,
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
  },
  meta: {},
};

const SNAPSHOT = {
  data: {
    chainId: 4663,
    poolAddress: POOL,
    baseToken: WETH,
    quoteToken: USDG,
    blockNumber: '123456',
    blockHash: `0x${'b'.repeat(64)}`,
    sourceTime: '2026-11-13T05:00:00Z',
    observedAt: '2026-11-13T05:00:05Z',
    source: 'slot0 at block 123456',
    status: 'COMPLETE',
    reservesBase: { value: '10000000000000000000', decimals: 18 },
    reservesQuote: { value: '25000000000', decimals: 6 },
    price: { value: '2500000000000000000000', scale: SCALE },
    liquidityQuote: { value: '50000000000', decimals: 6 },
  },
  meta: {},
};

const CANDIDATES = {
  data: [
    {
      token: WETH,
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
        evaluatedAt: '2026-11-13T04:00:00Z',
        proposedBaseQty: '243530914141316398',
      },
    },
  ],
  meta: { strategyId: 'paper-momentum', configVersion: '1.0.0' },
};

const JOURNAL = {
  data: {
    events: [
      {
        id: 'evt-2',
        type: 'paper.entry.executed',
        aggregateId: 'intent-1',
        payload: { intentId: 'intent-1' },
        createdAt: '2026-11-13T04:01:00Z',
      },
      {
        id: 'evt-1',
        type: 'risk.decision.recorded',
        aggregateId: 'intent-1',
        payload: { intentId: 'intent-1' },
        createdAt: '2026-11-13T04:00:30Z',
      },
    ],
    nextCursor: null,
  },
  meta: {},
};

const INTENT_VIEW = {
  data: {
    intent: {
      id: 'intent-1',
      evaluationId: 'eval-1',
      idempotencyKey: 'key-12345',
      mode: 'PAPER',
      side: 'BUY',
      token: WETH,
      quoteToken: USDG,
      baseQty: '243530914141316398',
      limitPrice: { value: '2500000000000000000000', scale: SCALE },
      snapshotId: 'snap-1',
      expiresAt: '2026-11-13T05:00:00Z',
      status: 'APPROVED',
    },
    riskDecision: {
      intentId: 'intent-1',
      policyVersion: 'paper-risk-v1',
      portfolioVersion: 'ledger:3',
      verdict: 'APPROVED',
      reasons: [],
      evaluatedAt: '2026-11-13T04:00:30Z',
      rules: [{ rule: 'R01_chain', observed: 4663, threshold: 4663, status: 'PASS' }],
      approvedBaseQty: { value: '243530914141316398', decimals: 18 },
      maximumQuoteCost: { value: '500050000', decimals: 6 },
    },
  },
  meta: {},
};

const POOLS_BODY = (pools) => ({
  data: { pools, total: pools.length, offset: 0, limit: 20 },
  meta: { registryStatus: 'OK', registrySkipped: false, trackedPools: pools.length, watchlistEntries: 1 },
});

const WATCHLIST = { data: { entries: [{ address: WETH, symbol: 'WETH' }] }, meta: {} };

const JSON_HEADERS = { 'content-type': 'application/json' };

async function fulfil(route, body, status = 200) {
  await route.fulfill({ status, headers: JSON_HEADERS, body: JSON.stringify(body) });
}

/**
 * Fixture router. `options.killSwitch` flips the health meta, `options.poolsMeta`
 * replaces the pools meta ({} exercises the honest unavailable tile), and
 * `options.pools` replaces the listing.
 */
function routeApp(page, options = {}) {
  const { killSwitch = false, poolsMeta = null, pools = [pool(), STALE_POOL, UNAVAILABLE_POOL] } = options;
  return page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/health') {
      return fulfil(route, HEALTH(killSwitch));
    }
    if (url.pathname === '/api/v1/portfolio') {
      return fulfil(route, PORTFOLIO);
    }
    if (url.pathname === '/api/v1/markets/weth-usdg/snapshot') {
      return fulfil(route, SNAPSHOT);
    }
    if (url.pathname.startsWith('/api/v1/candidates')) {
      return fulfil(route, CANDIDATES);
    }
    if (url.pathname.startsWith('/api/v1/journal')) {
      return fulfil(route, JOURNAL);
    }
    if (url.pathname.startsWith('/api/v1/intents/')) {
      return fulfil(route, INTENT_VIEW);
    }
    if (url.pathname === '/api/v1/watchlist') {
      return fulfil(route, WATCHLIST);
    }
    if (url.pathname === '/api/v1/pools') {
      const body = POOLS_BODY(pools);
      return fulfil(route, poolsMeta === null ? body : { ...body, meta: poolsMeta });
    }
    return route.continue();
  });
}

async function withPage(browser, options, fn) {
  const context = await browser.newContext({
    viewport: options.viewport,
    ...(options.reducedMotion === undefined ? {} : { reducedMotion: options.reducedMotion }),
    ...(options.video === undefined ? {} : { recordVideo: { dir: `${OUT}video`, size: options.video } }),
  });
  const page = await context.newPage();
  await fn(page, context);
  return context;
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
}

async function axe(page, label, results) {
  const analysis = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  results.push({
    page: label,
    violations: analysis.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    })),
  });
}

async function overflow(page) {
  return page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));
}

async function gotoOverview(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.getByTestId('overview-equity-value').waitFor();
  await page.getByTestId('overview-tracked-pools').waitFor();
}

async function gotoDiscover(page) {
  await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
  await page.getByTestId(`pool-row-${POOL}`).waitFor();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(`${OUT}video`, { recursive: true });
  const browser = await chromium.launch();
  const results = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    dataSource:
      'FIXTURE: design exploration (issue #39); every API response is intercepted in the browser with test-shaped data. No live chain read.',
    widths: WIDTHS,
    screenshots: [],
    axe: [],
    layout: [],
    states: {},
    reducedMotion: {},
  };

  /* 1. Light responsive screenshots + axe + overflow probe. */
  for (const width of WIDTHS) {
    const context = await withPage(browser, { viewport: { width, height: 900 }, reducedMotion: 'reduce' }, async (page) => {
      await routeApp(page);
      await gotoOverview(page);
      await axe(page, `overview-${width}`, results.axe);
      await shot(page, `overview-${width}`);
      results.screenshots.push(`overview-${width}.png`);
      results.layout.push({ page: 'overview', theme: 'light', ...(await overflow(page)) });

      await gotoDiscover(page);
      await axe(page, `discover-${width}`, results.axe);
      await shot(page, `discover-${width}`);
      results.screenshots.push(`discover-${width}.png`);
      results.layout.push({ page: 'discover', theme: 'light', ...(await overflow(page)) });
    });
    await context.close();
  }

  /* 2. Dark responsive screenshots + axe. */
  for (const width of WIDTHS) {
    const context = await withPage(browser, { viewport: { width, height: 900 }, reducedMotion: 'reduce' }, async (page) => {
      await routeApp(page);
      await gotoOverview(page);
      await page.evaluate(() => {
        document.documentElement.dataset['theme'] = 'dark';
      });
      await axe(page, `overview-dark-${width}`, results.axe);
      await shot(page, `overview-dark-${width}`);
      results.screenshots.push(`overview-dark-${width}.png`);

      await gotoDiscover(page);
      await page.evaluate(() => {
        document.documentElement.dataset['theme'] = 'dark';
      });
      await axe(page, `discover-dark-${width}`, results.axe);
      await shot(page, `discover-dark-${width}`);
      results.screenshots.push(`discover-dark-${width}.png`);
      results.layout.push({ page: 'discover', theme: 'dark', ...(await overflow(page)) });
    });
    await context.close();
  }

  /* 3. Honest states: kill switch engaged and missing discovery meta. */
  {
    const context = await withPage(browser, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }, async (page) => {
      await routeApp(page, { killSwitch: true });
      await gotoOverview(page);
      await page.getByText('STOPPED', { exact: true }).waitFor();
      results.states.killSwitch = await page.locator('.badge--halted').first().innerText();
      await shot(page, 'state-halted-1280');
      results.screenshots.push('state-halted-1280.png');

      await routeApp(page, { poolsMeta: {} });
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByTestId('overview-tracked-pools').waitFor();
      results.states.discoveryMetaMissing = await page.getByTestId('overview-tracked-pools').innerText();
      results.states.watchlistMissing = await page.getByText('watchlist size unavailable').innerText();
      await shot(page, 'state-meta-missing-1280');
      results.screenshots.push('state-meta-missing-1280.png');
    });
    await context.close();
  }

  /* 4. Interaction recording: hover, press, route change, filter, theme toggle. */
  {
    const context = await withPage(
      browser,
      { viewport: { width: 1280, height: 800 }, video: { width: 1280, height: 800 } },
      async (page) => {
        await routeApp(page);
        await gotoOverview(page);

        await page.hover('[data-testid="overview-risk"]');
        await page.waitForTimeout(300);
        await shot(page, 'interaction-hover-tile');
        results.screenshots.push('interaction-hover-tile.png');

        const refresh = page.getByRole('button', { name: 'Refresh' });
        await refresh.hover();
        await page.mouse.down();
        await page.waitForTimeout(150);
        await shot(page, 'interaction-press-button');
        results.screenshots.push('interaction-press-button.png');
        await page.mouse.up();

        await page.getByTestId('theme-toggle').click();
        await page.waitForTimeout(300);
        await shot(page, 'interaction-theme-dark');
        results.screenshots.push('interaction-theme-dark.png');
        await page.getByTestId('theme-toggle').click();

        await page.getByTestId('nav-discover').click();
        await page.getByTestId(`pool-row-${POOL}`).waitFor();
        await page.waitForTimeout(300);
        await shot(page, 'interaction-route-discover');
        results.screenshots.push('interaction-route-discover.png');

        await page.getByTestId('filter-watched').click();
        await page.waitForTimeout(300);
        results.states.filterWatched = await page.getByTestId('filter-watched').getAttribute('aria-pressed');
        await shot(page, 'interaction-filter-watched');
        results.screenshots.push('interaction-filter-watched.png');

        await page.getByTestId('filter-watched').click();
        await page.getByTestId('discover-search-input').fill('WETH');
        await page.getByTestId('discover-search-submit').click();
        await page.waitForTimeout(300);
        await shot(page, 'interaction-search');
        results.screenshots.push('interaction-search.png');
      },
    );
    const video = context.pages()[0]?.video() ?? null;
    await context.close();
    if (video !== null) {
      await rename(await video.path(), `${OUT}interaction-recording.webm`);
      results.screenshots.push('interaction-recording.webm');
    }
  }

  /* 5. Reduced motion probe: travel tokens collapse and transitions die. */
  {
    const context = await withPage(browser, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }, async (page) => {
      await routeApp(page);
      await gotoOverview(page);
      results.reducedMotion = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const button = document.querySelector('.btn');
        const tile = document.querySelector('.bento-tile--interactive');
        return {
          liftToken: root.getPropertyValue('--lift').trim(),
          pressToken: root.getPropertyValue('--press').trim(),
          buttonTransition: button === null ? 'missing' : getComputedStyle(button).transitionDuration,
          tileTransition: tile === null ? 'missing' : getComputedStyle(tile).transitionDuration,
        };
      });
      await shot(page, 'reduced-motion-1280');
      results.screenshots.push('reduced-motion-1280.png');
    });
    await context.close();
  }

  /* 6. Mobile bottom navigation honesty at 375. */
  {
    const context = await withPage(browser, { viewport: { width: 375, height: 800 }, reducedMotion: 'reduce' }, async (page) => {
      await routeApp(page);
      await gotoOverview(page);
      results.states.bottomNav = await page.evaluate(() =>
        [...document.querySelectorAll('.bottom-nav a')].map((link) => ({
          href: link.getAttribute('href'),
          label: link.textContent,
        })),
      );
      await page.screenshot({ path: `${OUT}overview-375-bottom-nav.png` });
      results.screenshots.push('overview-375-bottom-nav.png');
    });
    await context.close();
  }

  await writeFile(`${OUT}results.json`, `${JSON.stringify(results, null, 2)}\n`);
  await browser.close();
  console.log(
    JSON.stringify(
      {
        screenshots: results.screenshots.length,
        axeViolations: results.axe.flatMap((entry) => entry.violations.map((violation) => `${entry.page}: ${violation.id}`)),
        reducedMotion: results.reducedMotion,
        states: results.states,
      },
      null,
      2,
    ),
  );
}

await main();
