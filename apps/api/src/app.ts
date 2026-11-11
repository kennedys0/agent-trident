import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import {
  appendAudit,
  getEvaluation,
  getLatestSnapshot,
  getPortfolio,
  getRiskDecisionByIntent,
  isKillSwitchEngaged,
  KILL_SWITCH_KEY,
  listEvaluations,
  listJournal,
  setState,
} from './db/repositories.js';
import { AppError } from './errors.js';
import { effectiveStatus } from './domain/snapshot.js';
import type { PoolIdentity, StrategyConfig } from './domain/types.js';
import type { MarketService } from './services/market.js';
import { createIntentFromEvaluation, executeIntent } from './services/execution.js';
import type { QuotePort } from './services/ports.js';
import { USDG, VERIFIED_FEE, VERIFIED_VENUE, WETH } from './chain/venue.js';

export type HealthProbe = () => Promise<{ chainId: number; headBlock: number; latencyMs: number }>;

export type AppDeps = {
  readonly db: Db;
  readonly config: Config;
  readonly pool: PoolIdentity;
  readonly strategyConfig: StrategyConfig;
  readonly market: MarketService;
  readonly quote: QuotePort;
  readonly probe: HealthProbe;
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

  app.get('/health', async (request, reply) => {
    const requestId = requestIdOf(request);
    try {
      const probe = await deps.probe();
      const chainIdOk = probe.chainId === 4663;
      const body = {
        data: {
          mode: deps.config.mode,
          chainId: probe.chainId,
          expectedChainId: 4663,
          chainOk: chainIdOk,
          headBlock: probe.headBlock,
          rpcLatencyMs: probe.latencyMs,
          killSwitchEngaged: isKillSwitchEngaged(deps.db),
        },
        meta: meta(requestId),
      };
      return reply.status(chainIdOk ? 200 : 503).send(body);
    } catch {
      return reply.status(503).send({
        data: {
          mode: deps.config.mode,
          chainId: null,
          expectedChainId: 4663,
          chainOk: false,
          headBlock: null,
          rpcLatencyMs: null,
          killSwitchEngaged: isKillSwitchEngaged(deps.db),
        },
        meta: meta(requestId),
      });
    }
  });

  app.get('/api/v1/venues', async (request, reply) => {
    const requestId = requestIdOf(request);
    return reply.send({
      data: {
        venues: [
          {
            venueId: VERIFIED_VENUE.id,
            chainId: 4663,
            factory: VERIFIED_VENUE.factory,
            quoterV2: VERIFIED_VENUE.quoterV2,
            swapRouter02: VERIFIED_VENUE.swapRouter02,
            provenance: VERIFIED_VENUE.provenance,
            assets: [WETH, USDG],
            pool: {
              id: deps.pool.id,
              fee: deps.pool.fee,
              tickSpacing: deps.pool.tickSpacing,
              token0: deps.pool.token0.id,
              token1: deps.pool.token1.id,
            },
          },
        ],
      },
      meta: meta(requestId),
    });
  });

  app.get('/api/v1/markets/weth-usdg/snapshot', async (request, reply) => {
    const requestId = requestIdOf(request);
    const stored = getLatestSnapshot(deps.db, deps.pool.id);
    if (!stored) throw new AppError('NOT_FOUND', 'No market snapshot has been recorded yet');
    const status = effectiveStatus(stored, new Date(), deps.strategyConfig.maxStalenessSeconds);
    return reply.send({ data: { ...stored, status }, meta: meta(requestId) });
  });

  app.get('/api/v1/candidates', async (request, reply) => {
    const requestId = requestIdOf(request);
    const limit = Math.min(50, Math.max(1, Number((request.query as { limit?: string }).limit ?? 20)));
    return reply.send({
      data: listEvaluations(deps.db, limit),
      meta: meta(requestId, { strategyId: deps.strategyConfig.strategyId, configVersion: deps.strategyConfig.version }),
    });
  });

  app.post('/api/v1/intents', async (request, reply) => {
    const requestId = requestIdOf(request);
    const body = intentBodySchema.parse(request.body);
    const evaluation = getEvaluation(deps.db, body.evaluationId);
    if (!evaluation) throw new AppError('NOT_FOUND', 'Evaluation not found');

    const intent = createIntentFromEvaluation(deps.db, {
      evaluation,
      idempotencyKey: body.idempotencyKey,
      correlationId: requestId,
      mode: deps.config.mode,
    });
    const view = await executeIntent(
      {
        db: deps.db,
        quote: deps.quote,
        pool: deps.pool,
        config: deps.strategyConfig,
        mode: deps.config.mode,
        correlationId: requestId,
      },
      intent.id,
    );
    const status = view.riskDecision?.verdict === 'APPROVED' ? 201 : 200;
    return reply.status(view.replayed ? 200 : status).send({
      data: {
        intent: view.intent,
        riskDecision: view.riskDecision,
        orderId: view.orderId,
        fillId: view.fillId,
        replayed: view.replayed,
      },
      meta: meta(requestId, { fee: VERIFIED_FEE }),
    });
  });

  app.get('/api/v1/intents/:id', async (request, reply) => {
    const requestId = requestIdOf(request);
    const id = (request.params as { id: string }).id;
    const intent = deps.db.prepare('SELECT * FROM order_intents WHERE id = ?').get(id);
    if (!intent) throw new AppError('NOT_FOUND', 'Intent not found');
    return reply.send({ data: { intent, riskDecision: getRiskDecisionByIntent(deps.db, id) }, meta: meta(requestId) });
  });

  app.get('/api/v1/portfolio', async (request, reply) => {
    const requestId = requestIdOf(request);
    const stored = getLatestSnapshot(deps.db, deps.pool.id);
    const status = stored ? effectiveStatus(stored, new Date(), deps.strategyConfig.maxStalenessSeconds) : 'UNAVAILABLE';
    const portfolio = getPortfolio(deps.db, stored ? stored.priceScaled : null, stored ? stored.priceScale : 18);
    return reply.send({
      data: { ...portfolio, mode: 'PAPER', simulated: true, priceStatus: status, priceAsOf: stored?.sourceTime ?? null },
      meta: meta(requestId),
    });
  });

  app.get('/api/v1/journal', async (request, reply) => {
    const requestId = requestIdOf(request);
    const query = request.query as { limit?: string; before?: string };
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));
    const before = query.before === undefined ? undefined : Number(query.before);
    const rows = listJournal(deps.db, limit, Number.isFinite(before) ? before : undefined);
    return reply.send({ data: rows, meta: meta(requestId) });
  });

  app.post('/api/v1/system/halt', async (request, reply) => {
    const requestId = requestIdOf(request);
    const body = haltBodySchema.parse(request.body);
    setState(deps.db, KILL_SWITCH_KEY, String(body.engaged));
    appendAudit(deps.db, {
      actor: 'operator',
      action: body.engaged ? 'system.halt.engaged' : 'system.halt.released',
      entity: 'automation_state',
      entityId: KILL_SWITCH_KEY,
      correlationId: requestId,
    });
    return reply.send({ data: { killSwitchEngaged: body.engaged }, meta: meta(requestId) });
  });

  return app;
}

export type { FastifyReply };