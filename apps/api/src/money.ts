/**
 * Settlement amounts are integer base-unit strings. Nothing in the trading path
 * may use JavaScript numbers or floating point for value arithmetic.
 */
const BASE_UNIT = /^(0|[1-9]\d*)$/;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function parseBaseUnit(value: string, field = 'amount'): bigint {
  if (!BASE_UNIT.test(value)) {
    throw new MoneyError(`${field} must be a non-negative integer base-unit string`);
  }
  return BigInt(value);
}

export function toBaseUnitString(value: bigint): string {
  if (value < 0n) throw new MoneyError('base-unit amount cannot be negative');
  return value.toString();
}

/** Multiplies by a parts-per-million rate without leaving integer arithmetic. */
export function applyPpm(amount: bigint, ppm: bigint): bigint {
  if (ppm < 0n) throw new MoneyError('ppm rate cannot be negative');
  return (amount * ppm) / 1_000_000n;
}

export function bpsToPpm(bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) throw new MoneyError('bps must be a non-negative integer');
  return BigInt(bps) * 100n;
}

export function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Scale-aware formatting for display only; never used for settlement. */
export function formatBaseUnit(value: string, decimals: number, displayDecimals = 6): string {
  const raw = parseBaseUnit(value).toString().padStart(decimals + 1, '0');
  const whole = raw.slice(0, raw.length - decimals);
  const fraction = raw.slice(raw.length - decimals).slice(0, displayDecimals).replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

export function decimalToBaseUnit(value: string, decimals: number): string {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new MoneyError('value must be a positive decimal string');
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) throw new MoneyError(`value has more than ${decimals} decimal places`);
  return toBaseUnitString(BigInt(whole + fraction.padEnd(decimals, '0')));
}