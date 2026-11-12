import './zod-openapi.js';
import { z } from 'zod';
import {
  baseUnitAmountSchema,
  baseUnitStringSchema,
  chainIdSchema,
  evmAddressSchema,
  idempotencyKeySchema,
  idSchema,
  isoDateTimeSchema,
  positiveBaseUnitAmountSchema,
  positiveBaseUnitStringSchema,
  scaledIntegerSchema,
  signedBaseUnitAmountSchema,
  transactionHashSchema,
  versionSchema,
} from './primitives.js';

const observationSchema = z.object({
  chainId: chainIdSchema,
  poolAddress: evmAddressSchema,
  baseToken: evmAddressSchema,
  quoteToken: evmAddressSchema,
  blockNumber: positiveBaseUnitStringSchema,
  blockHash: transactionHashSchema,
  sourceTime: isoDateTimeSchema,
  observedAt: isoDateTimeSchema,
  source: z.string().min(1).max(128),
});

const observedMarketSchema = observationSchema.extend({
  reservesBase: baseUnitAmountSchema,
  reservesQuote: baseUnitAmountSchema,
  price: scaledIntegerSchema,
  liquidityQuote: baseUnitAmountSchema,
});

export const marketSnapshotSchema = z.discriminatedUnion('status', [
  observedMarketSchema.extend({ status: z.literal('COMPLETE') }).strict(),
  observedMarketSchema.extend({ status: z.literal('STALE') }).strict(),
  observationSchema.extend({
    status: z.literal('INCOMPLETE'),
    missingInputs: z.array(z.string().min(1)).min(1),
  }).strict(),
  observationSchema.extend({
    status: z.literal('UNAVAILABLE'),
    reason: z.string().min(1),
  }).strict(),
]);

const evaluationBaseSchema = z.object({
  id: idSchema,
  snapshotId: idSchema,
  snapshotStatus: z.enum(['COMPLETE', 'STALE', 'INCOMPLETE', 'UNAVAILABLE']),
  strategyId: idSchema,
  configVersion: versionSchema,
  inputHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  signalStrength: z.number().int().min(0).max(10_000),
  invalidation: z.string().min(1),
  reasons: z.array(z.string().min(1)),
  evaluatedAt: isoDateTimeSchema,
});

export const evaluationSchema = z.discriminatedUnion('action', [
  evaluationBaseSchema.extend({
    action: z.literal('BUY'),
    snapshotStatus: z.literal('COMPLETE'),
    proposedBaseQty: positiveBaseUnitStringSchema,
  }).strict(),
  evaluationBaseSchema.extend({
    action: z.literal('SELL'),
    proposedBaseQty: baseUnitStringSchema.optional(),
  }).strict(),
  evaluationBaseSchema.extend({
    action: z.literal('HOLD'),
    proposedBaseQty: baseUnitStringSchema.optional(),
  }).strict(),
  evaluationBaseSchema.extend({
    action: z.literal('WAIT'),
    proposedBaseQty: baseUnitStringSchema.optional(),
  }).strict(),
  evaluationBaseSchema.extend({
    action: z.literal('AVOID'),
    proposedBaseQty: baseUnitStringSchema.optional(),
  }).strict(),
]);

export const tradeIntentSchema = z.object({
  id: idSchema,
  evaluationId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  mode: z.literal('PAPER'),
  side: z.enum(['BUY', 'SELL']),
  token: evmAddressSchema,
  quoteToken: evmAddressSchema,
  baseQty: positiveBaseUnitStringSchema,
  limitPrice: scaledIntegerSchema,
  snapshotId: idSchema,
  expiresAt: isoDateTimeSchema,
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'ORDERED', 'FILLED', 'FAILED']),
}).strict();

export const createTradeIntentSchema = tradeIntentSchema.pick({
  evaluationId: true,
  idempotencyKey: true,
});

const riskEvidenceValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const riskRuleBaseSchema = z.object({
  rule: z.string().min(1).max(128),
  observed: riskEvidenceValueSchema,
  threshold: riskEvidenceValueSchema,
});

