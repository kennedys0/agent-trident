import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { withTransaction } from './db/index.js';
import {
  appendAudit,
  engageHalt,
  getEvaluation,
  getFillByOrder,
  getIntentById,
  getLatestSnapshot,
  getOrderById,
  getPortfolio,
  getRiskDecisionByIntent,
  getSnapshotById,
  isKillSwitchEngaged,
  isEvaluationQuarantined,
  HALT_REASON_KEY,
  getState,
  KILL_SWITCH_KEY,
  listEvaluations,
  listJournal,
  releaseHalt,
} from './db/repositories.js';
import { AppError } from './errors.js';
import { effectiveStatus } from './domain/snapshot.js';
import type { PoolIdentity, StrategyConfig } from './domain/types.js';
import type { MarketService } from './services/market.js';
import { createIntentFromEvaluation, executeIntent } from './services/execution.js';
import type { ChainReadPort } from './chain/client.js';
import {
  toPoolList,
  toPoolSummaryFromRefresh,
  toPoolSummaryFromStored,
  toWatchlist,
  toWatchlistMutation,
} from './api/marketIntelMapper.js';
import {
  isWatchlisted,
  listWatchlistEntries,
  loadTrackedPools,
  refreshTrackedPool,
  storedStatus,
} from './services/marketIntel.js';
import { addWatchlistEntry, latestPoolMarketSnapshot, readDiscoveredPools, removeWatchlistEntry } from './db/marketIntelRepositories.js';
import type { QuotePort } from './services/ports.js';
import { maybeInjectFault, type FaultHooks } from './services/faults.js';
import { USDG, VERIFIED_VENUE, WETH } from './chain/venue.js';
import {
  toCandidate,
  toHealth,
  toIntentExecution,
  toJournal,
  toPaperFill,
  toPaperOrder,
  toPortfolio,
  toRiskDecision,
  toSnapshot,
  toTradeIntent,
  toVenue,
} from './api/contract.js';

export type HealthProbe = () => Promise<{ chainId: number; headBlock: number; latencyMs: number }>;

export type AppDeps = {
  readonly db: Db;
  readonly config: Config;
  readonly pool: PoolIdentity;
  readonly strategyConfig: StrategyConfig;
  readonly market: MarketService;
  readonly quote: QuotePort;
  readonly probe: HealthProbe;
  /** Optional: enables pool-refresh reads for Discover detail. Absent in offline tests. */
  readonly chain?: ChainReadPort | undefined;
  /** Test-only crash boundary seam; production leaves it undefined. */
  readonly faults?: FaultHooks | undefined;
};

type Envelope = { requestId: string };

function meta(requestId: string, extra: Record<string, unknown> = {}): Envelope & Record<string, unknown> {
  return { requestId, observedAt: new Date().toISOString(), ...extra };
}

function requestIdOf(request: FastifyRequest): string {
  return String(request.id);
}

const intentBodySchema = z.object({
  evaluationId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128),
});

const haltBodySchema = z.object({ engaged: z.boolean() });

