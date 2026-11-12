# @trident/api — PAPER-only backend

Fastify + TypeScript + viem (public client only) vertical slice for TRIDENT.
One chain, one venue, one pool: Robinhood Chain mainnet `4663`, Uniswap v3
`WETH/USDG` at the `0.01%` fee tier. The process never signs, never holds a key,
and never calls `eth_send*`.

## Pipeline

The venue is `WETH/USDG` at Uniswap v3 **fee tier 100** — 100/1,000,000 = 0.01%,
tick spacing 1. "0.01%" is the correct term; "100 bps" would mean 1% and is wrong.
On-chain verification (2026-11-12, mainnet 4663):
`factory.getPool(WETH, USDG, 100)` = `0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca`,
`pool.fee()` = `100`, `tickSpacing()` = `1`; the other active tiers are
500 (0x69bf…8d9a, spacing 10), 3000 (0xa918…fB03, spacing 60) and
10000 (0x5f00…680D, spacing 200). The 0.01% pool is allowlisted because it is the
deepest; it is the only pool the service will touch.

```
RPC (chain 4663) -> verifyVenue (factory.getPool) -> block-pinned snapshot
                -> deterministic strategy -> fail-closed risk gate
                -> paper order -> fill -> double-entry ledger -> SQLite -> API
```

## Run

```bash
pnpm install --frozen-lockfile
pnpm --filter @trident/api build
cp .env.example .env                        # RPC_URL is required
node --env-file=.env apps/api/dist/server.js
```

Run the last command from the repository root: `DATABASE_PATH` and the SQLite
`data/` directory resolve against the working directory. The full walkthrough,
including the web console, is in the [root README](../../README.md).

Boot fails closed when the RPC chain id is not `4663`, when the execution mode is
not `OBSERVE`/`PAPER`, when the RPC URL is not HTTPS, or when the factory no
longer returns the allowlisted pool.

## Configuration

See `.env.example`. Nothing is read from a hardcoded secret; there are no secrets
in this slice at all.

| Variable | Default | Meaning |
|---|---|---|
| `EXECUTION_MODE` | `PAPER` | `OBSERVE` or `PAPER`; anything else aborts boot |
| `RPC_URL` | — | HTTPS JSON-RPC endpoint (server-side only) |
| `EXPECTED_CHAIN_ID` | `4663` | Must equal `4663`; a different value aborts boot |
| `DATABASE_PATH` | `./data/trident.sqlite` | SQLite file (WAL) |
| `PORT` / `HOST` | `8080` / `127.0.0.1` | Bind address; loopback by default |
| `MARKET_FRESHNESS_SECONDS` | `30` | Snapshot older than this is `STALE` |
| `OPENING_CASH_USDG_BASE` | `10000000000` | Simulated opening cash, 6-decimal base units |

## Endpoints

Envelope: `{ "data": ..., "meta": { "requestId", "observedAt" } }` on success and
`{ "error": { "code", "message", "details", "requestId" } }` on failure.

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | mode, chain id, head block, RPC latency, kill switch. `meta.haltReason` carries `CHAIN_REORG` / `CHAIN_EVIDENCE_UNAVAILABLE` / `OPERATOR` when entries are halted, `null` otherwise. `503` when the chain id is wrong or the probe fails |
| GET | `/api/v1/venues` | allowlist: tokens, factory, quoter, router, factory-derived pool (`data` is an array) |
| GET | `/api/v1/markets/weth-usdg/snapshot` | latest stored snapshot, freshness recomputed at read time; `404` before the first observation |
| GET | `/api/v1/candidates?limit=` | latest strategy evaluations (`data` is an array) |
| POST | `/api/v1/intents` | request `{ evaluationId, idempotencyKey }` only; server derives side, size, and limit. Returns `IntentExecution` (`intent`, `riskDecision`, `order`, `fill`), with `order`/`fill` explicitly `null` on `REJECTED`. `201` fresh approval, `200` replay or rejection; meta is `{ requestId, observedAt, replayed }` |
| GET | `/api/v1/intents/:id` | stored intent plus its risk decision |
| GET | `/api/v1/portfolio` | simulated cash, positions (`VALUED`/`UNPRICED`), realized/unrealized PnL |
| GET | `/api/v1/journal?limit=&before=` | append-only audit journal, newest first |
| POST | `/api/v1/system/halt` | `{ engaged: boolean }`; persisted, survives restart |