export const riskRuleSchema = z.discriminatedUnion('status', [
  riskRuleBaseSchema.extend({
    status: z.literal('PASS'),
    reason: z.string().min(1).optional(),
  }).strict(),
  riskRuleBaseSchema.extend({
    status: z.literal('FAIL'),
    reason: z.string().min(1),
  }).strict(),
  riskRuleBaseSchema.extend({
    status: z.literal('UNAVAILABLE'),
    reason: z.string().min(1),
  }).strict(),
]);

const passingRiskRuleSchema = riskRuleBaseSchema.extend({
  status: z.literal('PASS'),
  reason: z.string().min(1).optional(),
}).strict();

const riskBaseSchema = z.object({
  intentId: idSchema,
  policyVersion: versionSchema,
  portfolioVersion: versionSchema,
  reasons: z.array(z.string().min(1)),
  evaluatedAt: isoDateTimeSchema,
});

export const approvedRiskDecisionSchema = riskBaseSchema.extend({
  verdict: z.literal('APPROVED'),
  rules: z.array(passingRiskRuleSchema).min(1),
  approvedBaseQty: positiveBaseUnitAmountSchema,
  maximumQuoteCost: positiveBaseUnitAmountSchema,
}).strict();

export const rejectedRiskDecisionSchema = riskBaseSchema.extend({
  verdict: z.literal('REJECTED'),
  rules: z.array(riskRuleSchema).min(1),
  reasons: z.array(z.string().min(1)).min(1),
}).strict();

export const riskDecisionSchema = z.discriminatedUnion('verdict', [
  approvedRiskDecisionSchema,
  rejectedRiskDecisionSchema,
]);

const gasAvailableSchema = z.object({
  status: z.literal('AVAILABLE'),
  gasUnits: positiveBaseUnitStringSchema,
  gasPriceWei: baseUnitStringSchema,
  gasCostWei: baseUnitStringSchema,
  gasQuoteCost: baseUnitAmountSchema.optional(),
  provenance: z.string().min(1).max(512),
}).strict();

const gasUnavailableSchema = z.object({
  status: z.literal('UNAVAILABLE'),
  reason: z.string().min(1).max(512),
  provenance: z.string().min(1).max(512),
}).strict();

export const gasEstimateSchema = z.discriminatedUnion('status', [
  gasAvailableSchema,
  gasUnavailableSchema,
]).superRefine((value, ctx) => {
  if (value.status !== 'AVAILABLE') return;
  if (BigInt(value.gasCostWei) !== BigInt(value.gasUnits) * BigInt(value.gasPriceWei)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gasCostWei'],
      message: 'gasCostWei must equal gasUnits * gasPriceWei',
    });
  }
});

export const paperOrderSchema = z.object({
  id: idSchema,
  intentId: idSchema,
  riskDecisionId: idSchema,
  status: z.enum(['CREATED', 'FILLED', 'CANCELLED']),
  createdAt: isoDateTimeSchema,
}).strict();

export const paperFillSchema = z.object({
  orderId: idSchema,
  snapshotId: idSchema,
  baseQty: positiveBaseUnitStringSchema,
  quoteQty: positiveBaseUnitStringSchema,
  feeQuote: baseUnitAmountSchema,
  gasEstimate: gasEstimateSchema,
  executionPrice: scaledIntegerSchema,
  assumptionsVersion: versionSchema,
  filledAt: isoDateTimeSchema,
}).strict();

const executedIntentExecutionSchema = z.object({
  intent: tradeIntentSchema,
  riskDecision: approvedRiskDecisionSchema,
  order: paperOrderSchema,
  fill: paperFillSchema,
}).strict().superRefine((value, ctx) => {
  if (value.order.intentId !== value.intent.id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['order', 'intentId'], message: 'order.intentId must match intent.id' });
  }
  if (value.fill.orderId !== value.order.id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fill', 'orderId'], message: 'fill.orderId must match order.id' });
  }
  if (value.fill.snapshotId !== value.intent.snapshotId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fill', 'snapshotId'], message: 'fill.snapshotId must match intent.snapshotId' });
  }
  if (value.intent.status !== 'FILLED') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['intent', 'status'], message: 'an executed intent must have status FILLED' });
  }
});

