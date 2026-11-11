import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditEventSchema,
  baseUnitAmountSchema,
  baseUnitStringSchema,
  createTradeIntentSchema,
  evaluationSchema,
  marketSnapshotSchema,
  paperFillSchema,
  portfolioSchema,
  riskDecisionSchema,
  signedBaseUnitAmountSchema,
} from '../src/index.js';

const completeSnapshot = {
  status: 'COMPLETE',
  chainId: 4663,
  poolAddress: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca',
  baseToken: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  quoteToken: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  blockNumber: '111408300',
  blockHash: `0x${'a'.repeat(64)}`,
  sourceTime: '2026-11-11T03:00:00Z',
  observedAt: '2026-11-11T03:00:01Z',
  source: 'uniswap-v3',
  reservesBase: { value: '1000000000000000000', decimals: 18 },
  reservesQuote: { value: '2060330000', decimals: 6 },
  price: { value: '2060330000', scale: '1000000000000000000' },
  liquidityQuote: { value: '2060330000', decimals: 6 },
};

const buyEvaluation = {
  id: 'evaluation-1',
  snapshotId: 'snapshot-1',
  snapshotStatus: 'COMPLETE',
  strategyId: 'momentum',
  configVersion: 'momentum-v1',
  inputHash: `0x${'b'.repeat(64)}`,
  signalStrength: 5000,
  invalidation: 'price below configured threshold',
  reasons: [],
  evaluatedAt: '2026-11-11T03:00:02Z',
  action: 'BUY',
  proposedBaseQty: '1000000000000000000',
};

test('accepts only canonical integer base-unit strings and explicit scales', () => {
  assert.equal(baseUnitStringSchema.parse('0'), '0');
  assert.equal(baseUnitAmountSchema.parse({ value: '42', decimals: 6 }).value, '42');
  for (const invalid of ['-1', '1.0', '01', '1e6', 1, null]) {
    assert.equal(baseUnitStringSchema.safeParse(invalid).success, false);
  }
  assert.equal(baseUnitAmountSchema.safeParse({ value: '1', decimals: -1 }).success, false);
  assert.equal(signedBaseUnitAmountSchema.parse({ value: '-42', decimals: 6 }).value, '-42');
  assert.equal(signedBaseUnitAmountSchema.safeParse({ value: '-1.0', decimals: 6 }).success, false);
});

test('accepts complete observations and requires missing-input reasons', () => {
  assert.equal(marketSnapshotSchema.parse(completeSnapshot).status, 'COMPLETE');
  assert.equal(marketSnapshotSchema.safeParse({ ...completeSnapshot, status: 'INCOMPLETE' }).success, false);
  assert.equal(marketSnapshotSchema.safeParse({ ...completeSnapshot, chainId: 46630 }).success, false);
});

test('rejects BUY unless its snapshot is COMPLETE', () => {
  assert.equal(evaluationSchema.parse(buyEvaluation).action, 'BUY');
  for (const snapshotStatus of ['STALE', 'INCOMPLETE', 'UNAVAILABLE']) {
    assert.equal(evaluationSchema.safeParse({ ...buyEvaluation, snapshotStatus }).success, false);
  }
});

test('accepts semantic version identifiers and rejects empty versions', () => {
  assert.equal(evaluationSchema.parse(buyEvaluation).configVersion, 'momentum-v1');
  assert.equal(evaluationSchema.safeParse({ ...buyEvaluation, configVersion: '' }).success, false);
  const fill = {
    orderId: 'order-1', snapshotId: 'snapshot-1', baseQty: '1', quoteQty: '2060',
    feeQuote: { value: '1', decimals: 6 },
    gasEstimate: {
      status: 'AVAILABLE',
      gasUnits: '139283',
      gasPriceWei: '20014000',
      gasCostWei: (139283n * 20014000n).toString(),
      provenance: 'quoter-v2 gasEstimate + block baseFee at block 111408300',
    },
    executionPrice: { value: '1', scale: '1' }, assumptionsVersion: 'paper-v1',
    filledAt: '2026-11-11T03:00:03Z',
  };
  assert.deepEqual(paperFillSchema.parse(fill), fill);
  assert.equal(paperFillSchema.safeParse({ ...fill, assumptionsVersion: 'paper v1' }).success, false);
});

