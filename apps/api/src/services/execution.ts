import { randomUUID } from 'node:crypto';
import { withTransaction, type Db } from '../db/index.js';
import {
  appendAudit,
  countLedgerEntries,
  createIntent,
  getFillByOrder,
  getIntentById,
  getIntentByIdempotencyKey,
  getPortfolio,
  getPosition,
  getRiskDecisionByIntent,
  getSnapshotById,
  insertFill,
  insertOrder,
  insertRiskDecision,
  isKillSwitchEngaged,
  markOrderFilled,
  setIntentStatus,
  upsertPosition,
  type FillGas,
  type IntentRecord,
  type RiskDecisionRecord,
} from '../db/repositories.js';
import { AppError } from '../errors.js';
import { postBuy, postSell } from '../domain/ledger.js';
import { executionPriceScaled, quoteToBaseQty, quoteValueOf } from '../domain/price.js';
import { evaluateRisk } from '../domain/risk.js';
import { effectiveStatus } from '../domain/snapshot.js';
import type { AssetIdentity, EvaluationRecord, PoolIdentity, RiskOutcome, StrategyConfig } from '../domain/types.js';
import { WETH, USDG } from '../chain/venue.js';
import type { QuotePort } from './ports.js';

export const ASSUMPTIONS_VERSION = 'paper-v1';
const INTENT_TTL_SECONDS = 60;

export type IntentView = {
  readonly intent: IntentRecord;
  readonly riskDecision: RiskDecisionRecord | null;
  readonly orderId: string | null;
  readonly fillId: string | null;
  readonly replayed: boolean;
};

function assetById(id: string): AssetIdentity {
  return id === 'WETH' ? WETH : USDG;
}

export function createIntentFromEvaluation(
  db: Db,
  input: { evaluation: EvaluationRecord; idempotencyKey: string; now?: Date; correlationId: string; mode: 'OBSERVE' | 'PAPER' },
): IntentRecord {
  const existing = getIntentByIdempotencyKey(db, input.idempotencyKey);
  if (existing) return existing;

  if ((input.evaluation.action !== 'BUY' && input.evaluation.action !== 'SELL') || input.evaluation.proposedAmountIn === null) {
    throw new AppError('INTENT_NOT_ACTIONABLE', `EvaluationRecord action ${input.evaluation.action} cannot produce a paper intent`);
  }
  const side = input.evaluation.action;
  const snapshot = getSnapshotById(db, input.evaluation.snapshotId);
  if (snapshot === null) throw new AppError('CONFLICT', 'Evaluation points at a snapshot that does not exist');
  const baseQty =
    side === 'BUY'
      ? quoteToBaseQty(BigInt(input.evaluation.proposedAmountIn), BigInt(snapshot.priceScaled), 18, 6, snapshot.priceScale)
      : BigInt(input.evaluation.proposedAmountIn);
  if (baseQty <= 0n) {
    throw new AppError('INTENT_NOT_ACTIONABLE', 'Evaluation sizes a trade smaller than one base unit at the snapshot price');
  }
  const now = input.now ?? new Date();
  const intent = createIntent(db, {
    evaluationId: input.evaluation.id,
    idempotencyKey: input.idempotencyKey,
    mode: input.mode,
    side,
    tokenInId: side === 'BUY' ? 'USDG' : 'WETH',
    tokenOutId: side === 'BUY' ? 'WETH' : 'USDG',
    amountIn: input.evaluation.proposedAmountIn,
    minAmountOut: '0',
    snapshotId: input.evaluation.snapshotId,
    expiresAt: new Date(now.getTime() + INTENT_TTL_SECONDS * 1000).toISOString(),
  });
  appendAudit(db, {
    actor: 'operator',
    action: 'intent.created',
    entity: 'order_intent',
    entityId: intent.id,
    correlationId: input.correlationId,
    payload: { side, amountIn: intent.amountIn, evaluationId: intent.evaluationId },
  });
  return intent;
}

/**
 * Gas is emitted only when both halves are sourced from the pinned block:
 * QuoterV2's gas estimate and that block's baseFeePerGas. Anything missing is
 * UNAVAILABLE with the reason, never a placeholder price.
 */
