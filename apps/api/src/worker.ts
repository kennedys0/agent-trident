import type { FastifyInstance } from 'fastify';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { MarketService } from './services/market.js';
import { ReorgDetectedError } from './services/market.js';

export const SNAPSHOT_INTERVAL_MS = 10_000;

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
      input.logger.info(
        { blockNumber: snapshot.blockNumber, snapshotStatus: snapshot.status, action: evaluation.action, evaluationId: evaluation.id },
        'market tick',
      );
    } catch (error) {
      if (error instanceof ReorgDetectedError) {
        // The service already rewound the projections and engaged the kill
        // switch; log the audit trail link and wait for a canonical re-anchor.
        input.logger.error(
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