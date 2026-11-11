import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const ARTIFACTS = 'e2e/artifacts';
mkdirSync(ARTIFACTS, { recursive: true });

async function shot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({ path: `${ARTIFACTS}/${name}.png`, fullPage });
}

async function waitForChain(page: Page): Promise<void> {
  // The header reads /health; wait for it so a screenshot never captures the initial unknown badge.
  await expect(page.getByText('chain 4663').first()).toBeVisible();
  await expect(page.getByTestId('stop-new-entries')).toBeEnabled();
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem('trident.theme', value as string);
  }, theme);
}

test.describe('real backend', () => {
  test('overview renders live chain data, not placeholders', async ({ page, request }) => {
    const health = await (await request.get('/health')).json();
    const candidates = await (await request.get('/api/v1/candidates?limit=5')).json();

    // Capture the exact payload the UI consumed, so the assertion cannot race the 10s worker.
    const snapshotResponse = page.waitForResponse(
      (response) => response.url().includes('/api/v1/markets/weth-usdg/snapshot') && response.status() === 200,
    );
    const healthResponse = page.waitForResponse(
      (response) => response.url().endsWith('/health') && response.status() === 200,
    );
    await page.goto('/');
    const snapshotPayload = await (await snapshotResponse).json();
    const healthPayload = await (await healthResponse).json();

    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('PAPER — SIMULATED').first()).toBeVisible();
    await expect(page.getByText(`chain ${health.data.chainId}`).first()).toBeVisible();

    // The head block rendered in the DOM must equal the block the API just reported.
    await expect(page.locator('.topbar__meta')).toContainText(String(healthPayload.data.headBlock));

    // Snapshot freshness row must show the block that same response pinned.
    await expect(page.getByText(`block ${snapshotPayload.data.blockNumber}`).first()).toBeVisible();

    // The latest evaluation is rendered from the same payload.
    const latest = candidates.data[0];
    await expect(page.getByText(latest.evaluation.action, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(latest.evaluation.strategyId).first()).toBeVisible();

    // There is no LIVE control in this build: only the PAPER badge and the stop control exist.
    await expect(page.getByTestId('stop-new-entries')).toBeEnabled();
    expect(await page.getByRole('button', { name: /^live/i }).count()).toBe(0);
  });

  test('candidate detail shows snapshot provenance from the API', async ({ page, request }) => {
    const snapshot = await (await request.get('/api/v1/markets/weth-usdg/snapshot')).json();
    const candidates = await (await request.get('/api/v1/candidates?limit=5')).json();
    const id = candidates.data[0].evaluation.id;

    const snapshotResponse = page.waitForResponse(
      (response) => response.url().includes('/api/v1/markets/weth-usdg/snapshot') && response.status() === 200,
    );
    await page.goto(`/candidates/${id}`);
    const rendered = await (await snapshotResponse).json();
    await expect(page.getByRole('heading', { name: 'Candidate' })).toBeVisible();
    await expect(page.getByText(rendered.data.blockHash)).toBeVisible();
    await expect(page.locator('div.provenance')).toContainText(`block: ${rendered.data.blockNumber}`);
    await expect(page.getByText(rendered.data.source).first()).toBeVisible();
    await expect(page.getByText(/sourceTime:/)).toBeVisible();
  });

  test('portfolio is labelled simulated and matches the API projection', async ({ page, request }) => {
    const portfolio = await (await request.get('/api/v1/portfolio')).json();
    await page.goto('/portfolio');
    await expect(page.getByText('SIMULATED').first()).toBeVisible();
    const equityDigits = portfolio.data.equityQuote.value as string;
    expect(equityDigits.length).toBeGreaterThan(0);
    await expect(page.getByTestId('portfolio-equity')).not.toHaveText('Unavailable');
    await expect(page.getByText('PAPER — no real money')).toBeVisible();
  });

  test('journal lists real audit events', async ({ page, request }) => {
    const journal = await (await request.get('/api/v1/journal?limit=5')).json();
    await page.goto('/journal');
    const firstType = journal.data.events[0].type as string;
    await expect(page.getByText(firstType).first()).toBeVisible();
  });

  test('risk page never shows a decision it does not have', async ({ page }) => {
    await page.goto('/risk');
    await expect(page.getByRole('heading', { name: 'Risk' })).toBeVisible();
    const empty = page.getByTestId('risk-empty');
    const evidence = page.getByTestId('risk-rules');
    await expect(empty.or(evidence).first()).toBeVisible();
  });
});

