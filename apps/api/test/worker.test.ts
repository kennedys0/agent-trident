import { describe, expect, it } from 'vitest';
import { startWorker, HOLD_REPEAT_LOG_MS } from '../src/worker.js';
import { ChainEvidenceUnavailableError } from '../src/services/market.js';
import type { FastifyBaseLogger } from 'fastify';

const holdError = () =>
  new ChainEvidenceUnavailableError(
    'CANONICAL_BLOCK_UNAVAILABLE',
    { reason: 'CHAIN_EVIDENCE_UNAVAILABLE', kind: 'CANONICAL_BLOCK_UNAVAILABLE', checkpointBlock: 100, transitioned: true },
    'provider cannot resolve checkpoint block 100',
  );

function makeLogger(captured: { error: unknown[]; info: unknown[]; warn: unknown[] }): FastifyBaseLogger {
  const push = (bucket: unknown[]) => (fields: unknown, message?: string) => bucket.push({ fields, message });
  return {
    level: 'error',
    child: () => makeLogger(captured),
    info: push(captured.info),
    warn: push(captured.warn),
    error: push(captured.error),
    debug: push(captured.info),
    fatal: push(captured.error),
    trace: push(captured.info),
    silent: () => {},
  } as unknown as FastifyBaseLogger;
}

const evaluation = { id: 'evaluation-1', action: 'HOLD' } as never;
const snapshot = { id: 'snapshot-1', blockNumber: 111, status: 'COMPLETE' } as never;

describe('worker hold logging', () => {
  it('logs identical hold conditions once per repeat window, not every poll', async () => {
  const captured = { error: [] as unknown[], info: [] as unknown[], warn: [] as unknown[] };
  let mode: 'hold' | 'ok' = 'hold';
  const worker = startWorker({
    market: {
      async takeSnapshot() {
        if (mode === 'hold') throw holdError();
        return snapshot;
      },
      evaluate() {
        return evaluation;
      },
    },
    logger: makeLogger(captured),
    intervalMs: 60_000,
  });

  for (let i = 0; i < 12; i += 1) await worker.tick();
  expect(captured.error).toHaveLength(1);
  const first = captured.error[0] as { fields: { suppressedSinceLast: number } };
  expect(first.fields.suppressedSinceLast).toBe(0);

  // Recovery resets the dedupe state, so the next hold transition logs immediately.
  mode = 'ok';
  await worker.tick();
  mode = 'hold';
  await worker.tick();
  expect(captured.error).toHaveLength(2);

  worker.stop();
  });

  it('keeps a sane repeat interval default', () => {
    expect(HOLD_REPEAT_LOG_MS).toBe(30 * 60 * 1000);
  });
});
