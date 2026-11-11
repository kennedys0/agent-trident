import { randomUUID } from 'node:crypto';
import { withTransaction, type Db } from '../db/index.js';
import {
  appendAudit,
  clearCheckpoint,
  countFillsForSnapshot,
  deleteEvaluation,
  deleteSnapshot,
  getHighestCanonicalSnapshotBelow,
  insertReorg,
  KILL_SWITCH_KEY,
  listCanonicalSnapshotsFrom,
  listEvaluationsForSnapshot,
  listIntentsForSnapshot,
  quarantineEvaluation,
  quarantineSnapshot,
  recordReorgImpact,
  saveCheckpoint,
  setState,
  type ReorgRecord,
} from '../db/repositories.js';
import type { ChainCheckpoint, CheckpointVerification } from '../chain/checkpoint.js';
import { maybeInjectFault, type FaultHooks } from './faults.js';

type Divergence = Extract<CheckpointVerification, { canonical: false }>;

export type ReorgRecovery = {
  readonly reorgId: string;
  readonly kind: Divergence['kind'];
  readonly divergenceBlock: number;
  readonly rewoundSnapshots: number;
  readonly rewoundEvaluations: number;
  readonly quarantinedSnapshots: number;
  readonly quarantinedEvaluations: number;
  readonly affectedIntents: number;
};

/**
 * Rewinds chain-derived rows from the first non-canonical block in one
 * transaction. A snapshot/evaluation that no paper execution references is
 * deleted; one that a fill or intent already points at is quarantined instead,
 * because deleting it would rewrite the provenance of an existing execution.
 * The checkpoint is re-anchored to the highest remaining canonical block, new
 * entries are halted fail-closed, and the whole event is audited.
 */
