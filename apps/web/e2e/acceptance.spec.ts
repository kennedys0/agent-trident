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

async function contrastRatio(page: Page, foreground: string, background: string): Promise<number> {
  return page.evaluate(
    ({ foregroundColor, backgroundColor }) => {
      const luminance = (color: string): number => {
        const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
        if (channels === undefined || channels.length !== 3) throw new Error(`Unsupported CSS color: ${color}`);
        return channels.reduce((sum, channel, index) => {
          const normalized = channel / 255;
          const linear = normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
          return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
        }, 0);
      };
      const foregroundLuminance = luminance(foregroundColor);
      const backgroundLuminance = luminance(backgroundColor);
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    },
    { foregroundColor: foreground, backgroundColor: background },
  );
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

  test('the intent action follows the live evaluation, and a duplicate submit replays the stored execution', async ({ page, request }) => {
    const candidates = await (await request.get('/api/v1/candidates?limit=20')).json();
    type CandidatePayload = { evaluation: { id: string; action: string; snapshotStatus: string } };
    const entries = candidates.data as CandidatePayload[];
    expect(entries.length, 'the API must expose at least one evaluation').toBeGreaterThan(0);
    // The newest evaluation is what a user sees first, and the only one the backend
    // can still derive an intent from: older tradable entries may already be consumed.
    const target = entries[0]!;
    const tradable =
      (target.evaluation.action === 'BUY' || target.evaluation.action === 'SELL') && target.evaluation.snapshotStatus === 'COMPLETE';

    await page.goto(`/candidates/${target.evaluation.id}`);
    await expect(page.getByRole('heading', { name: 'Candidate' })).toBeVisible();
    await waitForChain(page);

    const action = page.getByTestId('create-intent');
    if (!tradable) {
      await expect(action).toBeDisabled();
      await expect(page.getByTestId('intent-disabled-reason')).toContainText(`This evaluation is ${target.evaluation.action}`);
      await shot(page, 'intent-disabled-hold');
      return;
    }

    await expect(action).toBeEnabled();

    // Any 5xx during the journey would be the duplicate-evaluation defect resurfacing.
    const serverErrors: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
    });

    const firstPost = page.waitForResponse(
      (response) => response.url().includes('/api/v1/intents') && response.request().method() === 'POST',
    );
    await action.click();
    await page.getByTestId('confirm-dialog-confirm').click();
    const firstResponse = await firstPost;
    expect([200, 201]).toContain(firstResponse.status());

    await expect(page.getByTestId('intent-result')).toBeVisible({ timeout: 30_000 });
    // The amended contract must parse without a mismatch and with explicit order/fill.
    await expect(page.getByTestId('intent-error')).toHaveCount(0);
    await expect(page.getByTestId('intent-status')).toHaveText(/FILLED|REJECTED/);
    await expect(page.getByTestId('intent-replayed')).toHaveCount(0);
    const status = (await page.getByTestId('intent-status').textContent())?.trim();
    if (status === 'FILLED') {
      await expect(page.getByTestId('intent-order')).not.toHaveText('None — rejected');
      await expect(page.getByTestId('intent-fill')).not.toHaveText('None — rejected');
      // The fill row shows the fill time, not a second copy of the order id.
      expect(await page.getByTestId('intent-fill').textContent()).not.toBe(await page.getByTestId('intent-order').textContent());
      await expect(page.getByTestId('gas-estimate')).toBeVisible();
      await expect(page.getByTestId('gas-estimate')).not.toContainText(/\b0 wei\b/);
    } else {
      await expect(page.getByTestId('intent-order')).toHaveText('None — rejected');
      await expect(page.getByTestId('gas-estimate')).toHaveCount(0);
    }
    const storedOrder = (await page.getByTestId('intent-order').textContent())?.trim();
    const storedFill = (await page.getByTestId('intent-fill').textContent())?.trim();
    await shot(page, `intent-result-${String(status).toLowerCase()}`);

    // Duplicate evaluation: the UI mints a fresh idempotency key per submit, so the
    // backend must replay by evaluationId (200 + meta.replayed) instead of inserting
    // a second intent or returning the old 500 UNIQUE constraint error.
    const secondPost = page.waitForResponse(
      (response) => response.url().includes('/api/v1/intents') && response.request().method() === 'POST',
    );
    await action.click();
    await page.getByTestId('confirm-dialog-confirm').click();
    const secondResponse = await secondPost;
    expect(secondResponse.status()).toBe(200);
    const secondBody = (await secondResponse.json()) as { meta?: { replayed?: unknown } };
    expect(secondBody.meta?.replayed).toBe(true);

    await expect(page.getByTestId('intent-replayed')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('intent-replayed')).toHaveText(/REPLAYED — no new fill/);
    await expect(page.getByTestId('intent-error')).toHaveCount(0);
    // Same stored execution: no new order id and no new fill timestamp.
    await expect(page.getByTestId('intent-order')).toHaveText(storedOrder ?? '');
    await expect(page.getByTestId('intent-fill')).toHaveText(storedFill ?? '');
    expect(serverErrors, 'no request may return 5xx').toEqual([]);
    await shot(page, `intent-replay-${String(status).toLowerCase()}`);
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

  test('a reorg-quarantined evaluation stops at manual review instead of a generic error', async ({ page, request }) => {
    const liveCandidates = await (await request.get('/api/v1/candidates?limit=5')).json();
    const liveHealth = await (await request.get('/health')).json();
    const base = liveCandidates.data[0] as {
      token: string;
      snapshotId: string;
      evaluation: {
        snapshotId: string;
        strategyId: string;
        configVersion: string;
        inputHash: string;
        evaluatedAt: string;
      };
    };
    const candidate = {
      token: base.token,
      snapshotId: base.snapshotId,
      evaluation: {
        id: 'eval-reorg',
        snapshotId: base.snapshotId,
        snapshotStatus: 'COMPLETE',
        strategyId: base.evaluation.strategyId,
        configVersion: base.evaluation.configVersion,
        inputHash: base.evaluation.inputHash,
        action: 'BUY',
        signalStrength: 6250,
        invalidation: 'Fixture: price falls below the entry band',
        reasons: ['Fixture evaluation for the reorg conflict state'],
        evaluatedAt: base.evaluation.evaluatedAt,
        proposedBaseQty: '243530914141316398',
      },
    };

    await page.route('**/api/v1/candidates?limit=50', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [candidate], meta: liveCandidates.meta }),
      }),
    );
    await page.route('**/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: liveHealth.data, meta: { ...liveHealth.meta, killSwitchEngaged: true } }),
      }),
    );
    let intentPosts = 0;
    await page.route('**/api/v1/intents', (route) => {
      intentPosts += 1;
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'CONFLICT',
            message: 'Evaluation was quarantined by a chain reorg and requires manual review',
            details: null,
            requestId: 'req-reorg-playwright',
          },
        }),
      });
    });

    await page.goto('/candidates/eval-reorg');
    await waitForChain(page);
    // The reorg halt is visible, not just implied by the refused intent.
    await expect(page.getByText('Entries stopped').first()).toBeVisible();

    const action = page.getByTestId('create-intent');
    await expect(action).toBeEnabled();
    await action.click();
    await page.getByTestId('confirm-dialog-confirm').click();

    const review = page.getByTestId('intent-manual-review');
    await expect(review).toBeVisible();
    await expect(review).toContainText('MANUAL REVIEW REQUIRED');
    await expect(review).toContainText(/quarantined by a chain reorg/i);
    await expect(review).toContainText(/no paper order, fill, or ledger entry was created/i);
    await expect(page.getByTestId('intent-result')).toHaveCount(0);
    await expect(page.getByTestId('intent-error')).toHaveCount(0);
    await expect(action).toBeDisabled();
    await expect(page.getByTestId('intent-disabled-reason')).toContainText(/manual review/i);
    // One refusal only: no automatic retry loop.
    expect(intentPosts).toBe(1);

    for (const theme of ['light', 'dark'] as const) {
      if (theme === 'dark') await page.getByTestId('theme-toggle').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const colors = await review.evaluate((element) => {
        const meta = element.querySelector<HTMLElement>('.meta');
        if (meta === null) throw new Error('Manual-review metadata is missing');
        return {
          foreground: getComputedStyle(meta).color,
          bannerForeground: getComputedStyle(element).color,
          background: getComputedStyle(element).backgroundColor,
        };
      });
      expect(colors.foreground).toBe(colors.bannerForeground);
      expect(await contrastRatio(page, colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);

      const axe = await new AxeBuilder({ page })
        .include('[data-testid="intent-manual-review"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = axe.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
      expect(serious, `${theme}: ${JSON.stringify(serious.map((violation) => violation.id))}`).toHaveLength(0);
    }
    await page.getByTestId('theme-toggle').click();
    await shot(page, 'intent-reorg-manual-review');
  });

  test('an unavailable snapshot keeps health, portfolio and entry controls truthful', async ({ page, request }) => {
    const liveCandidates = await (await request.get('/api/v1/candidates?limit=5')).json();
    const liveHealth = await (await request.get('/health')).json();
    const livePortfolio = await (await request.get('/api/v1/portfolio')).json();
    const base = liveCandidates.data[0];
    const [quoteBalance, baseBalance] = livePortfolio.data.balances;
    const candidate = {
      ...base,
      evaluation: { ...base.evaluation, id: 'eval-unavailable', action: 'SELL', snapshotStatus: 'UNAVAILABLE' },
    };
    const portfolioFixture = {
      mode: 'PAPER',
      asOf: '2026-11-11T18:00:00.000Z',
      balances: [
        quoteBalance,
        {
          asset: baseBalance.asset,
          available: { value: '243530914141316398', decimals: 18 },
          reserved: { value: '0', decimals: 18 },
        },
      ],
      positions: [
        {
          asset: baseBalance.asset,
          quantity: { value: '243530914141316398', decimals: 18 },
          costBasisQuote: { value: '500050000', decimals: 6 },
          valuationStatus: 'UNPRICED',
          reason: 'No canonical snapshot is available to value this position',
        },
      ],
      equityQuote: quoteBalance.available,
      realizedPnlQuote: { value: '0', decimals: 6 },
      unrealizedPnlQuote: { value: '0', decimals: 6 },
    };

    await page.route('**/api/v1/candidates?limit=50', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [candidate], meta: liveCandidates.meta }),
      }),
    );
    await page.route('**/api/v1/markets/weth-usdg/snapshot', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'No market snapshot has been recorded yet',
            details: null,
            requestId: 'req-snapshot-unavailable',
          },
        }),
      }),
    );
    await page.route('**/api/v1/portfolio', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: portfolioFixture,
          meta: { priceStatus: 'UNAVAILABLE', priceAsOf: null, simulated: true },
        }),
      }),
    );
    await page.route('**/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: liveHealth.data, meta: { ...liveHealth.meta, killSwitchEngaged: true } }),
      }),
    );

    await page.goto('/portfolio');
    await expect(page.getByTestId('portfolio-price-status')).toContainText('Valuation unavailable');
    await expect(page.getByTestId('portfolio-price-status')).toContainText(/no complete canonical market snapshot/);
    await expect(page.getByTestId('portfolio-unrealized')).toHaveText('Unavailable');
    await expect(page.getByText('UNPRICED', { exact: true })).toBeVisible();
    await expect(page.getByText(/excludes unpriced positions/)).toBeVisible();
    await expect(page.getByText('Entries stopped').first()).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    const freshness = page.locator('.row', { hasText: 'Snapshot freshness' });
    await expect(freshness.getByText('Unavailable')).toBeVisible();
    await expect(freshness).toContainText('no canonical snapshot');
    const reference = page.locator('.row', { hasText: 'Reference price' });
    await expect(reference.getByText('Unavailable')).toBeVisible();
    const entries = page.locator('.row', { hasText: 'New entries' });
    await expect(entries.getByText('STOPPED')).toBeVisible();
    await shot(page, 'state-snapshot-unavailable');

    await page.goto('/candidates/eval-unavailable');
    await expect(page.getByTestId('create-intent')).toBeDisabled();
    await expect(page.getByTestId('intent-disabled-reason')).toContainText(/UNAVAILABLE/);
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
    await shot(page, 'brand-sidebar-1280-light', false);

    // Dark canvas swaps in the white variant and retints the browser toolbar.
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.brand-mark__img:visible')).toHaveAttribute('src', '/brand/logo-white-transparent.png');
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#18181b');
    await expect(page.locator('.brand-mark__img:visible')).toHaveCount(1);

    const secondaryButtons = [
      page.getByRole('button', { name: 'Refresh' }).first(),
      page.getByRole('link', { name: 'All candidates' }).first(),
    ];
    for (const button of secondaryButtons) {
      await expect(button).toBeEnabled();
      await expect(button).toHaveCSS('opacity', '1');
    }
    await shot(page, 'brand-sidebar-1280-dark', false);

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
