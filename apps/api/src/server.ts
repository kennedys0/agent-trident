import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { acquireInstanceLock, releaseInstanceLock } from './db/lock.js';
import { seedOpeningCash, seedReferenceData, seedStrategyConfig } from './db/repositories.js';
import { ChainClient } from './chain/client.js';
import { USDG, VERIFIED_VENUE, WETH, verifyVenue } from './chain/venue.js';
import { DEFAULT_STRATEGY_CONFIG } from './domain/strategy.js';
import { createMarketService } from './services/market.js';
import { createQuotePort } from './services/ports.js';
import { buildApp } from './app.js';
import { startWorker } from './worker.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  acquireInstanceLock(db);

  const chain = new ChainClient({ rpcUrl: config.rpcUrl });
  const chainId = await chain.assertChain();
  const verified = await verifyVenue(chain);

  seedReferenceData(db, { venue: verified.venue, pool: verified.pool, assets: [WETH, USDG] });
  seedStrategyConfig(db, DEFAULT_STRATEGY_CONFIG);
  seedOpeningCash(db, config.openingCashUsdgBase);

  const market = createMarketService({
    db,
    chain,
    pool: verified.pool,
    config: DEFAULT_STRATEGY_CONFIG,
    correlationId: 'bootstrap',
  });

  const app = buildApp({
    db,
    config,
    pool: verified.pool,
    strategyConfig: DEFAULT_STRATEGY_CONFIG,
    market,
    quote: createQuotePort(chain, verified.venue),
    probe: async () => {
      const started = Date.now();
      const head = await chain.getHead();
      return { chainId, headBlock: head.number, latencyMs: Date.now() - started };
    },
  });

  const worker = startWorker({ market, logger: app.log });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    worker.stop();
    await app.close();
    releaseInstanceLock(db);
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { mode: config.mode, chainId, pool: verified.pool.id, host: config.host, port: config.port },
    'TRIDENT API ready (paper only)',
  );

  void worker.tick();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: 'fatal', message, at: new Date().toISOString() }));
  process.exit(1);
});

export { VERIFIED_VENUE };