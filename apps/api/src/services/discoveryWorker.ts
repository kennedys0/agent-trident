import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import type { ChainClient } from '../chain/client.js';
import { runDiscoveryTick, verifyFactory, FactoryMismatchError, type DiscoveryChainPort } from './discovery.js';

export const DISCOVERY_INTERVAL_MS = 30_000;

export type DiscoveryWorker = { readonly tick: () => Promise<void>; readonly stop: () => void };

/**
 * Binds a live ChainClient to the discovery port. The port is deliberately
 * narrow so tests can inject a deterministic chain without touching the
 * guarded RPC transport.
 */
export function makeDiscoveryPort(chain: ChainClient): DiscoveryChainPort {
  return {
    getHead: () => chain.getHead(),
    getBlockByNumber: (blockNumber) => chain.getBlockByNumber(blockNumber),
    getCodeSize: (address) => chain.getCodeSize(address as `0x${string}`),
    getBytecode: (address) => chain.getBytecode(address as `0x${string}`),
    readSymbol: (address) => chain.readSymbol(address as `0x${string}`),
    readDecimals: (address) => chain.readDecimals(address as `0x${string}`),
    getLogs: (request) =>
      chain.getLogs({
        address: request.address as `0x${string}`,
        fromBlock: request.fromBlock,
        toBlock: request.toBlock,
        topics: request.topics,
      }),
  };
}

export function startDiscoveryWorker(input: {
  readonly db: Db;
  readonly chain: DiscoveryChainPort;
  readonly logger: FastifyBaseLogger;
  readonly correlationId: string;
  readonly intervalMs?: number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}): DiscoveryWorker {
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  let factoryOk = false;
  let factoryChecked = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (!factoryChecked) {
        factoryChecked = true;
        try {
          await verifyFactory(input.chain);
          factoryOk = true;
        } catch (error) {
          input.logger.error({ err: error }, 'factory verification failed; discovery disabled for this process');
          return;
        }
      }
      if (!factoryOk) return;
      const result = await runDiscoveryTick({ db: input.db, chain: input.chain, correlationId: input.correlationId });
      if (result.status === 'UNAVAILABLE') {
        input.logger.warn({ kind: 'discovery', detail: result.detail }, 'discovery unavailable; entries unaffected, registry frozen');
      } else if (result.accepted > 0 || result.skippedEvents > 0 || result.skippedRows > 0) {
        input.logger.info({ accepted: result.accepted, skippedEvents: result.skippedEvents, skippedRows: result.skippedRows, detail: result.detail }, 'discovery tick');
      }
    } catch (error) {
      // Discovery must never take down the API or the PAPER slice.
      if (error instanceof FactoryMismatchError) {
        input.logger.error({ err: error }, 'factory bytecode mismatch; discovery disabled for this process');
      } else {
        input.logger.error({ err: error }, 'discovery tick failed');
      }
    } finally {
      running = false;
    }
  };

  const schedule = input.setIntervalFn ?? setInterval;
  const cancel = input.clearIntervalFn ?? clearInterval;
  timer = schedule(() => {
    void tick();
  }, input.intervalMs ?? DISCOVERY_INTERVAL_MS);
  timer.unref?.();

  return {
    tick,
    stop: () => {
      if (timer !== null) cancel(timer);
      timer = null;
    },
  };
}
