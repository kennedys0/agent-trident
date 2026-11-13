import { describe, expect, it } from 'vitest';
import { createPublicClient, defineChain, http, keccak256, getAddress } from 'viem';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/db/index.js';
import { runDiscoveryTick, verifyFactory, FactoryMismatchError } from '../src/services/discovery.js';
import { makeDiscoveryPort } from '../src/services/discoveryWorker.js';
import { ChainClient } from '../src/chain/client.js';
import { POOL_CREATED_TOPIC, UNISWAP_V3_FACTORY } from '../src/chain/poolCodec.js';
import { WETH, USDG, VERIFIED_VENUE } from '../src/chain/venue.js';
import { seedReferenceData, seedOpeningCash, seedStrategyConfig } from '../src/db/repositories.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';
import { countDiscoveredPools, getDiscoveryCheckpoint, saveDiscoveryCheckpoint } from '../src/db/discoveryRepositories.js';

const RPC_URL = process.env['RPC_URL'] ?? 'https://rpc.mainnet.chain.robinhood.com';
const RUN_RPC = process.env['RUN_RPC_TESTS'] === '1';

if (RUN_RPC) {
  describe('real-RPC discovery (RUN_RPC_TESTS=1)', () => {
    const chain = new ChainClient({ rpcUrl: RPC_URL, allowedRpcHosts: [new URL(RPC_URL).hostname] });
    const port = makeDiscoveryPort(chain);

    it('verifies the factory bytecode against the pinned constant', async () => {
      await expect(verifyFactory(port)).resolves.toBeUndefined();
    });

    it('refuses a wrong factory', async () => {
      const fake = { ...port, getCodeSize: async () => 1_000 };
      await expect(verifyFactory(fake)).rejects.toBeInstanceOf(FactoryMismatchError);
    });

    it('discovers real PoolCreated events in a bounded scan and persists coherent rows', async () => {
      const db = openDatabase(':memory:');
      seedReferenceData(db, { venue: VERIFIED_VENUE, pool: { id: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca', venueId: VERIFIED_VENUE.id, token0: WETH, token1: USDG, fee: 100, tickSpacing: 1 }, assets: [WETH, USDG] });
      seedStrategyConfig(db, DEFAULT_STRATEGY_CONFIG);
      seedOpeningCash(db, '10000000000');
      // Seed the checkpoint at a block that contains real PoolCreated events,
      // so the live scan is bounded and deterministic despite the chain moving.
      saveDiscoveryCheckpoint(db, { fromBlock: 112_712_000, toBlock: 112_712_000, blockHash: null });
      const result = await runDiscoveryTick({ db, chain: port, correlationId: 'discovery-rpc' });
      expect(result.status).toBe('OK');
      expect(result.accepted).toBeGreaterThanOrEqual(1);
      const pools = db.prepare('SELECT pool_address, token0, token1, fee, tick_spacing, first_seen_block FROM discovered_pools').all() as { pool_address: string; token0: string; token1: string; fee: number; tick_spacing: number; first_seen_block: number }[];
      for (const pool of pools) {
        expect(pool.pool_address).toMatch(/^0x[0-9a-f]{40}$/);
        expect(pool.token0).toMatch(/^0x[0-9a-f]{40}$/);
        expect(pool.token1).toMatch(/^0x[0-9a-f]{40}$/);
        expect(pool.token0.localeCompare(pool.token1)).toBeLessThan(0);
        expect([100, 500, 3000, 10000]).toContain(pool.fee);
        expect(pool.tick_spacing).toBeGreaterThan(0);
        expect(pool.first_seen_block).toBeGreaterThanOrEqual(0);
      }
      const checkpoint = getDiscoveryCheckpoint(db)!;
      expect(checkpoint.toBlock).toBeGreaterThan(0);
      db.close();
    }, 300_000);

    it('stays deterministic: a second tick over the same range inserts no duplicates', async () => {
      const db = openDatabase(':memory:');
      seedReferenceData(db, { venue: VERIFIED_VENUE, pool: { id: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca', venueId: VERIFIED_VENUE.id, token0: WETH, token1: USDG, fee: 100, tickSpacing: 1 }, assets: [WETH, USDG] });
      seedStrategyConfig(db, DEFAULT_STRATEGY_CONFIG);
      seedOpeningCash(db, '10000000000');
      saveDiscoveryCheckpoint(db, { fromBlock: 112_712_000, toBlock: 112_712_000, blockHash: null });
      await runDiscoveryTick({ db, chain: port, correlationId: 'discovery-rpc' });
      const afterFirst = countDiscoveredPools(db);
      await runDiscoveryTick({ db, chain: port, correlationId: 'discovery-rpc' });
      expect(countDiscoveredPools(db)).toBe(afterFirst);
      db.close();
    }, 60_000);
  });
} else {
  describe('real-RPC discovery (skipped — set RUN_RPC_TESTS=1)', () => {
    it.skip('requires explicit opt-in against the live chain', () => {});
  });
}
