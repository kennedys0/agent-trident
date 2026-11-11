import { describe, expect, it } from 'vitest';
import { formatAge, formatDecimalString, formatMoney, formatScaled, formatStrength, shortAddress } from '../src/lib/format.js';

describe('formatDecimalString', () => {
  it('groups thousands and keeps the requested fraction digits', () => {
    expect(formatDecimalString('9499950000', 6, { maxFrac: 2 })).toBe('9,499.95');
  });

  it('never rounds up: extra digits are truncated', () => {
    expect(formatDecimalString('9999897923', 6, { maxFrac: 2 })).toBe('9,999.89');
  });

  it('renders small amounts without inventing zeroes beyond the value', () => {
    expect(formatDecimalString('1', 6, { maxFrac: 6, minFrac: 2 })).toBe('0.000001');
    expect(formatDecimalString('1000000', 6, { maxFrac: 2 })).toBe('1.00');
  });

  it('marks negative values and prefixes positives only when asked', () => {
    expect(formatDecimalString('-102077', 6, { maxFrac: 2, signed: true })).toBe('−0.10');
    expect(formatDecimalString('500050000', 6, { maxFrac: 2, signed: true })).toBe('+500.05');
  });

  it('does not sign a zero value', () => {
    expect(formatDecimalString('0', 6, { maxFrac: 2, signed: true })).toBe('0.00');
  });

  it('refuses non-integer input instead of parsing it as a float', () => {
    expect(formatDecimalString('1.5', 6)).toBe('Unavailable');
    expect(formatDecimalString('abc', 6)).toBe('Unavailable');
  });
});

describe('formatMoney and formatScaled', () => {
  it('uses the explicit decimals from the contract', () => {
    expect(formatMoney({ value: '243530914141316398', decimals: 18 }, { maxFrac: 6, minFrac: 4 })).toBe('0.243530');
  });

  it('converts a scaled price using its scale string', () => {
    expect(formatScaled({ value: '2066130000000000000000', scale: '18' })).toBe('2,066.13');
  });

  it('reports an unusable scale as Unavailable', () => {
    expect(formatScaled({ value: '1', scale: 'eighteen' })).toBe('Unavailable');
  });
});

describe('misc formatters', () => {
  it('derives a percentage from the 0..10000 strength integer', () => {
    expect(formatStrength(6250)).toBe('62.5%');
    expect(formatStrength(10_001)).toBe('Unavailable');
  });

  it('shortens addresses without losing both ends', () => {
    expect(shortAddress('0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca')).toBe('0x52e6…71ca');
  });

  it('describes ages in readable units', () => {
    expect(formatAge(12)).toBe('12s ago');
    expect(formatAge(90)).toBe('1m ago');
    expect(formatAge(7200)).toBe('2h ago');
    expect(formatAge(null)).toBe('unknown age');
  });
});