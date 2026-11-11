/** Formatting helpers. All money is an integer base-unit string plus explicit decimals; no floats. */

export type Money = { readonly value: string; readonly decimals: number };

export type FormatMoneyOptions = {
  /** Minimum fraction digits to keep visible. */
  readonly minFrac?: number;
  /** Maximum fraction digits before the remainder is truncated (never rounded up silently). */
  readonly maxFrac?: number;
  /** Prefix positive values with `+` (used for PnL). */
  readonly signed?: boolean;
};

function group(integerPart: string): string {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Renders an integer decimal string as a grouped decimal string.
 * Truncates (never rounds) beyond `maxFrac`, so a value is never overstated.
 */
export function formatDecimalString(raw: string, decimals: number, options: FormatMoneyOptions = {}): string {
  const minFrac = options.minFrac ?? 2;
  const maxFrac = Math.max(minFrac, options.maxFrac ?? Math.max(minFrac, Math.min(decimals, 6)));
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(digits)) {
    return 'Unavailable';
  }

  const padded = digits.padStart(decimals + 1, '0');
  const cut = padded.length - decimals;
  const integerPart = padded.slice(0, cut);
  const fractionRaw = padded.slice(cut);
  let fraction = fractionRaw.slice(0, maxFrac);
  while (fraction.length < minFrac) {
    fraction = `${fraction}0`;
  }

  const isZero = /^0*$/.test(padded);
  const sign = isZero ? '' : negative ? '−' : options.signed ? '+' : '';
  const body = `${group(integerPart)}${fraction.length > 0 ? `.${fraction}` : ''}`;
  return `${sign}${body}`;
}

export function formatMoney(amount: Money, options: FormatMoneyOptions = {}): string {
  return formatDecimalString(amount.value, amount.decimals, options);
}

/** Price-like scaled integer: `value` divided by 10^`scale`, where scale is a digit string. */
export function formatScaled(scaled: { readonly value: string; readonly scale: string }, options: FormatMoneyOptions = {}): string {
  const decimals = Number.parseInt(scaled.scale, 10);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    return 'Unavailable';
  }
  return formatDecimalString(scaled.value, decimals, { minFrac: 2, maxFrac: 2, ...options });
}

/** Strategy strength is a 0..10_000 integer; shown as a percentage with one decimal. */
export function formatStrength(strength: number): string {
  if (!Number.isInteger(strength) || strength < 0 || strength > 10_000) {
    return 'Unavailable';
  }
  return `${(strength / 100).toFixed(1)}%`;
}

export function shortAddress(address: string): string {
  if (address.length <= 14) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Unavailable';
  }
  return `${date.toISOString().slice(0, 19).replace('T', ' ')}Z`;
}

export function ageSeconds(iso: string, now: number): number | null {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) {
    return null;
  }
  return Math.max(0, Math.floor((now - time) / 1000));
}

export function formatAge(seconds: number | null): string {
  if (seconds === null) {
    return 'unknown age';
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/** Copy-to-clipboard label that admits when the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}