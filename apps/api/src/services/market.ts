import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { appendAudit, getPortfolio, getPosition, insertEvaluation, insertSnapshot } from '../db/repositories.js';
import { buildSnapshot } from '../domain/snapshot.js';
import { averageCostScaled } from '../domain/price.js';
import { evaluateStrategy } from '../domain/strategy.js';
import type { Evaluation, MarketSnapshot, PoolIdentity, StrategyConfig } from '../domain/types.js';
import type { ChainClient } from '../chain/client.js';

export type MarketService = {
  takeSnapshot(observedAt?: Date): Promise<MarketSnapshot>;
  evaluate(snapshot: MarketSnapshot): Evaluation;
};

export function createMarketService(input: {
  db: Db;
  chain: ChainClient;
  pool: PoolIdentity;
  config: StrategyConfig;
  correlationId: string;
}): MarketService {
  const { db, chain, pool, config } = input;

  return {
    async takeSnapshot(observedAt = new Date()) {
      const head = await chain.getHead();
      const state = await chain.readPoolState(pool.id, head.number);
      const wethAddress = pool.token0.id === 'WETH' ? pool.token0.address : pool.token1.address;
      const usdgAddress = pool.token0.id === 'USDG' ? pool.token0.address : pool.token1.address;
      const [wethBalance, usdgBalance] = await Promise.all([
        chain.readBalance(wethAddress, pool.id, head.number),
        chain.readBalance(usdgAddress, pool.id, head.number),
      ]);

      // Reserves follow pool ordering, which the boot check already proved.
      const reserve0 = pool.token0.id === 'WETH' ? wethBalance : usdgBalance;
      const reserve1 = pool.token1.id === 'WETH' ? wethBalance : usdgBalance;

      const snapshot = buildSnapshot(
        {
          pool,
          blockNumber: head.number,
          blockHash: head.hash,
          blockTimestampSeconds: head.timestamp,
          sqrtPriceX96: state.sqrtPriceX96,
          tick: state.tick,
          liquidity: state.liquidity,
          reserve0,
          reserve1,
          observedAt,
          freshnessSeconds: config.maxStalenessSeconds,
        },
        randomUUID(),
      );

      const stored = insertSnapshot(db, snapshot);
      appendAudit(db, {
        actor: 'system',
        action: 'market.snapshot.persisted',
        entity: 'market_snapshot',
        entityId: stored.id,
        correlationId: input.correlationId,
        payload: { blockNumber: stored.blockNumber, blockHash: stored.blockHash, status: stored.status },
      });
      return stored;
    },

    evaluate(snapshot) {
      const portfolio = getPortfolio(db, snapshot.priceScaled, snapshot.priceScale);
      const position = getPosition(db, 'WETH');
      const averageCostScaledValue =
        position && BigInt(position.quantity) > 0n
          ? averageCostScaled(BigInt(position.costBasis), BigInt(position.quantity), 18, 6, snapshot.priceScale)
          : null;

      const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(snapshot.observedAt).getTime()) / 1000));
      const status =
        snapshot.status === 'INCOMPLETE' ? 'INCOMPLETE' : ageSeconds > config.maxStalenessSeconds ? 'STALE' : snapshot.status;

      const output = evaluateStrategy({
        snapshot,
        snapshotStatus: status,
        snapshotAgeSeconds: ageSeconds,
        config,
        cashUsdgBase: portfolio.cashUsdg,
        positionWethBase: position?.quantity ?? '0',
        averageCostScaled: averageCostScaledValue === null ? null : averageCostScaledValue.toString(),
      });

      const evaluation = insertEvaluation(db, {
        snapshotId: snapshot.id,
        strategyId: config.strategyId,
        configVersion: config.version,
        inputHash: output.inputHash,
        action: output.action,
        signalStrength: output.signalStrength,
        proposedAmountIn: output.proposedAmountIn,
        invalidation: output.invalidation,
        reasons: output.reasons,
      });

      appendAudit(db, {
        actor: 'system',
        action: 'strategy.evaluation.recorded',
        entity: 'strategy_evaluation',
        entityId: evaluation.id,
        correlationId: input.correlationId,
        payload: { action: evaluation.action, snapshotId: snapshot.id, inputHash: evaluation.inputHash },
      });
      return evaluation;
    },
  };
}