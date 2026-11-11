import {
  candidateSchema,
  healthSchema,
  intentExecutionSchema,
  journalPageSchema,
  marketSnapshotSchema,
  portfolioSchema,
  riskDecisionSchema,
  tradeIntentSchema,
  venueSchema,
} from '@trident/api-contract';
import type { IntentExecution, MarketSnapshot, Portfolio, RiskDecision, TradeIntent } from '@trident/api-contract';
import type { ParseSchema } from './client.js';

export type Endpoint<T> = {
  readonly path: string;
  readonly schema: ParseSchema<T>;
};

export type Candidate = ReturnType<typeof candidateSchema.parse>;
export type Health = ReturnType<typeof healthSchema.parse>;
export type Venue = ReturnType<typeof venueSchema.parse>;
export type JournalPage = ReturnType<typeof journalPageSchema.parse>;

const arrayOf =
  <T>(item: ParseSchema<T>): ParseSchema<T[]> => ({
    parse: (input: unknown): T[] => {
      if (!Array.isArray(input)) {
        throw new Error('Expected an array');
      }
      return input.map((entry) => item.parse(entry));
    },
  });

/**
 * `GET /api/v1/intents/:id` is not part of the contract yet (see
 * packages/api-contract/MIGRATION.md). It returns the intent plus the risk
 * decision, and today the backend may report no decision for an intent.
 */
const intentViewSchema: ParseSchema<{ intent: TradeIntent; riskDecision: RiskDecision | null }> = {
  parse: (input: unknown) => {
    if (typeof input !== 'object' || input === null) {
      throw new Error('Expected an intent view object');
    }
    const record = input as Record<string, unknown>;
    return {
      intent: tradeIntentSchema.parse(record['intent']),
      riskDecision: record['riskDecision'] === null ? null : riskDecisionSchema.parse(record['riskDecision']),
    };
  },
};

export const endpoints = {
  health: (): Endpoint<Health> => ({ path: '/health', schema: healthSchema }),
  venues: (): Endpoint<Venue[]> => ({ path: '/api/v1/venues', schema: arrayOf(venueSchema) }),
  snapshot: (): Endpoint<MarketSnapshot> => ({ path: '/api/v1/markets/weth-usdg/snapshot', schema: marketSnapshotSchema }),
  candidates: (limit = 20): Endpoint<Candidate[]> => ({
    path: `/api/v1/candidates?limit=${limit}`,
    schema: arrayOf(candidateSchema),
  }),
  portfolio: (): Endpoint<Portfolio> => ({ path: '/api/v1/portfolio', schema: portfolioSchema }),
  journal: (limit = 20, before?: number): Endpoint<JournalPage> => ({
    path: `/api/v1/journal?limit=${limit}${before === undefined ? '' : `&before=${before}`}`,
    schema: journalPageSchema,
  }),
  intent: (id: string): Endpoint<{ intent: TradeIntent; riskDecision: RiskDecision | null }> => ({
    path: `/api/v1/intents/${encodeURIComponent(id)}`,
    schema: intentViewSchema,
  }),
} as const;

/** `POST /api/v1/intents` response, validated by the shared contract. */
export const intentExecution: ParseSchema<IntentExecution> = intentExecutionSchema;

export type { IntentExecution, MarketSnapshot, Portfolio, RiskDecision, TradeIntent };