/**
 * Integer-only price math for a Uniswap v3 pool. A price is always quote asset
 * per base asset, scaled by PRICE_SCALE decimal places. No floating point.
 */
export const PRICE_SCALE = 18;
const Q192 = 2n ** 192n;

export class PriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceError';
  }
}

/**
 * Spot price from sqrtPriceX96: (sqrtP / 2^96)^2 * 10^(baseDecimals - quoteDecimals + scale).
 * The caller decides which pool token is the base asset.
 */
export function spotPriceScaled(
  sqrtPriceX96: bigint,
  baseDecimals: number,
  quoteDecimals: number,
  scale = PRICE_SCALE,
): bigint {
  if (sqrtPriceX96 <= 0n) throw new PriceError('sqrtPriceX96 must be positive');
  const exponent = baseDecimals - quoteDecimals + scale;
  if (exponent < 0) throw new PriceError('unsupported decimal configuration');
  return (sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(exponent)) / Q192;
}

/**
 * Execution price from an exact-input swap, expressed as quote per base with the
 * same scale as `spotPriceScaled`. For a BUY the quote amount is the input; for
 * a SELL the quote amount is the output.
 */
export function executionPriceScaled(input: {
  readonly amountQuote: bigint;
  readonly amountBase: bigint;
  readonly quoteDecimals: number;
  readonly baseDecimals: number;
  readonly scale?: number;
}): bigint {
  if (input.amountBase <= 0n) throw new PriceError('base amount must be positive');
  const scale = input.scale ?? PRICE_SCALE;
  const exponent = input.baseDecimals - input.quoteDecimals + scale;
  if (exponent < 0) throw new PriceError('unsupported decimal configuration');
  return (input.amountQuote * 10n ** BigInt(exponent)) / input.amountBase;
}

/** Absolute deviation of execution price from spot, in basis points. */
export function priceImpactBps(spotScaled: bigint, executionScaled: bigint): number {
  if (spotScaled <= 0n) throw new PriceError('spot price must be positive');
  const delta = executionScaled > spotScaled ? executionScaled - spotScaled : spotScaled - executionScaled;
  const bps = (delta * 10_000n) / spotScaled;
  return Number(bps);
}
/** Divisor converting base quantity x scaled price into quote base units. */
export function quoteDivisor(baseDecimals: number, quoteDecimals: number, scale = PRICE_SCALE): bigint {
  const exponent = baseDecimals - quoteDecimals + scale;
  if (exponent < 0) throw new PriceError('unsupported decimal configuration');
  return 10n ** BigInt(exponent);
}

/** Converts a base-asset quantity into quote base units at a scaled price. */
export function quoteValueOf(
  quantityBase: bigint,
  priceScaled: bigint,
  baseDecimals: number,
  quoteDecimals: number,
  scale = PRICE_SCALE,
): bigint {
  return (quantityBase * priceScaled) / quoteDivisor(baseDecimals, quoteDecimals, scale);
}

/** Average cost in quote-per-base scaled units from a total cost in quote base units. */
export function averageCostScaled(
  costQuoteBase: bigint,
  quantityBase: bigint,
  baseDecimals: number,
  quoteDecimals: number,
  scale = PRICE_SCALE,
): bigint {
  if (quantityBase <= 0n) throw new PriceError('quantity must be positive');
  return (costQuoteBase * quoteDivisor(baseDecimals, quoteDecimals, scale)) / quantityBase;
}

/** Inverse of `quoteValueOf`: the base-asset quantity a quote amount buys. */
export function quoteToBaseQty(
  amountQuote: bigint,
  priceScaled: bigint,
  baseDecimals: number,
  quoteDecimals: number,
  scale = PRICE_SCALE,
): bigint {
  if (priceScaled <= 0n) throw new PriceError('price must be positive');
  return (amountQuote * quoteDivisor(baseDecimals, quoteDecimals, scale)) / priceScaled;
}

/**
 * Inverse spot price (token0 per token1) from sqrtPriceX96. Kept separate from
 * `spotPriceScaled` so both directions stay integer-only; a round trip through
 * both bounds loses at most a unit of scale.
 */
export function inverseSpotPriceScaled(
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number,
  scale = PRICE_SCALE,
): bigint {
  if (sqrtPriceX96 <= 0n) throw new PriceError('sqrtPriceX96 must be positive');
  const exponent = token1Decimals - token0Decimals + scale;
  if (exponent < 0) throw new PriceError('unsupported decimal configuration');
  return (Q192 * 10n ** BigInt(exponent)) / (sqrtPriceX96 * sqrtPriceX96);
}
