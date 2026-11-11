import { randomUUID } from 'node:crypto';
import { nowIso, type Db } from './index.js';
import { quoteValueOf } from '../domain/price.js';
import type { ChainCheckpoint, ReorgKind } from '../chain/checkpoint.js';
import type {
  AssetIdentity,
  EvaluationRecord,
  PoolSnapshot,
  PoolIdentity,
  PortfolioState,
  RiskOutcome,
  StrategyConfig,
  Venue,
} from '../domain/types.js';

type Row = Record<string, unknown>;

function mapSnapshot(row: Row): PoolSnapshot {
  return {
    id: row['id'] as string,
    poolId: row['pool_id'] as `0x${string}`,
    chainId: 4663,
    blockNumber: Number(row['block_number']),
    blockHash: row['block_hash'] as `0x${string}`,
    sqrtPriceX96: row['sqrt_price_x96'] as string,
    tick: Number(row['tick']),
    liquidity: row['liquidity'] as string,
    reserve0: row['reserve0'] as string,
    reserve1: row['reserve1'] as string,
    priceScaled: row['price_scaled'] as string,
    priceScale: Number(row['price_scale']),
    source: row['source'] as PoolSnapshot['source'],
    status: row['status'] as PoolSnapshot['status'],
    sourceTime: row['source_time'] as string,
    observedAt: row['observed_at'] as string,
  };
}

function mapEvaluation(row: Row): EvaluationRecord {
  return {
    id: row['id'] as string,
    snapshotId: row['snapshot_id'] as string,
    strategyId: row['strategy_id'] as EvaluationRecord['strategyId'],
    configVersion: String(row['config_version']),
    inputHash: row['input_hash'] as string,
    action: row['action'] as EvaluationRecord['action'],
    signalStrength: Number(row['signal_strength']),
    proposedAmountIn: (row['proposed_amount_in'] as string | null) ?? null,
    invalidation: row['invalidation'] as string,
    reasons: JSON.parse(row['reasons_json'] as string) as string[],
    createdAt: row['created_at'] as string,
  };
}

export function seedReferenceData(
  db: Db,
  input: { venue: Venue; pool: PoolIdentity; assets: readonly AssetIdentity[] },
): void {
  const at = nowIso();
  const insertAsset = db.prepare(
    'INSERT INTO assets (id, symbol, address, decimals, kind, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET address = excluded.address, decimals = excluded.decimals',
  );
  for (const asset of input.assets) {
    insertAsset.run(asset.id, asset.symbol, asset.address, asset.decimals, asset.id === 'USDG' ? 'STABLECOIN' : 'NATIVE_WRAPPED', at);
  }
  db.prepare(
    'INSERT INTO venues (id, chain_id, name, factory_address, quoter_address, router_address, provenance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET factory_address = excluded.factory_address, quoter_address = excluded.quoter_address, router_address = excluded.router_address',
  ).run(input.venue.id, input.venue.chainId, 'Uniswap v3', input.venue.factory, input.venue.quoterV2, input.venue.swapRouter02, JSON.stringify(input.venue.provenance), at);
  db.prepare(
    'INSERT INTO pools (id, venue_id, token0_id, token1_id, fee, tick_spacing, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
  ).run(input.pool.id, input.pool.venueId, input.pool.token0.id, input.pool.token1.id, input.pool.fee, input.pool.tickSpacing, at);
}

export function seedStrategyConfig(db: Db, config: StrategyConfig): void {
  db.prepare(
    'INSERT INTO strategy_configs (strategy_id, version, params_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(strategy_id, version) DO NOTHING',
  ).run(config.strategyId, config.version, JSON.stringify(config), nowIso());
}

export function seedOpeningCash(db: Db, amountBase: string): void {
  const existing = db.prepare("SELECT 1 AS present FROM ledger_entries WHERE business_key = 'genesis:opening_cash'").get();
  if (existing) return;
  postLedgerEntries(db, [
    {
      txGroup: 'genesis',
      account: 'EQUITY',
      assetId: 'USDG',
      direction: 'CREDIT',
      amount: amountBase,
      businessKey: 'genesis:opening_cash_equity',
    },
    {
      txGroup: 'genesis',
      account: 'CASH',
      assetId: 'USDG',
      direction: 'DEBIT',
      amount: amountBase,
      businessKey: 'genesis:opening_cash',
    },
  ]);
}

