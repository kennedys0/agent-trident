/**
 * S3-02 wire contract, copied verbatim from `packages/api-contract/src/domain.ts`
 * on `origin/sprint3/s3-02-market-intelligence` (PR #25, `2e7ffa6`).
 *
 * Why a copy exists: S3-03 branches from `main` (`4cd05c7`), where these schemas
 * are not exported yet. Copying them keeps the branch independent of PR #25
 * without inventing a second wire shape. **When S3-02 merges, delete this file
 * and import the same names from `@trident/api-contract`; nothing else changes.**
 *
 * Do not edit a schema here. A drift between this file and the contract is a bug,
 * and `test/discover.test.tsx` pins the fields the UI actually reads.
 */

import {
  baseUnitAmountSchema,
  baseUnitStringSchema,
  chainIdSchema,
  evmAddressSchema,
  isoDateTimeSchema,
  positiveBaseUnitStringSchema,
  scaledIntegerSchema,
} from '@trident/api-contract';
import { z } from 'zod';

/**
 * Identifies the copied binding shown in the UI provenance note. It names the
 * S3-02 commit the schemas were copied from, so a reviewer can diff the copy
 * instead of trusting a version string.
 */
export const DISCOVER_CONTRACT_REVISION = 's3-02@2e7ffa6';

export const tokenRefSchema = z
  .object({
    address: evmAddressSchema,
    symbol: z.string().min(1).max(64),
    decimals: z.number().int().min(0).max(255),
  })
  .strict();

const metricObservationSchema = z.object({
  blockNumber: positiveBaseUnitStringSchema,
  sourceTime: isoDateTimeSchema,
  observedAt: isoDateTimeSchema,
  provenance: z.string().min(1).max(256),
});

const unavailableMetricSchema = z
  .object({
    status: z.literal('UNAVAILABLE'),
    reason: z.string().min(1).max(512),
  })
  .strict();

export const priceMetricSchema = z.discriminatedUnion('status', [
  metricObservationSchema
    .extend({
      status: z.literal('AVAILABLE'),
      token1PerToken0: scaledIntegerSchema,
      token0PerToken1: scaledIntegerSchema,
    })
    .strict(),
  metricObservationSchema
    .extend({
      status: z.literal('STALE'),
      token1PerToken0: scaledIntegerSchema,
      token0PerToken1: scaledIntegerSchema,
    })
    .strict(),
  unavailableMetricSchema,
]);

export const liquidityMetricSchema = z.discriminatedUnion('status', [
  metricObservationSchema
    .extend({
      status: z.literal('AVAILABLE'),
      liquidity: z
        .string()
        .regex(/^(0|[1-9][0-9]*)$/)
        .max(256),
      reserve0: baseUnitStringSchema,
      reserve1: baseUnitStringSchema,
      reserve0Decimals: z.number().int().min(0).max(255),
      reserve1Decimals: z.number().int().min(0).max(255),
    })
    .strict(),
  metricObservationSchema
    .extend({
      status: z.literal('STALE'),
      liquidity: z
        .string()
        .regex(/^(0|[1-9][0-9]*)$/)
        .max(256),
      reserve0: baseUnitStringSchema,
      reserve1: baseUnitStringSchema,
      reserve0Decimals: z.number().int().min(0).max(255),
      reserve1Decimals: z.number().int().min(0).max(255),
    })
    .strict(),
  unavailableMetricSchema,
]);

export const volumeMetricSchema = z.discriminatedUnion('status', [
  metricObservationSchema
    .extend({
      status: z.literal('AVAILABLE'),
      volumeQuote24h: baseUnitAmountSchema,
    })
    .strict(),
  metricObservationSchema
    .extend({
      status: z.literal('STALE'),
      volumeQuote24h: baseUnitAmountSchema,
    })
    .strict(),
  unavailableMetricSchema,
]);

export const poolSummarySchema = z
  .object({
    chainId: chainIdSchema,
    pool: evmAddressSchema,
    factory: evmAddressSchema,
    fee: z.number().int().positive().max(1_000_000),
    token0: tokenRefSchema,
    token1: tokenRefSchema,
    venue: z.enum(['verified-allowlist', 's3-01-registry']),
    firstSeenBlock: positiveBaseUnitStringSchema.nullable(),
    status: z.enum(['AVAILABLE', 'STALE', 'UNAVAILABLE']),
    reason: z.string().min(1).max(512).optional(),
    metrics: z
      .object({
        price: priceMetricSchema,
        liquidity: liquidityMetricSchema,
        volume24h: volumeMetricSchema,
      })
      .strict(),
    confidence: z.literal('LOW'),
    confidenceReason: z.string().min(1).max(256),
    watched: z.boolean(),
  })
  .strict();

export const poolListSchema = z
  .object({
    pools: z.array(poolSummarySchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(50),
  })
  .strict();

export const watchlistEntrySchema = z
  .object({
    address: evmAddressSchema,
    addedAt: isoDateTimeSchema,
    known: z.boolean(),
    symbol: z.string().min(1).max(64).optional(),
  })
  .strict();

export const watchlistSchema = z.object({ entries: z.array(watchlistEntrySchema) }).strict();

export const createWatchlistEntrySchema = z.object({ address: evmAddressSchema }).strict();

export const watchlistMutationSchema = z
  .object({
    address: evmAddressSchema,
    result: z.enum(['ADDED', 'EXISTING', 'REMOVED', 'ABSENT']),
  })
  .strict();

export type TokenRef = z.infer<typeof tokenRefSchema>;
export type PoolStatus = PoolSummary['status'];
export type PriceMetric = z.infer<typeof priceMetricSchema>;
export type LiquidityMetric = z.infer<typeof liquidityMetricSchema>;
export type VolumeMetric = z.infer<typeof volumeMetricSchema>;
export type PoolSummary = z.infer<typeof poolSummarySchema>;
export type PoolList = z.infer<typeof poolListSchema>;
export type WatchlistEntry = z.infer<typeof watchlistEntrySchema>;
export type Watchlist = z.infer<typeof watchlistSchema>;
export type WatchlistMutation = z.infer<typeof watchlistMutationSchema>;

/** Display label for a token whose symbol the backend always provides. */
export function tokenLabel(token: TokenRef): string {
  return token.symbol;
}

/** The backend's own aggregate status; the UI does not invent a different one. */
export function poolStatus(pool: PoolSummary): 'AVAILABLE' | 'STALE' | 'UNAVAILABLE' {
  return pool.status;
}