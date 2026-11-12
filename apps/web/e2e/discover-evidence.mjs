/**
 * S3-03 Discover UI evidence harness.
 *
 * This script drives the built app in Chromium and captures screenshots, axe
 * results and keyboard order. Every API response it serves is a labelled
 * fixture, because S3-02 is not merged into `main` yet (PR #25). The script
 * prints that fact in its result JSON so no screenshot can be mistaken for a
 * live chain read.
 *
 * Usage: start `pnpm --filter @trident/web preview`, then
 *   node apps/web/e2e/discover-evidence.mjs [baseUrl]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const OUT = new URL('../../../docs/evidence/s3-03/', import.meta.url).pathname;

const POOL = '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca';
const POOL_B = '0x69bfaf19c9f377bb306a89aed9f6b07e2c1a8d9a';
const POOL_C = '0x00000000000000000000000000000000000000c3';
const WETH = '0x1111111111111111111111111111111111111111';
const USDG = '0x2222222222222222222222222222222222222222';
const FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const SCALE = '1000000000000000000';

const observed = {
  blockNumber: '123456',
  sourceTime: new Date(Date.now() - 12_000).toISOString(),
  observedAt: new Date(Date.now() - 8_000).toISOString(),
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
      volume24h: { status: 'UNAVAILABLE', reason: 'no verifiable volume source; the public RPC exposes no pinned-block per-pool volume' },
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
    price: { ...pool().metrics.price, status: 'STALE', token1PerToken0: { value: '2490000000000000000000', scale: SCALE } },
    liquidity: { ...pool().metrics.liquidity, status: 'STALE' },
  },
};

const UNAVAILABLE_POOL = {
  ...pool({ pool: POOL_C, fee: 3000, venue: 's3-01-registry', status: 'UNAVAILABLE' }),
  reason: 'no observation persisted yet; refresh the pool detail endpoint',
  metrics: {
    price: { status: 'UNAVAILABLE', reason: 'no observation persisted yet; refresh the pool detail endpoint' },
    liquidity: { status: 'UNAVAILABLE', reason: 'no observation persisted yet; refresh the pool detail endpoint' },
    volume24h: { status: 'UNAVAILABLE', reason: 'no verifiable volume source; the public RPC exposes no pinned-block per-pool volume' },
  },
};

const HEALTH = { data: { mode: 'PAPER', chainId: 4663, rpcStatus: 'HEALTHY', headBlock: '123456', lagSeconds: 2 } };

const JSON_HEADERS = { 'content-type': 'application/json' };

async function fulfil(route, body, status = 200) {
  await route.fulfill({ status, headers: JSON_HEADERS, body: JSON.stringify(body) });
}

async function withPage(browser, options, fn) {
  const context = await browser.newContext({ viewport: options.viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const calls = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) {
      calls.push(`${request.method()} ${new URL(request.url()).pathname}${new URL(request.url()).search}`);
    }
  });
  await fn(page, context, calls);
  await context.close();
}

function routePools(page, { mode = 'default', delayMs = 0, pools: override = null, detailMeta = {} } = {}) {
  return page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/health') {
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(HEALTH) });
    }
    if (url.pathname === '/api/v1/watchlist') {
      return fulfil(route, { data: { entries: [] }, meta: {} });
    }
    if (url.pathname === '/api/v1/pools') {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (mode === 'error') {
        return fulfil(route, { error: { code: 'RPC_UNAVAILABLE', message: 'RPC is unreachable' } }, 503);
      }
      if (mode === 'rejected') {
        return fulfil(route, { error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters for pool discovery' } }, 400);
      }
      const pools = override ?? (mode === 'empty' ? [] : mode === 'unavailable' ? [UNAVAILABLE_POOL] : [pool(), STALE_POOL, UNAVAILABLE_POOL]);
      return fulfil(route, { data: { pools, total: pools.length, offset: 0, limit: 20 }, meta: {} });
    }
    if (url.pathname.startsWith('/api/v1/pools/')) {
      const address = url.pathname.slice('/api/v1/pools/'.length).toLowerCase();
      const pools = override ?? [pool(), STALE_POOL, UNAVAILABLE_POOL];
      const match = pools.find((candidate) => candidate.pool.toLowerCase() === address) ?? pools[0];
      return fulfil(route, { data: match, meta: detailMeta });
    }
    return route.continue();
  });
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

async function keyboardOrder(page) {
  await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
  const order = [];
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement)) {
          return 'none';
        }
        return element.dataset['testid'] ?? element.getAttribute('aria-label') ?? element.tagName.toLowerCase();
      }),
    );
  }
  return order;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    dataSource: 'FIXTURE: S3-02 is not merged into main (PR #25); every API response below is intercepted in the browser.',
    widths: [320, 375, 768, 1024, 1280],
    screenshots: [],
    axe: [],
    keyboard: [],
    layout: [],
    states: {},
  };

  for (const width of results.widths) {
    await withPage(browser, { viewport: { width, height: 900 } }, async (page) => {
      await routePools(page);
      await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
      await page.getByTestId(`pool-row-${POOL}`).waitFor();
      results.layout.push(
        await page.evaluate((viewportWidth) => {
          const table = document.querySelector('.discover-table');
          const cells = table === null ? [] : [...table.querySelectorAll('td')];
          return {
            width: viewportWidth,
            viewportScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            overflowingCells: cells
              .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
              .map((cell) => cell.getAttribute('data-label')),
          };
        }, width),
      );
      await axe(page, `discover-${width}`, results.axe);
      await shot(page, `listing-${width}`);
      results.screenshots.push(`listing-${width}.png`);
    });
  }

  await withPage(browser, { viewport: { width: 375, height: 900 } }, async (page) => {
    await routePools(page, { pools: [pool()], detailMeta: { refreshError: 'RPC read failed at pinned block' } });
    await page.goto(`${BASE}/discover/pools/${POOL}`, { waitUntil: 'networkidle' });
    await page.getByTestId('pool-refresh-error').waitFor();
    await shot(page, 'pool-refresh-error-375');
    results.screenshots.push('pool-refresh-error-375.png');
    results.states.poolRefreshError = await page.getByTestId('pool-refresh-error').innerText();
  });

  await withPage(browser, { viewport: { width: 375, height: 900 } }, async (page) => {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/health') {
        return fulfil(route, HEALTH);
      }
      if (url.pathname === '/api/v1/watchlist') {
        return fulfil(route, { data: { entries: [] }, meta: {} });
      }
      if (url.pathname.startsWith('/api/v1/pools/')) {
        return fulfil(route, { error: { code: 'NOT_FOUND', message: 'Pool is not tracked' } }, 404);
      }
      return route.continue();
    });
    await page.goto(`${BASE}/discover/pools/${POOL}`, { waitUntil: 'networkidle' });
    await page.getByTestId('pool-unknown').waitFor();
    await shot(page, 'pool-unknown-375');
    results.screenshots.push('pool-unknown-375.png');
    results.states.poolUnknown = await page.getByTestId('pool-unknown').innerText();
  });

  await withPage(browser, { viewport: { width: 375, height: 900 } }, async (page, _context, calls) => {
    let releaseMutation = () => {};
    let markMutationStarted = () => {};
    const mutationGate = new Promise((resolve) => {
      releaseMutation = resolve;
    });
    const mutationStarted = new Promise((resolve) => {
      markMutationStarted = resolve;
    });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/health') {
        return fulfil(route, HEALTH);
      }
      if (url.pathname === '/api/v1/watchlist' && route.request().method() === 'POST') {
        markMutationStarted();
        await mutationGate;
        return fulfil(route, { data: { address: WETH, result: 'ADDED' }, meta: {} });
      }
      if (url.pathname === '/api/v1/watchlist') {
        return fulfil(route, { data: { entries: [] }, meta: {} });
      }
      if (url.pathname.startsWith('/api/v1/pools/')) {
        return fulfil(route, { data: pool(), meta: {} });
      }
      return route.continue();
    });
    await page.goto(`${BASE}/discover/pools/${POOL}`, { waitUntil: 'networkidle' });
    const button = page.getByTestId(`watch-${WETH}`);
    await button.waitFor();
    await button.click();
    await mutationStarted;
    const pendingPressed = await button.getAttribute('aria-pressed');
    const pendingBusy = await button.getAttribute('aria-busy');
    await shot(page, 'watch-pending-375');
    releaseMutation();
    await page.getByTestId('pool-watchlist-message').waitFor();
    const persistedPressed = await button.getAttribute('aria-pressed');
    await shot(page, 'watch-success-375');
    results.screenshots.push('watch-pending-375.png', 'watch-success-375.png');
    results.states.watchlist = { pendingPressed, pendingBusy, persistedPressed, calls };
  });

  const states = [
    { key: 'loading', mode: 'loading' },
    { key: 'empty', mode: 'empty' },
    { key: 'unavailable', mode: 'unavailable' },
    { key: 'error', mode: 'error' },
    { key: 'rejected', mode: 'rejected' },
  ];

  for (const state of states) {
    await withPage(browser, { viewport: { width: 375, height: 900 } }, async (page) => {
      await routePools(page, { mode: state.mode, delayMs: state.mode === 'loading' ? 4000 : 0 });
      await page.goto(`${BASE}/discover`, { waitUntil: 'domcontentloaded' });
      if (state.mode === 'loading') {
        await page.getByTestId('discover-loading').waitFor();
      } else {
        await page.locator('[data-testid^="pool-row-"], [data-testid="discover-empty"], [data-testid="discover-error"]').first().waitFor();
      }
      await shot(page, `state-${state.key}-375`);
      results.screenshots.push(`state-${state.key}-375.png`);
      results.states[state.key] = await page.locator('[data-testid="discover-empty"], [data-testid="discover-error"], [data-testid="discover-loading"], [data-testid="discover-count"]').first().innerText();
    });
  }

  await withPage(browser, { viewport: { width: 375, height: 900 } }, async (page) => {
    // No API is running behind the preview proxy and no route is mocked here,
    // so the first load fails like a real backend outage.
    await page.goto(`${BASE}/discover`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('discover-error').waitFor({ timeout: 20_000 });
    // Going offline fires the browser event; a client-side remount then has no
    // data and reports the offline state instead of a generic backend error.
    await page.context().setOffline(true);
    await page.getByTestId('bottom-nav-candidates').click();
    await page.getByTestId('bottom-nav-discover').click();
    await page.getByTestId('discover-error').waitFor({ timeout: 20_000 });
    await shot(page, 'state-offline-375');
    results.screenshots.push('state-offline-375.png');
    results.states.offline = await page.getByTestId('discover-error').innerText();
  });

  for (const width of results.widths) {
    await withPage(browser, { viewport: { width, height: 1000 } }, async (page) => {
      await routePools(page, { pools: [pool()] });
      await page.goto(`${BASE}/discover/pools/${POOL}`, { waitUntil: 'networkidle' });
      await page.getByText('LOW CONFIDENCE').first().waitFor();
      await axe(page, `pool-inspector-${width}`, results.axe);
      await shot(page, `pool-inspector-${width}`);
      results.screenshots.push(`pool-inspector-${width}.png`);
    });
  }

  for (const width of results.widths) {
    await withPage(browser, { viewport: { width, height: 1000 } }, async (page) => {
      await routePools(page);
      await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        document.documentElement.dataset['theme'] = 'dark';
      });
      await page.getByTestId(`pool-row-${POOL}`).waitFor();
      await axe(page, `discover-dark-${width}`, results.axe);
      await shot(page, `listing-dark-${width}`);
      results.screenshots.push(`listing-dark-${width}.png`);

      await page.goto(`${BASE}/discover/pools/${POOL}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        document.documentElement.dataset['theme'] = 'dark';
      });
      await page.getByText('LOW CONFIDENCE').first().waitFor();
      await axe(page, `pool-inspector-dark-${width}`, results.axe);
    });
  }

  await withPage(browser, { viewport: { width: 1280, height: 900 } }, async (page) => {
    await routePools(page);
    results.keyboard = await keyboardOrder(page);
  });

  await writeFile(`${OUT}results.json`, `${JSON.stringify(results, null, 2)}\n`);
  await browser.close();
  console.log(JSON.stringify({ screenshots: results.screenshots.length, axe: results.axe, keyboard: results.keyboard }, null, 2));
}

await main();
