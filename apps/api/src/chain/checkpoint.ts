import type { ChainBlock } from './client.js';

/** The last block this process ingested, persisted so a restart can verify it. */
export type ChainCheckpoint = {
  readonly poolId: string;
  readonly chainId: number;
  readonly blockNumber: number;
  readonly blockHash: string;
  /** Null when a reorg re-anchored the checkpoint and the parent was not re-read. */
  readonly parentHash: string | null;
  readonly updatedAt: string;
};

export type ReorgKind =
  | 'SAME_HEIGHT_HASH_REPLACEMENT'
  | 'PARENT_MISMATCH'
  | 'CHAIN_ROLLBACK'
  | 'CANONICAL_BLOCK_UNAVAILABLE';

export type CheckpointVerification =
  | { readonly canonical: true }
  | {
      readonly canonical: false;
      readonly kind: ReorgKind;
      /** First block whose stored data may no longer be canonical. */
      readonly divergenceBlock: number;
      readonly checkpointBlock: number | null;
      readonly checkpointHash: string | null;
      readonly canonicalBlock: number | null;
      readonly canonicalHash: string | null;
      readonly detail: string;
    };

const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * Decides whether the stored checkpoint is still an ancestor of the reported
 * head. Three shapes matter:
 * - the head is the checkpoint height: the hash must match;
 * - the head is the next block: its parent must be the checkpoint;
 * - the head is further ahead (a gap, or a restart after downtime): the
 *   checkpoint height must still resolve to the stored hash, which proves every
 *   canonical block above it descends from the stored data.
 * A provider that cannot answer for the checkpoint height fails closed.
 */
export async function verifyCheckpoint(input: {
  readonly checkpoint: ChainCheckpoint | null;
  readonly head: ChainBlock;
  readonly readBlock: (blockNumber: number) => Promise<ChainBlock | null>;
}): Promise<CheckpointVerification> {
  const { checkpoint, head, readBlock } = input;
  if (checkpoint === null) return { canonical: true };

  const base = {
    checkpointBlock: checkpoint.blockNumber,
    checkpointHash: checkpoint.blockHash,
  } as const;

  if (head.number < checkpoint.blockNumber) {
    return {
      canonical: false,
      kind: 'CHAIN_ROLLBACK',
      divergenceBlock: checkpoint.blockNumber,
      ...base,
      canonicalBlock: null,
      canonicalHash: null,
      detail: `Head ${head.number} is behind the checkpoint ${checkpoint.blockNumber}; the chain rolled back`,
    };
  }

  const canonicalAtCheckpoint = async (): Promise<ChainBlock | null> => readBlock(checkpoint.blockNumber);

  if (head.number === checkpoint.blockNumber) {
    if (same(head.hash, checkpoint.blockHash)) return { canonical: true };
    const canonical = await canonicalAtCheckpoint();
    if (canonical === null) {
      return {
        canonical: false,
        kind: 'CANONICAL_BLOCK_UNAVAILABLE',
        divergenceBlock: checkpoint.blockNumber,
        ...base,
        canonicalBlock: checkpoint.blockNumber,
        canonicalHash: null,
        detail: `The provider cannot resolve block ${checkpoint.blockNumber}, so the stored checkpoint cannot be proven canonical`,
      };
    }
    if (same(canonical.hash, checkpoint.blockHash)) {
      // The stored block is still canonical; only the reported head is a stale
      // side branch at the same height.
      return {
        canonical: false,
        kind: 'PARENT_MISMATCH',
        divergenceBlock: checkpoint.blockNumber + 1,
        ...base,
        canonicalBlock: checkpoint.blockNumber,
        canonicalHash: canonical.hash,
        detail: `Head hash ${head.hash} differs from canonical block ${checkpoint.blockNumber} hash ${canonical.hash}`,
      };
    }
    return {
      canonical: false,
      kind: 'SAME_HEIGHT_HASH_REPLACEMENT',
      divergenceBlock: checkpoint.blockNumber,
      ...base,
      canonicalBlock: canonical.number,
      canonicalHash: canonical.hash,
      detail: `Block ${checkpoint.blockNumber} was replaced: stored ${checkpoint.blockHash}, canonical ${canonical.hash}`,
    };
  }

  if (head.number === checkpoint.blockNumber + 1 && same(head.parentHash, checkpoint.blockHash)) {
    return { canonical: true };
  }

  // Gap, downtime, or a head that does not descend from the checkpoint. Verify
  // the checkpoint height itself; a mismatch means stored rows are orphaned.
  const canonical = await canonicalAtCheckpoint();
  if (canonical === null) {
    return {
      canonical: false,
      kind: 'CANONICAL_BLOCK_UNAVAILABLE',
      divergenceBlock: checkpoint.blockNumber,
      ...base,
      canonicalBlock: checkpoint.blockNumber,
      canonicalHash: null,
      detail: `The provider cannot resolve checkpoint block ${checkpoint.blockNumber}, so stored data cannot be proven canonical`,
    };
  }
  if (!same(canonical.hash, checkpoint.blockHash)) {
    return {
      canonical: false,
      kind: 'SAME_HEIGHT_HASH_REPLACEMENT',
      divergenceBlock: checkpoint.blockNumber,
      ...base,
      canonicalBlock: canonical.number,
      canonicalHash: canonical.hash,
      detail: `Checkpoint block ${checkpoint.blockNumber} no longer resolves to ${checkpoint.blockHash}; canonical is ${canonical.hash}`,
    };
  }
  if (head.number === checkpoint.blockNumber + 1) {
    return {
      canonical: false,
      kind: 'PARENT_MISMATCH',
      divergenceBlock: checkpoint.blockNumber + 1,
      ...base,
      canonicalBlock: canonical.number,
      canonicalHash: canonical.hash,
      detail: `Head ${head.number} parent ${head.parentHash} does not extend canonical checkpoint ${checkpoint.blockHash}`,
    };
  }
  return { canonical: true };
}