Every `data` payload is the type owned by `@trident/api-contract` and is produced
through the mappers in `src/api/contract.ts`, which call the contract's zod
schema. A contract change therefore fails the API build or its tests instead of
drifting quietly. Facts the contract does not model (kill switch, RPC latency,
`sqrtPriceX96`, pool liquidity, and the halt reason `haltReason`) travel in
`meta`; order, fill, and risk-decision ids live in `data`, so the intent route
meta stays strict.

Error codes: `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`,
`INTENT_NOT_ACTIONABLE`, `INTENT_EXPIRED`, `CHAIN_UNAVAILABLE`,
`KILL_SWITCH_ENGAGED`, `INTERNAL_ERROR`. `500` is always generic.

## Invariants enforced in code

1. **Chain identity.** `assertChain()` rejects any RPC that is not `4663`; the
   testnet `46630` is rejected by the same check.
2. **Pool provenance.** The pool address is not typed in by hand as a source of
   truth: `verifyVenue()` calls `factory.getPool(WETH, USDG, 100)` and compares
   the result with the allowlist, then re-reads `token0`, `token1`, `symbol`, and
   `decimals` on chain. A mismatch aborts boot.
3. **Block pinning.** The snapshot, the reserve reads, and the QuoterV2 call all
   use the same `blockNumber`. The risk gate rejects a quote whose block differs
   from the snapshot block (`R07`).
4. **Freshness.** Status is recomputed at read time (`effectiveStatus`), so a
   stored `COMPLETE` row becomes `STALE` on its own; the strategy returns `AVOID`
   and the risk gate returns `REJECTED`.
5. **Integer money.** Amounts are non-negative integer base-unit strings. Price
   math is integer-only with `PRICE_SCALE = 18`; the base/quote divisor is
   `10^(baseDecimals - quoteDecimals + scale)` (`1e30` for `WETH18/USDG6`).
   No `Number` touches a settlement value.
6. **Fail-closed risk.** `paper-risk-v1` rules `R01`–`R15`; any `FAIL` or
   `UNAVAILABLE` rejects. `UNAVAILABLE` is never treated as `PASS`. The whole
   `evaluateRisk` call runs inside the write transaction, immediately before the
   order and fill: the kill switch, cash, position, equity, clock, and snapshot
   age are re-read there, so a halt or a fill that happened while the quote was
   in flight cannot be missed. A stale quote can therefore only reject, never
   overspend; the stored risk decision records the `portfolioVersion` it used.
7. **At most one effect per intent.** `order_intents.evaluation_id` is unique,
   `orders.intent_id` and `fills.order_id` are unique, and every ledger row has a
   unique `business_key`, so a replay is a read, not a write.
   `evaluation_id` is the business key: a request that names an evaluation which
   already produced an intent replays that stored execution (`200`,
   `replayed: true`) even when it carries a new `idempotencyKey`. The insert uses
   `ON CONFLICT DO NOTHING` and reads back by `evaluation_id` first, then by
   `idempotency_key`; a key bound to a different evaluation is `409 CONFLICT`,
   never an arbitrary row. `executeIntent` re-reads the status inside the write
   transaction, so only the winner writes risk/order/fill/ledger/audit rows.
8. **Legacy block window.** The public RPC is not an archive node (~5,000 blocks
   of state), so `R14` rejects a snapshot more than `MAX_BLOCK_AGE` behind head.
9. **Append-only audit.** SQLite triggers abort `UPDATE` and `DELETE` on
   `audit_events`.
10. **Single writer.** A pid lock in `automation_state` stops a second process
    from sharing the database.
