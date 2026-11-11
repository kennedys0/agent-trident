import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import {
  getCheckpoint,
  getEvaluation,
  getLatestSnapshot,
  getSnapshotAtBlockAny,
  listReorgImpacts,
  listReorgs,
  seedOpeningCash,
} from '../src/db/repositories.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';
import { createMarketService, ChainEvidenceUnavailableError, ReorgDetectedError } from '../src/services/market.js';
import { createIntentFromEvaluation, executeIntent } from '../src/services/execution.js';
import { createFakeChain, createFakeQuotePort, fakeBlock, makeDb, seedEvaluation, TEST_POOL } from './helpers.js';

const config: Config = {
  mode: 'PAPER',
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  expectedChainId: 4663,
  databasePath: ':memory:',
  port: 0,
  host: '127.0.0.1',
  logLevel: 'silent',
  marketFreshnessSeconds: 30,
  openingCashUsdgBase: '10000000000',
};

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

function market(db: ReturnType<typeof makeDb>, chain: ReturnType<typeof createFakeChain>) {
  return createMarketService({ db, chain, pool: TEST_POOL, config: DEFAULT_STRATEGY_CONFIG, correlationId: 'reorg-test' });
}

function countRows(db: ReturnType<typeof makeDb>, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number | bigint };
  return Number(row.count);
}

function auditActions(db: ReturnType<typeof makeDb>): string[] {
  return (db.prepare('SELECT action FROM audit_events ORDER BY rowid ASC').all() as { action: string }[]).map((r) => r.action);
}

function checkpointFor(db: ReturnType<typeof makeDb>) {
  return getCheckpoint(db, TEST_POOL.id);
}