export type LedgerEntryInput = {
  readonly txGroup: string;
  readonly account: 'CASH' | 'POSITION' | 'FEE_EXPENSE' | 'REALIZED' | 'EQUITY' | 'CLEARING';
  readonly assetId: string;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amount: string;
  readonly businessKey: string;
};

export function postLedgerEntries(db: Db, entries: readonly LedgerEntryInput[]): void {
  const insert = db.prepare(
    'INSERT INTO ledger_entries (id, tx_group, account, asset_id, direction, amount, business_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const at = nowIso();
  for (const entry of entries) {
    insert.run(randomUUID(), entry.txGroup, entry.account, entry.assetId, entry.direction, entry.amount, entry.businessKey, at);
  }
}

export type SnapshotIngest =
  | { readonly status: 'CREATED'; readonly snapshot: PoolSnapshot }
  | { readonly status: 'EXISTING'; readonly snapshot: PoolSnapshot }
  | { readonly status: 'QUARANTINED_BLOCK'; readonly blockNumber: number };

/**
 * Stores one block-pinned snapshot. A block height that a reorg quarantined is
 * never re-used: the row already holds that height and a second hash at the same
 * height would rewrite the provenance a stored fill points at, so ingestion
 * resumes at the next canonical block above it.
 */
export function insertSnapshot(db: Db, snapshot: PoolSnapshot): SnapshotIngest {
  const existing = getSnapshotAtBlockAny(db, snapshot.poolId, snapshot.blockNumber);
  if (existing !== null) {
    if (existing.quarantined) return { status: 'QUARANTINED_BLOCK', blockNumber: snapshot.blockNumber };
    if (existing.snapshot.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase()) {
      throw new Error(
        `Block ${snapshot.blockNumber} already stores hash ${existing.snapshot.blockHash}; refusing to overwrite it with ${snapshot.blockHash}`,
      );
    }
    return { status: 'EXISTING', snapshot: existing.snapshot };
  }
  db.prepare(
    `INSERT INTO market_snapshots (id, pool_id, chain_id, block_number, block_hash, sqrt_price_x96, tick, liquidity, reserve0, reserve1, price_scaled, price_scale, source, status, source_time, observed_at, created_at, reorg_id, quarantined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(pool_id, block_number) DO NOTHING`,
  ).run(
    snapshot.id,
    snapshot.poolId,
    snapshot.chainId,
    snapshot.blockNumber,
    snapshot.blockHash,
    snapshot.sqrtPriceX96,
    snapshot.tick,
    snapshot.liquidity,
    snapshot.reserve0,
    snapshot.reserve1,
    snapshot.priceScaled,
    snapshot.priceScale,
    snapshot.source,
    snapshot.status,
    snapshot.sourceTime,
    snapshot.observedAt,
    nowIso(),
  );
  const stored = getSnapshotByBlock(db, snapshot.poolId, snapshot.blockNumber);
  if (!stored) throw new Error('snapshot insert failed');
  return { status: 'CREATED', snapshot: stored };
}

export function getSnapshotByBlock(db: Db, poolId: string, blockNumber: number): PoolSnapshot | null {
  const row = db
    .prepare('SELECT * FROM market_snapshots WHERE pool_id = ? AND block_number = ? AND quarantined_at IS NULL')
    .get(poolId, blockNumber) as Row | undefined;
  return row ? mapSnapshot(row) : null;
}

export function getSnapshotAtBlockAny(
  db: Db,
  poolId: string,
  blockNumber: number,
): { snapshot: PoolSnapshot; quarantined: boolean } | null {
  const row = db
    .prepare('SELECT * FROM market_snapshots WHERE pool_id = ? AND block_number = ?')
    .get(poolId, blockNumber) as Row | undefined;
  return row ? { snapshot: mapSnapshot(row), quarantined: row['quarantined_at'] !== null } : null;
}

export function getSnapshotById(db: Db, id: string): PoolSnapshot | null {
  const row = db.prepare('SELECT * FROM market_snapshots WHERE id = ?').get(id) as Row | undefined;
  return row ? mapSnapshot(row) : null;
}

export function getLatestSnapshot(db: Db, poolId: string): PoolSnapshot | null {
  const row = db
    .prepare(
      'SELECT * FROM market_snapshots WHERE pool_id = ? AND quarantined_at IS NULL ORDER BY block_number DESC LIMIT 1',
    )
    .get(poolId) as Row | undefined;
  return row ? mapSnapshot(row) : null;
}

/** Canonical snapshots at or above `fromBlock`, oldest first. */
export function listCanonicalSnapshotsFrom(db: Db, poolId: string, fromBlock: number): (PoolSnapshot & { id: string })[] {
  const rows = db
    .prepare(
      'SELECT * FROM market_snapshots WHERE pool_id = ? AND block_number >= ? AND quarantined_at IS NULL ORDER BY block_number ASC',
    )
    .all(poolId, fromBlock) as Row[];
  return rows.map((row) => mapSnapshot(row));
}

export function quarantineSnapshot(db: Db, snapshotId: string, reorgId: string, at: string): void {
  db.prepare('UPDATE market_snapshots SET reorg_id = ?, quarantined_at = ? WHERE id = ?').run(reorgId, at, snapshotId);
}

export function deleteSnapshot(db: Db, snapshotId: string): void {
  db.prepare('DELETE FROM market_snapshots WHERE id = ?').run(snapshotId);
}

export function insertEvaluation(
  db: Db,
  evaluation: Omit<EvaluationRecord, 'id' | 'createdAt'>,
): { evaluation: EvaluationRecord; created: boolean } {
  const result = db
    .prepare(
      `INSERT INTO strategy_evaluations (id, snapshot_id, strategy_id, config_version, input_hash, action, signal_strength, proposed_amount_in, invalidation, reasons_json, created_at, reorg_id, quarantined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
       ON CONFLICT(snapshot_id, strategy_id, config_version) DO NOTHING`,
    )
    .run(
      randomUUID(),
      evaluation.snapshotId,
      evaluation.strategyId,
      evaluation.configVersion,
      evaluation.inputHash,
      evaluation.action,
      evaluation.signalStrength,
      evaluation.proposedAmountIn,
      evaluation.invalidation,
      JSON.stringify(evaluation.reasons),
      nowIso(),
    );
  const row = db
    .prepare('SELECT * FROM strategy_evaluations WHERE snapshot_id = ? AND strategy_id = ? AND config_version = ?')
    .get(evaluation.snapshotId, evaluation.strategyId, evaluation.configVersion) as Row;
  return { evaluation: mapEvaluation(row), created: Number(result.changes) === 1 };
}

export function listEvaluations(db: Db, limit = 20): EvaluationRecord[] {
  const rows = db
    .prepare(
      `SELECT e.* FROM strategy_evaluations e
       JOIN market_snapshots s ON s.id = e.snapshot_id
       WHERE e.quarantined_at IS NULL AND s.quarantined_at IS NULL
       ORDER BY e.created_at DESC LIMIT ?`,
    )
    .all(limit) as Row[];
  return rows.map(mapEvaluation);
}

export function getEvaluation(db: Db, id: string): EvaluationRecord | null {
  const row = db.prepare('SELECT * FROM strategy_evaluations WHERE id = ?').get(id) as Row | undefined;
  return row ? mapEvaluation(row) : null;
}

/** True when a reorg quarantined the evaluation or its snapshot. */
export function isEvaluationQuarantined(db: Db, evaluationId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS quarantined FROM strategy_evaluations e
       JOIN market_snapshots s ON s.id = e.snapshot_id
       WHERE e.id = ? AND (e.quarantined_at IS NOT NULL OR s.quarantined_at IS NOT NULL)`,
    )
    .get(evaluationId) as Row | undefined;
  return row !== undefined;
}

export function listEvaluationsForSnapshot(db: Db, snapshotId: string): (EvaluationRecord & { id: string })[] {
  const rows = db.prepare('SELECT * FROM strategy_evaluations WHERE snapshot_id = ? ORDER BY created_at ASC').all(snapshotId) as Row[];
  return rows.map(mapEvaluation);
}

export function quarantineEvaluation(db: Db, evaluationId: string, reorgId: string, at: string): void {
  db.prepare('UPDATE strategy_evaluations SET reorg_id = ?, quarantined_at = ? WHERE id = ?').run(reorgId, at, evaluationId);
}

export function deleteEvaluation(db: Db, evaluationId: string): void {
  db.prepare('DELETE FROM strategy_evaluations WHERE id = ?').run(evaluationId);
}

export function listIntentsForSnapshot(db: Db, snapshotId: string): IntentRecord[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT i.* FROM order_intents i
       LEFT JOIN strategy_evaluations e ON e.id = i.evaluation_id
       WHERE i.snapshot_id = ? OR e.snapshot_id = ?`,
    )
    .all(snapshotId, snapshotId) as Row[];
  return rows.map(mapIntent);
}