const rejectedIntentExecutionSchema = z.object({
  intent: tradeIntentSchema,
  riskDecision: rejectedRiskDecisionSchema,
  order: z.null(),
  fill: z.null(),
}).strict().superRefine((value, ctx) => {
  if (value.intent.status !== 'REJECTED') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['intent', 'status'], message: 'a rejected execution must have intent status REJECTED' });
  }
});

export const intentExecutionSchema = z.union([
  executedIntentExecutionSchema,
  rejectedIntentExecutionSchema,
]);

const assetBalanceSchema = z.object({
  asset: evmAddressSchema,
  available: baseUnitAmountSchema,
  reserved: baseUnitAmountSchema,
}).strict();

const positionBaseSchema = z.object({
  asset: evmAddressSchema,
  quantity: baseUnitAmountSchema,
  costBasisQuote: baseUnitAmountSchema,
});

const positionSchema = z.discriminatedUnion('valuationStatus', [
  positionBaseSchema.extend({
    valuationStatus: z.literal('VALUED'),
    unrealizedPnlQuote: signedBaseUnitAmountSchema,
    valuationSnapshotId: idSchema,
  }).strict(),
  positionBaseSchema.extend({
    valuationStatus: z.literal('UNPRICED'),
    reason: z.string().min(1),
  }).strict(),
]);

export const portfolioSchema = z.object({
  mode: z.literal('PAPER'),
  asOf: isoDateTimeSchema,
  balances: z.array(assetBalanceSchema),
  positions: z.array(positionSchema),
  equityQuote: baseUnitAmountSchema,
  realizedPnlQuote: signedBaseUnitAmountSchema,
  unrealizedPnlQuote: signedBaseUnitAmountSchema,
}).strict();

export const auditEventSchema = z.object({
  id: idSchema,
  type: z.string().min(1).max(128),
  aggregateId: idSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: isoDateTimeSchema,
}).strict();

export const healthSchema = z.object({
  mode: z.enum(['OBSERVE', 'PAPER']),
  chainId: chainIdSchema,
  rpcStatus: z.enum(['HEALTHY', 'DEGRADED', 'OFFLINE']),
  headBlock: positiveBaseUnitStringSchema.nullable(),
  lagSeconds: z.number().int().nonnegative().nullable(),
}).strict();

export const candidateSchema = z.object({
  token: evmAddressSchema,
  snapshotId: idSchema,
  evaluation: evaluationSchema,
}).strict();

export const venueSchema = z.object({
  chainId: chainIdSchema,
  factory: evmAddressSchema,
  pool: evmAddressSchema,
  fee: z.number().int().positive(),
  token0: evmAddressSchema,
  token1: evmAddressSchema,
  provenance: z.array(z.string().url()).min(1),
}).strict();

export const journalPageSchema = z.object({
  events: z.array(auditEventSchema),
  nextCursor: z.string().nullable(),
}).strict();

export const errorBodySchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: idSchema,
}).strict();

export type BaseUnitString = z.infer<typeof baseUnitStringSchema>;
export type BaseUnitAmount = z.infer<typeof baseUnitAmountSchema>;
export type ScaledInteger = z.infer<typeof scaledIntegerSchema>;
export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
export type TradeIntent = z.infer<typeof tradeIntentSchema>;
export type CreateTradeIntent = z.infer<typeof createTradeIntentSchema>;
export type RiskDecision = z.infer<typeof riskDecisionSchema>;
export type ApprovedRiskDecision = z.infer<typeof approvedRiskDecisionSchema>;
export type RejectedRiskDecision = z.infer<typeof rejectedRiskDecisionSchema>;
export type GasEstimate = z.infer<typeof gasEstimateSchema>;
export type PaperOrder = z.infer<typeof paperOrderSchema>;
export type PaperFill = z.infer<typeof paperFillSchema>;
export type IntentExecution = z.infer<typeof intentExecutionSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