describe('AT-04 chain checkpoint', () => {
  it('persists the checkpoint with block hash and parent hash on the first ingest', async () => {
    const db = makeDb();
    const chain = createFakeChain([fakeBlock(100, 'aa')]);
    const service = market(db, chain);

    const snapshot = await service.takeSnapshot();
    expect(snapshot).not.toBeNull();

    const checkpoint = checkpointFor(db);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.chainId).toBe(4663);
    expect(checkpoint!.poolId).toBe(TEST_POOL.id);
    expect(checkpoint!.blockNumber).toBe(100);
    expect(checkpoint!.blockHash).toBe(snapshot!.blockHash);
    expect(checkpoint!.parentHash).toBe(fakeBlock(100, 'aa').parentHash);
    expect(auditActions(db)).toContain('market.snapshot.persisted');
  });

  it('verifies the parent hash after a restart and continues from the next block', async () => {
    const db = makeDb();
    const previous = fakeBlock(100, 'aa');
    const next = fakeBlock(101, 'bb', previous.hash);
    const chain = createFakeChain([previous]);

    const first = market(db, chain);
    await first.takeSnapshot();
    expect(checkpointFor(db)!.blockNumber).toBe(100);

    // Simulate a restart: a fresh service over the same database.
    chain.setHead(next);
    const restarted = market(db, chain);
    const snapshot = await restarted.takeSnapshot();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.blockNumber).toBe(101);
    expect(checkpointFor(db)!.blockNumber).toBe(101);
    expect(checkpointFor(db)!.parentHash).toBe(previous.hash);
  });

  it('accepts a gap above the checkpoint once the checkpoint block still resolves to the stored hash', async () => {
    const db = makeDb();
    const base = fakeBlock(100, 'aa');
    const chain = createFakeChain([base]);
    await market(db, chain).takeSnapshot();

    const far = fakeBlock(150, 'cc', fakeBlock(149, 'dd').hash);
    chain.setCanonical([base, far]);
    chain.setHead(far);

    const snapshot = await market(db, chain).takeSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.blockNumber).toBe(150);
    expect(checkpointFor(db)!.blockNumber).toBe(150);
  });

  it('detects a same-height hash replacement, rewinds the orphan, and halts new entries', async () => {
    const db = makeDb();
    const b100 = fakeBlock(100, 'aa');
    const b101 = fakeBlock(101, 'bb', b100.hash);
    const chain = createFakeChain([b100]);
    const service = market(db, chain);
    await service.takeSnapshot();

    // The chain reorgs block 100 to a different hash at the same height.
    const replacement = fakeBlock(100, 'ff');
    chain.setCanonical([replacement]);
    chain.setHead(replacement);

    await expect(service.takeSnapshot()).rejects.toBeInstanceOf(ReorgDetectedError);

    // The orphaned snapshot is gone, its hash can never be read again.
    expect(getSnapshotAtBlockAny(db, TEST_POOL.id, 100)).toBeNull();
    expect(checkpointFor(db)).toBeNull();
    expect(auditActions(db)).toContain('chain.reorg.detected');
    expect(auditActions(db)).toContain('system.halt.engaged');
    expect(db.prepare("SELECT value FROM automation_state WHERE key = 'new_entries_halted'").get()).toEqual({ value: 'true' });

    const reorgs = listReorgs(db);
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!['kind']).toBe('SAME_HEIGHT_HASH_REPLACEMENT');
    expect(reorgs[0]!['divergence_block']).toBe(100);
    expect(reorgs[0]!['rewound_snapshots']).toBe(1);

    // The next tick ingests the replacement hash, never the orphan.
    const after = await market(db, chain).takeSnapshot();
    expect(after).not.toBeNull();
    expect(after!.blockHash).toBe(replacement.hash);
  });

  it('rejects a head whose parent does not extend the checkpoint', async () => {
    const db = makeDb();
    const b100 = fakeBlock(100, 'aa');
    const chain = createFakeChain([b100]);
    await market(db, chain).takeSnapshot();

    // Same height+1 but a different parent: a stale side branch.
    chain.setHead(fakeBlock(101, 'ee', fakeBlock(99, 'zz').hash));

    await expect(market(db, chain).takeSnapshot()).rejects.toBeInstanceOf(ReorgDetectedError);
    expect(listReorgs(db)[0]!['kind']).toBe('PARENT_MISMATCH');
    expect(listReorgs(db)[0]!['divergence_block']).toBe(101);
  });

  it('holds without deleting data when the checkpoint block cannot be resolved by the provider', async () => {
    const db = makeDb();
    const b100 = fakeBlock(100, 'aa');
    const chain = createFakeChain([b100]);
    const service = market(db, chain);
    const snapshot = await service.takeSnapshot();
    const evaluation = seedEvaluation(db, snapshot!, 'BUY', '500000000');
    const before = checkpointFor(db);

    const far = fakeBlock(120, 'cc', fakeBlock(119, 'dd').hash);
    chain.setCanonical([far]);
    chain.setHead(far);
    chain.hideBlock(100);

    const error = await market(db, chain)
      .takeSnapshot()
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ChainEvidenceUnavailableError);
    expect((error as ChainEvidenceUnavailableError).kind).toBe('CANONICAL_BLOCK_UNAVAILABLE');
    expect((error as ChainEvidenceUnavailableError).hold.reason).toBe('CHAIN_EVIDENCE_UNAVAILABLE');

    // No divergence is proven: every stored row and the checkpoint survive.
    expect(countRows(db, 'chain_reorgs')).toBe(0);
    expect(countRows(db, 'chain_reorg_impacts')).toBe(0);
    expect(countRows(db, 'market_snapshots')).toBe(1);
    expect(countRows(db, 'strategy_evaluations')).toBe(1);
    expect(getSnapshotAtBlockAny(db, TEST_POOL.id, 100)!.quarantined).toBe(false);
    expect(getEvaluation(db, evaluation.id)).not.toBeNull();
    expect(checkpointFor(db)).toEqual(before);
    expect(auditActions(db)).not.toContain('chain.reorg.detected');
    expect(db.prepare("SELECT value FROM automation_state WHERE key = 'new_entries_halted'").get()).toEqual({ value: 'true' });
    expect(db.prepare("SELECT value FROM automation_state WHERE key = 'new_entries_halted_reason'").get()).toEqual({
      value: 'CHAIN_EVIDENCE_UNAVAILABLE',
    });

    // A repeated tick keeps the same state and writes no duplicate halt audit.
    await expect(market(db, chain).takeSnapshot()).rejects.toBeInstanceOf(ChainEvidenceUnavailableError);
    expect(auditActions(db).filter((action) => action === 'system.halt.engaged')).toHaveLength(1);
  });
});