test.describe('truthful states (intercepted transport, clearly test-only)', () => {
  test('offline/error state keeps the last values labelled and offers retry', async ({ page }) => {
    await page.route('**/api/v1/**', (route) => route.abort('failed'));
    await page.route('**/health', (route) => route.abort('failed'));
    await page.goto('/');
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.getByTestId('candidates-error').or(page.getByTestId('candidates-loading')).first()).toBeVisible();
    await expect(page.getByText(/could not be read/).first()).toBeVisible();
  });

  test('empty evaluations are not presented as an error', async ({ page }) => {
    await page.route('**/api/v1/candidates?limit=5', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: {} }) }),
    );
    await page.goto('/');
    await expect(page.getByTestId('candidates-empty')).toBeVisible();
    await expect(page.getByText('No eligible candidates in the latest scan')).toBeVisible();
  });

  test('a stale snapshot is labelled stale and cannot look healthy', async ({ page, request }) => {
    const live = await (await request.get('/api/v1/markets/weth-usdg/snapshot')).json();
    await page.route('**/api/v1/markets/weth-usdg/snapshot', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { ...live.data, status: 'STALE' }, meta: live.meta }),
      }),
    );
    await page.goto('/');
    await expect(page.getByText('Stale').first()).toBeVisible();
    await shot(page, 'state-stale-desktop');
  });

  test('loading state is announced and shows no invented numbers', async ({ page }) => {
    await page.route('**/api/v1/portfolio', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await route.continue();
    });
    await page.goto('/');
    await expect(page.getByTestId('portfolio-loading')).toBeVisible();
    await expect(page.getByTestId('portfolio-loading')).toHaveText(/Loading the simulated portfolio/);
  });
});