export function countFillsForSnapshot(db: Db, snapshotId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM fills WHERE snapshot_id = ?').get(snapshotId) as Row;
  return Number(row['count']);
}

export type IntentRecord = {
  readonly id: string;
  readonly evaluationId: string;
  readonly idempotencyKey: string;
  readonly mode: 'OBSERVE' | 'PAPER';
  readonly side: 'BUY' | 'SELL';
  readonly tokenInId: string;
  readonly tokenOutId: string;
  readonly amountIn: string;
  readonly minAmountOut: string;
  readonly snapshotId: string;
  readonly expiresAt: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'FILLED';
  readonly createdAt: string;
};

function mapIntent(row: Row): IntentRecord {
  return {
    id: row['id'] as string,
    evaluationId: row['evaluation_id'] as string,
    idempotencyKey: row['idempotency_key'] as string,
    mode: row['mode'] as IntentRecord['mode'],
    side: row['side'] as IntentRecord['side'],
    tokenInId: row['token_in_id'] as string,
    tokenOutId: row['token_out_id'] as string,
    amountIn: row['amount_in'] as string,
    minAmountOut: row['min_amount_out'] as string,
    snapshotId: row['snapshot_id'] as string,
    expiresAt: row['expires_at'] as string,
    status: row['status'] as IntentRecord['status'],
    createdAt: row['created_at'] as string,
  };
}