describe('AT-04 reorg quarantine of referenced executions', () => {
  async function seedExecutedSnapshot(db: ReturnType<typeof makeDb>, chain: ReturnType<typeof createFakeChain>) {
    seedOpeningCash(db, '10000000000');
    const snapshot = await market(db, chain).takeSnapshot();
    const evaluation = seedEvaluation(db, snapshot!, 'BUY', '500000000');
    const intent = createIntentFromEvaluation(db, {
      evaluation,
      idempotencyKey: 'reorg-key-1',
      correlationId: 'seed',
      mode: 'PAPER',
    });
    return { snapshot: snapshot!, evaluation, intent };
  }

  it('quarantines a snapshot a paper execution references instead of deleting it', async () => {
    const db = makeDb();
    const chain = createFakeChain([fakeBlock(100, 'aa')]);
    const { snapshot, evaluation, intent } = await seedExecutedSnapshot(db, chain);

    // Execute the intent so a fill points at the snapshot.
    await executeIntent(
      { db, quote: createFakeQuotePort({ headBlock: 100 }), pool: TEST_POOL, config: DEFAULT_STRATEGY_CONFIG, mode: 'PAPER', correlationId: 'seed' },
      intent.id,
    );
    expect(countRows(db, 'fills')).toBe(1);

    const replacement = fakeBlock(100, 'ff');
    chain.setCanonical([replacement]);
    chain.setHead(replacement);

    await expect(market(db, chain).takeSnapshot()).rejects.toBeInstanceOf(ReorgDetectedError);

    const stored = getSnapshotAtBlockAny(db, TEST_POOL.id, 100);
    expect(stored).not.toBeNull();
    expect(stored!.quarantined).toBe(true);
    expect(stored!.snapshot.blockHash).toBe(snapshot.blockHash);
    // The fill survives; the row is never deleted from under it.
    expect(countRows(db, 'fills')).toBe(1);

    expect(auditActions(db)).toContain('paper.execution.reorg_review_required');
    const reorgId = listReorgs(db)[0]!['id'] as string;
    const impacts = listReorgImpacts(db, reorgId);
    expect(impacts.some((row) => row['entity'] === 'market_snapshot' && row['disposition'] === 'QUARANTINED')).toBe(true);
    expect(impacts.some((row) => row['entity'] === 'strategy_evaluation' && row['disposition'] === 'QUARANTINED')).toBe(true);
    expect(impacts.some((row) => row['entity'] === 'order_intent' && row['disposition'] === 'QUARANTINED')).toBe(true);

    // The quarantined height is never re-ingested: the row keeps the orphan hash
    // and ingestion resumes only at a higher canonical block.
    const skipped = await market(db, chain).takeSnapshot();
    expect(skipped).toBeNull();
    expect(getSnapshotAtBlockAny(db, TEST_POOL.id, 100)!.snapshot.blockHash).toBe(snapshot.blockHash);

    const next = fakeBlock(101, 'gg', replacement.hash);
    chain.setHead(next);
    const resumed = await market(db, chain).takeSnapshot();
    expect(resumed).not.toBeNull();
    expect(resumed!.blockNumber).toBe(101);
    expect(resumed!.blockHash).toBe(next.hash);

    // The quarantined evaluation can no longer produce a paper intent.
    app = buildApp({
      db,
      config,
      pool: TEST_POOL,
      strategyConfig: DEFAULT_STRATEGY_CONFIG,
      market: market(db, chain),
      quote: createFakeQuotePort(),
      probe: async () => ({ chainId: 4663, headBlock: 101, latencyMs: 1 }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { evaluationId: evaluation.id, idempotencyKey: 'reorg-key-2' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });

  it('never reports a quarantined snapshot as the latest market read', async () => {
    const db = makeDb();
    const chain = createFakeChain([fakeBlock(100, 'aa')]);
    const { snapshot, intent } = await seedExecutedSnapshot(db, chain);
    // Execute so the snapshot must be retained, not deleted.
    await executeIntent(
      { db, quote: createFakeQuotePort({ headBlock: 100 }), pool: TEST_POOL, config: DEFAULT_STRATEGY_CONFIG, mode: 'PAPER', correlationId: 'seed' },
      intent.id,
    );

    const replacement = fakeBlock(100, 'ff');
    chain.setCanonical([replacement]);
    chain.setHead(replacement);
    await expect(market(db, chain).takeSnapshot()).rejects.toBeInstanceOf(ReorgDetectedError);
    expect(getSnapshotAtBlockAny(db, TEST_POOL.id, 100)!.snapshot.blockHash).toBe(snapshot.blockHash);

    const canonical = db
      .prepare('SELECT block_hash FROM market_snapshots WHERE pool_id = ? AND quarantined_at IS NULL')
      .all(TEST_POOL.id) as { block_hash: string }[];
    expect(canonical).toHaveLength(0);
    expect(getLatestSnapshot(db, TEST_POOL.id)).toBeNull();
  });
});

describe('AT-04 checkpoint survives a restart without duplicating rows', () => {
  it('keeps one snapshot per block height across a restart', async () => {
    const db = makeDb();
    const b100 = fakeBlock(100, 'aa');
    const chain = createFakeChain([b100]);
    await market(db, chain).takeSnapshot();
    await market(db, chain).takeSnapshot();

    expect(countRows(db, 'market_snapshots')).toBe(1);
    expect(countRows(db, 'audit_events')).toBe(1);
    const snapshot = await market(db, chain).takeSnapshot();
    expect(snapshot!.blockHash).toBe(b100.hash);
  });
});

describe('AT-04 reorg transaction boundary', () => {
  it('rolls back the whole rewind when the reorg transaction fails', async () => {
    const db = makeDb();
    const b100 = fakeBlock(100, 'aa');
    const chain = createFakeChain([b100]);
    const service = createMarketService({
      db,
      chain,
      pool: TEST_POOL,
      config: DEFAULT_STRATEGY_CONFIG,
      correlationId: 'reorg-test',
      faults: {
        afterEntityWrite: (stage) => {
          if (stage === 'chain.reorg') throw new Error('simulated crash before commit');
        },
      },
    });
    await service.takeSnapshot();

    const replacement = fakeBlock(100, 'ff');
    chain.setCanonical([replacement]);
    chain.setHead(replacement);

    await expect(service.takeSnapshot()).rejects.toThrow('simulated crash before commit');

    // Nothing was rewound or nudged: no reorg row, no quarantine, no halt.
    expect(countRows(db, 'chain_reorgs')).toBe(0);
    expect(countRows(db, 'chain_reorg_impacts')).toBe(0);
    const stored = getSnapshotAtBlockAny(db, TEST_POOL.id, 100);
    expect(stored).not.toBeNull();
    expect(stored!.quarantined).toBe(false);
    expect(checkpointFor(db)!.blockNumber).toBe(100);
    expect(db.prepare("SELECT value FROM automation_state WHERE key = 'new_entries_halted'").get()).not.toEqual({ value: 'true' });
  });
});

describe('AT-04 proven rollback rewinds every row above the canonical head', () => {
  async function ingestHead(
    db: ReturnType<typeof makeDb>,
    chain: ReturnType<typeof createFakeChain>,
    blocks: ReturnType<typeof fakeBlock>[],
  ) {
    chain.setCanonical(blocks);
    chain.setHead(blocks[blocks.length - 1]!);
    return market(db, chain).takeSnapshot();
  }

  it('removes rows 110 and 120 when the confirmed head is 105, then re-anchors at 100', async () => {
    const db = makeDb();
    const b100 = fakeBlock(100, 'aa');
    const b110 = fakeBlock(110, 'bb', b100.hash);
    const b120 = fakeBlock(120, 'cc', b110.hash);
    const chain = createFakeChain([b100]);
    await ingestHead(db, chain, [b100]);
    await ingestHead(db, chain, [b100, b110]);
    await ingestHead(db, chain, [b100, b110, b120]);
    expect(countRows(db, 'market_snapshots')).toBe(3);

    // The canonical head rolls back below two stored rows.
    const b105 = fakeBlock(105, 'dd', fakeBlock(104, 'ee').hash);
    chain.setCanonical([b100, b105]);
    chain.setHead(b105);

    await expect(market(db, chain).takeSnapshot()).rejects.toBeInstanceOf(ReorgDetectedError);

    // Both orphaned heights are gone, 100 survives, and the checkpoint moves
    // down to it before any new ingest.
    expect(getSnapshotAtBlockAny(db, TEST_POOL.id, 110)).toBeNull();
    expect(getSnapshotAtBlockAny(db, TEST_POOL.id, 120)).toBeNull();
    const latest = getLatestSnapshot(db, TEST_POOL.id);
    expect(latest).not.toBeNull();
    expect(latest!.blockNumber).toBe(100);
    expect(latest!.blockHash).toBe(b100.hash);
    expect(checkpointFor(db)!.blockNumber).toBe(100);
    expect(checkpointFor(db)!.blockHash).toBe(b100.hash);

    const reorg = listReorgs(db)[0]!;
    expect(reorg['kind']).toBe('CHAIN_ROLLBACK');
    expect(reorg['divergence_block']).toBe(106);
    expect(reorg['rewound_snapshots']).toBe(2);
    expect(db.prepare("SELECT value FROM automation_state WHERE key = 'new_entries_halted_reason'").get()).toEqual({
      value: 'CHAIN_REORG',
    });

    // Restart/failover: a fresh service continues from the re-anchor, keeps one
    // row per height, and never reports an orphan as the latest read.
    const restarted = market(db, chain);
    const snapshot = await restarted.takeSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.blockNumber).toBe(105);
    expect(snapshot!.blockHash).toBe(b105.hash);
    expect(getLatestSnapshot(db, TEST_POOL.id)!.blockNumber).toBe(105);
    expect(countRows(db, 'market_snapshots')).toBe(2);
    const aboveHead = db
      .prepare('SELECT COUNT(*) AS count FROM market_snapshots WHERE pool_id = ? AND block_number > ? AND quarantined_at IS NULL')
      .get(TEST_POOL.id, 105) as { count: number | bigint };
    expect(Number(aboveHead.count)).toBe(0);
    const duplicates = db
      .prepare('SELECT block_number, COUNT(*) AS count FROM market_snapshots GROUP BY block_number HAVING count > 1')
      .all();
    expect(duplicates).toHaveLength(0);
  });

  it('quarantines referenced rows above the canonical head instead of deleting them', async () => {
    const db = makeDb();
    const b100 = fakeBlock(100, 'aa');
    const b110 = fakeBlock(110, 'bb', b100.hash);
    const b120 = fakeBlock(120, 'cc', b110.hash);
    const chain = createFakeChain([b100]);
    await ingestHead(db, chain, [b100]);
    const snap110 = await ingestHead(db, chain, [b100, b110]);
    const snap120 = await ingestHead(db, chain, [b100, b110, b120]);

    // A pending intent references 110; a completed fill references 120.
    const evaluation110 = seedEvaluation(db, snap110!, 'BUY', '500000000');
    createIntentFromEvaluation(db, { evaluation: evaluation110, idempotencyKey: 'rollback-110', correlationId: 'seed', mode: 'PAPER' });
    const evaluation120 = seedEvaluation(db, snap120!, 'BUY', '500000000');
    const intent120 = createIntentFromEvaluation(db, {
      evaluation: evaluation120,
      idempotencyKey: 'rollback-120',
      correlationId: 'seed',
      mode: 'PAPER',
    });
    await executeIntent(
      { db, quote: createFakeQuotePort({ headBlock: 120 }), pool: TEST_POOL, config: DEFAULT_STRATEGY_CONFIG, mode: 'PAPER', correlationId: 'seed' },
      intent120.id,
    );
    expect(countRows(db, 'fills')).toBe(1);

    const b105 = fakeBlock(105, 'dd', fakeBlock(104, 'ee').hash);
    chain.setCanonical([b100, b105]);
    chain.setHead(b105);
    await expect(market(db, chain).takeSnapshot()).rejects.toBeInstanceOf(ReorgDetectedError);

    // Referenced rows survive for provenance and become visibly quarantined.
    for (const blockNumber of [110, 120]) {
      const stored = getSnapshotAtBlockAny(db, TEST_POOL.id, blockNumber);
      expect(stored).not.toBeNull();
      expect(stored!.quarantined).toBe(true);
    }
    expect(countRows(db, 'fills')).toBe(1);
    const reorg = listReorgs(db)[0]!;
    expect(reorg['kind']).toBe('CHAIN_ROLLBACK');
    expect(reorg['quarantined_snapshots']).toBe(2);
    expect(reorg['affected_intents']).toBe(2);
    expect(auditActions(db)).toContain('paper.execution.reorg_review_required');
    const impacts = listReorgImpacts(db, reorg['id'] as string);
    expect(impacts.filter((row) => row['disposition'] === 'QUARANTINED')).toHaveLength(6); // 2 snapshots + 2 evaluations + 2 intents
    expect(impacts.filter((row) => row['entity'] === 'order_intent')).toHaveLength(2);
    expect(checkpointFor(db)!.blockNumber).toBe(100);
    expect(getLatestSnapshot(db, TEST_POOL.id)!.blockNumber).toBe(100);
  });

  it('holds a lower head that the provider cannot confirm instead of rewinding it', async () => {
    const db = makeDb();
    const b100 = fakeBlock(100, 'aa');
    const chain = createFakeChain([b100]);
    await market(db, chain).takeSnapshot();
    const before = checkpointFor(db);

    // The reported head is below the checkpoint, but the provider cannot return
    // that block, so no rollback is proven.
    const b90 = fakeBlock(90, 'ff');
    chain.setHead(b90);
    chain.hideBlock(90);

    const error = await market(db, chain)
      .takeSnapshot()
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ChainEvidenceUnavailableError);
    expect((error as ChainEvidenceUnavailableError).kind).toBe('CHAIN_ROLLBACK');
    expect(countRows(db, 'chain_reorgs')).toBe(0);
    expect(getSnapshotAtBlockAny(db, TEST_POOL.id, 100)!.quarantined).toBe(false);
    expect(checkpointFor(db)).toEqual(before);
    expect(db.prepare("SELECT value FROM automation_state WHERE key = 'new_entries_halted_reason'").get()).toEqual({
      value: 'CHAIN_EVIDENCE_UNAVAILABLE',
    });
  });

  it('resumes from the held checkpoint once a provider can prove it again', async () => {
    const db = makeDb();
    const b100 = fakeBlock(100, 'aa');
    const chain = createFakeChain([b100]);
    await market(db, chain).takeSnapshot();

    const far = fakeBlock(120, 'cc');
    chain.setCanonical([far]);
    chain.setHead(far);
    chain.hideBlock(100);
    await expect(market(db, chain).takeSnapshot()).rejects.toBeInstanceOf(ChainEvidenceUnavailableError);
    expect(checkpointFor(db)!.blockNumber).toBe(100);

    // Failover to a provider that still serves the checkpoint block.
    chain.setCanonical([b100, far]);
    chain.setHead(far);
    const snapshot = await market(db, chain).takeSnapshot();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.blockNumber).toBe(120);
    expect(snapshot!.blockHash).toBe(far.hash);
    expect(checkpointFor(db)!.blockNumber).toBe(120);
    // The frozen rows survived, no height duplicated, and no reorg was invented.
    expect(countRows(db, 'market_snapshots')).toBe(2);
    expect(countRows(db, 'chain_reorgs')).toBe(0);
    expect(getLatestSnapshot(db, TEST_POOL.id)!.blockNumber).toBe(120);
    const duplicates = db
      .prepare('SELECT block_number, COUNT(*) AS count FROM market_snapshots GROUP BY block_number HAVING count > 1')
      .all();
    expect(duplicates).toHaveLength(0);
  });
});