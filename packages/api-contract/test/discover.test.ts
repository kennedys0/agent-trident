import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  liquidityMetricSchema,
  poolSummarySchema,
  priceMetricSchema,
  volumeMetricSchema,
  watchlistSchema,
  watchlistMutationSchema,
} from '../src/index.js';

const token0 = { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', symbol: 'WETH', decimals: 18 };
const token1 = { address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', symbol: 'USDG', decimals: 6 };
const observation = {
  blockNumber: '112298569',
  sourceTime: '2026-11-12T05:45:43.000Z',
  observedAt: '2026-11-12T05:45:45.000Z',
  provenance: 'uniswap-v3-slot0+balanceOf@block-112298569',
};

const availableSummary = {
  chainId: 4663,
  pool: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca',
  factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
  fee: 100,
  token0,
  token1,
  venue: 'verified-allowlist',
  firstSeenBlock: null,
  status: 'AVAILABLE',
  metrics: {
    price: {
      status: 'AVAILABLE',
      ...observation,
      token1PerToken0: { value: '2060330000000000000000', scale: '1000000000000000000' },
      token0PerToken1: { value: '485282000000000000', scale: '1000000000000000000' },
    },
    liquidity: {
      status: 'AVAILABLE',
      ...observation,
      liquidity: '2698042491188085314',
      reserve0: '5569872785751890475170',
      reserve1: '1958102737784784772784',
      reserve0Decimals: 18,
      reserve1Decimals: 6,
    },
    volume24h: {
      status: 'UNAVAILABLE',
      reason: 'no verifiable volume source; the public RPC exposes no pinned-block per-pool volume',
    },
  },
  confidence: 'LOW',
  confidenceReason: 'single Uniswap v3 pool; a spot price is not an independent oracle',
  watched: false,
};

test('pool summary round-trips AVAILABLE with provenance and LOW confidence', () => {
  const parsed = poolSummarySchema.parse(availableSummary);
  assert.equal(parsed.metrics.price.status, 'AVAILABLE');
  assert.equal(parsed.metrics.liquidity.status, 'AVAILABLE');
  assert.equal(parsed.metrics.volume24h.status, 'UNAVAILABLE');
  assert.equal(parsed.confidence, 'LOW');
});

test('volume can never be reported as zero or estimated away from UNAVAILABLE', () => {
  const parsed = volumeMetricSchema.parse(availableSummary.metrics.volume24h);
  assert.equal(parsed.status, 'UNAVAILABLE');
  assert.equal(volumeMetricSchema.safeParse({ status: 'UNAVAILABLE' }).success, false);
  assert.equal(volumeMetricSchema.safeParse({ status: 'AVAILABLE', ...observation, volumeQuote24h: { value: '0', decimals: 6 } }).success, true);
});

test('price and liquidity metrics round-trip both directions', () => {
  const price = priceMetricSchema.parse(availableSummary.metrics.price);
  assert.equal(price.status, 'AVAILABLE');
  assert.equal(priceMetricSchema.safeParse({ ...availableSummary.metrics.price, token1PerToken0: { value: '1', scale: '0' } }).success, false);
  const liquidity = liquidityMetricSchema.parse(availableSummary.metrics.liquidity);
  assert.equal(liquidity.status, 'AVAILABLE');
  assert.equal(liquidityMetricSchema.safeParse({ ...availableSummary.metrics.liquidity, reserve0Decimals: 256 }).success, false);
});

test('unavailable metrics require a reason and cannot carry values', () => {
  const unavailablePrice = { status: 'UNAVAILABLE', reason: 'no observation persisted yet' };
  assert.deepEqual(priceMetricSchema.parse(unavailablePrice), unavailablePrice);
  assert.equal(priceMetricSchema.safeParse({ status: 'UNAVAILABLE' }).success, false);
  assert.equal(priceMetricSchema.safeParse({ status: 'UNAVAILABLE', reason: 'x', token1PerToken0: { value: '1', scale: '1000000000000000000' } }).success, false);
});

test('pool summary rejects inconsistent status/metric pairing and bad venue', () => {
  assert.equal(poolSummarySchema.safeParse({ ...availableSummary, status: 'MAYBE' }).success, false);
  assert.equal(poolSummarySchema.safeParse({ ...availableSummary, venue: 'cex' }).success, false);
  const observedVolume = {
    status: 'AVAILABLE' as const,
    blockNumber: observation.blockNumber,
    sourceTime: observation.sourceTime,
    observedAt: observation.observedAt,
    provenance: observation.provenance,
    volumeQuote24h: { value: '123400000', decimals: 6 },
  };
  assert.equal(poolSummarySchema.safeParse({ ...availableSummary, metrics: { ...availableSummary.metrics, volume24h: observedVolume } }).success, true);
});

test('watchlist payloads round-trip and reject malformed addresses', () => {
  const list = watchlistSchema.parse({ entries: [{ address: token0.address, addedAt: '2026-11-12T05:45:45.000Z', known: true, symbol: 'WETH' }] });
  assert.equal(list.entries[0]?.symbol, 'WETH');
  assert.equal(watchlistMutationSchema.parse({ address: token0.address, result: 'ADDED' }).result, 'ADDED');
  assert.equal(watchlistMutationSchema.safeParse({ address: '0xzz', result: 'ADDED' }).success, false);
});
