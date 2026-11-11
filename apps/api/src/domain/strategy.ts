import { createHash } from 'node:crypto';
import type { PoolSnapshot, SnapshotStatus, StrategyAction, StrategyConfig } from './types.js';

export type StrategyInput = {
  readonly snapshot: PoolSnapshot;
  readonly snapshotStatus: SnapshotStatus;
  readonly snapshotAgeSeconds: number;
  readonly config: StrategyConfig;
  readonly cashUsdgBase: string;
  readonly positionWethBase: string;
  /** Average cost basis of the open WETH position in USDG per WETH, scaled by snapshot.priceScale. */
  readonly averageCostScaled: string | null;
};

export type StrategyOutput = {
  readonly action: StrategyAction;
  readonly signalStrength: number;
  readonly proposedAmountIn: string | null;
  readonly invalidation: string;
  readonly reasons: readonly string[];
  readonly inputHash: string;
};

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Pure, deterministic decision function. The same snapshot, config, and
 * portfolio always produce the same action and input hash; nothing is read
 * from the clock, the network, or global state.
 */
export function evaluateStrategy(input: StrategyInput): StrategyOutput {
  const { snapshot, config } = input;
  const price = BigInt(snapshot.priceScaled);
  const cash = BigInt(input.cashUsdgBase);
  const position = BigInt(input.positionWethBase);
  const liquidity = BigInt(snapshot.liquidity);

  const inputHash = canonicalHash({
    snapshotId: snapshot.id,
    pool: snapshot.poolId,
    blockNumber: snapshot.blockNumber,
    blockHash: snapshot.blockHash,
    priceScaled: snapshot.priceScaled,
    priceScale: snapshot.priceScale,
    status: input.snapshotStatus,
    configVersion: config.version,
    maxAllocationBps: config.maxAllocationBps,
    cashUsdgBase: input.cashUsdgBase,
    positionWethBase: input.positionWethBase,
    averageCostScaled: input.averageCostScaled,
  });

  const base = {
    signalStrength: 0,
    proposedAmountIn: null,
    invalidation: `Snapshot older than ${config.maxStalenessSeconds}s, pool mismatch, or price move beyond ${config.maxPriceImpactBps}bps before execution`,
    inputHash,
  } as const;

  if (input.snapshotStatus !== 'COMPLETE') {
    return {
      ...base,
      action: 'AVOID',
      reasons: [
        input.snapshotStatus === 'STALE'
          ? `snapshot_stale: age ${input.snapshotAgeSeconds}s exceeds ${config.maxStalenessSeconds}s`
          : 'snapshot_incomplete: pool liquidity or reserves are zero',
      ],
    };
  }

  if (position > 0n) {
    if (input.averageCostScaled === null) {
      return { ...base, action: 'HOLD', reasons: ['open_position_without_cost_basis: refusing to act'] };
    }
    const cost = BigInt(input.averageCostScaled);
    const pnlBps = cost === 0n ? 0n : ((price - cost) * 10_000n) / cost;
    if (pnlBps >= BigInt(config.takeProfitBps)) {
      return {
        ...base,
        action: 'SELL',
        signalStrength: Math.min(100, Number(pnlBps / 10n)),
        proposedAmountIn: input.positionWethBase,
        reasons: [`take_profit: unrealized ${pnlBps.toString()}bps >= ${config.takeProfitBps}bps`],
      };
    }
    if (pnlBps <= -BigInt(config.stopLossBps)) {
      return {
        ...base,
        action: 'SELL',
        signalStrength: Math.min(100, Number(-pnlBps / 10n)),
        proposedAmountIn: input.positionWethBase,
        reasons: [`stop_loss: unrealized ${pnlBps.toString()}bps <= -${config.stopLossBps}bps`],
      };
    }
    return {
      ...base,
      action: 'HOLD',
      reasons: [`open_position: unrealized ${pnlBps.toString()}bps inside band`],
    };
  }

  if (liquidity < BigInt(config.minPoolLiquidity)) {
    return {
      ...base,
      action: 'WAIT',
      reasons: [`low_liquidity: ${liquidity.toString()} < ${config.minPoolLiquidity}`],
    };
  }

  const minNotional = BigInt(config.minNotionalUsdg);
  if (cash < minNotional) {
    return { ...base, action: 'WAIT', reasons: [`insufficient_cash: ${cash.toString()} < ${minNotional.toString()}`] };
  }

  const allocation = (cash * BigInt(config.maxAllocationBps)) / 10_000n;
  const proposed = allocation < minNotional ? minNotional : allocation;
  if (proposed > cash) {
    return { ...base, action: 'WAIT', reasons: ['insufficient_cash: allocation exceeds available cash'] };
  }
  const liquidityRatio = (liquidity * 100n) / (BigInt(config.minPoolLiquidity) * 4n);
  const strength = liquidityRatio > 100n ? 100 : Number(liquidityRatio);
  return {
    ...base,
    action: 'BUY',
    signalStrength: strength,
    proposedAmountIn: proposed.toString(),
    reasons: [
      `entry: allocation ${config.maxAllocationBps}bps of available cash`,
      `liquidity_ok: ${liquidity.toString()} >= ${config.minPoolLiquidity}`,
    ],
  };
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  strategyId: 'weth-usdg-momentum-v1',
  version: 1,
  maxAllocationBps: 500,
  maxStalenessSeconds: 30,
  minPoolLiquidity: '100000000000000000',
  maxPriceImpactBps: 100,
  minNotionalUsdg: '10000000',
  takeProfitBps: 200,
  stopLossBps: 150,
};