test('risk decisions preserve per-rule evidence and distinct approval units', () => {
  const passRule = {
    rule: 'R01', observed: '10', threshold: '30', status: 'PASS',
  };
  const approved = {
    intentId: 'intent-1', policyVersion: 'paper-risk-v1', portfolioVersion: 'portfolio-v1',
    reasons: [], evaluatedAt: '2026-11-11T03:00:03Z', verdict: 'APPROVED', rules: [passRule],
    approvedBaseQty: { value: '1000000000000000000', decimals: 18 },
    maximumQuoteCost: { value: '2061000000', decimals: 6 },
  };
  assert.deepEqual(riskDecisionSchema.parse(approved), approved);
  assert.equal(riskDecisionSchema.safeParse({
    ...approved,
    rules: [{ ...passRule, status: 'FAIL', reason: 'stale quote' }],
  }).success, false);
  assert.equal(riskDecisionSchema.safeParse({
    ...approved, approvedBaseQty: { value: '0', decimals: 18 },
  }).success, false);
  const rejected = {
    intentId: approved.intentId,
    policyVersion: approved.policyVersion,
    portfolioVersion: approved.portfolioVersion,
    evaluatedAt: approved.evaluatedAt,
    verdict: 'REJECTED',
    rules: [{ ...passRule, status: 'UNAVAILABLE', reason: 'quote unavailable' }],
    reasons: ['R01 unavailable'],
  };
  assert.deepEqual(riskDecisionSchema.parse(rejected), rejected);
  assert.equal(riskDecisionSchema.safeParse({ ...rejected, reasons: [] }).success, false);
});

test('create intent accepts only evaluation and idempotency references', () => {
  const intent = { evaluationId: 'evaluation-1', idempotencyKey: 'unique-key-1' };
  assert.deepEqual(createTradeIntentSchema.parse(intent), intent);
  assert.equal(createTradeIntentSchema.safeParse({ ...intent, side: 'BUY' }).success, false);
  assert.equal(createTradeIntentSchema.safeParse({ ...intent, baseQty: '1' }).success, false);
  assert.equal(createTradeIntentSchema.safeParse({ ...intent, mode: 'LIVE' }).success, false);
});

test('portfolio positions round-trip valued and explicitly unpriced states', () => {
  const basePosition = {
    asset: completeSnapshot.baseToken,
    quantity: { value: '1000000000000000000', decimals: 18 },
    costBasisQuote: { value: '2060000000', decimals: 6 },
  };
  const portfolio = {
    mode: 'PAPER', asOf: '2026-11-11T03:00:04Z', balances: [],
    equityQuote: { value: '10000000000', decimals: 6 },
    realizedPnlQuote: { value: '0', decimals: 6 },
    unrealizedPnlQuote: { value: '-100000', decimals: 6 },
    positions: [
      {
        ...basePosition, valuationStatus: 'VALUED', valuationSnapshotId: 'snapshot-1',
        unrealizedPnlQuote: { value: '-100000', decimals: 6 },
      },
      { ...basePosition, valuationStatus: 'UNPRICED', reason: 'snapshot unavailable' },
    ],
  };
  assert.deepEqual(portfolioSchema.parse(portfolio), portfolio);
  assert.equal(portfolioSchema.safeParse({
    ...portfolio,
    positions: [{ ...basePosition, valuationStatus: 'UNPRICED', unrealizedPnlQuote: { value: '0', decimals: 6 } }],
  }).success, false);
  assert.equal(portfolioSchema.safeParse({
    ...portfolio,
    positions: [{ ...basePosition, valuationStatus: 'VALUED', unrealizedPnlQuote: { value: '0', decimals: 6 } }],
  }).success, false);
});

test('audit payload remains unknown data rather than trusted domain content', () => {
  const parsed = auditEventSchema.parse({
    id: 'event-1', type: 'intent.created', aggregateId: 'intent-1',
    payload: { arbitrary: true }, createdAt: '2026-11-11T03:00:04Z',
  });
  assert.deepEqual(parsed.payload, { arbitrary: true });
});