// S3-02 Discover query/params schemas. Coercion on purpose: empty strings and
// junk numbers become NaN and fail validation instead of silently becoming 0.
const intelQuerySchema = z.object({
  search: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();
const intelAddressParamsSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
}).strict();
const createWatchlistEntryBodySchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
}).strict();

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: deps.config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    genReqId: () => randomUUID(),
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = requestIdOf(request);
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details ?? null, requestId },
      });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Request body failed validation', details: { issues: error.issues }, requestId },
      });
    }
    request.log.error({ err: error, requestId }, 'unhandled request error');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal error', details: null, requestId },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found', details: null, requestId: requestIdOf(request) } }),
  );

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      { requestId: requestIdOf(request), route: request.routeOptions.url, status: reply.statusCode, durationMs: reply.elapsedTime },
      'request completed',
    );
  });

  const haltReason = (): string | null => getState(deps.db, HALT_REASON_KEY);

  app.get('/health', async (request, reply) => {
    const requestId = requestIdOf(request);
    try {
      const probe = await deps.probe();
      const chainIdOk = probe.chainId === 4663;
      const data = toHealth({
        mode: deps.config.mode,
        chainId: probe.chainId,
        headBlock: probe.headBlock,
        lagSeconds: null,
      });
      return reply.status(chainIdOk ? 200 : 503).send({
        data,
        meta: meta(requestId, {
          expectedChainId: 4663,
          chainOk: chainIdOk,
          rpcLatencyMs: probe.latencyMs,
          killSwitchEngaged: isKillSwitchEngaged(deps.db),
          haltReason: haltReason(),
        }),
      });
    } catch {
      return reply.status(503).send({
        data: toHealth({ mode: deps.config.mode, chainId: null, headBlock: null, lagSeconds: null }),
        meta: meta(requestId, { expectedChainId: 4663, chainOk: false, rpcLatencyMs: null, killSwitchEngaged: isKillSwitchEngaged(deps.db), haltReason: haltReason() }),
      });
    }
  });

  app.get('/api/v1/venues', async (request, reply) => {
    const requestId = requestIdOf(request);
    return reply.send({
      data: [toVenue(VERIFIED_VENUE, deps.pool)],
      meta: meta(requestId, {
        venueId: VERIFIED_VENUE.id,
        quoterV2: VERIFIED_VENUE.quoterV2,
        swapRouter02: VERIFIED_VENUE.swapRouter02,
        tickSpacing: deps.pool.tickSpacing,
        assets: [WETH, USDG],
      }),
    });
  });

  app.get('/api/v1/markets/weth-usdg/snapshot', async (request, reply) => {
    const requestId = requestIdOf(request);
    const stored = getLatestSnapshot(deps.db, deps.pool.id);
    if (!stored) throw new AppError('NOT_FOUND', 'No market snapshot has been recorded yet');
    const status = effectiveStatus(stored, new Date(), deps.strategyConfig.maxStalenessSeconds);
    return reply.send({
      data: toSnapshot(stored, deps.pool, status),
      meta: meta(requestId, {
        snapshotId: stored.id,
        priceScaled: stored.priceScaled,
        priceScale: stored.priceScale,
        sqrtPriceX96: stored.sqrtPriceX96,
        tick: stored.tick,
        poolLiquidity: stored.liquidity,
        status,
      }),
    });
  });

  app.get('/api/v1/candidates', async (request, reply) => {
    const requestId = requestIdOf(request);
    const limit = Math.min(50, Math.max(1, Number((request.query as { limit?: string }).limit ?? 20)));
    const candidates = listEvaluations(deps.db, limit).flatMap((evaluation) => {
      const snapshot = getSnapshotById(deps.db, evaluation.snapshotId);
      return snapshot === null ? [] : [toCandidate(evaluation, snapshot, deps.pool)];
    });
    return reply.send({
      data: candidates,
      meta: meta(requestId, { strategyId: deps.strategyConfig.strategyId, configVersion: deps.strategyConfig.version }),
    });
  });

  app.post('/api/v1/intents', async (request, reply) => {
    const requestId = requestIdOf(request);
    const body = intentBodySchema.parse(request.body);
    const evaluation = getEvaluation(deps.db, body.evaluationId);
    if (!evaluation) throw new AppError('NOT_FOUND', 'EvaluationRecord not found');
    // A reorg quarantined this evaluation's block; its price is no longer
    // canonical, so it must never produce a paper execution.
    if (isEvaluationQuarantined(deps.db, evaluation.id)) {
      throw new AppError('CONFLICT', 'Evaluation was quarantined by a chain reorg and requires manual review');
    }

    const intent = createIntentFromEvaluation(deps.db, {
      evaluation,
      idempotencyKey: body.idempotencyKey,
      correlationId: requestId,
      mode: deps.config.mode,
      faults: deps.faults,
      allowlistPoolId: deps.pool.id,
    });
    const view = await executeIntent(
      {
        db: deps.db,
        quote: deps.quote,
        pool: deps.pool,
        config: deps.strategyConfig,
        mode: deps.config.mode,
        correlationId: requestId,
        faults: deps.faults,
      },
      intent.id,
    );
    const stored = getSnapshotById(deps.db, view.intent.snapshotId);
    if (stored === null || view.riskDecision === null) {
      throw new AppError('CONFLICT', 'Intent executed without its snapshot or risk decision');
    }
    const order = view.orderId === null ? null : getOrderById(deps.db, view.orderId);
    const fill = order === null ? null : getFillByOrder(deps.db, order['id'] as string);
    const execution = toIntentExecution({
      intent: toTradeIntent(view.intent, deps.pool, stored),
      riskDecision: toRiskDecision(view.riskDecision),
      order: order === null ? null : toPaperOrder(order),
      fill: order === null || fill === null ? null : toPaperFill(fill, view.intent.side, stored.priceScale),
    });
    const status = view.riskDecision.verdict === 'APPROVED' ? 201 : 200;
    return reply.status(view.replayed ? 200 : status).send({
      data: execution,
      meta: meta(requestId, { replayed: view.replayed }),
    });
  });

  app.get('/api/v1/intents/:id', async (request, reply) => {
    const requestId = requestIdOf(request);
    const id = (request.params as { id: string }).id;
    const intent = getIntentById(deps.db, id);
    if (!intent) throw new AppError('NOT_FOUND', 'Intent not found');
    const stored = getSnapshotById(deps.db, intent.snapshotId);
    if (stored === null) throw new AppError('CONFLICT', 'Intent points at a snapshot that does not exist');
    const decision = getRiskDecisionByIntent(deps.db, id);
    return reply.send({
      data: {
        intent: toTradeIntent(intent, deps.pool, stored),
        riskDecision: decision === null ? null : toRiskDecision(decision),
      },
      meta: meta(requestId),
    });
  });

  app.get('/api/v1/portfolio', async (request, reply) => {
    const requestId = requestIdOf(request);
    const stored = getLatestSnapshot(deps.db, deps.pool.id);
    const status = stored ? effectiveStatus(stored, new Date(), deps.strategyConfig.maxStalenessSeconds) : 'UNAVAILABLE';
    const state = getPortfolio(deps.db, stored ? stored.priceScaled : null, stored ? stored.priceScale : 18);
    const portfolio = toPortfolio(state, {
      pool: deps.pool,
      snapshotId: stored ? stored.id : null,
      priceScaled: stored ? stored.priceScaled : null,
      priceScale: stored ? stored.priceScale : 18,
    });
    return reply.send({
      data: portfolio,
      meta: meta(requestId, {
        simulated: true,
        priceStatus: status,
        priceAsOf: stored?.sourceTime ?? null,
        portfolioVersion: state.portfolioVersion,
      }),
    });
  });

  app.get('/api/v1/journal', async (request, reply) => {
    const requestId = requestIdOf(request);
    const query = request.query as { limit?: string; before?: string };
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));
    const before = query.before === undefined ? undefined : Number(query.before);
    const rows = listJournal(deps.db, limit, Number.isFinite(before) ? before : undefined);
    return reply.send({ data: toJournal(rows, limit), meta: meta(requestId) });
  });

  app.post('/api/v1/system/halt', async (request, reply) => {
    const requestId = requestIdOf(request);
    const body = haltBodySchema.parse(request.body);
    // AT-16: the automation state, its reason, and its audit event commit
    // together, so a crash cannot change the kill switch without a journal entry.
    withTransaction(deps.db, () => {
      if (body.engaged) {
        engageHalt(deps.db, 'OPERATOR');
        maybeInjectFault(deps.faults, 'automation.state');
        appendAudit(deps.db, {
          actor: 'operator',
          action: 'system.halt.engaged',
          entity: 'automation_state',
          entityId: KILL_SWITCH_KEY,
          correlationId: requestId,
          payload: { reason: 'OPERATOR' },
        });
      } else {
        releaseHalt(deps.db);
        maybeInjectFault(deps.faults, 'automation.state');
        appendAudit(deps.db, {
          actor: 'operator',
          action: 'system.halt.released',
          entity: 'automation_state',
          entityId: KILL_SWITCH_KEY,
          correlationId: requestId,
        });
      }
    });
    return reply.send({
      data: { killSwitchEngaged: body.engaged, haltReason: getState(deps.db, HALT_REASON_KEY) },
      meta: meta(requestId),
    });
  });

  const intelAssets = [WETH, USDG];
  const intelVerified = () => ({
    pool: deps.pool,
    venueFactory: VERIFIED_VENUE.factory,
    verifiedAssets: intelAssets,
  });
  const knownTokenMap = (): Map<string, string> => {
    const map = new Map<string, string>();
    for (const asset of intelAssets) map.set(asset.address.toLowerCase(), asset.symbol);
    try {
      for (const record of readDiscoveredPools(deps.db)) {
        map.set(record.token0.toLowerCase(), record.token0Symbol);
        map.set(record.token1.toLowerCase(), record.token1Symbol);
      }
    } catch {
      // Registry unreadable: verified allowlist stays known, discovered list is empty + reported via meta.
    }
    return map;
  };

  app.get('/api/v1/pools', async (request, reply) => {
    const requestId = requestIdOf(request);
    const parsed = intelQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid query parameters for pool discovery', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    const { search, limit, offset } = parsed.data;
    const loaded = loadTrackedPools(deps.db, intelVerified());
    const needle = search?.toLowerCase();
    const matches = needle
      ? loaded.pools.filter(
          (pool) =>
            pool.pool.includes(needle) ||
            pool.token0.address.includes(needle) ||
            pool.token1.address.includes(needle) ||
            pool.token0.symbol.toLowerCase().includes(needle) ||
            pool.token1.symbol.toLowerCase().includes(needle),
        )
      : loaded.pools;
    const known = knownTokenMap();
    const now = new Date();
    const summaries = matches.map((pool) => {
      const row = latestPoolMarketSnapshot(deps.db, pool.pool);
      const stored = storedStatus(row, deps.config.marketFreshnessSeconds, now);
      const watched =
        isWatchlisted(deps.db, pool.token0.address.toLowerCase()) ||
        isWatchlisted(deps.db, pool.token1.address.toLowerCase());
      return toPoolSummaryFromStored(pool, row, stored.status, stored.reason, watched);
    });
    const total = summaries.length;
    const page = summaries.slice(offset, offset + limit);
    return reply.send({
      data: toPoolList(page, offset, limit, total),
      meta: meta(requestId, {
        registryStatus: loaded.registryStatus,
        registrySkipped: loaded.registrySkipped,
        trackedPools: loaded.pools.length,
        watchlistEntries: listWatchlistEntries(deps.db).length,
      }),
    });
  });

  app.get('/api/v1/pools/:address', async (request, reply) => {
    const requestId = requestIdOf(request);
    const params = intelAddressParamsSchema.safeParse(request.params ?? {});
    if (!params.success) {
      throw new AppError('VALIDATION_ERROR', 'Pool address parameter is malformed');
    }
    const address = params.data.address.toLowerCase();
    const loaded = loadTrackedPools(deps.db, intelVerified());
    const tracked = loaded.pools.find((pool) => pool.pool === address);
    if (!tracked) {
      throw new AppError('NOT_FOUND', 'Pool is not tracked by discovery or the verified allowlist');
    }
    const watched =
      isWatchlisted(deps.db, tracked.token0.address.toLowerCase()) ||
      isWatchlisted(deps.db, tracked.token1.address.toLowerCase());
    const now = new Date();

    if (deps.chain !== undefined) {
      try {
        const refreshed = await refreshTrackedPool({
          db: deps.db,
          chain: deps.chain,
          tracked,
          freshnessSeconds: deps.config.marketFreshnessSeconds,
          now,
        });
        return reply.send({
          data: toPoolSummaryFromRefresh(tracked, refreshed, watched),
          meta: meta(requestId, { registryStatus: loaded.registryStatus, registrySkipped: loaded.registrySkipped }),
        });
      } catch (error) {
        // Fall back to the latest stored observation when the refresh fails; never fabricate.
        const row = latestPoolMarketSnapshot(deps.db, tracked.pool);
        if (row !== null) {
          const stored = storedStatus(row, deps.config.marketFreshnessSeconds, now);
          return reply.send({
            data: toPoolSummaryFromStored(tracked, row, stored.status, stored.reason, watched),
            meta: meta(requestId, {
              registryStatus: loaded.registryStatus,
              refreshError: error instanceof Error ? error.message : String(error),
            }),
          });
        }
        return reply.send({
          data: toPoolSummaryFromStored(tracked, null, 'UNAVAILABLE', 'pool observation unavailable; RPC refresh failed', watched),
          meta: meta(requestId, {
            registryStatus: loaded.registryStatus,
            refreshError: error instanceof Error ? error.message : String(error),
          }),
        });
      }
    }

    const row = latestPoolMarketSnapshot(deps.db, tracked.pool);
    const stored = storedStatus(row, deps.config.marketFreshnessSeconds, now);
    return reply.send({
      data: toPoolSummaryFromStored(tracked, row, stored.status, stored.reason, watched),
      meta: meta(requestId, { registryStatus: loaded.registryStatus }),
    });
  });

  app.get('/api/v1/watchlist', async (request, reply) => {
    const requestId = requestIdOf(request);
    const known = knownTokenMap();
    const entries = listWatchlistEntries(deps.db).map((entry) => ({
      address: entry.address,
      addedAt: entry.addedAt,
      known: known.has(entry.address.toLowerCase()),
      ...(known.has(entry.address.toLowerCase()) ? { symbol: known.get(entry.address.toLowerCase()) } : {}),
    }));
    return reply.send({ data: toWatchlist(entries, (address) => ({ known: known.has(address.toLowerCase()), symbol: known.get(address.toLowerCase()) })), meta: meta(requestId) });
  });

  app.post('/api/v1/watchlist', async (request, reply) => {
    const requestId = requestIdOf(request);
    const body = createWatchlistEntryBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      throw new AppError('VALIDATION_ERROR', 'Watchlist body must contain a valid 0x token address');
    }
    const address = body.data.address.toLowerCase();
    const known = knownTokenMap();
    if (!known.has(address)) {
      throw new AppError('NOT_FOUND', 'Unknown asset; only tokens of tracked pools or the verified allowlist can be watched');
    }
    const result = addWatchlistEntry(deps.db, address);
    return reply.status(result === 'ADDED' ? 201 : 200).send({
      data: toWatchlistMutation(address, result),
      meta: meta(requestId),
    });
  });

  app.delete('/api/v1/watchlist/:address', async (request, reply) => {
    const requestId = requestIdOf(request);
    const params = intelAddressParamsSchema.safeParse(request.params ?? {});
    if (!params.success) {
      throw new AppError('VALIDATION_ERROR', 'Watchlist address parameter is malformed');
    }
    const address = params.data.address.toLowerCase();
    const result = removeWatchlistEntry(deps.db, address);
    return reply.send({
      data: toWatchlistMutation(address, result),
      meta: meta(requestId),
    });
  });

  return app;
}

export type { FastifyReply };