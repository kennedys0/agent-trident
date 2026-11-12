import { describe, expect, it } from 'vitest';
import { ChainClient } from '../src/chain/client.js';
import { DEFAULT_RPC_ALLOWED_HOSTS } from '../src/chain/rpc-guard.js';
import { EXPECTED_POOL, verifyVenue } from '../src/chain/venue.js';
import { openDatabase } from '../src/db/index.js';
import { seedReferenceData, insertSnapshot } from '../src/db/repositories.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';
import { createMarketService } from '../src/services/market.js';
import { USDG, WETH } from '../src/chain/venue.js';

const RUN = process.env['RUN_RPC_TESTS'] === '1';
const rpcUrl = process.env['RPC_URL'] ?? 'https://rpc.mainnet.chain.robinhood.com';

/**
 * Real-network checks. They are skipped by default so the unit suite stays
 * offline and deterministic; CI or a manual run sets RUN_RPC_TESTS=1.
 */
describe.skipIf(!RUN)('real Robinhood Chain RPC', () => {
  it('reports chain id 4663 and a live head block', async () => {
    const chain = new ChainClient({ rpcUrl, minIntervalMs: 100 });
    await expect(chain.assertChain()).resolves.toBe(4663);
    const head = await chain.getHead();
    expect(head.number).toBeGreaterThan(100_000_000);
    expect(head.hash).toMatch(/^0x[0-9a-f]{64}$/);
  }, 60_000);

  it('rejects a mismatched chain id', async () => {
    const chain = new ChainClient({
      rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
      // The testnet host is intentionally outside the default allowlist; opt in
      // here only so the chain-id mismatch path is what fails.
      allowedRpcHosts: [...DEFAULT_RPC_ALLOWED_HOSTS, 'rpc.testnet.chain.robinhood.com'],
      minIntervalMs: 100,
    });
    await expect(chain.assertChain()).rejects.toThrow(/does not match/);
  }, 60_000);

  it('derives the verified pool from the factory and reads token metadata', async () => {
    const chain = new ChainClient({ rpcUrl, minIntervalMs: 100 });
    const verified = await verifyVenue(chain);
    expect(verified.pool.id.toLowerCase()).toBe(EXPECTED_POOL.toLowerCase());
    expect(verified.pool.token0.id).toBe('WETH');
    expect(verified.pool.token1.id).toBe('USDG');
  }, 120_000);

  it('produces a block-pinned snapshot with provenance from real chain data', async () => {
    const chain = new ChainClient({ rpcUrl, minIntervalMs: 100 });
    const verified = await verifyVenue(chain);
    const db = openDatabase(':memory:');
    seedReferenceData(db, { venue: verified.venue, pool: verified.pool, assets: [WETH, USDG] });
    const market = createMarketService({ db, chain, pool: verified.pool, config: DEFAULT_STRATEGY_CONFIG, correlationId: 'rpc-test' });

    const snapshot = await market.takeSnapshot();
    expect(snapshot).not.toBeNull();
    if (snapshot === null) throw new Error('unreachable');
    expect(snapshot.chainId).toBe(4663);
    expect(snapshot.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(BigInt(snapshot.liquidity)).toBeGreaterThan(0n);
    // ≈2,060 USDG per WETH with 18 decimals of precision.
    expect(Number(BigInt(snapshot.priceScaled) / 10n ** 16n)).toBeGreaterThan(200_000);
    expect(snapshot.status).toBe('COMPLETE');
    insertSnapshot(db, snapshot);
    db.close();
  }, 120_000);
});