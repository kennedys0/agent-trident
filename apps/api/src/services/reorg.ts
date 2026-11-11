import { randomUUID } from 'node:crypto';
import { withTransaction, type Db } from '../db/index.js';
import {
  appendAudit,
  clearCheckpoint,
  countFillsForSnapshot,
  deleteEvaluation,
  deleteSnapshot,
  engageHalt,
  getHighestCanonicalSnapshotBelow,
  insertReorg,
  listCanonicalSnapshotsFrom,
  listEvaluationsForSnapshot,
  listIntentsForSnapshot,
  quarantineEvaluation,
  quarantineSnapshot,
  recordReorgImpact,
  saveCheckpoint,
  type ReorgRecord,
} from '../db/repositories.js';
import type { ChainCheckpoint, CheckpointVerification, ReorgKind } from '../chain/checkpoint.js';
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

export type ReorgHold = {
  readonly reason: 'CHAIN_EVIDENCE_UNAVAILABLE';
  readonly kind: ReorgKind;
  readonly checkpointBlock: number | null;
  /** False when the switch was already held for this reason. */
  readonly transitioned: boolean;
};

/**
 * Fail-closed freeze for a checkpoint the provider cannot prove wrong.
 *
 * Nothing chain-derived is deleted, quarantined, cleared, or re-anchored: the
 * snapshots, evaluations, and checkpoint stay exactly as they were so a later
 * verified read can decide. Only new entries are halted, with a reason that
 * tells the operator this is missing evidence, not a confirmed reorg. A repeat
 * tick stays silent because the state and audit are written on transition only.
 */
export function holdNewEntries(input: {
  readonly db: Db;
  readonly poolId: string;
  readonly verification: Divergence;
  readonly correlationId: string;
  readonly faults?: FaultHooks | undefined;
}): ReorgHold {
  const { db, verification } = input;
  return withTransaction(db, () => {
    const transitioned = engageHalt(db, 'CHAIN_EVIDENCE_UNAVAILABLE');
    if (transitioned) {
      appendAudit(db, {
        actor: 'system',
        action: 'system.halt.engaged',
        entity: 'automation_state',
        entityId: 'new_entries_halted',
        correlationId: input.correlationId,
        payload: {
          reason: 'CHAIN_EVIDENCE_UNAVAILABLE',
          kind: verification.kind,
          detail: verification.detail,
          checkpointBlock: verification.checkpointBlock,
          checkpointHash: verification.checkpointHash,
          poolId: input.poolId,
        },
      });
    }
    maybeInjectFault(input.faults, 'chain.hold');
    return {
      reason: 'CHAIN_EVIDENCE_UNAVAILABLE' as const,
      kind: verification.kind,
      checkpointBlock: verification.checkpointBlock,
      transitioned,
    };
  });
}

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

    if (engageHalt(db, 'CHAIN_REORG')) {
      appendAudit(db, {
        actor: 'system',
        action: 'system.halt.engaged',
        entity: 'automation_state',
        entityId: 'new_entries_halted',
        correlationId: input.correlationId,
        payload: { reason: 'CHAIN_REORG', reorgId, kind: verification.kind },
      });
    }

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