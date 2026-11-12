import './zod-openapi.js';
import { z } from 'zod';

export const baseUnitStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'Expected a non-negative integer base-unit string')
  .max(256)
  .brand('BaseUnitString');

export const positiveBaseUnitStringSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/, 'Expected a positive integer base-unit string')
  .max(256)
  .brand('PositiveBaseUnitString');

export const baseUnitAmountSchema = z.object({
  value: baseUnitStringSchema,
  decimals: z.number().int().min(0).max(255),
}).strict();

export const positiveBaseUnitAmountSchema = z.object({
  value: positiveBaseUnitStringSchema,
  decimals: z.number().int().min(0).max(255),
}).strict();

export const signedBaseUnitStringSchema = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)$/, 'Expected an integer base-unit string')
  .max(256)
  .brand('SignedBaseUnitString');

export const signedBaseUnitAmountSchema = z.object({
  value: signedBaseUnitStringSchema,
  decimals: z.number().int().min(0).max(255),
}).strict();

export const scaledIntegerSchema = z.object({
  value: baseUnitStringSchema,
  scale: positiveBaseUnitStringSchema,
}).strict();

export const chainIdSchema = z.literal(4663);
export const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const transactionHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const idSchema = z.string().min(1).max(256);
export const idempotencyKeySchema = z.string().min(8).max(256);
export const executionModeSchema = z.enum(['OBSERVE', 'PAPER']);
export const versionSchema = z.string().regex(/^\S+$/, 'Expected a nonempty version identifier').max(128);
