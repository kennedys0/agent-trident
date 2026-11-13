import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Watchlist click proof against the real API (Sprint 4 pre-check).
 *
 * The unit suite already covers the toggle through a fake transport; what it
 * cannot prove is the browser-level path: a real click, a real HTTP round trip
 * to `POST /api/v1/watchlist` / `DELETE /api/v1/watchlist/:address`, and the
 * pressed state surviving a reload because the server persisted it.
 *
 * Requirements: the API on 127.0.0.1:8080 and the web preview on 127.0.0.1:4173
 * (see apps/web/playwright.config.ts, WEB_BASE_URL).
 */

const ARTIFACTS = 'e2e/artifacts';
mkdirSync(ARTIFACTS, { recursive: true });

type PoolSummary = {
  pool: string;
  venue: string;
  token0: { address: string; symbol: string };
  token1: { address: string; symbol: string };
};

type WatchlistEntry = { address: string; symbol?: string };

function isWatched(entries: WatchlistEntry[], address: string): boolean {
  return entries.some((entry) => entry.address.toLowerCase() === address.toLowerCase());
}

test.describe('watchlist click against the real API', () => {
  test('a click adds the token, the server persists it, and a reload restores the pressed state', async ({
    page,
    request,
  }) => {
    const poolsResponse = await request.get('/api/v1/pools');
    expect(poolsResponse.status()).toBe(200);
    const pools = (await poolsResponse.json()) as { data: { pools: PoolSummary[] } };
    const pool = pools.data.pools.find((entry) => entry.venue === 'verified-allowlist') ?? pools.data.pools[0];
    if (pool === undefined) {
      throw new Error('the API must expose at least one pool');
    }
    const address = pool.token0.address;
    const symbol = pool.token0.symbol;

    const before = (await (await request.get('/api/v1/watchlist')).json()) as { data: { entries: WatchlistEntry[] } };
    const startedWatched = isWatched(before.data.entries, address);

    await page.goto(`/discover/pools/${pool.pool}`);
    const button = page.getByTestId(`watch-${address}`);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', String(startedWatched));

    // Click once: the browser must send a real mutation and the pressed state
    // may only move after the server answered.
    const mutation = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/watchlist') &&
        response.request().method() === (startedWatched ? 'DELETE' : 'POST'),
    );
    await button.click();
    const mutationResponse = await mutation;
    expect(mutationResponse.status()).toBeLessThan(300);
    await expect(button).toHaveAttribute('aria-pressed', String(!startedWatched));
    await expect(page.getByTestId('pool-watchlist-message')).toHaveText(
      `${symbol} ${startedWatched ? 'removed from' : 'added to'} watchlist`,
    );
    await page.screenshot({ path: `${ARTIFACTS}/watchlist-after-click.png`, fullPage: true });

    // The server is the source of truth: the entry is really there.
    const after = (await (await request.get('/api/v1/watchlist')).json()) as { data: { entries: WatchlistEntry[] } };
    expect(isWatched(after.data.entries, address)).toBe(!startedWatched);

    // A reload must re-read the persisted list, not a client-side cache.
    await page.reload();
    await expect(page.getByTestId(`watch-${address}`)).toHaveAttribute('aria-pressed', String(!startedWatched));

    // Click again and confirm the removal reaches the server too.
    const removal = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/watchlist') &&
        response.request().method() === (startedWatched ? 'POST' : 'DELETE'),
    );
    await page.getByTestId(`watch-${address}`).click();
    const removalResponse = await removal;
    expect(removalResponse.status()).toBeLessThan(300);
    await expect(page.getByTestId(`watch-${address}`)).toHaveAttribute('aria-pressed', String(startedWatched));

    const restored = (await (await request.get('/api/v1/watchlist')).json()) as { data: { entries: WatchlistEntry[] } };
    expect(isWatched(restored.data.entries, address)).toBe(startedWatched);
  });
});
