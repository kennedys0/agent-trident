import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  approvedRiskDecisionSchema,
  gasEstimateSchema,
  intentExecutionSchema,
  paperFillSchema,
  rejectedRiskDecisionSchema,
  riskDecisionSchema,
} from '../src/index.js';
import { intentExecutionMetaSchema } from '../src/openapi.js';

const passRule = { rule: 'R01', observed: '10', threshold: '30', status: 'PASS' as const };

const approvedDecision = {
  intentId: 'intent-1', policyVersion: 'paper-risk-v1', portfolioVersion: 'ledger:1',
  reasons: ['All 15 paper-risk-v1 rules passed'], evaluatedAt: '2026-11-11T03:00:03Z',
  verdict: 'APPROVED' as const, rules: [passRule],
  approvedBaseQty: { value: '1000000000000000000', decimals: 18 },
  maximumQuoteCost: { value: '2061000000', decimals: 6 },
};

const rejectedDecision = {
  intentId: 'intent-1', policyVersion: 'paper-risk-v1', portfolioVersion: 'ledger:1',
  reasons: ['R02: Kill switch is engaged'], evaluatedAt: '2026-11-11T03:00:03Z',
  verdict: 'REJECTED' as const,
  rules: [{ rule: 'R02', observed: true, threshold: false, status: 'FAIL' as const, reason: 'Kill switch is engaged' }],
};

const intent = {
  id: 'intent-1', evaluationId: 'evaluation-1', idempotencyKey: 'unique-key-1',
  mode: 'PAPER' as const, side: 'BUY' as const,
  token: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  quoteToken: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  baseQty: '1000000000000000000',
  limitPrice: { value: '2060330000', scale: '1000000000000000000' },
  snapshotId: 'snapshot-1', expiresAt: '2026-11-11T03:01:00Z',
  status: 'FILLED' as const,
};

const order = {
  id: 'order-1', intentId: 'intent-1', riskDecisionId: 'decision-1',
  status: 'FILLED' as const, createdAt: '2026-11-11T03:00:03Z',
};

const gasAvailable = {
  status: 'AVAILABLE' as const,
  gasUnits: '139283',
  gasPriceWei: '20014000',
  gasCostWei: (139283n * 20014000n).toString(),
  provenance: 'quoter-v2 gasEstimate + block baseFee at block 111408300',
};

const fill = {
  orderId: 'order-1', snapshotId: 'snapshot-1',
  baseQty: '1000000000000000000', quoteQty: '2060330000',
  feeQuote: { value: '20603', decimals: 6 },
  gasEstimate: gasAvailable,
  executionPrice: { value: '2060330000', scale: '1000000000000000000' },
  assumptionsVersion: 'paper-v1',
  filledAt: '2026-11-11T03:00:04Z',
};

const executed = { intent, riskDecision: approvedDecision, order, fill };
const rejected = {
  intent: { ...intent, status: 'REJECTED' as const },
  riskDecision: rejectedDecision,
  order: null,
  fill: null,
};

test('gas estimate round-trips AVAILABLE and UNAVAILABLE with provenance', () => {
  assert.deepEqual(gasEstimateSchema.parse(gasAvailable), gasAvailable);
  const unavailable = { status: 'UNAVAILABLE', reason: 'no gas price source for ETH/USDG conversion', provenance: 'quoter-v2 returned no gas data' };
  assert.deepEqual(gasEstimateSchema.parse(unavailable), unavailable);
  const withQuoteCost = { ...gasAvailable, gasQuoteCost: { value: '2871', decimals: 6 } };
  assert.deepEqual(gasEstimateSchema.parse(withQuoteCost), withQuoteCost);
});

test('gas estimate rejects inconsistent cost, zero units, and missing provenance', () => {
  assert.equal(gasEstimateSchema.safeParse({ ...gasAvailable, gasCostWei: '1' }).success, false);
  assert.equal(gasEstimateSchema.safeParse({ ...gasAvailable, gasUnits: '0' }).success, false);
  assert.equal(gasEstimateSchema.safeParse({ ...gasAvailable, provenance: '' }).success, false);
  assert.equal(gasEstimateSchema.safeParse({ status: 'UNAVAILABLE', provenance: 'x' }).success, false);
  assert.equal(gasEstimateSchema.safeParse({ status: 'UNAVAILABLE', reason: 'x' }).success, false);
  assert.equal(gasEstimateSchema.safeParse({ ...gasAvailable, status: 'SOMETIMES' }).success, false);
});

test('a zero baseFee chain is representable without faking unavailability', () => {
  const freeGas = { ...gasAvailable, gasPriceWei: '0', gasCostWei: '0' };
  assert.deepEqual(gasEstimateSchema.parse(freeGas), freeGas);
});

test('paper fill rejects the legacy flat gasQuoteEstimate field', () => {
  const legacy = { ...fill, gasEstimate: undefined, gasQuoteEstimate: { value: '1', decimals: 6 } };
  assert.equal(paperFillSchema.safeParse(legacy).success, false);
  assert.equal(paperFillSchema.safeParse({ ...fill, gasEstimate: undefined }).success, false);
});

test('executed intent execution round-trips with linked order and fill', () => {
  assert.deepEqual(intentExecutionSchema.parse(executed), executed);
});

test('rejected intent execution round-trips with explicit null order and fill', () => {
  assert.deepEqual(intentExecutionSchema.parse(rejected), rejected);
});

test('intent execution rejects crossed states and broken linkage', () => {
  const cases: unknown[] = [
    { ...executed, order: null },
    { ...executed, fill: null },
    { ...rejected, order },
    { ...rejected, fill },
    { ...executed, order: { ...order, intentId: 'other-intent' } },
    { ...executed, fill: { ...fill, orderId: 'other-order' } },
    { ...executed, fill: { ...fill, snapshotId: 'other-snapshot' } },
    { ...executed, intent: { ...intent, status: 'APPROVED' } },
    { ...rejected, intent: { ...intent, status: 'FILLED' } },
    { ...executed, riskDecision: rejectedDecision },
    { ...rejected, riskDecision: approvedDecision },
    { ...rejected, order: null, fill: null, intent: { ...intent, status: 'PENDING' } },
  ];
  for (const candidate of cases) {
    assert.equal(intentExecutionSchema.safeParse(candidate).success, false, JSON.stringify(candidate));
  }
});

test('split risk decision schemas stay discriminated on verdict', () => {
  assert.equal(riskDecisionSchema.parse(approvedDecision).verdict, 'APPROVED');
  assert.equal(approvedRiskDecisionSchema.safeParse({ ...approvedDecision, maximumQuoteCost: { value: '0', decimals: 6 } }).success, false);
  assert.equal(rejectedRiskDecisionSchema.safeParse({ ...rejectedDecision, reasons: [] }).success, false);
});

test('intent execution meta requires a boolean replayed flag', () => {
  const meta = { requestId: 'request-1', observedAt: '2026-11-11T03:00:05Z', replayed: true };
  assert.deepEqual(intentExecutionMetaSchema.parse(meta), meta);
  assert.equal(intentExecutionMetaSchema.safeParse({ ...meta, replayed: 'true' }).success, false);
  assert.equal(intentExecutionMetaSchema.safeParse({ requestId: 'request-1', replayed: true }).success, false);
  assert.equal(intentExecutionMetaSchema.safeParse({ ...meta, fee: 100 }).success, false);
});