11. **Kill switch.** Persisted in `automation_state` as `new_entries_halted`, with
    the cause in `new_entries_halted_reason` (`CHAIN_REORG`,
    `CHAIN_EVIDENCE_UNAVAILABLE`, or `OPERATOR`). The risk gate reads it on every
    intent; an unreadable state fails closed.

## Chain checkpoint, reorg recovery, and atomic audit (AT-04 / AT-16)

**Checkpoint.** `chain_checkpoints` stores one row per pool:
`{chain_id, pool_id, block_number, block_hash, parent_hash, updated_at}`. Each
ingest writes the checkpoint in the same transaction as the snapshot and its
audit event. Before any ingest, `verifyCheckpoint` proves the stored checkpoint is
still canonical:

- head below the checkpoint -> a rollback only after the provider re-reads that
  height and confirms the reported head hash; every stored row above the
  confirmed head is then orphaned (`divergenceBlock = head + 1`). An
  unconfirmed/lagging head is `UNAVAILABLE`, not divergence;
- head at the checkpoint height -> hashes must match;
- head one block above -> `head.parentHash` must equal the checkpoint hash;
- head further above (a gap or a restart after downtime) -> the checkpoint
  height must still resolve to the stored hash, which proves every block above
  it descends from the stored data;
- a provider that cannot resolve the checkpoint height -> `UNAVAILABLE`
  (`CANONICAL_BLOCK_UNAVAILABLE`).

Each non-canonical result carries `evidence`. `PROVEN` names the canonical block
that contradicted the checkpoint and may rewind. `UNAVAILABLE` means the provider
could not answer, so no divergence is proven: `holdNewEntries` freezes every
snapshot, evaluation, and the checkpoint as-is, engages the kill switch with
reason `CHAIN_EVIDENCE_UNAVAILABLE`, and writes one `system.halt.engaged` audit
row on transition. Nothing is deleted, quarantined, cleared, or re-anchored;
later ticks retry until a verified canonical read arrives.

**Reorg recovery.** On proven divergence, `recoverFromReorg` runs in one
transaction: it rewinds every chain-derived snapshot/evaluation at or above the
divergence block — so a rollback to head `105` rewinds stored rows `110` and
`120` before anything is re-anchored. A row no paper execution references is
deleted. A row a fill or intent already references is kept for provenance,
marked `quarantined_at`/`reorg_id`, and every affected intent gets a
`paper.execution.reorg_review_required` audit event. It records `chain_reorgs`
plus `chain_reorg_impacts`, re-anchors the checkpoint at the highest surviving
canonical block, engages the kill switch with reason `CHAIN_REORG`, and writes
`chain.reorg.detected`. A quarantined block height is never re-ingested — its
unique `(pool_id, block_number)` row keeps the orphan hash — so ingestion resumes
at the next canonical block above it, and `POST /api/v1/intents` rejects a
quarantined evaluation with `409 CONFLICT`. Both halt paths write their audit row
only when the switch or the reason actually changes, so repeated ticks stay
idempotent.

**Atomic audit.** Every state write commits with its audit event in one
transaction: snapshot + checkpoint + audit, evaluation + audit, intent + audit,
`EXPIRED` + audit, risk decision + audit, fill/ledger/position + audit, and the
kill switch + audit. `withTransaction` joins an already-open transaction, so a
service composed inside a larger unit of work does not split the writes. A
test-only `FaultHooks.afterEntityWrite` seam throws between the entity write and
the audit write to prove a crash leaves neither row.

## Paper accounting model

`postBuy`/`postSell` post through a `CLEARING` account so each asset leg balances
on its own; `assertBalanced()` throws `LedgerImbalanceError` otherwise. Positions
carry `quantity` and `cost_basis` in base units; unrealized PnL is
`quoteValueOf(quantity) - costBasis` using the latest stored price.

## Tests