export function recoverFromReorg(input: {
  readonly db: Db;
  readonly poolId: string;
  readonly chainId: number;
  readonly verification: Divergence;
  readonly checkpoint: ChainCheckpoint | null;
  readonly correlationId: string;
  readonly now?: Date;
  readonly faults?: FaultHooks | undefined;
}): ReorgRecovery {
  const { db, poolId, chainId, verification } = input;
  const at = (input.now ?? new Date()).toISOString();
  const reorgId = randomUUID();

  return withTransaction(db, () => {
    let rewoundSnapshots = 0;
    let rewoundEvaluations = 0;
    let quarantinedSnapshots = 0;
    let quarantinedEvaluations = 0;
    let affectedIntents = 0;
    const impacts: {
      entity: 'market_snapshot' | 'strategy_evaluation' | 'order_intent';
      entityId: string;
      blockNumber: number;
      disposition: 'DELETED' | 'QUARANTINED';
    }[] = [];

    const snapshots = listCanonicalSnapshotsFrom(db, poolId, verification.divergenceBlock);
    for (const snapshot of snapshots) {
      const evaluations = listEvaluationsForSnapshot(db, snapshot.id);
      const intents = listIntentsForSnapshot(db, snapshot.id);
      const fills = countFillsForSnapshot(db, snapshot.id);

      if (evaluations.length === 0 && fills === 0) {
        deleteSnapshot(db, snapshot.id);
        rewoundSnapshots += 1;
        impacts.push({ entity: 'market_snapshot', entityId: snapshot.id, blockNumber: snapshot.blockNumber, disposition: 'DELETED' });
        continue;
      }

      if (fills === 0 && intents.length === 0) {
        for (const evaluation of evaluations) deleteEvaluation(db, evaluation.id);
        deleteSnapshot(db, snapshot.id);
        rewoundSnapshots += 1;
        rewoundEvaluations += evaluations.length;
        impacts.push({ entity: 'market_snapshot', entityId: snapshot.id, blockNumber: snapshot.blockNumber, disposition: 'DELETED' });
        for (const evaluation of evaluations) {
          impacts.push({
            entity: 'strategy_evaluation',
            entityId: evaluation.id,
            blockNumber: snapshot.blockNumber,
            disposition: 'DELETED',
          });
        }
        continue;
      }

      // A paper execution already points at this snapshot. Keep the row for
      // provenance, quarantine it so it can never be ingested or offered again,
      // and flag every affected execution for manual review.
      quarantineSnapshot(db, snapshot.id, reorgId, at);
      quarantinedSnapshots += 1;
      impacts.push({ entity: 'market_snapshot', entityId: snapshot.id, blockNumber: snapshot.blockNumber, disposition: 'QUARANTINED' });
      for (const evaluation of evaluations) {
        quarantineEvaluation(db, evaluation.id, reorgId, at);
        quarantinedEvaluations += 1;
        impacts.push({
          entity: 'strategy_evaluation',
          entityId: evaluation.id,
          blockNumber: snapshot.blockNumber,
          disposition: 'QUARANTINED',
        });
      }
      for (const intent of intents) {
        affectedIntents += 1;
        impacts.push({ entity: 'order_intent', entityId: intent.id, blockNumber: snapshot.blockNumber, disposition: 'QUARANTINED' });
        appendAudit(db, {
          actor: 'system',
          action: 'paper.execution.reorg_review_required',
          entity: 'order_intent',
          entityId: intent.id,
          correlationId: input.correlationId,
          payload: {
            reorgId,
            intentStatus: intent.status,
            blockNumber: snapshot.blockNumber,
            blockHash: snapshot.blockHash,
            reason: 'The execution is derived from a block that is no longer canonical; manual review is required',
          },
        });
      }
    }

    const record: ReorgRecord = {
      id: reorgId,
      poolId,
      detectedAt: at,
      kind: verification.kind,
      divergenceBlock: verification.divergenceBlock,
      checkpointBlock: verification.checkpointBlock,
      checkpointHash: verification.checkpointHash,
      canonicalBlock: verification.canonicalBlock,
      canonicalHash: verification.canonicalHash,
      rewoundSnapshots,
      rewoundEvaluations,
      quarantinedSnapshots,
      quarantinedEvaluations,
      affectedIntents,
      correlationId: input.correlationId,
    };
    insertReorg(db, record);
    for (const impact of impacts) recordReorgImpact(db, { reorgId, ...impact });

    // Re-anchor the checkpoint at the highest surviving canonical block so the
    // next tick verifies from a block the chain still contains.
    const below = getHighestCanonicalSnapshotBelow(db, poolId, verification.divergenceBlock);
    const unchanged =
      input.checkpoint !== null &&
      below !== null &&
      below.blockNumber === input.checkpoint.blockNumber &&
      below.blockHash.toLowerCase() === input.checkpoint.blockHash.toLowerCase();
    if (below === null) {
      clearCheckpoint(db, poolId);
    } else if (!unchanged) {
      // The parent of a re-anchored block is not re-read here; storing null is
      // truthful, while verification only needs the block hash.
      saveCheckpoint(db, {
        poolId,
        chainId,
        blockNumber: below.blockNumber,
        blockHash: below.blockHash,
        parentHash: null,
      });
    }

    appendAudit(db, {
      actor: 'system',
      action: 'chain.reorg.detected',
      entity: 'chain_reorg',
      entityId: reorgId,
      correlationId: input.correlationId,
      payload: {
        kind: verification.kind,
        detail: verification.detail,
        divergenceBlock: verification.divergenceBlock,
        checkpointBlock: verification.checkpointBlock,
        checkpointHash: verification.checkpointHash,
        canonicalBlock: verification.canonicalBlock,
        canonicalHash: verification.canonicalHash,
        rewoundSnapshots,
        rewoundEvaluations,
        quarantinedSnapshots,
        quarantinedEvaluations,
        affectedIntents,
      },
    });

    setState(db, KILL_SWITCH_KEY, 'true');
    appendAudit(db, {
      actor: 'system',
      action: 'system.halt.engaged',
      entity: 'automation_state',
      entityId: KILL_SWITCH_KEY,
      correlationId: input.correlationId,
      payload: { reason: 'CHAIN_REORG', reorgId },
    });

    maybeInjectFault(input.faults, 'chain.reorg');

    return {
      reorgId,
      kind: verification.kind,
      divergenceBlock: verification.divergenceBlock,
      rewoundSnapshots,
      rewoundEvaluations,
      quarantinedSnapshots,
      quarantinedEvaluations,
      affectedIntents,
    };
  });
}