import { describe, expect, it } from 'vitest';
import { DEFAULT_STRATEGY_CONFIG, evaluateStrategy } from '../src/domain/strategy.js';
import { makeSnapshot } from './helpers.js';

const baseInput = {
  config: DEFAULT_STRATEGY_CONFIG,
  cashUsdgBase: '10000000000',
  positionWethBase: '0',
  averageCostScaled: null,
};

describe('deterministic strategy', () => {
  it('returns the same action and input hash for identical inputs', () => {
    const snapshot = makeSnapshot();
    const a = evaluateStrategy({ ...baseInput, snapshot, snapshotStatus: 'COMPLETE', snapshotAgeSeconds: 1 });
    const b = evaluateStrategy({ ...baseInput, snapshot, snapshotStatus: 'COMPLETE', snapshotAgeSeconds: 1 });
    expect(a.action).toBe('BUY');
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.proposedAmountIn).toBe('500000000');
  });

  it('changes the hash when the portfolio changes', () => {
    const snapshot = makeSnapshot();
    const a = evaluateStrategy({ ...baseInput, snapshot, snapshotStatus: 'COMPLETE', snapshotAgeSeconds: 1 });
    const b = evaluateStrategy({
      ...baseInput,
      snapshot,
      snapshotStatus: 'COMPLETE',
      snapshotAgeSeconds: 1,
      cashUsdgBase: '9000000000',
    });
    expect(a.inputHash).not.toBe(b.inputHash);
  });

  it('never proposes BUY from a stale or incomplete snapshot', () => {
    const snapshot = makeSnapshot();
    expect(evaluateStrategy({ ...baseInput, snapshot, snapshotStatus: 'STALE', snapshotAgeSeconds: 45 }).action).toBe('AVOID');
    expect(evaluateStrategy({ ...baseInput, snapshot, snapshotStatus: 'INCOMPLETE', snapshotAgeSeconds: 1 }).action).toBe('AVOID');
  });

  it('holds an open position inside the band and sells at take profit', () => {
    const snapshot = makeSnapshot();
    const held = evaluateStrategy({
      ...baseInput,
      snapshot,
      snapshotStatus: 'COMPLETE',
      snapshotAgeSeconds: 1,
      positionWethBase: '242701000000000000',
      averageCostScaled: snapshot.priceScaled,
    });
    expect(held.action).toBe('HOLD');

    const profitable = evaluateStrategy({
      ...baseInput,
      snapshot,
      snapshotStatus: 'COMPLETE',
      snapshotAgeSeconds: 1,
      positionWethBase: '242701000000000000',
      averageCostScaled: ((BigInt(snapshot.priceScaled) * 9n) / 10n).toString(),
    });
    expect(profitable.action).toBe('SELL');
  });

  it('waits when liquidity or cash is insufficient', () => {
    const thin = makeSnapshot({ liquidity: 1n });
    expect(evaluateStrategy({ ...baseInput, snapshot: thin, snapshotStatus: 'COMPLETE', snapshotAgeSeconds: 1 }).action).toBe('WAIT');
    expect(
      evaluateStrategy({ ...baseInput, cashUsdgBase: '1', snapshot: makeSnapshot(), snapshotStatus: 'COMPLETE', snapshotAgeSeconds: 1 }).action,
    ).toBe('WAIT');
  });
});