```bash
pnpm --filter @trident/api test           # 87 offline tests, 4 skipped
RUN_RPC_TESTS=1 pnpm --filter @trident/api test   # adds 4 real-RPC tests
```

The API tests parse the real responses with the contract schemas, so a payload
that stops matching `@trident/api-contract` fails the suite.

Offline coverage: money, integer price math, deterministic strategy (hash
stability, stale/incomplete refusal), risk rules, paper execution (single fill,
replay, restart, kill switch, audit immutability, buy→sell cycle), the
`IntentExecution` envelope (executed and rejected), gas `AVAILABLE`/`UNAVAILABLE`
mapping, and HTTP routes. Duplicate-evaluation coverage includes a repeated key,
a new key on the same evaluation, three concurrent submissions, a rejected
evaluation replayed after the kill switch is released, and a replay after a
restart that asserts every table keeps its pre-replay row counts. The real-RPC
suite proves chain id, testnet rejection, factory→pool derivation, and a
block-pinned snapshot.

AT-04 coverage (`test/reorg.test.ts`): first-ingest checkpoint with hash and
parent hash, restart continuation by parent, gap acceptance, same-height hash
replacement, parent mismatch, hold-with-retention when the provider cannot
resolve the checkpoint block or a lower head, proven rollback to head `105` that
removes stored rows `110`/`120` and re-anchors at `100`, the same rollback with
referenced rows quarantined instead of deleted, a restart/failover after the
rollback that resumes without duplicate heights or an orphan latest, a resume
from a held checkpoint once the block is readable again, quarantine of a
referenced snapshot (kept for its fill, `reorg_review_required` audit, `409` on
new intents), quarantined height never re-ingested, and full rollback of the
rewind when the reorg transaction fails.

Stale-risk and read-back coverage (`test/risk-race.test.ts`): a kill switch
pressed during the quote is seen inside the write transaction and rejects with no
order, fill, ledger, or position; two intents sized against the same cash leave
the second rejected by `R11` on the fresh balance (`3999400000`) with cash still
non-negative and one fill; the stored decision carries the portfolio version it
decided on; a key bound to another evaluation returns `409`; and a replay with a
new key returns the stored intent without a second row.

AT-16 coverage (`test/atomic.test.ts`): fault injection between entity and audit
for snapshot, evaluation, intent, expiry, risk decision, fill/ledger/position,
and halt; each proves the entity and the audit are both absent. A full paper
cycle proves one audit event per persisted entity and a replay adds none.

## Sanitized real-RPC evidence (11 Nov 2026, mainnet 4663)

- `/health` -> `chainId 4663`, `chainOk true`, head block `111728517`.
- Factory `0x1f7d…2efa` + `getPool(WETH, USDG, 100)` -> `0x52e6…71Ca`.
- Snapshot at block `111728517`, status `COMPLETE`, price
  `2048679247722938193489` at scale 18 (≈ `2048.68` USDG/WETH).
- `POST /api/v1/intents` with the kill switch engaged -> `200`, verdict
  `REJECTED`, `order: null`, `fill: null`, intent status `REJECTED`
  (`R02_kill_switch`).
- `POST /api/v1/intents` after release -> `201`, verdict `APPROVED`, 15/15 rules
  `PASS`, order `FILLED`. Fill: `baseQty 243511960236305145` wei WETH,
  `quoteQty 500000000` (500 USDG), `feeQuote 50000` (0.01%).
- Gas from the quote block `111728418`: `AVAILABLE`, `91542` units,
  `20026000` wei base fee, `gasCostWei 1833220092000`. The base fee was
  re-fetched independently with `eth_getBlockByNumber` and matched. No
  `gasQuoteCost` is sent because no ETH→USDG conversion is sourced.
- Replay with the same `idempotencyKey` -> `200`, `replayed: true`, same order
  id and fill timestamp.

### Duplicate-evaluation replay (11 Nov 2026, port 8092, fresh DB)

The UI sends a new `idempotencyKey` on every submit, so the replay proof below
uses new keys against one already-executed evaluation.

