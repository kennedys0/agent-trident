import {
  candidateSchema,
  evaluationSchema,
  healthSchema,
  journalPageSchema,
  marketSnapshotSchema,
  portfolioSchema,
  riskDecisionSchema,
  tradeIntentSchema,
  venueSchema,
  type AuditEvent,
  type Evaluation,
  type MarketSnapshot,
  type Portfolio,
  type RiskDecision,
  type TradeIntent,
} from '@trident/api-contract';
import { quoteToBaseQty, quoteValueOf } from '../domain/price.js';
import type { RiskDecisionRecord, IntentRecord } from '../db/repositories.js';
import type {
  EvaluationRecord,
  PoolIdentity,
  PoolSnapshot,
  PortfolioState,
  RiskRule,
  SnapshotStatus,
  Venue,
} from '../domain/types.js';

/**
 * Boundary mappers. Internal engine types stay rich (bigints, rule-level risk
 * evidence, sqrtPriceX96 provenance); every HTTP payload is produced here in the
 * shape owned by `@trident/api-contract` and validated with its schema, so a
 * contract change breaks this file instead of silently drifting.
 */
const USDC_DECIMALS = 6;
const WETH_DECIMALS = 18;

/** Plain inputs; the contract schema brands them on parse. */
function amount(value: bigint | string, decimals: number): { value: string; decimals: number } {
  return { value: value.toString(), decimals };
}

function scaled(value: bigint | string, scale: number) {
  return { value: value.toString(), scale: String(scale) };
}

export type HealthInput = {
  readonly mode: 'OBSERVE' | 'PAPER';
  readonly chainId: number | null;
  readonly headBlock: number | null;
  readonly lagSeconds: number | null;
};

export function toHealth(input: HealthInput): ReturnType<typeof healthSchema.parse> {
  const parsed = healthSchema.parse({
    mode: input.mode,
    chainId: 4663,
    rpcStatus: input.chainId === 4663 ? 'HEALTHY' : input.chainId === null ? 'OFFLINE' : 'DEGRADED',
    headBlock: input.headBlock === null ? null : String(input.headBlock),
    lagSeconds: input.lagSeconds,
  });
  return parsed;
}

export function toVenue(venue: Venue, pool: PoolIdentity): ReturnType<typeof venueSchema.parse> {
  return venueSchema.parse({
    chainId: 4663,
    factory: venue.factory,
    pool: pool.id,
    fee: pool.fee,
    token0: pool.token0.address,
    token1: pool.token1.address,
    provenance: venue.provenance,
  });
}

function baseQuoteAddresses(pool: PoolIdentity): { base: `0x${string}`; quote: `0x${string}` } {
  const base = pool.token0.id === 'WETH' ? pool.token0.address : pool.token1.address;
  const quote = pool.token0.id === 'USDG' ? pool.token0.address : pool.token1.address;
  return { base, quote };
}

function baseQuoteReserves(snapshot: PoolSnapshot, pool: PoolIdentity): { base: string; quote: string } {
  const base = pool.token0.id === 'WETH' ? snapshot.reserve0 : snapshot.reserve1;
  const quote = pool.token0.id === 'USDG' ? snapshot.reserve0 : snapshot.reserve1;
  return { base, quote };
}

/**
 * The contract snapshot cannot carry `sqrtPriceX96`/`tick`, so those stay in
 * storage as provenance evidence and the price is the recomputable projection.
 */
export function toSnapshot(
  snapshot: PoolSnapshot,
  pool: PoolIdentity,
  status: SnapshotStatus,
): ReturnType<typeof marketSnapshotSchema.parse> {
  const { base, quote } = baseQuoteAddresses(pool);
  const reserves = baseQuoteReserves(snapshot, pool);
  const observation = {
    chainId: 4663 as const,
    poolAddress: pool.id,
    baseToken: base,
    quoteToken: quote,
    blockNumber: String(snapshot.blockNumber),
    blockHash: snapshot.blockHash,
    sourceTime: snapshot.sourceTime,
    observedAt: snapshot.observedAt,
    source: snapshot.source,
  };

  if (status === 'INCOMPLETE') {
    return marketSnapshotSchema.parse({
      ...observation,
      status: 'INCOMPLETE',
      missingInputs: ['pool.liquidity', 'pool.reserves'],
    });
  }

  return marketSnapshotSchema.parse({
    ...observation,
    status,
    reservesBase: amount(BigInt(reserves.base), WETH_DECIMALS),
    reservesQuote: amount(BigInt(reserves.quote), USDC_DECIMALS),
    price: scaled(snapshot.priceScaled, snapshot.priceScale),
    liquidityQuote: amount(BigInt(reserves.quote), USDC_DECIMALS),
  });
}

