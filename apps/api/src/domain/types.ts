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
  readonly provenance: string;
};

export type PoolIdentity = {
  readonly id: `0x${string}`;
  readonly venueId: Venue['id'];
  readonly token0: AssetIdentity;
  readonly token1: AssetIdentity;
  readonly fee: number;
  readonly tickSpacing: number;
};

export type SnapshotStatus = 'COMPLETE' | 'INCOMPLETE' | 'STALE';

export type MarketSnapshot = {
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

export type StrategyAction = 'BUY' | 'SELL' | 'HOLD' | 'WAIT' | 'AVOID';

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

export type Evaluation = {
  readonly id: string;
  readonly snapshotId: string;
  readonly strategyId: StrategyConfig['strategyId'];
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

export type RiskDecision = {
  readonly verdict: RiskVerdict;
  readonly policyVersion: string;
  readonly rules: readonly RiskRule[];
  readonly approvedAmountIn: string | null;
  readonly approvedAmountOut: string | null;
};

export type PortfolioView = {
  readonly cashUsdg: string;
  readonly positions: readonly { assetId: AssetId; quantity: string }[];
  readonly realizedPnlUsdg: string;
  readonly unrealizedPnlUsdg: string | null;
  readonly portfolioVersion: string;
  readonly asOf: string;
};

export type IntentSide = 'BUY' | 'SELL';