export function createIntent(
  db: Db,
  input: Omit<IntentRecord, 'id' | 'createdAt' | 'status'>,
): { intent: IntentRecord; created: boolean } {
  const result = db
    .prepare(
      `INSERT INTO order_intents (id, evaluation_id, idempotency_key, mode, side, token_in_id, token_out_id, amount_in, min_amount_out, snapshot_id, expires_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(
      randomUUID(),
      input.evaluationId,
      input.idempotencyKey,
      input.mode,
      input.side,
      input.tokenInId,
      input.tokenOutId,
      input.amountIn,
      input.minAmountOut,
      input.snapshotId,
      input.expiresAt,
      nowIso(),
    );
  // A concurrent writer may have won either unique key, so read back by both
  // business keys instead of trusting the insert.
  const row = db
    .prepare('SELECT * FROM order_intents WHERE idempotency_key = ? OR evaluation_id = ? LIMIT 1')
    .get(input.idempotencyKey, input.evaluationId) as Row;
  return { intent: mapIntent(row), created: Number(result.changes) === 1 };
}

export function getIntentByIdempotencyKey(db: Db, key: string): IntentRecord | null {
  const row = db.prepare('SELECT * FROM order_intents WHERE idempotency_key = ?').get(key) as Row | undefined;
  return row ? mapIntent(row) : null;
}

export function getIntentByEvaluationId(db: Db, evaluationId: string): IntentRecord | null {
  const row = db.prepare('SELECT * FROM order_intents WHERE evaluation_id = ?').get(evaluationId) as Row | undefined;
  return row ? mapIntent(row) : null;
}

export function getIntentById(db: Db, id: string): IntentRecord | null {
  const row = db.prepare('SELECT * FROM order_intents WHERE id = ?').get(id) as Row | undefined;
  return row ? mapIntent(row) : null;
}

export function setIntentStatus(db: Db, id: string, status: IntentRecord['status']): void {
  db.prepare('UPDATE order_intents SET status = ? WHERE id = ?').run(status, id);
}

export function insertRiskDecision(
  db: Db,
  input: { intentId: string; decision: RiskOutcome; portfolioVersion: string },
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO risk_decisions (id, intent_id, policy_version, portfolio_version, verdict, rules_json, approved_base_qty, approved_quote_amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(intent_id) DO NOTHING`,
  ).run(
    id,
    input.intentId,
    input.decision.policyVersion,
    input.portfolioVersion,
    input.decision.verdict,
    JSON.stringify(input.decision.rules),
    input.decision.approvedBaseQty,
    input.decision.approvedQuoteAmount,
    input.decision.evaluatedAt,
  );
  const row = db.prepare('SELECT id FROM risk_decisions WHERE intent_id = ?').get(input.intentId) as Row;
  return row['id'] as string;
}

