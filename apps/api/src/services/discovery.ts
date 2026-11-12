import { keccak256 } from 'viem';
import {
  deleteDiscoveredPoolsFrom,
  getDiscoveryCheckpoint,
  insertDiscoveredPool,
  saveDiscoveryCheckpoint,
} from '../db/discoveryRepositories.js';
import { appendAudit, clearState, getState, setState } from '../db/repositories.js';
import { withTransaction, type Db } from '../db/index.js';
import {
  decodePoolCreated,
  EXPECTED_FACTORY_BYTES,
  EXPECTED_FACTORY_CODE_KECCAK,
  POOL_CREATED_TOPIC,
  UNISWAP_ALLOWED_FEES,
  UNISWAP_V3_FACTORY,
  type RawLog,
} from '../chain/poolCodec.js';
import type { ChainBlock } from '../chain/client.js';

// Logs (not state) are retained well beyond the ~5,000-block state window, so
// a wider initial lookback is safe and finds older PoolCreated events. Read
// lazily so tests can override it per process.
export function discoveryLookbackBlocks(): number {
  return Math.min(25_000, Math.max(1, Number(process.env['DISCOVERY_LOOKBACK_BLOCKS'] ?? 2_000) || 2_000));
}
export const DISCOVERY_CHUNK = Math.min(
  500,
  Math.max(25, Number(process.env['DISCOVERY_CHUNK_SIZE'] ?? 200) || 200),
);
export const DISCOVERY_CHUNK_BACKOFF = [DISCOVERY_CHUNK, 100, 25] as const;
export const DISCOVERY_MAX_RETRIES = 3;

export type DiscoveryChainPort = {
  getHead(): Promise<ChainBlock>;
  getBlockByNumber(blockNumber: number): Promise<ChainBlock | null>;
  getCodeSize(address: string): Promise<number>;
  getBytecode(address: string): Promise<`0x${string}` | undefined>;
  readSymbol(address: string): Promise<string>;
  readDecimals(address: string): Promise<number>;
  getLogs(request: {
    readonly address: string;
    readonly fromBlock: number;
    readonly toBlock: number;
    readonly topics: readonly [string];
  }): Promise<readonly RawLog[]>;
};

export type DiscoveryLog = {
  readonly accepted: number;
  readonly skippedEvents: number;
  readonly skippedRows: number;
  readonly status: 'OK' | 'UNAVAILABLE';
  readonly detail: string;
};

export class FactoryMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactoryMismatchError';
  }
}

function isCapError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /10000|exceeds limit/i.test(message) && /32000/i.test(message);
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('socket') ||
    message.includes('429') ||
    message.includes('502') ||
    message.includes('503')
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Factory check: wrong bytecode or unreachable code size fails the discovery path closed, without touching execution. */
export async function verifyFactory(chain: DiscoveryChainPort): Promise<void> {
  const size = await chain.getCodeSize(UNISWAP_V3_FACTORY);
  if (size !== EXPECTED_FACTORY_BYTES) {
    throw new FactoryMismatchError(`factory code size ${size} != ${EXPECTED_FACTORY_BYTES}`);
  }
  const code = await chain.getBytecode(UNISWAP_V3_FACTORY);
  if (code === undefined) {
    throw new FactoryMismatchError('factory bytecode is unreadable');
  }
  if (keccak256(code) !== EXPECTED_FACTORY_CODE_KECCAK) {
    throw new FactoryMismatchError('factory bytecode hash does not match the pinned constant');
  }
}

/**
 * Prove a stored checkpoint is still canonical. Nothing is deleted unless
 * divergence is proven (same-height hash replacement) — otherwise freeze.
 */
export async function verifyDiscoveryCheckpoint(input: {
  readonly db: Db;
  readonly chain: DiscoveryChainPort;
  readonly correlationId: string;
  readonly now?: Date;
}): Promise<'ok' | 'rewound' | 'frozen'> {
  const { db, chain, correlationId } = input;
  const checkpoint = getDiscoveryCheckpoint(db);
  if (checkpoint === null || checkpoint.toBlock < 0) return 'ok';

  if (checkpoint.blockHash !== null) {
    const canonical = await chain.getBlockByNumber(checkpoint.toBlock).catch(() => null);
    if (canonical === null) {
      appendAudit(db, {
        actor: 'system',
        action: 'discovery.frozen',
        entity: 'discovery',
        entityId: 'discovery',
        correlationId,
        payload: { reason: 'checkpoint block is unresolvable', checkpointBlock: checkpoint.toBlock },
      });
      return 'frozen';
    }
    if (canonical.hash.toLowerCase() !== checkpoint.blockHash.toLowerCase()) {
      const deleted = withTransaction(db, () =>
        deleteDiscoveredPoolsFrom(db, checkpoint.toBlock),
      );
      withTransaction(db, () =>
        saveDiscoveryCheckpoint(db, {
          fromBlock: checkpoint.fromBlock,
          toBlock: checkpoint.toBlock - 1,
          blockHash: null,
        }),
      );
      appendAudit(db, {
        actor: 'system',
        action: 'discovery.reorg.rewound',
        entity: 'discovery',
        entityId: 'discovery',
        correlationId,
        payload: { divergenceBlock: checkpoint.toBlock, deletedPools: deleted.map((r) => r.poolAddress) },
      });
      return 'rewound';
    }
  }
  return 'ok';
}

