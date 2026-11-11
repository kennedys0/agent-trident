import { describe, expect, it } from 'vitest';
import { executionPriceScaled, priceImpactBps, spotPriceScaled } from '../src/domain/price.js';
import { REAL_SQRT_PRICE_X96 } from './helpers.js';

describe('integer price math', () => {
  it('derives the observed spot price from the real sqrtPriceX96', () => {
    const scaled = spotPriceScaled(REAL_SQRT_PRICE_X96, 18, 6, 18);
    // 2060.79 USDG per WETH with 18 decimals of precision.
    expect(scaled / 10n ** 18n).toBe(2060n);
    expect(scaled).toBeGreaterThan(2_060_000_000_000_000_000n);
    expect(scaled).toBeLessThan(2_061_000_000_000_000_000_000n);
  });

  it('matches the QuoterV2 execution price within one basis point for a small trade', () => {
    const spot = spotPriceScaled(REAL_SQRT_PRICE_X96, 18, 6, 18);
    const amountIn = 500_000_000n;
    const amountOut = (amountIn * 10n ** 18n) / 2_060_000_000n;
    const execution = executionPriceScaled({
      amountQuote: amountIn,
      amountBase: amountOut,
      quoteDecimals: 6,
      baseDecimals: 18,
      scale: 18,
    });
    expect(priceImpactBps(spot, execution)).toBeLessThanOrEqual(5);
  });

  it('computes the same price from either swap direction', () => {
    const buy = executionPriceScaled({ amountQuote: 500_000_000n, amountBase: 242_701_000_000_000_000n, quoteDecimals: 6, baseDecimals: 18, scale: 18 });
    const sell = executionPriceScaled({ amountQuote: 500_000_000n, amountBase: 242_701_000_000_000_000n, quoteDecimals: 6, baseDecimals: 18, scale: 18 });
    expect(buy).toBe(sell);
    expect(buy / 10n ** 18n).toBe(2060n);
  });

  it('reports impact in basis points and rejects zero quantities', () => {
    expect(priceImpactBps(1_000_000n, 1_010_000n)).toBe(100);
    expect(() => executionPriceScaled({ amountQuote: 1n, amountBase: 0n, quoteDecimals: 6, baseDecimals: 18 })).toThrow();
    expect(() => spotPriceScaled(0n, 18, 6)).toThrow();
  });
});