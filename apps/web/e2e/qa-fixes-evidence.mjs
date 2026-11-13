/**
 * QA-fixes evidence harness (issue #39, Revision 2 follow-up).
 *
 * R-1: blocks GET /api/v1/portfolio in the browser (the QA repro) so the
 *      charcoal feature panel shows its error state in light and dark mode —
 *      every other endpoint talks to the real local PAPER API.
 * R-4: captures the Discover first paint (rest position, scroll 0) at
 *      375×667 and 320×568 and measures the toolbar controls against the
 *      fixed bottom-nav band.
 *
 * Usage: run the local API (PAPER) and `vite preview` proxied to it, then
 *   node apps/web/e2e/qa-fixes-evidence.mjs [baseUrl]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4573';
const OUT = new URL('../../../docs/design/evidence/rev2/qa-fixes/', import.meta.url).pathname;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const results = {
  fixtureLabel: 'real local PAPER API; GET /api/v1/portfolio blocked in the browser for the R-1 repro (disclosed)',
  r1: {},
  r4: {},
};

/* ---------- R-1: charcoal panel error state, light + dark ---------- */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/api/v1/portfolio*', (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.getByTestId('portfolio-error').waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByTestId('portfolio-error-retry').waitFor({ state: 'visible', timeout: 10_000 });
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await page.evaluate(() => {
        document.documentElement.dataset['theme'] = 'dark';
      });
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: `${OUT}r1-overview-error-${theme}-full.png`, fullPage: true });
    await page.getByTestId('overview-portfolio').screenshot({ path: `${OUT}r1-overview-error-${theme}-panel.png` });
    results.r1[theme] = {
      errorStateVisible: true,
      retryVisible: true,
      screenshots: [`r1-overview-error-${theme}-full.png`, `r1-overview-error-${theme}-panel.png`],
    };
  }
  await context.close();
}

/* ---------- R-4: Discover first paint vs the bottom-nav band ---------- */
function restMeasure(width, height) {
  return browser.newContext({ viewport: { width, height } }).then(async (context) => {
    const page = await context.newPage();
    await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.filter-chip');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const data = await page.evaluate(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (el === null) return null;
        const box = el.getBoundingClientRect();
        return { top: Math.round(box.top), bottom: Math.round(box.bottom) };
      };
      const navTop = document.querySelector('.bottom-nav')?.getBoundingClientRect().top ?? null;
      const chips = [...document.querySelectorAll('.filter-chip')].map((el) => {
        const box = el.getBoundingClientRect();
        return { label: el.textContent?.trim() ?? '', top: Math.round(box.top), bottom: Math.round(box.bottom) };
      });
      return {
        scrollY: window.scrollY,
        navTop: navTop === null ? null : Math.round(navTop),
        input: rect('.discover-input'),
        searchBtn: rect('.discover-search .btn'),
        chips,
      };
    });
    await page.screenshot({ path: `${OUT}r4-discover-${width}-firstpaint.png` });
    const named = {
      // The QA finding names these controls: Search button, chips All + Available.
      searchBtnAboveBand: data.searchBtn !== null && data.navTop !== null && data.searchBtn.bottom <= data.navTop,
      inputAboveBand: data.input !== null && data.navTop !== null && data.input.bottom <= data.navTop,
      firstChips: data.chips
        .slice(0, 2)
        .every((chip) => data.navTop !== null && chip.bottom <= data.navTop),
    };
    results.r4[width] = { viewport: `${width}x${height}`, scrollY: data.scrollY, navTop: data.navTop, controls: data, ...named };
    await context.close();
    return named;
  });
}

const named375 = await restMeasure(375, 667);
const named320 = await restMeasure(320, 568);

await writeFile(`${OUT}results.json`, `${JSON.stringify(results, null, 2)}\n`);
await browser.close();
console.log(JSON.stringify({ 375: named375, 320: named320 }, null, 1));
