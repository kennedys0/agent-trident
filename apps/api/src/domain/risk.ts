import { priceImpactBps } from './price.js';
import type {
  IntentSide,
  PoolSnapshot,
  RiskEvidenceValue,
  RiskOutcome,
  RiskRule,
  SnapshotStatus,
  StrategyConfig,
} from './types.js';

export const RISK_POLICY_VERSION = 'paper-risk-v1';
/** The public RPC only serves state about this many blocks behind the head. */
export const MAX_BLOCK_AGE = 5_000;

export type RiskInput = {
  readonly side: IntentSide;
  readonly mode: 'OBSERVE' | 'PAPER';
  readonly amountIn: string;
  /** Intent value expressed in USDG base units, so BUY and SELL are comparable. */
  readonly notionalQuote: string;
  /** Quote-currency fee the fill will charge, so the cash rule covers the real spend. */
  readonly feeQuoteBase: string;
  readonly evaluatedAt: string;
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

/**
 * Rule evidence. `reason` is mandatory for FAIL and UNAVAILABLE because the wire
 * contract refuses an unexplained non-passing rule; a PASS may explain itself.
 */
function rule(
  name: string,
  status: RiskRule['status'],
  observed: RiskEvidenceValue,
  threshold: RiskEvidenceValue,
  reason?: string,
): RiskRule {
  return { rule: name, status, observed, threshold, ...(reason === undefined ? {} : { reason }) };
}

/**
 * Fail-closed risk gate. It is the only approver: any FAIL or UNAVAILABLE rule
 * rejects the intent, so missing or stale evidence can never reach execution.
 * Every rule keeps the observed value next to the threshold so the decision can
 * be re-read without trusting a summary sentence.
 */
export function evaluateRisk(input: RiskInput): RiskOutcome {
  const rules: RiskRule[] = [];

  rules.push(
    rule(
      'R01_mode_paper_only',
      input.mode === 'PAPER' ? 'PASS' : 'FAIL',
      input.mode,
      'PAPER',
      'Execution mode must be PAPER to approve a paper trade',
    ),
  );
  rules.push(
    rule(
      'R02_kill_switch',
      input.killSwitchEngaged ? 'FAIL' : 'PASS',
      input.killSwitchEngaged,
      false,
      'Kill switch is engaged; new entries are blocked',
    ),
  );

  if (input.snapshot === null) {
    rules.push(rule('R03_snapshot_present', 'UNAVAILABLE', null, 'COMPLETE', 'No market snapshot exists for this intent'));
  } else {
    rules.push(
      rule(
        'R03_snapshot_complete',
        input.snapshotStatus === 'COMPLETE' ? 'PASS' : 'FAIL',
        input.snapshotStatus,
        'COMPLETE',
        'Snapshot is not COMPLETE',
      ),
    );
    rules.push(
      rule(
        'R04_snapshot_fresh',
        input.snapshotStatus === 'STALE' ? 'FAIL' : 'PASS',
        input.snapshotAgeSeconds,
        input.config.maxStalenessSeconds,
        'Snapshot is older than the freshness window',
      ),
    );
    rules.push(
      rule(
        'R05_chain_identity',
        input.snapshot.chainId === 4663 ? 'PASS' : 'FAIL',
        input.snapshot.chainId,
        4663,
        'Snapshot chain id does not match the verified Robinhood Chain id',
      ),
    );
  }

  rules.push(
    rule(
      'R06_pool_allowlisted',
      input.poolMatchesAllowlist ? 'PASS' : 'FAIL',
      input.poolMatchesAllowlist,
      true,
      'Snapshot pool is not the verified allowlisted pool',
    ),
  );
  rules.push(
    rule(
      'R07_quote_pinned_to_snapshot',
      input.snapshot === null || input.quoteBlockNumber === null
        ? 'UNAVAILABLE'
        : input.quoteBlockNumber === input.snapshot.blockNumber
          ? 'PASS'
          : 'FAIL',
      input.quoteBlockNumber,
      input.snapshot === null ? null : input.snapshot.blockNumber,
      'Quote block does not match the snapshot block',
    ),
  );

  const amountOut = input.quoteAmountOut === null ? 0n : BigInt(input.quoteAmountOut);
  rules.push(rule('R08_quote_positive', amountOut > 0n ? 'PASS' : 'UNAVAILABLE', amountOut.toString(), '> 0', 'Quoter returned no output amount'));

  const impact =
    input.snapshot !== null && input.executionPriceScaled !== null
      ? priceImpactBps(BigInt(input.snapshot.priceScaled), BigInt(input.executionPriceScaled))
      : null;
  rules.push(
    rule(
      'R09_price_impact',
      impact === null ? 'UNAVAILABLE' : impact <= input.config.maxPriceImpactBps ? 'PASS' : 'FAIL',
      impact,
      input.config.maxPriceImpactBps,
      'Execution price impact exceeds the configured cap',
    ),
  );

  const amountIn = BigInt(input.amountIn);
  const fee = BigInt(input.feeQuoteBase);
  const notional = BigInt(input.notionalQuote);
  rules.push(
    rule(
      'R10_min_notional',
      notional >= BigInt(input.config.minNotionalUsdg) ? 'PASS' : 'FAIL',
      notional.toString(),
      input.config.minNotionalUsdg,
      'Notional is below the configured minimum',
    ),
  );

  const cashRequired = amountIn + fee;
  rules.push(
    rule(
      'R11_cash_available',
      input.side === 'SELL' ? 'PASS' : BigInt(input.cashUsdgBase) >= cashRequired ? 'PASS' : 'FAIL',
      input.side === 'SELL' ? null : input.cashUsdgBase,
      input.side === 'SELL' ? null : cashRequired.toString(),
      'Cash balance does not cover the approved spend plus fee',
    ),
  );

  const maxAllocation = (BigInt(input.equityUsdgBase) * BigInt(input.config.maxAllocationBps)) / 10_000n;
  rules.push(
    rule(
      'R12_allocation_cap',
      input.equityUsdgBase === '0' ? 'UNAVAILABLE' : notional <= maxAllocation ? 'PASS' : 'FAIL',
      notional.toString(),
      maxAllocation.toString(),
      `Notional exceeds ${input.config.maxAllocationBps} bps of equity`,
    ),
  );

  rules.push(
    rule(
      'R15_position_sufficient',
      input.side === 'SELL' ? (amountIn <= BigInt(input.positionWethBase) ? 'PASS' : 'FAIL') : 'PASS',
      input.side === 'SELL' ? amountIn.toString() : null,
      input.side === 'SELL' ? input.positionWethBase : null,
      'Requested sell quantity exceeds the open position',
    ),
  );

  rules.push(
    rule(
      'R13_single_position',
      input.side === 'BUY' && input.openPositionCount >= 1 ? 'FAIL' : 'PASS',
      input.openPositionCount,
      0,
      'A position is already open for this market',
    ),
  );
  rules.push(
    rule(
      'R14_block_window',
      input.snapshot === null || input.headBlockNumber === null
        ? 'UNAVAILABLE'
        : input.headBlockNumber - input.snapshot.blockNumber <= MAX_BLOCK_AGE
          ? 'PASS'
          : 'FAIL',
      input.snapshot === null || input.headBlockNumber === null
        ? null
        : input.headBlockNumber - input.snapshot.blockNumber,
      MAX_BLOCK_AGE,
      'Snapshot block is outside the public RPC state window',
    ),
  );

  const approved = rules.every((r) => r.status === 'PASS');
  return {
    verdict: approved ? 'APPROVED' : 'REJECTED',
    policyVersion: RISK_POLICY_VERSION,
    rules,
    approvedBaseQty: approved ? (input.side === 'BUY' ? amountOut.toString() : amountIn.toString()) : null,
    approvedQuoteAmount: approved
      ? (input.side === 'BUY' ? cashRequired.toString() : (amountOut - fee).toString())
      : null,
    evaluatedAt: input.evaluatedAt,
  };
}