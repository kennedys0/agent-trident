import { priceImpactBps } from './price.js';
import type { IntentSide, PoolSnapshot, RiskOutcome, RiskRule, SnapshotStatus, StrategyConfig } from './types.js';

export const RISK_POLICY_VERSION = 'paper-risk-v1';
/** The public RPC only serves state about this many blocks behind the head. */
export const MAX_BLOCK_AGE = 5_000;

export type RiskInput = {
  readonly side: IntentSide;
  readonly mode: 'OBSERVE' | 'PAPER';
  readonly amountIn: string;
  /** Intent value expressed in USDG base units, so BUY and SELL are comparable. */
  readonly notionalQuote: string;
  readonly snapshot: PoolSnapshot | null;
  readonly snapshotStatus: SnapshotStatus | 'UNAVAILABLE';
  readonly snapshotAgeSeconds: number | null;
  readonly quoteBlockNumber: number | null;
  readonly quoteAmountOut: string | null;
  readonly executionPriceScaled: string | null;
  readonly headBlockNumber: number | null;
  readonly cashUsdgBase: string;
  readonly positionWethBase: string;
  readonly equityUsdgBase: string;
  readonly openPositionCount: number;
  readonly killSwitchEngaged: boolean;
  readonly config: StrategyConfig;
  readonly poolMatchesAllowlist: boolean;
};

function rule(name: string, status: RiskRule['status'], observed: string, threshold: string): RiskRule {
  return { rule: name, status, observed, threshold };
}

/**
 * Fail-closed risk gate. It is the only approver: any FAIL or UNAVAILABLE rule
 * rejects the intent, so missing or stale evidence can never reach execution.
 */
export function evaluateRisk(input: RiskInput): RiskOutcome {
  const rules: RiskRule[] = [];

  rules.push(rule('R01_mode_paper_only', input.mode === 'PAPER' ? 'PASS' : 'FAIL', input.mode, 'PAPER'));
  rules.push(rule('R02_kill_switch', input.killSwitchEngaged ? 'FAIL' : 'PASS', String(input.killSwitchEngaged), 'false'));

  if (input.snapshot === null) {
    rules.push(rule('R03_snapshot_present', 'UNAVAILABLE', 'missing', 'COMPLETE'));
  } else {
    rules.push(rule('R03_snapshot_complete', input.snapshotStatus === 'COMPLETE' ? 'PASS' : 'FAIL', input.snapshotStatus, 'COMPLETE'));
    rules.push(rule('R04_snapshot_fresh', input.snapshotStatus === 'STALE' ? 'FAIL' : 'PASS', `${input.snapshotAgeSeconds ?? -1}s`, `<= ${input.config.maxStalenessSeconds}s`));
    rules.push(rule('R05_chain_identity', input.snapshot.chainId === 4663 ? 'PASS' : 'FAIL', String(input.snapshot.chainId), '4663'));
  }

  rules.push(rule('R06_pool_allowlisted', input.poolMatchesAllowlist ? 'PASS' : 'FAIL', String(input.poolMatchesAllowlist), 'true'));
  rules.push(
    rule(
      'R07_quote_pinned_to_snapshot',
      input.snapshot === null || input.quoteBlockNumber === null
        ? 'UNAVAILABLE'
        : input.quoteBlockNumber === input.snapshot.blockNumber
          ? 'PASS'
          : 'FAIL',
      input.quoteBlockNumber === null ? 'missing' : String(input.quoteBlockNumber),
      input.snapshot === null ? String(input.quoteBlockNumber) : String(input.snapshot.blockNumber),
    ),
  );

  const amountOut = input.quoteAmountOut === null ? 0n : BigInt(input.quoteAmountOut);
  rules.push(rule('R08_quote_positive', amountOut > 0n ? 'PASS' : 'UNAVAILABLE', amountOut.toString(), '> 0'));

  const impact =
    input.snapshot !== null && input.executionPriceScaled !== null
      ? priceImpactBps(BigInt(input.snapshot.priceScaled), BigInt(input.executionPriceScaled))
      : null;
  rules.push(
    rule(
      'R09_price_impact',
      impact === null ? 'UNAVAILABLE' : impact <= input.config.maxPriceImpactBps ? 'PASS' : 'FAIL',
      impact === null ? 'missing' : `${impact} bps`,
      `<= ${input.config.maxPriceImpactBps} bps`,
    ),
  );

  const amountIn = BigInt(input.amountIn);
  const notional = BigInt(input.notionalQuote);
  rules.push(rule('R10_min_notional', notional >= BigInt(input.config.minNotionalUsdg) ? 'PASS' : 'FAIL', notional.toString(), `>= ${input.config.minNotionalUsdg}`));
  rules.push(
    rule(
      'R11_cash_available',
      input.side === 'SELL' ? 'PASS' : BigInt(input.cashUsdgBase) >= amountIn ? 'PASS' : 'FAIL',
      input.side === 'SELL' ? 'not_applicable' : input.cashUsdgBase,
      input.side === 'SELL' ? 'not_applicable' : `>= ${amountIn.toString()}`,
    ),
  );

  const maxAllocation = (BigInt(input.equityUsdgBase) * BigInt(input.config.maxAllocationBps)) / 10_000n;
  rules.push(
    rule(
      'R12_allocation_cap',
      input.equityUsdgBase === '0' ? 'UNAVAILABLE' : notional <= maxAllocation ? 'PASS' : 'FAIL',
      notional.toString(),
      `<= ${maxAllocation.toString()} (${input.config.maxAllocationBps} bps of equity)`,
    ),
  );

  rules.push(
    rule(
      'R15_position_sufficient',
      input.side === 'SELL' ? (amountIn <= BigInt(input.positionWethBase) ? 'PASS' : 'FAIL') : 'PASS',
      input.side === 'SELL' ? amountIn.toString() : 'not_applicable',
      input.side === 'SELL' ? `<= ${input.positionWethBase}` : 'not_applicable',
    ),
  );

  rules.push(rule('R13_single_position', input.side === 'BUY' && input.openPositionCount >= 1 ? 'FAIL' : 'PASS', String(input.openPositionCount), '0 open positions for BUY'));
  rules.push(
    rule(
      'R14_block_window',
      input.snapshot === null || input.headBlockNumber === null
        ? 'UNAVAILABLE'
        : input.headBlockNumber - input.snapshot.blockNumber <= MAX_BLOCK_AGE
          ? 'PASS'
          : 'FAIL',
      input.snapshot === null || input.headBlockNumber === null
        ? 'missing'
        : `${input.headBlockNumber - input.snapshot.blockNumber} blocks`,
      `<= ${MAX_BLOCK_AGE} blocks`,
    ),
  );

  const approved = rules.every((r) => r.status === 'PASS');
  return {
    verdict: approved ? 'APPROVED' : 'REJECTED',
    policyVersion: RISK_POLICY_VERSION,
    rules,
    approvedAmountIn: approved ? input.amountIn : null,
    approvedAmountOut: approved ? input.quoteAmountOut : null,
  };
}