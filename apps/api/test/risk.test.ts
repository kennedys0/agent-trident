import { describe, expect, it } from 'vitest';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';
import { evaluateRisk, type RiskInput } from '../src/domain/risk.js';
import { makeSnapshot } from './helpers.js';

function approvedInput(overrides: Partial<RiskInput> = {}): RiskInput {
  const snapshot = makeSnapshot();
  return {
    side: 'BUY',
    mode: 'PAPER',
    amountIn: '500000000',
    notionalQuote: '500000000',
    snapshot,
    snapshotStatus: 'COMPLETE',
    snapshotAgeSeconds: 2,
    quoteBlockNumber: snapshot.blockNumber,
    quoteAmountOut: '242701000000000000',
    executionPriceScaled: snapshot.priceScaled,
    headBlockNumber: snapshot.blockNumber + 5,
    cashUsdgBase: '10000000000',
    positionWethBase: '0',
    equityUsdgBase: '10000000000',
    openPositionCount: 0,
    killSwitchEngaged: false,
    config: DEFAULT_STRATEGY_CONFIG,
    poolMatchesAllowlist: true,
    ...overrides,
  };
}

describe('fail-closed risk gate', () => {
  it('approves a complete, fresh, in-limit intent', () => {
    const decision = evaluateRisk(approvedInput());
    expect(decision.verdict).toBe('APPROVED');
    expect(decision.rules.every((rule) => rule.status === 'PASS')).toBe(true);
  });

  it('rejects a stale snapshot and reports the failing rule', () => {
    const decision = evaluateRisk(approvedInput({ snapshotStatus: 'STALE', snapshotAgeSeconds: 60 }));
    expect(decision.verdict).toBe('REJECTED');
    expect(decision.rules.find((rule) => rule.rule === 'R04_snapshot_fresh')?.status).toBe('FAIL');
    expect(decision.approvedAmountIn).toBeNull();
  });

  it('rejects when the snapshot is missing entirely', () => {
    const decision = evaluateRisk(
      approvedInput({ snapshot: null, snapshotStatus: 'UNAVAILABLE', snapshotAgeSeconds: null, quoteBlockNumber: null, quoteAmountOut: null, executionPriceScaled: null }),
    );
    expect(decision.verdict).toBe('REJECTED');
    expect(decision.rules.find((rule) => rule.rule === 'R03_snapshot_present')?.status).toBe('UNAVAILABLE');
  });

  it('rejects a quote that is not pinned to the snapshot block', () => {
    const decision = evaluateRisk(approvedInput({ quoteBlockNumber: 1 }));
    expect(decision.verdict).toBe('REJECTED');
    expect(decision.rules.find((rule) => rule.rule === 'R07_quote_pinned_to_snapshot')?.status).toBe('FAIL');
  });

  it('rejects an engaged kill switch, a second position, and over-allocation', () => {
    expect(evaluateRisk(approvedInput({ killSwitchEngaged: true })).verdict).toBe('REJECTED');
    expect(evaluateRisk(approvedInput({ openPositionCount: 1 })).verdict).toBe('REJECTED');
    expect(evaluateRisk(approvedInput({ amountIn: '1000000000', notionalQuote: '1000000000' })).verdict).toBe('REJECTED');
  });

  it('rejects data older than the non-archive block window', () => {
    const decision = evaluateRisk(approvedInput({ headBlockNumber: 111_408_300 + 5_001 }));
    expect(decision.verdict).toBe('REJECTED');
  });

  it('rejects a pool outside the allowlist', () => {
    expect(evaluateRisk(approvedInput({ poolMatchesAllowlist: false })).verdict).toBe('REJECTED');
  });
});