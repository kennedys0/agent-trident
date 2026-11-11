import type { Evaluation as ContractEvaluation } from '@trident/api-contract';

export type AssetId = 'WETH' | 'USDG';

export type AssetIdentity = {
  readonly id: AssetId;
  readonly symbol: string;
  readonly address: `0x${string}`;
  readonly decimals: number;
};

export type Venue = {
  readonly id: 'uniswap-v3-robinhood';
  readonly chainId: 4663;
  readonly factory: `0x${string}`;
  readonly quoterV2: `0x${string}`;
  readonly swapRouter02: `0x${string}`;
  readonly provenance: readonly string[];
};

export type PoolIdentity = {
  readonly id: `0x${string}`;
  readonly venueId: Venue['id'];
  readonly token0: AssetIdentity;
  readonly token1: AssetIdentity;
  readonly fee: number;
  readonly tickSpacing: number;
};

/**
 * Engine-side observation. It is deliberately richer than the wire contract:
 * `sqrtPriceX96` and `tick` are provenance evidence and the reason the price can
 * be recomputed, so they stay in storage even though the contract payload does
 * not carry them.
 */
export type PoolSnapshot = {
  readonly id: string;
  readonly poolId: `0x${string}`;
  readonly chainId: 4663;
  readonly blockNumber: number;
  readonly blockHash: `0x${string}`;
  readonly sqrtPriceX96: string;
  readonly tick: number;
  readonly liquidity: string;
  /** Pool token balances in base units, ordered by pool token0/token1. */
  readonly reserve0: string;
  readonly reserve1: string;
  /** USDG per WETH, scaled by `priceScale` decimal places. */
  readonly priceScaled: string;
  readonly priceScale: number;
  readonly source: 'uniswap-v3-pool+quoter';
  readonly status: SnapshotStatus;
  readonly sourceTime: string;
  readonly observedAt: string;
};

/** The action vocabulary is owned by the contract, not re-declared here. */
export type StrategyAction = ContractEvaluation['action'];

export type SnapshotStatus = 'COMPLETE' | 'INCOMPLETE' | 'STALE';

export type StrategyConfig = {
  readonly strategyId: 'weth-usdg-momentum-v1';
  readonly version: number;
  readonly maxAllocationBps: number;
  readonly maxStalenessSeconds: number;
  readonly minPoolLiquidity: string;
  readonly maxPriceImpactBps: number;
  readonly minNotionalUsdg: string;
  readonly takeProfitBps: number;
  readonly stopLossBps: number;
};

export type EvaluationRecord = {
  readonly id: string;
  readonly snapshotId: string;
  readonly strategyId: string;
  readonly configVersion: number;
  readonly inputHash: string;
  readonly action: StrategyAction;
  readonly signalStrength: number;
  readonly proposedAmountIn: string | null;
  readonly invalidation: string;
  readonly reasons: readonly string[];
  readonly createdAt: string;
};

export type RiskRuleStatus = 'PASS' | 'FAIL' | 'UNAVAILABLE';

export type RiskRule = {
  readonly rule: string;
  readonly status: RiskRuleStatus;
  readonly observed: string;
  readonly threshold: string;
};

export type RiskVerdict = 'APPROVED' | 'REJECTED';

/**
 * Engine-side verdict. `rules` is the audit evidence the risk gate produces;
 * the wire contract carries the same facts folded into `reasons`.
 */
export type RiskOutcome = {
  readonly verdict: RiskVerdict;
  readonly policyVersion: string;
  readonly rules: readonly RiskRule[];
  readonly approvedAmountIn: string | null;
  readonly approvedAmountOut: string | null;
};

export type IntentSide = 'BUY' | 'SELL';

/** Engine-side portfolio projection; the wire form is the contract `Portfolio`. */
export type PortfolioState = {
  readonly cashUsdg: string;
  readonly positions: readonly { assetId: AssetId; quantity: string }[];
  readonly realizedPnlUsdg: string;
  readonly unrealizedPnlUsdg: string | null;
  readonly costBasisUsdg: string;
  readonly portfolioVersion: string;
  readonly asOf: string;
};