export type RiskDecisionRecord = RiskOutcome & {
  readonly id: string;
  readonly intentId: string;
  readonly portfolioVersion: string;
};

export function getRiskDecisionByIntent(db: Db, intentId: string): RiskDecisionRecord | null {
  const row = db.prepare('SELECT * FROM risk_decisions WHERE intent_id = ?').get(intentId) as Row | undefined;
  if (!row) return null;
  return {
    id: row['id'] as string,
    intentId: row['intent_id'] as string,
    verdict: row['verdict'] as RiskOutcome['verdict'],
    policyVersion: row['policy_version'] as string,
    portfolioVersion: row['portfolio_version'] as string,
    rules: JSON.parse(row['rules_json'] as string) as RiskOutcome['rules'],
    approvedBaseQty: (row['approved_base_qty'] as string | null) ?? null,
    approvedQuoteAmount: (row['approved_quote_amount'] as string | null) ?? null,
    evaluatedAt: row['created_at'] as string,
  };
}

export function insertOrder(db: Db, input: { intentId: string; riskDecisionId: string }): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO orders (id, intent_id, risk_decision_id, status, created_at) VALUES (?, ?, ?, 'CREATED', ?) ON CONFLICT(intent_id) DO NOTHING",
  ).run(id, input.intentId, input.riskDecisionId, nowIso());
  const row = db.prepare('SELECT id FROM orders WHERE intent_id = ?').get(input.intentId) as Row;
  return row['id'] as string;
}

export type FillGas =
  | {
      readonly status: 'AVAILABLE';
      readonly gasUnits: string;
      readonly gasPriceWei: string;
      readonly gasCostWei: string;
      readonly provenance: string;
    }
  | {
      readonly status: 'UNAVAILABLE';
      readonly reason: string;
      readonly provenance: string;
    };

export type FillInput = {
  readonly orderId: string;
  readonly snapshotId: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly executionPriceScaled: string;
  readonly feeAmount: string;
  readonly gas: FillGas;
  readonly assumptionsVersion: string;
};

export function insertFill(db: Db, input: FillInput): string {
  const id = randomUUID();
  const gas = input.gas;
  db.prepare(
    `INSERT INTO fills (id, order_id, snapshot_id, amount_in, amount_out, execution_price_scaled, fee_amount, gas_status, gas_units, gas_price_wei, gas_cost_wei, gas_reason, gas_provenance, assumptions_version, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(order_id) DO NOTHING`,
  ).run(
    id,
    input.orderId,
    input.snapshotId,
    input.amountIn,
    input.amountOut,
    input.executionPriceScaled,
    input.feeAmount,
    gas.status,
    gas.status === 'AVAILABLE' ? gas.gasUnits : null,
    gas.status === 'AVAILABLE' ? gas.gasPriceWei : null,
    gas.status === 'AVAILABLE' ? gas.gasCostWei : null,
    gas.status === 'UNAVAILABLE' ? gas.reason : null,
    gas.provenance,
    input.assumptionsVersion,
    nowIso(),
  );
  const row = db.prepare('SELECT id FROM fills WHERE order_id = ?').get(input.orderId) as Row;
  return row['id'] as string;
}

export function markOrderFilled(db: Db, orderId: string): void {
  db.prepare("UPDATE orders SET status = 'FILLED' WHERE id = ?").run(orderId);
}

export function getOrderById(db: Db, orderId: string): Row | null {
  return (db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Row | undefined) ?? null;
}

export function getOrderByIntent(db: Db, intentId: string): Row | null {
  return (db.prepare('SELECT * FROM orders WHERE intent_id = ?').get(intentId) as Row | undefined) ?? null;
}

export function getFillByOrder(db: Db, orderId: string): Row | null {
  return (db.prepare('SELECT * FROM fills WHERE order_id = ?').get(orderId) as Row | undefined) ?? null;
}

