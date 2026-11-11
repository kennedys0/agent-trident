export type Migration = { readonly version: string; readonly sql: string };

export const MIGRATIONS: readonly Migration[] = [
  {
    version: '001_init',
    sql: `
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  kind TEXT NOT NULL CHECK (kind IN ('NATIVE_WRAPPED','STABLECOIN')),
  created_at TEXT NOT NULL
);

CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL CHECK (chain_id = 4663),
  name TEXT NOT NULL,
  factory_address TEXT NOT NULL,
  quoter_address TEXT NOT NULL,
  router_address TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE pools (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  token0_id TEXT NOT NULL REFERENCES assets(id),
  token1_id TEXT NOT NULL REFERENCES assets(id),
  fee INTEGER NOT NULL CHECK (fee > 0),
  tick_spacing INTEGER NOT NULL CHECK (tick_spacing > 0),
  created_at TEXT NOT NULL,
  UNIQUE (venue_id, token0_id, token1_id, fee)
);

CREATE TABLE market_snapshots (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES pools(id),
  chain_id INTEGER NOT NULL CHECK (chain_id = 4663),
  block_number INTEGER NOT NULL,
  block_hash TEXT NOT NULL,
  sqrt_price_x96 TEXT NOT NULL,
  tick INTEGER NOT NULL,
  liquidity TEXT NOT NULL,
  reserve0 TEXT NOT NULL,
  reserve1 TEXT NOT NULL,
  price_scaled TEXT NOT NULL,
  price_scale INTEGER NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETE','INCOMPLETE','STALE')),
  source_time TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (pool_id, block_number)
);

CREATE TABLE strategy_configs (
  strategy_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  params_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (strategy_id, version)
);

CREATE TABLE strategy_evaluations (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES market_snapshots(id),
  strategy_id TEXT NOT NULL,
  config_version INTEGER NOT NULL,
  input_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('BUY','SELL','HOLD','WAIT','AVOID')),
  signal_strength INTEGER NOT NULL CHECK (signal_strength BETWEEN 0 AND 100),
  proposed_amount_in TEXT,
  invalidation TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (snapshot_id, strategy_id, config_version)
);

CREATE TABLE order_intents (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL UNIQUE REFERENCES strategy_evaluations(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('OBSERVE','PAPER')),
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  token_in_id TEXT NOT NULL REFERENCES assets(id),
  token_out_id TEXT NOT NULL REFERENCES assets(id),
  amount_in TEXT NOT NULL,
  min_amount_out TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES market_snapshots(id),
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','FILLED')),
  created_at TEXT NOT NULL
);

CREATE TABLE risk_decisions (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE REFERENCES order_intents(id),
  policy_version TEXT NOT NULL,
  portfolio_version TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('APPROVED','REJECTED')),
  rules_json TEXT NOT NULL,
  approved_amount_in TEXT,
  approved_amount_out TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE REFERENCES order_intents(id),
  risk_decision_id TEXT NOT NULL UNIQUE REFERENCES risk_decisions(id),
  status TEXT NOT NULL CHECK (status IN ('CREATED','FILLED','CANCELLED')),
  created_at TEXT NOT NULL
);

CREATE TABLE fills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  snapshot_id TEXT NOT NULL REFERENCES market_snapshots(id),
  amount_in TEXT NOT NULL,
  amount_out TEXT NOT NULL,
  execution_price_scaled TEXT NOT NULL,
  fee_amount TEXT NOT NULL,
  gas_units TEXT NOT NULL,
  gas_cost_wei TEXT NOT NULL,
  assumptions_version TEXT NOT NULL,
  executed_at TEXT NOT NULL
);

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  tx_group TEXT NOT NULL,
  account TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  direction TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount TEXT NOT NULL,
  business_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE positions (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id),
  quantity TEXT NOT NULL,
  cost_basis TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE portfolio_snapshots (
  id TEXT PRIMARY KEY,
  cash TEXT NOT NULL,
  equity TEXT NOT NULL,
  realized_pnl TEXT NOT NULL,
  unrealized_pnl TEXT,
  portfolio_version TEXT NOT NULL,
  as_of TEXT NOT NULL
);

CREATE TABLE automation_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE INDEX idx_market_snapshots_pool_block ON market_snapshots (pool_id, block_number DESC);
CREATE INDEX idx_audit_events_entity ON audit_events (entity, entity_id, at);
CREATE INDEX idx_ledger_entries_group ON ledger_entries (tx_group);
`,
  },
  {
    version: '002_risk_approval_units',
    // The contract separates the approved base quantity from the quote leg, so the
    // former in/out columns are renamed to say what each amount actually means.
    sql: `
ALTER TABLE risk_decisions RENAME COLUMN approved_amount_in TO approved_base_qty;
ALTER TABLE risk_decisions RENAME COLUMN approved_amount_out TO approved_quote_amount;
`,
  },
  {
    version: '003_truthful_gas_estimate',
    // Gas is a discriminated estimate, never a placeholder. Legacy rows keep
    // their quoted units but lose the unsourced 20 gwei cost.
    sql: `
ALTER TABLE fills RENAME TO fills_legacy;

CREATE TABLE fills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  snapshot_id TEXT NOT NULL REFERENCES market_snapshots(id),
  amount_in TEXT NOT NULL,
  amount_out TEXT NOT NULL,
  execution_price_scaled TEXT NOT NULL,
  fee_amount TEXT NOT NULL,
  gas_status TEXT NOT NULL CHECK (gas_status IN ('AVAILABLE','UNAVAILABLE')),
  gas_units TEXT,
  gas_price_wei TEXT,
  gas_cost_wei TEXT,
  gas_reason TEXT,
  gas_provenance TEXT NOT NULL,
  assumptions_version TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  CHECK (
    (gas_status = 'AVAILABLE' AND gas_units IS NOT NULL AND gas_price_wei IS NOT NULL AND gas_cost_wei IS NOT NULL AND gas_reason IS NULL)
    OR (gas_status = 'UNAVAILABLE' AND gas_units IS NULL AND gas_price_wei IS NULL AND gas_cost_wei IS NULL AND gas_reason IS NOT NULL)
  )
);

INSERT INTO fills (id, order_id, snapshot_id, amount_in, amount_out, execution_price_scaled, fee_amount, gas_status, gas_units, gas_price_wei, gas_cost_wei, gas_reason, gas_provenance, assumptions_version, executed_at)
SELECT id, order_id, snapshot_id, amount_in, amount_out, execution_price_scaled, fee_amount, 'UNAVAILABLE', NULL, NULL, NULL,
  'Fill predates truthful gas estimation; its 20 gwei placeholder was not sourced from chain data',
  'migration 003_truthful_gas_estimate', assumptions_version, executed_at
FROM fills_legacy;

DROP TABLE fills_legacy;
`,
  },
  {
    version: '004_chain_checkpoint_and_reorg',
    // AT-04: the worker records the last ingested block as a persistent
    // checkpoint, so a restart can prove the chain still descends from it.
    // Chain-derived rows keep a quarantine marker instead of being deleted when
    // a paper execution already references them; the next canonical block above
    // the quarantined height is ingested normally.
    sql: `
ALTER TABLE market_snapshots ADD COLUMN reorg_id TEXT;
ALTER TABLE market_snapshots ADD COLUMN quarantined_at TEXT;

ALTER TABLE strategy_evaluations ADD COLUMN reorg_id TEXT;
ALTER TABLE strategy_evaluations ADD COLUMN quarantined_at TEXT;

CREATE TABLE chain_checkpoints (
  pool_id TEXT PRIMARY KEY REFERENCES pools(id),
  chain_id INTEGER NOT NULL CHECK (chain_id = 4663),
  block_number INTEGER NOT NULL CHECK (block_number >= 0),
  block_hash TEXT NOT NULL,
  parent_hash TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE chain_reorgs (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES pools(id),
  detected_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('SAME_HEIGHT_HASH_REPLACEMENT','PARENT_MISMATCH','CHAIN_ROLLBACK','CANONICAL_BLOCK_UNAVAILABLE')),
  divergence_block INTEGER NOT NULL,
  checkpoint_block INTEGER,
  checkpoint_hash TEXT,
  canonical_block INTEGER,
  canonical_hash TEXT,
  rewound_snapshots INTEGER NOT NULL,
  rewound_evaluations INTEGER NOT NULL,
  quarantined_snapshots INTEGER NOT NULL,
  quarantined_evaluations INTEGER NOT NULL,
  affected_intents INTEGER NOT NULL,
  correlation_id TEXT NOT NULL
);

CREATE TABLE chain_reorg_impacts (
  reorg_id TEXT NOT NULL REFERENCES chain_reorgs(id),
  entity TEXT NOT NULL CHECK (entity IN ('market_snapshot','strategy_evaluation','order_intent')),
  entity_id TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('DELETED','QUARANTINED')),
  PRIMARY KEY (reorg_id, entity, entity_id)
);

CREATE INDEX idx_market_snapshots_canonical ON market_snapshots (pool_id, block_number DESC) WHERE quarantined_at IS NULL;
CREATE INDEX idx_strategy_evaluations_canonical ON strategy_evaluations (created_at DESC) WHERE quarantined_at IS NULL;
CREATE INDEX idx_chain_reorgs_pool ON chain_reorgs (pool_id, detected_at DESC);
`,
  },
];