/**
 * The contract evaluation expresses size as base quantity, while the strategy
 * allocates quote currency, so the boundary converts at the snapshot price.
 */
export function toEvaluation(record: EvaluationRecord, snapshot: PoolSnapshot): Evaluation {
  const baseQty =
    record.proposedAmountIn === null
      ? null
      : record.action === 'BUY'
        ? quoteToBaseQty(BigInt(record.proposedAmountIn), BigInt(snapshot.priceScaled), WETH_DECIMALS, USDC_DECIMALS, snapshot.priceScale)
        : BigInt(record.proposedAmountIn);

  const shared = {
    id: record.id,
    snapshotId: record.snapshotId,
    snapshotStatus: snapshot.status,
    strategyId: record.strategyId,
    configVersion: record.configVersion,
    inputHash: `0x${record.inputHash.replace(/^0x/, '').slice(0, 64)}`,
    signalStrength: Math.min(10_000, record.signalStrength * 100),
    invalidation: record.invalidation,
    reasons: [...record.reasons],
    evaluatedAt: record.createdAt,
  };

  if (record.action === 'BUY') {
    if (baseQty === null || baseQty <= 0n) {
      // A BUY the contract cannot express is a WAIT, not a malformed BUY.
      return evaluationSchema.parse({ ...shared, action: 'WAIT', proposedBaseQty: '0' });
    }
    return evaluationSchema.parse({ ...shared, snapshotStatus: 'COMPLETE', action: 'BUY', proposedBaseQty: baseQty.toString() });
  }

  return evaluationSchema.parse({
    ...shared,
    action: record.action,
    ...(baseQty === null ? {} : { proposedBaseQty: baseQty.toString() }),
  });
}

export function toCandidate(record: EvaluationRecord, snapshot: PoolSnapshot, pool: PoolIdentity) {
  const { base } = baseQuoteAddresses(pool);
  return candidateSchema.parse({
    token: base,
    snapshotId: record.snapshotId,
    evaluation: toEvaluation(record, snapshot),
  });
}

/**
 * Intent terms come from the evaluation and its snapshot: the strategy sizes the
 * trade and the snapshot price is the limit the gate priced. The executed units
 * are not copied here — they live on the risk decision and the fill.
 */
export function toTradeIntent(intent: IntentRecord, pool: PoolIdentity, snapshot: PoolSnapshot): TradeIntent {
  const { base, quote } = baseQuoteAddresses(pool);
  const baseQty =
    intent.side === 'BUY'
      ? quoteToBaseQty(BigInt(intent.amountIn), BigInt(snapshot.priceScaled), WETH_DECIMALS, USDC_DECIMALS, snapshot.priceScale)
      : BigInt(intent.amountIn);

  return tradeIntentSchema.parse({
    id: intent.id,
    evaluationId: intent.evaluationId,
    idempotencyKey: intent.idempotencyKey,
    mode: 'PAPER',
    side: intent.side,
    token: base,
    quoteToken: quote,
    baseQty: baseQty.toString(),
    limitPrice: scaled(snapshot.priceScaled, snapshot.priceScale),
    snapshotId: intent.snapshotId,
    expiresAt: intent.expiresAt,
    status: intent.status,
  });
}

function riskRuleEvidence(rule: RiskRule): {
  rule: string;
  status: RiskRule['status'];
  observed: RiskRule['observed'];
  threshold: RiskRule['threshold'];
  reason?: string;
} {
  return {
    rule: rule.rule,
    status: rule.status,
    observed: rule.observed,
    threshold: rule.threshold,
    ...(rule.reason === undefined ? {} : { reason: rule.reason }),
  };
}

/**
 * The wire decision carries the same per-rule evidence the gate produced, with
 * the approval split into explicit base and quote units.
 */
