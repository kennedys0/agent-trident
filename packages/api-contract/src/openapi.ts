import './zod-openapi.js';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { z } from 'zod';

import {
  auditEventSchema,
  candidateSchema,
  createTradeIntentSchema,
  createWatchlistEntrySchema,
  errorBodySchema,
  evaluationSchema,
  gasEstimateSchema,
  healthSchema,
  intentExecutionSchema,
  journalPageSchema,
  liquidityMetricSchema,
  marketSnapshotSchema,
  paperFillSchema,
  paperOrderSchema,
  poolListSchema,
  poolSummarySchema,
  portfolioSchema,
  priceMetricSchema,
  riskDecisionSchema,
  tokenRefSchema,
  tradeIntentSchema,
  venueSchema,
  volumeMetricSchema,
  watchlistMutationSchema,
  watchlistSchema,
} from './domain.js';
import { idSchema, isoDateTimeSchema, evmAddressSchema } from './primitives.js';

const registry = new OpenAPIRegistry();
const schemas = {
  AuditEvent: auditEventSchema,
  Candidate: candidateSchema,
  CreateTradeIntent: createTradeIntentSchema,
  Error: errorBodySchema,
  Evaluation: evaluationSchema,
  GasEstimate: gasEstimateSchema,
  Health: healthSchema,
  IntentExecution: intentExecutionSchema,
  JournalPage: journalPageSchema,
  MarketSnapshot: marketSnapshotSchema,
  PaperFill: paperFillSchema,
  PaperOrder: paperOrderSchema,
  Portfolio: portfolioSchema,
  RiskDecision: riskDecisionSchema,
  LiquidityMetric: liquidityMetricSchema,
  PoolList: poolListSchema,
  PoolSummary: poolSummarySchema,
  PriceMetric: priceMetricSchema,
  TokenRef: tokenRefSchema,
  TradeIntent: tradeIntentSchema,
  Venue: venueSchema,
  VolumeMetric: volumeMetricSchema,
  Watchlist: watchlistSchema,
  WatchlistMutation: watchlistMutationSchema,
  CreateWatchlistEntry: createWatchlistEntrySchema,
};

for (const [name, schema] of Object.entries(schemas)) {
  registry.register(name, schema);
}

const requestMeta = z.object({ requestId: idSchema }).strict();
export const intentExecutionMetaSchema = z.object({
  requestId: idSchema,
  observedAt: isoDateTimeSchema,
  replayed: z.boolean(),
}).strict();
const intentExecutionResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: z.object({ data: intentExecutionSchema, meta: intentExecutionMetaSchema }).strict(),
    },
  },
});
const response = (name: string, data: z.ZodType) => ({
  description: name,
  content: {
    'application/json': {
      schema: z.object({ data, meta: requestMeta }).strict(),
    },
  },
});
const errorResponses = {
  400: {
    description: 'Invalid request',
    content: { 'application/json': { schema: z.object({ error: errorBodySchema }).strict() } },
  },
  500: {
    description: 'Internal error',
    content: { 'application/json': { schema: z.object({ error: errorBodySchema }).strict() } },
  },
};

const get = (path: string, name: string, data: z.ZodType) => registry.registerPath({
  method: 'get', path, responses: { 200: response(name, data), ...errorResponses },
});

get('/api/v1/health', 'System health', healthSchema);
get('/api/v1/venues', 'Verified venues', z.array(venueSchema));
get('/api/v1/markets/weth-usdg/snapshot', 'Latest market snapshot', marketSnapshotSchema);
get('/api/v1/candidates', 'Latest candidates', z.array(candidateSchema));
get('/api/v1/portfolio', 'Paper portfolio', portfolioSchema);
const addressParam = z.object({ address: evmAddressSchema }).strict();
const explorerQuery = z.object({
  search: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();
registry.registerPath({
  method: 'get',
  path: '/api/v1/pools',
  request: { query: explorerQuery },
  responses: { 200: response('Discover pool list', poolListSchema), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{address}',
  request: { params: addressParam },
  responses: { 200: response('Discover pool detail', poolSummarySchema), ...errorResponses, 404: {
    description: 'Unknown pool',
    content: { 'application/json': { schema: z.object({ error: errorBodySchema }).strict() } },
  } },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/watchlist',
  responses: { 200: response('Watchlist entries', watchlistSchema), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/watchlist',
  request: { body: { required: true, content: { 'application/json': { schema: createWatchlistEntrySchema } } } },
  responses: {
    201: response('Address added to the watchlist', watchlistMutationSchema),
    200: response('Address already on the watchlist', watchlistMutationSchema),
    ...errorResponses,
    404: {
      description: 'Unknown asset',
      content: { 'application/json': { schema: z.object({ error: errorBodySchema }).strict() } },
    },
  },
});
registry.registerPath({
  method: 'delete',
  path: '/api/v1/watchlist/{address}',
  request: { params: addressParam },
  responses: { 200: response('Watchlist remove result (idempotent)', watchlistMutationSchema), ...errorResponses },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/journal',
  request: { query: z.object({ cursor: z.string().optional() }) },
  responses: { 200: response('Journal page', journalPageSchema), ...errorResponses },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/intents',
  request: { body: { required: true, content: { 'application/json': { schema: createTradeIntentSchema } } } },
  responses: {
    201: intentExecutionResponse('Executed paper intent (fresh, approved)'),
    200: intentExecutionResponse('Idempotent replay or rejected execution'),
    ...errorResponses,
  },
});

export const openApiDocument: OpenAPIObject = new OpenApiGeneratorV31(registry.definitions).generateDocument({
  openapi: '3.1.0',
  info: { title: 'TRIDENT Paper API', version: '0.1.0' },
  servers: [{ url: '/' }],
});