- Three concurrent `POST /api/v1/intents` on the same evaluation with distinct
  keys -> `200, 200, 201`; all three returned intent `528caf94…`, order
  `8bcee306…`, and fill `18:22:49.019Z`. Delta row counts for that burst:
  intents +1, orders +1, fills +1, risk decisions +1, ledger +6, audit +3,
  positions +1 — one execution, not three.
- A further request with a fourth new key -> `200`, `replayed: true`, zero row
  deltas in every table.
- Repeating the winning key -> `200`, `replayed: true`, zero row deltas.
- Kill switch engaged -> fresh `200 REJECTED` with `order: null`, `fill: null`
  (intents +1, risk +1, audit +2). Released, then a new key on the same
  evaluation -> `200`, `replayed: true`, still `REJECTED`, zero row deltas.
  A stored rejection is never re-evaluated.
- Server restart on the same database, then a new key on the filled evaluation
  -> `200`, `replayed: true`, same fill timestamp, zero row deltas.
- SQL check: no `evaluation_id` holds more than one intent; no request in
  either run returned `500`.
- `/api/v1/portfolio` -> equity `9999850251` (≈ 9,999.85 USDG after the buy, fee,
  and price impact), position `VALUED`.

### Chain checkpoint live evidence (11 Nov 2026, port 8093, fresh DB)

- First worker tick persisted `chain_checkpoints` with chain id `4663`, pool
  `0x52e6…71Ca`, block `111929143`, hash `0xb706…49f5`, and that block's parent
  hash `0xed4f…bffb`, together with its snapshot and audit event.
- The process was stopped and started again on the same database. The new tick
  verified the stored parent before ingesting, then advanced to block `111929661`;
  the second snapshot was written and audited, and no block height holds two
  hashes (`COUNT(*) GROUP BY block_number HAVING COUNT(DISTINCT block_hash) > 1`
  is empty).
- `chain_reorgs` is empty and the checkpoint count stays `1`, which is the
  expected result on a healthy chain.

- **Contract type names are not re-declared here.** `src/domain/types.ts` keeps
  only engine-internal types (`PoolSnapshot`, `EvaluationRecord`, `RiskOutcome`,
  `PortfolioState`, pool/venue identity). The wire types (`MarketSnapshot`,
  `Evaluation`, `RiskDecision`, `Portfolio`, `AuditEvent`) come from
  `@trident/api-contract`; the earlier local copies of those names were deleted.

### Contract conformance with PR #7 (`0fb7be6`)

The backend is based on the amended contract, and all seven integration findings
from both rounds are closed on the contract side and used here:

1. **Semantic versions.** `configVersion`, `policyVersion`, `portfolioVersion`,
   and `assumptionsVersion` are validated by `versionSchema` (nonempty, no
   spaces). The strategy publishes `1.0.0`, the gate `paper-risk-v1`, the ledger
   `ledger:<entry-count>`, and the fill model `paper-v1`; no numeric coercion is
   left in the mappers.
2. **Per-rule risk evidence.** `RiskDecision.rules` carries `R01`–`R15` with
   `observed`, `threshold`, and `status`, plus a mandatory `reason` on every
   `FAIL`/`UNAVAILABLE` rule. Approval is only expressible when every rule is
   `PASS`.
3. **Create intent takes references, not sizing.** `POST /api/v1/intents`
   accepts only `{ evaluationId, idempotencyKey }`; side, size, and limit come
   from the evaluation and its snapshot.
4. **Explicit approval units.** `approvedBaseQty` is WETH base units and
   `maximumQuoteCost` is USDG base units. A BUY approves the quote spend
   *including* the 0.01% fee; a SELL approves the base quantity sold and the net
   quote proceeds the gate priced. `R11` compares cash against amount + fee, so
   an approval can never overdraw the simulated balance.
5. **`VALUED` / `UNPRICED` positions.** A position with a stored snapshot is
   `VALUED` with `valuationSnapshotId` and unrealized PnL; without one it is
   `UNPRICED` with a `reason`. `meta.unpricedPosition` is gone.