export function toRiskDecision(record: RiskDecisionRecord): RiskDecision {
  const shared = {
    intentId: record.intentId,
    policyVersion: record.policyVersion,
    portfolioVersion: record.portfolioVersion,
    evaluatedAt: record.evaluatedAt,
  };

  if (record.verdict === 'APPROVED') {
    if (record.approvedBaseQty === null || record.approvedQuoteAmount === null) {
      throw new Error('Approved risk decision is missing its approved units');
    }
    return riskDecisionSchema.parse({
      ...shared,
      verdict: 'APPROVED',
      rules: record.rules.map(riskRuleEvidence),
      reasons: [`All ${record.rules.length} ${record.policyVersion} rules passed`],
      approvedBaseQty: amount(record.approvedBaseQty, WETH_DECIMALS),
      maximumQuoteCost: amount(record.approvedQuoteAmount, USDC_DECIMALS),
    });
  }

  return riskDecisionSchema.parse({
    ...shared,
    verdict: 'REJECTED',
    rules: record.rules.map(riskRuleEvidence),
    reasons: record.rules.filter((rule) => rule.status !== 'PASS').map((rule) => `${rule.rule}: ${rule.reason ?? 'failed'}`),
  });
}

/**
 * A position is priced only when a snapshot exists. The contract's `UNPRICED`
 * variant keeps the quantity and cost basis visible instead of inventing a zero.
 */
export function toPortfolio(
  state: PortfolioState,
  input: {
    readonly pool: PoolIdentity;
    readonly snapshotId: string | null;
    readonly priceScaled: string | null;
    readonly priceScale: number;
  },
): Portfolio {
  const { base, quote } = baseQuoteAddresses(input.pool);
  const weth = state.positions.find((position) => position.assetId === 'WETH');
  const priced = input.snapshotId !== null && input.priceScaled !== null;
  const quantity = weth ? BigInt(weth.quantity) : 0n;

  const positions: unknown[] = [];
  let unrealized = 0n;
  let marketValue = 0n;

  if (quantity > 0n) {
    const shared = {
      asset: base,
      quantity: amount(quantity, WETH_DECIMALS),
      costBasisQuote: amount(BigInt(state.costBasisUsdg), USDC_DECIMALS),
    };
    if (priced) {
      marketValue = quoteValueOf(quantity, BigInt(input.priceScaled as string), WETH_DECIMALS, USDC_DECIMALS, input.priceScale);
      unrealized = marketValue - BigInt(state.costBasisUsdg);
      positions.push({
        ...shared,
        valuationStatus: 'VALUED',
        unrealizedPnlQuote: { value: unrealized.toString(), decimals: USDC_DECIMALS },
        valuationSnapshotId: input.snapshotId as string,
      });
    } else {
      positions.push({
        ...shared,
        valuationStatus: 'UNPRICED',
        reason: 'No market snapshot is available to value this position',
      });
    }
  }

  const equity = BigInt(state.cashUsdg) + marketValue;
  return portfolioSchema.parse({
    mode: 'PAPER',
    asOf: state.asOf,
    balances: [
      { asset: quote, available: amount(BigInt(state.cashUsdg), USDC_DECIMALS), reserved: amount(0n, USDC_DECIMALS) },
      { asset: base, available: amount(quantity, WETH_DECIMALS), reserved: amount(0n, WETH_DECIMALS) },
    ],
    positions,
    equityQuote: amount(equity, USDC_DECIMALS),
    realizedPnlQuote: { value: state.realizedPnlUsdg, decimals: USDC_DECIMALS },
    unrealizedPnlQuote: { value: unrealized.toString(), decimals: USDC_DECIMALS },
  });
}

export function toJournal(
  rows: readonly Record<string, unknown>[],
  limit: number,
): ReturnType<typeof journalPageSchema.parse> {
  const events: AuditEvent[] = rows.map((row) => ({
    id: String(row['id']),
    type: String(row['action']),
    aggregateId: String(row['entity_id']),
    payload: {
      ...(JSON.parse(String(row['payload_json'] ?? '{}')) as Record<string, unknown>),
      actor: String(row['actor']),
      entity: String(row['entity']),
      correlationId: String(row['correlation_id']),
      at: String(row['at']),
      sequence: Number(row['sequence']),
    },
    createdAt: String(row['at']),
  }));
  const last = rows.at(-1);
  return journalPageSchema.parse({
    events,
    nextCursor: rows.length < limit || last === undefined ? null : String(last['sequence']),
  });
}