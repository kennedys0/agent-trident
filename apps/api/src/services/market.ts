import { randomUUID } from 'node:crypto';
import { withTransaction, type Db } from '../db/index.js';
import {
  appendAudit,
  getCheckpoint,
  getPortfolio,
  getPosition,
  insertEvaluation,
  insertSnapshot,
  saveCheckpoint,
} from '../db/repositories.js';
import { buildSnapshot } from '../domain/snapshot.js';
import { averageCostScaled } from '../domain/price.js';
import { evaluateStrategy } from '../domain/strategy.js';
import type { EvaluationRecord, PoolSnapshot, PoolIdentity, StrategyConfig } from '../domain/types.js';
import type { ChainReadPort } from '../chain/client.js';
import { ROBINHOOD_CHAIN_ID } from '../config.js';
import { verifyCheckpoint, type ReorgKind } from '../chain/checkpoint.js';
import { holdNewEntries, recoverFromReorg, type ReorgHold, type ReorgRecovery } from './reorg.js';
import { maybeInjectFault, type FaultHooks } from './faults.js';

export type MarketService = {
  /** Null when the head height is covered by a quarantine row, so it is skipped. */
  takeSnapshot(observedAt?: Date): Promise<PoolSnapshot | null>;
  evaluate(snapshot: PoolSnapshot): EvaluationRecord;
};

/** Raised instead of ingesting when the stored checkpoint left the canonical chain. */
export class ReorgDetectedError extends Error {
  constructor(
    readonly kind: ReorgKind,
    readonly recovery: ReorgRecovery,
  ) {
    super(
      `Chain reorg (${kind}) at block ${recovery.divergenceBlock}; rewound ${recovery.rewoundSnapshots} snapshots, quarantined ${recovery.quarantinedSnapshots}, halted new entries`,
    );
    this.name = 'ReorgDetectedError';
  }
}

/**
 * Raised when a checkpoint cannot be proven canonical or orphaned. Nothing was
 * changed on disk except the halt switch and its audit: the caller must retry
 * until a provider returns canonical evidence.
 */
export class ChainEvidenceUnavailableError extends Error {
  constructor(
    readonly kind: ReorgKind,
    readonly hold: ReorgHold,
    readonly detail: string,
  ) {
    super(`Chain evidence unavailable (${kind}): ${detail}; data and checkpoint frozen, new entries halted`);
    this.name = 'ChainEvidenceUnavailableError';
  }
}

export function createMarketService(input: {
  db: Db;
  chain: ChainReadPort;
  pool: PoolIdentity;
  config: StrategyConfig;
  correlationId: string;
  faults?: FaultHooks | undefined;
}): MarketService {
  const { db, chain, pool, config } = input;

  return {
    async takeSnapshot(observedAt = new Date()) {
      const head = await chain.getHead();

      // AT-04: prove the persisted checkpoint is still canonical before any
      // ingest, including the first tick after a restart or a long gap.
      const checkpoint = getCheckpoint(db, pool.id);
      const verification = await verifyCheckpoint({
        checkpoint,
        head,
        readBlock: (blockNumber) => chain.getBlockByNumber(blockNumber),
      });
      if (!verification.canonical) {
        if (verification.evidence === 'UNAVAILABLE') {
          // AT-04: missing evidence is not divergence. Freeze the checkpoint and
          // every stored row, halt entries with a distinct reason, and wait for a
          // verified canonical read instead of deleting live data.
          const hold = holdNewEntries({
            db,
            poolId: pool.id,
            verification,
            correlationId: input.correlationId,
            faults: input.faults,
          });
          throw new ChainEvidenceUnavailableError(verification.kind, hold, verification.detail);
        }
        const recovery = recoverFromReorg({
          db,
          poolId: pool.id,
          chainId: checkpoint?.chainId ?? ROBINHOOD_CHAIN_ID,
          verification,
          checkpoint,
          correlationId: input.correlationId,
          now: observedAt,
          faults: input.faults,
        });
        throw new ReorgDetectedError(verification.kind, recovery);
      }

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

      // AT-16: the snapshot, its checkpoint, and its audit event commit together.
      const ingest = withTransaction(db, () => {
        const result = insertSnapshot(db, snapshot);
        if (result.status === 'QUARANTINED_BLOCK') return result;

        saveCheckpoint(db, {
          poolId: pool.id,
          chainId: snapshot.chainId,
          blockNumber: head.number,
          blockHash: head.hash,
          parentHash: head.parentHash,
        });
        if (result.status === 'CREATED') {
          appendAudit(db, {
            actor: 'system',
            action: 'market.snapshot.persisted',
            entity: 'market_snapshot',
            entityId: result.snapshot.id,
            correlationId: input.correlationId,
            payload: {
              blockNumber: result.snapshot.blockNumber,
              blockHash: result.snapshot.blockHash,
              parentHash: head.parentHash,
              status: result.snapshot.status,
            },
          });
        }
        maybeInjectFault(input.faults, 'market.snapshot');
        return result;
      });

      return ingest.status === 'QUARANTINED_BLOCK' ? null : ingest.snapshot;
    },

    evaluate(snapshot) {
      return withTransaction(db, () => {
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

        // AT-16: the evaluation and its audit event commit together.
        const { evaluation, created } = insertEvaluation(db, {
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

        if (created) {
          appendAudit(db, {
            actor: 'system',
            action: 'strategy.evaluation.recorded',
            entity: 'strategy_evaluation',
            entityId: evaluation.id,
            correlationId: input.correlationId,
            payload: { action: evaluation.action, snapshotId: snapshot.id, inputHash: evaluation.inputHash },
          });
        }
        maybeInjectFault(input.faults, 'strategy.evaluation');
        return evaluation;
      });
    },
  };
}