async function getLogsHalving(input: {
  readonly chain: DiscoveryChainPort;
  readonly fromBlock: number;
  readonly toBlock: number;
}): Promise<{ readonly logs: readonly RawLog[]; readonly unavailable: boolean }> {
  const { chain, fromBlock, toBlock } = input;
  for (const size of DISCOVERY_CHUNK_BACKOFF) {
    try {
      const logs: RawLog[] = [];
      for (let start = fromBlock; start <= toBlock; start += size) {
        const end = Math.min(toBlock, start + size - 1);
        const chunk = await getLogsWithRetry(chain, { fromBlock: start, toBlock: end });
        logs.push(...chunk);
      }
      return { logs, unavailable: false };
    } catch (error) {
      if (!isCapError(error)) throw error;
      // fall through: cap exceeded at this chunk size, retry with a smaller one
    }
  }
  return { logs: [], unavailable: true };
}

async function getLogsWithRetry(
  chain: DiscoveryChainPort,
  request: { readonly fromBlock: number; readonly toBlock: number },
): Promise<readonly RawLog[]> {
  let attempt = 0;
  for (;;) {
    try {
      return await chain.getLogs({
        address: UNISWAP_V3_FACTORY,
        fromBlock: request.fromBlock,
        toBlock: request.toBlock,
        topics: [POOL_CREATED_TOPIC],
      });
    } catch (error) {
      attempt += 1;
      if (attempt >= DISCOVERY_MAX_RETRIES || !isTransient(error)) throw error;
      await sleep(250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
    }
  }
}

/**
 * One discovery tick: verify factory, checkpoint-resume, scan forward in
 * bounded chunks, persist pools idempotently. All failures are contained; a
 * failed tick skips ingest without touching the PAPER execution path.
 */
export async function runDiscoveryTick(input: {
  readonly db: Db;
  readonly chain: DiscoveryChainPort;
  readonly correlationId: string;
  readonly now?: Date;
}): Promise<DiscoveryLog> {
  const { db, chain, correlationId } = input;
  // Factory verification happens once in the worker lifecycle, not per tick;
  // a mismatch disables the discovery path until the process restarts.
  const checkpointState = await verifyDiscoveryCheckpoint({ db, chain, correlationId });
  if (checkpointState === 'frozen') {
    return { accepted: 0, skippedEvents: 0, skippedRows: 0, status: 'UNAVAILABLE', detail: 'checkpoint unresolvable; discovery frozen' };
  }

  const head = await chain.getHead();
  const existing = getDiscoveryCheckpoint(db);
  if (existing === null) {
    // toBlock == fromBlock (null hash) is the "nothing scanned yet" marker;
    // the first tick covers [from_block, head].
    const from = Math.max(0, head.number - discoveryLookbackBlocks());
    saveDiscoveryCheckpoint(db, { fromBlock: from, toBlock: from, blockHash: null });
  }
  let checkpoint = getDiscoveryCheckpoint(db)!;

  // Fill a missing stored hash once (trust the read after it is stored).
  // Marker exception: toBlock == fromBlock with null hash is "not scanned yet",
  // so the marker block is trusted by definition and only needs a hash later.
  if (checkpoint.blockHash === null && checkpoint.toBlock > checkpoint.fromBlock) {
    const stored = await chain.getBlockByNumber(checkpoint.toBlock).catch(() => null);
    if (stored === null) {
      return { accepted: 0, skippedEvents: 0, skippedRows: 0, status: 'UNAVAILABLE', detail: 'checkpoint block unresolvable' };
    }
    checkpoint = { ...checkpoint, blockHash: stored.hash };
    saveDiscoveryCheckpoint(db, { fromBlock: checkpoint.fromBlock, toBlock: checkpoint.toBlock, blockHash: stored.hash });
  }

  if (checkpoint.toBlock > head.number) {
    // Head behind the stored checkpoint: freeze discovery (PAPER untouched).
    // Audit only on the first transition to avoid one row per poll.
    if (getState(db, 'discovery_head_frozen') !== 'true') {
      setState(db, 'discovery_head_frozen', 'true');
      appendAudit(db, {
        actor: 'system',
        action: 'discovery.frozen',
        entity: 'discovery',
        entityId: 'discovery',
        correlationId,
        payload: { reason: 'head regressed below the stored checkpoint', head: head.number, checkpointBlock: checkpoint.toBlock },
      });
    }
    return { accepted: 0, skippedEvents: 0, skippedRows: 0, status: 'UNAVAILABLE', detail: 'head regressed below checkpoint; discovery frozen' };
  }

  const freshMarker = checkpoint.blockHash === null && checkpoint.toBlock === checkpoint.fromBlock;
  const from = freshMarker ? checkpoint.fromBlock : checkpoint.toBlock + 1;
  if (from > head.number) {
    return { accepted: 0, skippedEvents: 0, skippedRows: 0, status: 'OK', detail: 'nothing to scan' };
  }

  // Discovery scans event logs, not state, so the ~5,000-block state window
  // does not apply. A generous sanity bound still applies.
  const gap = head.number - from;
  if (gap > 100_000) {
    return { accepted: 0, skippedEvents: 0, skippedRows: 0, status: 'UNAVAILABLE', detail: `gap of ${gap} blocks exceeds the discovery sanity bound` };
  }

  const { logs, unavailable } = await getLogsHalving({ chain, fromBlock: from, toBlock: head.number });
  if (unavailable) {
    appendAudit(db, {
      actor: 'system',
      action: 'discovery.logs.unavailable',
      entity: 'discovery',
      entityId: 'discovery',
      correlationId,
      payload: { fromBlock: from, toBlock: head.number, reason: 'getLogs cap exceeded even after halving' },
    });
    return { accepted: 0, skippedEvents: 0, skippedRows: 0, status: 'UNAVAILABLE', detail: 'getLogs cap exceeded after halving' };
  }

  let accepted = 0;
  let skippedEvents = 0;
  let skippedRows = 0;
  for (const log of logs) {
    let decoded;
    try {
      decoded = decodePoolCreated(log);
    } catch {
      skippedEvents += 1;
      continue;
    }
    if (decoded.token0.toLowerCase() >= decoded.token1.toLowerCase()) {
      skippedEvents += 1;
      continue;
    }
    if (!UNISWAP_ALLOWED_FEES.has(decoded.fee) || decoded.tickSpacing <= 0) {
      skippedEvents += 1;
      continue;
    }
    try {
      const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([
        chain.readSymbol(decoded.token0),
        chain.readSymbol(decoded.token1),
        chain.readDecimals(decoded.token0),
        chain.readDecimals(decoded.token1),
      ]);
      if (!symbol0.trim() || !symbol1.trim() || symbol0.length > 64 || symbol1.length > 64) {
        skippedRows += 1;
        continue;
      }
      if (!Number.isInteger(decimals0) || !Number.isInteger(decimals1) || decimals0 < 0 || decimals1 < 0 || decimals0 > 255 || decimals1 > 255) {
        skippedRows += 1;
        continue;
      }
      const inserted = insertDiscoveredPool(db, {
        poolAddress: decoded.pool,
        factory: UNISWAP_V3_FACTORY,
        token0: decoded.token0,
        token1: decoded.token1,
        token0Symbol: symbol0,
        token1Symbol: symbol1,
        token0Decimals: decimals0,
        token1Decimals: decimals1,
        fee: decoded.fee,
        tickSpacing: decoded.tickSpacing,
        firstSeenBlock: log.blockNumber,
        firstSeenTx: log.transactionHash,
        logIndex: log.logIndex,
      });
      if (inserted) accepted += 1;
    } catch {
      skippedRows += 1;
    }
  }

  clearState(db, 'discovery_head_frozen');
  const newHash = (await chain.getBlockByNumber(head.number))?.hash ?? null;
  saveDiscoveryCheckpoint(db, { fromBlock: checkpoint.fromBlock, toBlock: head.number, blockHash: newHash });

  if (accepted > 0 || skippedEvents > 0 || skippedRows > 0) {
    appendAudit(db, {
      actor: 'system',
      action: 'discovery.batch',
      entity: 'discovery',
      entityId: 'discovery',
      correlationId,
      payload: { fromBlock: from, toBlock: head.number, accepted, skippedEvents, skippedRows },
    });
  }

  return { accepted, skippedEvents, skippedRows, status: 'OK', detail: `scanned ${from}..${head.number}` };
}
