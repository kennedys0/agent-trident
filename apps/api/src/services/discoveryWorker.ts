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
    async getCodeSize(address) {
      const code = await chain.raw.getCode({ address: address as `0x${string}` });
      return code === undefined ? 0 : (code.length - 2) / 2;
    },
    async getBytecode(address) {
      const code = await chain.raw.getBytecode({ address: address as `0x${string}` });
      return code as `0x${string}` | undefined;
    },
    readSymbol: (address) => chain.readSymbol(address as `0x${string}`),
    readDecimals: (address) => chain.readDecimals(address as `0x${string}`),
    async getLogs(request) {
      const logs = await chain.raw.getLogs({
        address: request.address as `0x${string}`,
        fromBlock: BigInt(request.fromBlock),
        toBlock: BigInt(request.toBlock),
        event: {
          type: 'event',
          name: 'PoolCreated',
          inputs: [
            { type: 'address', name: 'token0', indexed: true },
            { type: 'address', name: 'token1', indexed: true },
            { type: 'uint24', name: 'fee', indexed: false },
            { type: 'int24', name: 'tickSpacing', indexed: false },
            { type: 'address', name: 'pool', indexed: false },
          ],
        },
      });
      return logs.map((log, index) => ({
        address: log.address,
        topics: [...log.topics],
        data: log.data,
        blockNumber: Number(log.blockNumber),
        transactionHash: log.transactionHash ?? `0x${'0'.repeat(64)}`,
        logIndex: log.logIndex === undefined ? index : Number(log.logIndex),
      }));
    },
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
