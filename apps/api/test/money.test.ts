import { describe, expect, it } from 'vitest';
import { applyPpm, bpsToPpm, decimalToBaseUnit, formatBaseUnit, parseBaseUnit, toBaseUnitString } from '../src/money.js';

describe('integer base-unit money', () => {
  it('parses and formats base units without floating point', () => {
    expect(parseBaseUnit('10000000000')).toBe(10_000_000_000n);
    expect(toBaseUnitString(10_000_000_000n)).toBe('10000000000');
    expect(formatBaseUnit('2060327316', 6)).toBe('2060.327316');
    expect(decimalToBaseUnit('10000', 6)).toBe('10000000000');
    expect(decimalToBaseUnit('0.000001', 6)).toBe('1');
  });

  it('rejects negative, decimal, and padded inputs', () => {
    expect(() => parseBaseUnit('-1')).toThrow();
    expect(() => parseBaseUnit('1.5')).toThrow();
    expect(() => parseBaseUnit('007')).toThrow();
    expect(() => toBaseUnitString(-1n)).toThrow();
  });

  it('converts basis points and applies ppm rates with integer math', () => {
    expect(bpsToPpm(500)).toBe(50_000n);
    expect(applyPpm(10_000_000_000n, 50_000n)).toBe(500_000_000n);
  });
});