6. **Full `IntentExecution` response.** The route assembles `{ intent,
   riskDecision, order, fill }` and parses the whole object with
   `intentExecutionSchema`, so the cross-field invariants (order.intentId,
   fill.orderId, fill.snapshotId, verdict/status pairing) are enforced before
   the response leaves the process. A rejection carries explicit `null`
   `order`/`fill`; the old `meta.orderId`/`meta.fillId`/`meta.fee` workaround is
   deleted and meta is strict `{ requestId, observedAt, replayed }`.
7. **Truthful gas estimate.** `PaperFill.gasEstimate` is a discriminated union.
   `AVAILABLE` needs both the QuoterV2 `gasEstimate` and that same pinned block's
   `baseFeePerGas`; the stored `gasCostWei` is exactly `gasUnits *
   gasPriceWei`, and provenance names the block and states that no priority fee
   is included. Any missing half yields `UNAVAILABLE` with a reason and where it
   was checked. The hardcoded 20 gwei is gone; `gasQuoteCost` stays absent until
   an ETH→USDG conversion is sourced.

Remaining follow-ups, recorded for the contract owner rather than worked around:

- **`GET /api/v1/intents/:id` still has no contract path.** It keeps returning
  `{ intent, riskDecision }` (used for inspection), and `MIGRATION.md` says not
  to reuse `IntentExecution` for it as-is.
- **`gasQuoteCost` is not emitted.** Converting wei to USDG needs a sourced
  ETH→USDG price, which this slice does not have.

## Deviations from `ARCHITECTURE.md` (for review)

- **Outbox omitted.** `outbox` is not in `001_init`. In this slice every
  transaction is committed synchronously by a single writer inside one process,
  so an outbox would be dead code. It belongs with the indexer/worker fan-out in
  a later issue.
- **`node:sqlite` instead of a native driver.** Node 24 ships `DatabaseSync`; it
  avoids a native build step and keeps WAL + prepared statements.
- **`x-requested-with` / CSRF and session auth are not implemented.** The service
  binds `127.0.0.1` and is not exposed; adding auth before any non-loopback
  exposure is tracked as a release blocker, not silently skipped.
- **`GET /health` is at the root**, as specified in `ARCHITECTURE.md`; the rest
  of the surface is under `/api/v1`.
- **Merged stack.** This slice was built on the contract branch and has since
  merged to `main` (PRs #7, #8). `apps/api` still builds the contract package
  before typecheck/test to keep a clean checkout working.
- **Contract conformance.** Health, venues, snapshot, candidates, intents,
  portfolio, and journal payloads are all produced through schema-validated
  mappers; the API tests parse each response with the contract schema.

## Schema debt (kept, not dropped)

- **`portfolio_snapshots`** was created in `001_init` and is never read or
  written. It was reserved for a portfolio-projection table that does not exist
  yet. It stays because dropping it would be a destructive migration for zero
  benefit; nothing should be built on it until a reader exists, and the next
  migration may drop it once that is true.
- **`strategy_configs`** is written once at boot (`seedStrategyConfig`) and never
  read back; `DEFAULT_STRATEGY_CONFIG` is the only source the strategy uses. Same
  disposition: kept for audit value and migration compatibility, not removed.

## HOLD logging

The snapshot worker polls every 10 s. A `CHAIN_EVIDENCE_UNAVAILABLE` or
reorg-HOLD condition persists until an operator releases the halt, so identical
lines are now logged once at the change and then at most every
`HOLD_REPEAT_LOG_MS` (30 minutes), with a `suppressedSinceLast` counter; the
counter and the first line after every recovery keep the signal. Without this,
a held system emits ~8,640 identical error lines per day.

## Known blockers

- No auth/CSRF: do not expose beyond loopback.
- No container/runtime manifest for this API yet.
- The snapshot worker polls every 10 s (`SNAPSHOT_INTERVAL_MS`); the public RPC
  has no `eth_subscribe`.