export function countLedgerEntries(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM ledger_entries').get() as Row;
  return Number(row['count']);
}

export function getPortfolio(
  db: Db,
  priceScaled: string | null,
  priceScale: number,
  baseDecimals = 18,
  quoteDecimals = 6,
): PortfolioState {
  const cashRow = db
    .prepare("SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END), 0) AS cash FROM ledger_entries WHERE account = 'CASH' AND asset_id = 'USDG'")
    .get() as Row;
  const realizedRow = db
    .prepare("SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END), 0) AS realized FROM ledger_entries WHERE account = 'REALIZED' AND asset_id = 'USDG'")
    .get() as Row;
  const positionRow = db.prepare("SELECT quantity, cost_basis FROM positions WHERE asset_id = 'WETH'").get() as Row | undefined;

  const cash = BigInt(String(cashRow['cash']));
  const quantity = positionRow ? BigInt(String(positionRow['quantity'])) : 0n;
  const costBasis = positionRow ? BigInt(String(positionRow['cost_basis'])) : 0n;

  const marketValue =
    priceScaled !== null && quantity > 0n
      ? quoteValueOf(quantity, BigInt(priceScaled), baseDecimals, quoteDecimals, priceScale)
      : 0n;
  const unrealized = quantity > 0n && costBasis > 0n ? (marketValue - costBasis).toString() : null;
  const equity = cash + marketValue;

  return {
    cashUsdg: cash.toString(),
    positions: quantity > 0n ? [{ assetId: 'WETH', quantity: quantity.toString() }] : [],
    realizedPnlUsdg: String(realizedRow['realized']),
    unrealizedPnlUsdg: unrealized,
    costBasisUsdg: costBasis.toString(),
    portfolioVersion: `ledger:${countLedgerEntries(db)}`,
    asOf: nowIso(),
  };
}

export function upsertPosition(db: Db, input: { assetId: string; quantity: string; costBasis: string }): void {
  db.prepare(
    `INSERT INTO positions (asset_id, quantity, cost_basis, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(asset_id) DO UPDATE SET quantity = excluded.quantity, cost_basis = excluded.cost_basis, updated_at = excluded.updated_at`,
  ).run(input.assetId, input.quantity, input.costBasis, nowIso());
}

export function getPosition(db: Db, assetId: string): { quantity: string; costBasis: string } | null {
  const row = db.prepare('SELECT quantity, cost_basis FROM positions WHERE asset_id = ?').get(assetId) as Row | undefined;
  return row ? { quantity: String(row['quantity']), costBasis: String(row['cost_basis']) } : null;
}

export function appendAudit(
  db: Db,
  input: {
    actor: string;
    action: string;
    entity: string;
    entityId: string;
    correlationId: string;
    payload?: Record<string, unknown>;
  },
): void {
  db.prepare(
    'INSERT INTO audit_events (id, at, actor, action, entity, entity_id, correlation_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    randomUUID(),
    nowIso(),
    input.actor,
    input.action,
    input.entity,
    input.entityId,
    input.correlationId,
    JSON.stringify(input.payload ?? {}),
  );
}

export function listJournal(db: Db, limit: number, beforeSequence?: number): Row[] {
  if (beforeSequence === undefined) {
    return db.prepare('SELECT rowid AS sequence, * FROM audit_events ORDER BY rowid DESC LIMIT ?').all(limit) as Row[];
  }
  return db
    .prepare('SELECT rowid AS sequence, * FROM audit_events WHERE rowid < ? ORDER BY rowid DESC LIMIT ?')
    .all(beforeSequence, limit) as Row[];
}

export function getState(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM automation_state WHERE key = ?').get(key) as Row | undefined;
  return row ? String(row['value']) : null;
}

export function setState(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO automation_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(key, value, nowIso());
}

export const KILL_SWITCH_KEY = 'new_entries_halted';

export function isKillSwitchEngaged(db: Db): boolean {
  try {
    return getState(db, KILL_SWITCH_KEY) === 'true';
  } catch {
    // Unreadable state fails closed.
    return true;
  }
}

export type { ChainCheckpoint };

