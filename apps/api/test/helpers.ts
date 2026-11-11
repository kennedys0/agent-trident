import { openDatabase, type Db } from '../src/db/index.js';
import { seedOpeningCash, seedReferenceData, seedStrategyConfig, insertSnapshot, insertEvaluation } from '../src/db/repositories.js';
import { WETH, USDG, VERIFIED_VENUE } from '../src/chain/venue.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/domain/strategy.js';
import { buildSnapshot } from '../src/domain/snapshot.js';
import type { EvaluationRecord, PoolSnapshot, PoolIdentity } from '../src/domain/types.js';
import type { QuotePort, QuoteRequest } from '../src/services/ports.js';

export const TEST_POOL: PoolIdentity = {
  id: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca',
  venueId: VERIFIED_VENUE.id,
  token0: WETH,
  token1: USDG,
  fee: 100,
  tickSpacing: 1,
};

/** Real mainnet sqrtPriceX96 observed on 2026-11-11 (≈2,060 USDG per WETH). */
export const REAL_SQRT_PRICE_X96 = 3596635876533259452022784n;
export const REAL_LIQUIDITY = 2698042491188085314n;
const USDG_PER_WETH_BASE = 2_060_000_000n; // 2,060 USDG in 6-decimal base units

export function seedTestDb(db: Db): Db {
  seedReferenceData(db, { venue: VERIFIED_VENUE, pool: TEST_POOL, assets: [WETH, USDG] });
  seedStrategyConfig(db, DEFAULT_STRATEGY_CONFIG);
  seedOpeningCash(db, '10000000000');
  return db;
}

export function makeDb(): Db {
  return seedTestDb(openDatabase(':memory:'));
}

/** Deterministic fake quoter output for 500 USDG at the observed price. */
export const FAKE_BUY_OUT = (500_000_000n * 10n ** 18n) / USDG_PER_WETH_BASE;

export function makeSnapshot(overrides: Partial<{ observedAt: Date; blockNumber: number; liquidity: bigint; reserve0: bigint; reserve1: bigint }> = {}): PoolSnapshot {
  return buildSnapshot({
    pool: TEST_POOL,
    blockNumber: overrides.blockNumber ?? 111_408_300,
    blockHash: '0x8d6705459fdbc4915fdb906502470cfdda3febdb9a835f7c63a4ad777d1ba80b',
    blockTimestampSeconds: Math.floor((overrides.observedAt ?? new Date()).getTime() / 1000),
    sqrtPriceX96: REAL_SQRT_PRICE_X96,
    tick: -200012,
    liquidity: overrides.liquidity ?? REAL_LIQUIDITY,
    reserve0: overrides.reserve0 ?? 5_569_872_785_751_890_475_170n,
    reserve1: overrides.reserve1 ?? 1_958_102_737_784n,
    observedAt: overrides.observedAt ?? new Date(),
    freshnessSeconds: DEFAULT_STRATEGY_CONFIG.maxStalenessSeconds,
  });
}

export function seedEvaluation(db: Db, snapshot: PoolSnapshot, action: EvaluationRecord['action'] = 'BUY', amount = '500000000'): EvaluationRecord {
  insertSnapshot(db, snapshot);
  return insertEvaluation(db, {
    snapshotId: snapshot.id,
    strategyId: DEFAULT_STRATEGY_CONFIG.strategyId,
    configVersion: DEFAULT_STRATEGY_CONFIG.version,
    inputHash: 'a'.repeat(64),
    action,
    signalStrength: 80,
    proposedAmountIn: action === 'BUY' || action === 'SELL' ? amount : null,
    invalidation: 'test',
    reasons: ['test'],
  });
}

/** Deterministic stand-in for QuoterV2 at the observed ≈2,060 USDG/WETH price. */
export function createFakeQuotePort(options: { headBlock?: number; amountOut?: bigint } = {}): QuotePort {
  return {
    async quote(request: QuoteRequest) {
      const amountOut =
        options.amountOut ??
        (request.tokenIn.toLowerCase() === USDG.address.toLowerCase()
          ? (request.amountIn * 10n ** 18n) / USDG_PER_WETH_BASE
          : (request.amountIn * USDG_PER_WETH_BASE) / 10n ** 18n);
      return { amountOut, gasEstimate: 139_283n, blockNumber: request.blockNumber };
    },
    async headBlockNumber() {
      return options.headBlock ?? 111_408_301;
    },
    async baseFeePerGas() {
      return 20_014_000n;
    },
  };
}