async function estimateFillGas(
  deps: ExecutionDeps,
  quote: { readonly gasEstimate: bigint } | null,
  blockNumber: number | null,
): Promise<FillGas> {
  if (quote === null || blockNumber === null) {
    return {
      status: 'UNAVAILABLE',
      reason: 'No QuoterV2 quote was produced for this intent',
      provenance: 'QuoterV2 quoteExactInputSingle was not called',
    };
  }

  const quoteProvenance = `QuoterV2 quoteExactInputSingle gasEstimate simulated at block ${blockNumber}`;

  if (quote.gasEstimate <= 0n) {
    return {
      status: 'UNAVAILABLE',
      reason: `QuoterV2 returned a non-positive gas estimate at block ${blockNumber}`,
      provenance: quoteProvenance,
    };
  }

  let baseFee: bigint | null;
  try {
    baseFee = await deps.quote.baseFeePerGasAt(blockNumber);
  } catch {
    return {
      status: 'UNAVAILABLE',
      reason: `Base fee for block ${blockNumber} could not be read from the RPC`,
      provenance: `eth_getBlockByNumber(${blockNumber}) baseFeePerGas failed`,
    };
  }

  if (baseFee === null) {
    return {
      status: 'UNAVAILABLE',
      reason: `Block ${blockNumber} did not report baseFeePerGas`,
      provenance: `eth_getBlockByNumber(${blockNumber}) baseFeePerGas absent`,
    };
  }

  return {
    status: 'AVAILABLE',
    gasUnits: quote.gasEstimate.toString(),
    gasPriceWei: baseFee.toString(),
    gasCostWei: (quote.gasEstimate * baseFee).toString(),
    provenance: `${quoteProvenance} + eth_getBlockByNumber baseFeePerGas at block ${blockNumber}; priority fee not included`,
  };
}

export type ExecutionDeps = {
  readonly db: Db;
  readonly quote: QuotePort;
  readonly pool: PoolIdentity;
  readonly config: StrategyConfig;
  readonly mode: 'OBSERVE' | 'PAPER';
  readonly correlationId: string;
  readonly now?: () => Date;
};

/**
 * Executes one paper intent. The risk decision, order, fill, ledger postings,
 * and position update commit in a single transaction, and every step is keyed
 * by unique business keys so a replay cannot duplicate any effect.
 */