export function getCheckpoint(db: Db, poolId: string): ChainCheckpoint | null {
  const row = db.prepare('SELECT * FROM chain_checkpoints WHERE pool_id = ?').get(poolId) as Row | undefined;
  if (!row) return null;
  return {
    poolId: row['pool_id'] as string,
    chainId: Number(row['chain_id']),
    blockNumber: Number(row['block_number']),
    blockHash: row['block_hash'] as string,
    parentHash: (row['parent_hash'] as string | null) ?? null,
    updatedAt: row['updated_at'] as string,
  };
}

export function saveCheckpoint(
  db: Db,
  input: { poolId: string; chainId: number; blockNumber: number; blockHash: string; parentHash: string | null },
): void {
  db.prepare(
    `INSERT INTO chain_checkpoints (pool_id, chain_id, block_number, block_hash, parent_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(pool_id) DO UPDATE SET
       chain_id = excluded.chain_id,
       block_number = excluded.block_number,
       block_hash = excluded.block_hash,
       parent_hash = excluded.parent_hash,
       updated_at = excluded.updated_at`,
  ).run(input.poolId, input.chainId, input.blockNumber, input.blockHash, input.parentHash, nowIso());
}

export function clearCheckpoint(db: Db, poolId: string): void {
  db.prepare('DELETE FROM chain_checkpoints WHERE pool_id = ?').run(poolId);
}

export type ReorgRecord = {
  readonly id: string;
  readonly poolId: string;
  readonly detectedAt: string;
  readonly kind: ReorgKind;
  readonly divergenceBlock: number;
  readonly checkpointBlock: number | null;
  readonly checkpointHash: string | null;
  readonly canonicalBlock: number | null;
  readonly canonicalHash: string | null;
  readonly rewoundSnapshots: number;
  readonly rewoundEvaluations: number;
  readonly quarantinedSnapshots: number;
  readonly quarantinedEvaluations: number;
  readonly affectedIntents: number;
  readonly correlationId: string;
};

export function insertReorg(db: Db, reorg: ReorgRecord): void {
  db.prepare(
    `INSERT INTO chain_reorgs (id, pool_id, detected_at, kind, divergence_block, checkpoint_block, checkpoint_hash, canonical_block, canonical_hash, rewound_snapshots, rewound_evaluations, quarantined_snapshots, quarantined_evaluations, affected_intents, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    reorg.id,
    reorg.poolId,
    reorg.detectedAt,
    reorg.kind,
    reorg.divergenceBlock,
    reorg.checkpointBlock,
    reorg.checkpointHash,
    reorg.canonicalBlock,
    reorg.canonicalHash,
    reorg.rewoundSnapshots,
    reorg.rewoundEvaluations,
    reorg.quarantinedSnapshots,
    reorg.quarantinedEvaluations,
    reorg.affectedIntents,
    reorg.correlationId,
  );
}

export function recordReorgImpact(
  db: Db,
  input: {
    reorgId: string;
    entity: 'market_snapshot' | 'strategy_evaluation' | 'order_intent';
    entityId: string;
    blockNumber: number;
    disposition: 'DELETED' | 'QUARANTINED';
  },
): void {
  db.prepare(
    'INSERT INTO chain_reorg_impacts (reorg_id, entity, entity_id, block_number, disposition) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
  ).run(input.reorgId, input.entity, input.entityId, input.blockNumber, input.disposition);
}

export function listReorgs(db: Db, limit = 20): Row[] {
  return db.prepare('SELECT * FROM chain_reorgs ORDER BY detected_at DESC LIMIT ?').all(limit) as Row[];
}

export function listReorgImpacts(db: Db, reorgId: string): Row[] {
  return db.prepare('SELECT * FROM chain_reorg_impacts WHERE reorg_id = ? ORDER BY block_number ASC').all(reorgId) as Row[];
}

/** Highest canonical snapshot strictly below `blockNumber`, used to re-anchor the checkpoint. */
export function getHighestCanonicalSnapshotBelow(db: Db, poolId: string, blockNumber: number): PoolSnapshot | null {
  const row = db
    .prepare(
      'SELECT * FROM market_snapshots WHERE pool_id = ? AND block_number < ? AND quarantined_at IS NULL ORDER BY block_number DESC LIMIT 1',
    )
    .get(poolId, blockNumber) as Row | undefined;
  return row ? mapSnapshot(row) : null;
}