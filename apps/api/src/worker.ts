import type { FastifyInstance } from 'fastify';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { MarketService } from './services/market.js';
import { ChainEvidenceUnavailableError, ReorgDetectedError } from './services/market.js';

export const SNAPSHOT_INTERVAL_MS = 10_000;
/** Identical hold/reorg lines repeat at most this often; the first is always logged. */
export const HOLD_REPEAT_LOG_MS = 30 * 60 * 1000;

export type Worker = {
  readonly tick: () => Promise<void>;
  readonly stop: () => void;
};

/**
 * Polling worker: the public RPC has no push subscription, so the slice reads a
 * fresh block-pinned snapshot on a fixed interval and records one evaluation.
 * A slow tick never overlaps the next; a failed tick is logged and retried.
 */
export function startWorker(input: {
  market: MarketService;
  logger: FastifyBaseLogger;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): Worker {
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  /**
   * HOLD conditions persist until an operator acts, so a 10 s poll would emit
   * 8,640 identical lines a day. Log the first occurrence, then one line every
   * HOLD_REPEAT_LOG_MS with the count of suppressed repeats; reset on recovery.
   */
  let holdLog: { key: string | null; loggedAt: number; suppressed: number } = { key: null, loggedAt: 0, suppressed: 0 };
  const logHold = (fields: Record<string, unknown>, message: string) => {
    const key = `${fields['kind']}:${fields['checkpointBlock'] ?? fields['divergenceBlock'] ?? ''}:${String(fields['detail'] ?? '')}`;
    const now = Date.now();
    if (key === holdLog.key && now - holdLog.loggedAt < HOLD_REPEAT_LOG_MS) {
      holdLog.suppressed += 1;
      return;
    }
    input.logger.error({ ...fields, suppressedSinceLast: holdLog.suppressed }, message);
    holdLog = { key, loggedAt: now, suppressed: 0 };
  };
  const resetHoldLog = () => {
    holdLog = { key: null, loggedAt: 0, suppressed: 0 };
  };

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const snapshot = await input.market.takeSnapshot();
      if (snapshot === null) {
        // The head height belongs to a block a reorg already quarantined; the
        // next canonical block above it will be ingested on a later tick.
        input.logger.warn('market tick skipped a quarantined block height');
        return;
      }
      const evaluation = input.market.evaluate(snapshot);
      resetHoldLog();
      input.logger.info(
        { blockNumber: snapshot.blockNumber, snapshotStatus: snapshot.status, action: evaluation.action, evaluationId: evaluation.id },
        'market tick',
      );
    } catch (error) {
      if (error instanceof ChainEvidenceUnavailableError) {
        // No divergence is proven: state and checkpoint stay untouched, and a
        // later tick retries once the provider can answer for the checkpoint.
        logHold(
          {
            kind: error.kind,
            reason: error.hold.reason,
            checkpointBlock: error.hold.checkpointBlock,
            detail: error.detail,
          },
          'chain evidence unavailable; data frozen and new entries halted',
        );
        return;
      }
      if (error instanceof ReorgDetectedError) {
        // The service already rewound the projections and engaged the kill
        // switch; log the audit trail link and wait for a canonical re-anchor.
        logHold(
          { kind: error.kind, reorgId: error.recovery.reorgId, divergenceBlock: error.recovery.divergenceBlock },
          'chain reorg detected; new entries halted pending canonical data',
        );
        return;
      }
      input.logger.error({ err: error }, 'market tick failed');
    } finally {
      running = false;
    }
  };

  const schedule = input.setIntervalFn ?? setInterval;
  const cancel = input.clearIntervalFn ?? clearInterval;
  timer = schedule(() => {
    void tick();
  }, input.intervalMs ?? SNAPSHOT_INTERVAL_MS);
  timer.unref?.();

  return {
    tick,
    stop: () => {
      if (timer !== null) cancel(timer);
      timer = null;
    },
  };
}

export type { Config, Db, FastifyInstance };