export async function executeIntent(deps: ExecutionDeps, intentId: string): Promise<IntentView> {
  const { db, pool, config } = deps;
  const clock = deps.now ?? (() => new Date());
  const intent = getIntentById(db, intentId);
  if (!intent) throw new AppError('NOT_FOUND', 'Intent not found');

  if (intent.status === 'FILLED') {
    const order = db.prepare('SELECT id FROM orders WHERE intent_id = ?').get(intentId) as { id: string } | undefined;
    const fill = order ? getFillByOrder(db, order.id) : null;
    return {
      intent,
      riskDecision: getRiskDecisionByIntent(db, intentId),
      orderId: order?.id ?? null,
      fillId: fill ? (fill['id'] as string) : null,
      replayed: true,
    };
  }

  if (intent.status === 'REJECTED') {
    return { intent, riskDecision: getRiskDecisionByIntent(db, intentId), orderId: null, fillId: null, replayed: true };
  }

  if (clock().getTime() > new Date(intent.expiresAt).getTime()) {
    setIntentStatus(db, intent.id, 'EXPIRED');
    appendAudit(db, {
      actor: 'system',
      action: 'intent.expired',
      entity: 'order_intent',
      entityId: intent.id,
      correlationId: deps.correlationId,
      payload: { expiresAt: intent.expiresAt },
    });
    throw new AppError('INTENT_EXPIRED', 'Intent expired before it could be approved; request a new one');
  }

  const snapshot = getSnapshotById(db, intent.snapshotId);
  const tokenIn = assetById(intent.tokenInId);
  const tokenOut = assetById(intent.tokenOutId);

  const quote = snapshot
    ? await deps.quote.quote({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn: BigInt(intent.amountIn),
        fee: pool.fee,
        blockNumber: snapshot.blockNumber,
      })
    : null;

  const executionPrice =
    quote && snapshot
      ? intent.side === 'BUY'
        ? executionPriceScaled({
            amountQuote: BigInt(intent.amountIn),
            amountBase: quote.amountOut,
            quoteDecimals: tokenIn.decimals,
            baseDecimals: tokenOut.decimals,
            scale: snapshot.priceScale,
          })
        : executionPriceScaled({
            amountQuote: quote.amountOut,
            amountBase: BigInt(intent.amountIn),
            quoteDecimals: tokenOut.decimals,
            baseDecimals: tokenIn.decimals,
            scale: snapshot.priceScale,
          })
      : null;

  const portfolio = getPortfolio(db, snapshot?.priceScaled ?? null, snapshot?.priceScale ?? 18);
  const position = getPosition(db, 'WETH');
  const equity = snapshot
    ? (
        BigInt(portfolio.cashUsdg) +
        (position ? quoteValueOf(BigInt(position.quantity), BigInt(snapshot.priceScaled), 18, 6, snapshot.priceScale) : 0n)
      ).toString()
    : portfolio.cashUsdg;

  const headBlockNumber = await deps.quote.headBlockNumber().catch(() => null);
  const now = clock();
  const snapshotStatus = snapshot ? effectiveStatus(snapshot, now, config.maxStalenessSeconds) : 'UNAVAILABLE';
  const snapshotAgeSeconds = snapshot
    ? Math.max(0, Math.floor((now.getTime() - new Date(snapshot.observedAt).getTime()) / 1000))
    : null;
  /** Fees are quote-denominated on both sides, so the risk gate can size them. */
  const feeQuote =
    quote === null
      ? 0n
      : intent.side === 'BUY'
        ? (BigInt(intent.amountIn) * BigInt(pool.fee)) / 1_000_000n
        : (quote.amountOut * BigInt(pool.fee)) / 1_000_000n;

  const risk = evaluateRisk({
    side: intent.side,
    mode: intent.mode,
    amountIn: intent.amountIn,
    notionalQuote: intent.side === 'BUY' ? intent.amountIn : (quote?.amountOut ?? 0n).toString(),
    feeQuoteBase: feeQuote.toString(),
    evaluatedAt: now.toISOString(),
    snapshot,
    snapshotStatus,
    snapshotAgeSeconds,
    quoteBlockNumber: quote?.blockNumber ?? null,
    quoteAmountOut: quote ? quote.amountOut.toString() : null,
    executionPriceScaled: executionPrice ? executionPrice.toString() : null,
    headBlockNumber,
    cashUsdgBase: portfolio.cashUsdg,
    positionWethBase: position?.quantity ?? '0',
    equityUsdgBase: equity,
    openPositionCount: portfolio.positions.length,
    killSwitchEngaged: isKillSwitchEngaged(db),
    config,
    poolMatchesAllowlist: snapshot !== null && snapshot.poolId.toLowerCase() === pool.id.toLowerCase(),
  });

  // Sourced only for an approved execution; a rejected intent does not pay gas.
  const fillGas =
    risk.verdict === 'APPROVED' ? await estimateFillGas(deps, quote, snapshot ? snapshot.blockNumber : null) : null;

  const result = withTransaction(db, () => {
    const riskDecisionId = insertRiskDecision(db, {
      intentId: intent.id,
      decision: risk,
      portfolioVersion: portfolio.portfolioVersion,
    });
    appendAudit(db, {
      actor: 'risk-gate',
      action: 'risk.decision.recorded',
      entity: 'risk_decision',
      entityId: riskDecisionId,
      correlationId: deps.correlationId,
      payload: { verdict: risk.verdict, intentId: intent.id, failedRules: risk.rules.filter((r) => r.status !== 'PASS').map((r) => r.rule) },
    });

    if (risk.verdict !== 'APPROVED' || !snapshot || !quote) {
      setIntentStatus(db, intent.id, 'REJECTED');
      return { orderId: null, fillId: null, riskDecisionId };
    }
    if (fillGas === null) throw new AppError('INTERNAL_ERROR', 'Approved execution is missing its gas estimate');

    const orderId = insertOrder(db, { intentId: intent.id, riskDecisionId });
    const amountIn = BigInt(intent.amountIn);
    const amountOut = quote.amountOut;

    if (intent.side === 'BUY') {
      const fillId = insertFill(db, {
        orderId,
        snapshotId: snapshot.id,
        amountIn: amountIn.toString(),
        amountOut: amountOut.toString(),
        executionPriceScaled: executionPrice!.toString(),
        feeAmount: feeQuote.toString(),
        gas: fillGas,
        assumptionsVersion: ASSUMPTIONS_VERSION,
      });
      postBuy(db, { fillId, amountInUsdg: amountIn.toString(), amountOutWeth: amountOut.toString(), feeUsdg: feeQuote.toString() });
      const prior = getPosition(db, 'WETH');
      upsertPosition(db, {
        assetId: 'WETH',
        quantity: ((prior ? BigInt(prior.quantity) : 0n) + amountOut).toString(),
        costBasis: ((prior ? BigInt(prior.costBasis) : 0n) + amountIn + feeQuote).toString(),
      });
      markOrderFilled(db, orderId);
      setIntentStatus(db, intent.id, 'FILLED');
      appendAudit(db, {
        actor: 'paper-execution',
        action: 'paper.fill.recorded',
        entity: 'fill',
        entityId: fillId,
        correlationId: deps.correlationId,
        payload: { side: 'BUY', amountIn: amountIn.toString(), amountOut: amountOut.toString(), fee: feeQuote.toString(), snapshotId: snapshot.id },
      });
      return { orderId, fillId, riskDecisionId };
    }

    const costBasis = getPosition(db, 'WETH');
    const quantityBefore = costBasis ? BigInt(costBasis.costBasis) : 0n;
    const unitsBefore = costBasis ? BigInt(costBasis.quantity) : 0n;
    const costReleased = unitsBefore > 0n ? (quantityBefore * amountIn) / unitsBefore : 0n;
    const proceeds = amountOut - feeQuote;
    const realized = proceeds - costReleased;
    const fillId = insertFill(db, {
      orderId,
      snapshotId: snapshot.id,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      executionPriceScaled: executionPrice!.toString(),
      feeAmount: feeQuote.toString(),
      gas: fillGas,
      assumptionsVersion: ASSUMPTIONS_VERSION,
    });
    postSell(db, {
      fillId,
      amountInWeth: amountIn.toString(),
      amountOutUsdg: amountOut.toString(),
      feeUsdg: feeQuote.toString(),
      realizedPnlUsdg: realized.toString(),
    });
    const remainingUnits = unitsBefore - amountIn;
    upsertPosition(db, {
      assetId: 'WETH',
      quantity: remainingUnits > 0n ? remainingUnits.toString() : '0',
      costBasis: (quantityBefore - costReleased > 0n ? quantityBefore - costReleased : 0n).toString(),
    });
    markOrderFilled(db, orderId);
    setIntentStatus(db, intent.id, 'FILLED');
    appendAudit(db, {
      actor: 'paper-execution',
      action: 'paper.fill.recorded',
      entity: 'fill',
      entityId: fillId,
      correlationId: deps.correlationId,
      payload: { side: 'SELL', amountIn: amountIn.toString(), amountOut: amountOut.toString(), fee: feeQuote.toString(), snapshotId: snapshot.id },
    });
    return { orderId, fillId, riskDecisionId };
  });

  const refreshed = getIntentById(db, intentId) ?? intent;
  return {
    intent: refreshed,
    riskDecision: getRiskDecisionByIntent(db, intentId),
    orderId: result.orderId,
    fillId: result.fillId,
    replayed: false,
  };
}

export function newCorrelationId(): string {
  return randomUUID();
}

export function ledgerEntryCount(db: Db): number {
  return countLedgerEntries(db);
}