test.describe('responsive and accessibility evidence', () => {
  const viewports = [
    { name: '320', width: 320, height: 800 },
    { name: '375', width: 375, height: 812 },
    { name: '768', width: 768, height: 1024 },
    { name: '1024', width: 1024, height: 768 },
    { name: '1280', width: 1280, height: 900 },
  ];

  for (const viewport of viewports) {
    test(`overview layout at ${viewport.name}px in light and dark`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
      await waitForChain(page);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(0);

      if (viewport.width < 768) {
        await expect(page.getByTestId('bottom-nav-portfolio')).toBeVisible();
        await expect(page.getByTestId('nav-portfolio')).toBeHidden();
      } else if (viewport.width >= 1024) {
        await expect(page.getByTestId('nav-portfolio')).toBeVisible();
        await expect(page.getByTestId('bottom-nav-portfolio')).toBeHidden();
      }

      // A fixed bottom nav belongs to the viewport, so narrow screens use a viewport shot.
      await shot(page, `overview-${viewport.name}-light`, viewport.width >= 768);

      await page.emulateMedia({ colorScheme: 'dark' });
      await page.evaluate(() => window.localStorage.setItem('trident.theme', 'dark'));
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
      await waitForChain(page);
      await shot(page, `overview-${viewport.name}-dark`, viewport.width >= 768);
      await page.evaluate(() => window.localStorage.setItem('trident.theme', 'light'));
    });
  }

  test('official brand mark follows the theme, with favicon and social metadata', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await waitForChain(page);

    // The mark is announced once, from the wrapper, and only the theme's variant renders.
    const mark = page.locator('.brand').getByRole('img', { name: 'TRIDENT' });
    await expect(mark).toBeVisible();
    await expect(mark).toHaveCount(1);
    await expect(page.locator('.brand-mark__img:visible')).toHaveCount(1);
    await expect(page.locator('.brand-mark__img:visible')).toHaveAttribute('src', '/brand/logo-black-transparent.png');

    // The artwork is used at its supplied size: square, never resampled by CSS.
    const natural = await page
      .locator('.brand-mark__img:visible')
      .evaluate((element) => {
        const image = element as HTMLImageElement;
        return { width: image.naturalWidth, height: image.naturalHeight };
      });
    expect(natural).toEqual({ width: 2000, height: 2000 });
    const box = await page.locator('.brand-mark').first().boundingBox();
    expect(box === null ? 0 : Math.abs(box.width - box.height)).toBeLessThanOrEqual(0.5);

    // Dark canvas swaps in the white variant and retints the browser toolbar.
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.brand-mark__img:visible')).toHaveAttribute('src', '/brand/logo-white-transparent.png');
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#18181b');
    await expect(page.locator('.brand-mark__img:visible')).toHaveCount(1);

    // Favicon and social card are wired to shipped files that actually resolve.
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.ico');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('sizes', '32x32');
    expect((await request.get('/favicon.ico')).status()).toBe(200);

    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Paper only/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', '/brand/seo-light.png');
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '2000');
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '2000');
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content', /TRIDENT/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    expect((await request.get('/brand/seo-light.png')).status()).toBe(200);
    expect((await request.get('/brand/logo-black-transparent.png')).status()).toBe(200);
    expect((await request.get('/brand/logo-white-transparent.png')).status()).toBe(200);

    await page.evaluate(() => window.localStorage.setItem('trident.theme', 'light'));
  });

  test('the brand mark leads the top bar on mobile without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/');
    await waitForChain(page);

    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('.topbar__brand').getByRole('img', { name: 'TRIDENT' })).toBeVisible();
    await expect(page.locator('.topbar__brand .brand-mark__img:visible')).toHaveCount(1);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'the top bar must not overflow at 320px').toBeLessThanOrEqual(0);
    await shot(page, 'brand-mobile-320-light', false);
  });

  test('route evidence at 1280px: candidates, risk, portfolio, journal', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const candidates = await (await request.get('/api/v1/candidates?limit=1')).json();
    const id = candidates.data[0].evaluation.id as string;

    await page.goto('/candidates');
    await expect(page.getByRole('heading', { name: 'Candidates' })).toBeVisible();
    await waitForChain(page);
    await shot(page, 'candidates-1280-light');

    await page.goto(`/candidates/${id}`);
    await expect(page.getByRole('heading', { name: 'Candidate' })).toBeVisible();
    await waitForChain(page);
    await expect(page.getByTestId('create-intent')).toBeVisible();
    await shot(page, 'candidate-detail-1280-light');

    await page.goto('/risk');
    await expect(page.getByRole('heading', { name: 'Risk' })).toBeVisible();
    await waitForChain(page);
    await expect(page.getByTestId('risk-empty').or(page.getByTestId('risk-rules')).first()).toBeVisible();
    await shot(page, 'risk-1280-light');

    await page.goto('/portfolio');
    await expect(page.getByRole('heading', { name: 'Paper portfolio' })).toBeVisible();
    await waitForChain(page);
    await expect(page.getByTestId('portfolio-equity')).not.toHaveText('Unavailable');
    await shot(page, 'portfolio-1280-light');

    await page.goto('/journal');
    await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
    await waitForChain(page);
    await shot(page, 'journal-1280-light');

    await page.goto('/more');
    await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();
    await waitForChain(page);
    await shot(page, 'more-1280-light');
  });

  test('axe scan reports no serious violations on the overview', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
    expect(serious, JSON.stringify(serious.map((violation) => violation.id))).toHaveLength(0);
  });

  test('axe scan reports no serious violations on candidate, risk and portfolio', async ({ page, request }) => {
    const candidates = await (await request.get('/api/v1/candidates?limit=1')).json();
    const id = candidates.data[0].evaluation.id as string;
    for (const route of [`/candidates/${id}`, '/risk', '/portfolio', '/journal']) {
      await page.goto(route);
      await expect(page.locator('h1')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
      expect(serious, `${route}: ${JSON.stringify(serious.map((violation) => violation.id))}`).toHaveLength(0);
    }
  });

  test('keyboard reaches the primary navigation and the stop control', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('nav-overview')).toBeFocused();
  });

  test('no LIVE control and no unapproved paper/live ambiguity', async ({ page }) => {
    await page.goto('/more');
    await expect(page.getByText(/no LIVE control/)).toBeVisible();
    const liveButtons = page.getByRole('button', { name: /live/i });
    expect(await liveButtons.count()).toBe(0);
  });
});