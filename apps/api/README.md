# @trident/api — PAPER-only backend

Fastify + TypeScript + viem (public client only) vertical slice for TRIDENT.
One chain, one venue, one pool: Robinhood Chain mainnet `4663`, Uniswap v3
`WETH/USDG` at the `0.01%` fee tier. The process never signs, never holds a key,
and never calls `eth_send*`.

## Pipeline

```
RPC (chain 4663) -> verifyVenue (factory.getPool) -> block-pinned snapshot
                -> deterministic strategy -> fail-closed risk gate
                -> paper order -> fill -> double-entry ledger -> SQLite -> API
```

## Run

```bash
pnpm install
pnpm --filter @trident/api build
cp apps/api/.env.example apps/api/.env      # then export the values
node apps/api/dist/server.js
```

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
| GET | `/health` | mode, chain id, head block, RPC latency, kill switch. `503` when the chain id is wrong or the probe fails |
| GET | `/api/v1/venues` | allowlist: tokens, factory, quoter, router, factory-derived pool |
| GET | `/api/v1/markets/weth-usdg/snapshot` | latest stored snapshot, freshness recomputed at read time; `404` before the first observation |
| GET | `/api/v1/candidates?limit=` | latest strategy evaluations |
| POST | `/api/v1/intents` | `{ evaluationId, idempotencyKey }`; `201` approved and filled, `200` replayed or rejected |
| GET | `/api/v1/intents/:id` | stored intent plus its risk decision |
| GET | `/api/v1/portfolio` | simulated cash, position, realized/unrealized PnL |
| GET | `/api/v1/journal?limit=&before=` | append-only audit journal, newest first |
| POST | `/api/v1/system/halt` | `{ engaged: boolean }`; persisted, survives restart |

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
   `UNAVAILABLE` rejects. `UNAVAILABLE` is never treated as `PASS`.
7. **At most one effect per intent.** `order_intents.evaluation_id` is unique,
   `orders.intent_id` and `fills.order_id` are unique, and every ledger row has a
   unique `business_key`, so a replay is a read, not a write.
8. **Legacy block window.** The public RPC is not an archive node (~5,000 blocks
   of state), so `R14` rejects a snapshot more than `MAX_BLOCK_AGE` behind head.
9. **Append-only audit.** SQLite triggers abort `UPDATE` and `DELETE` on
   `audit_events`.
10. **Single writer.** A pid lock in `automation_state` stops a second process
    from sharing the database.
11. **Kill switch.** Persisted in `automation_state` and read by the risk gate on
    every intent; an unreadable state fails closed.

## Paper accounting model

`postBuy`/`postSell` post through a `CLEARING` account so each asset leg balances
on its own; `assertBalanced()` throws `LedgerImbalanceError` otherwise. Positions
carry `quantity` and `cost_basis` in base units; unrealized PnL is
`quoteValueOf(quantity) - costBasis` using the latest stored price.

## Tests

```bash
pnpm --filter @trident/api test           # 39 offline tests, 4 skipped
RUN_RPC_TESTS=1 pnpm --filter @trident/api test   # adds 4 real-RPC tests
```

Offline coverage: money, integer price math, deterministic strategy (hash
stability, stale/incomplete refusal), risk rules, paper execution (single fill,
replay, restart, kill switch, audit immutability, buy→sell cycle), and HTTP
routes. The real-RPC suite proves chain id, testnet rejection, factory→pool
derivation, and a block-pinned snapshot.

## Sanitized real-RPC evidence (11 Nov 2026, mainnet 4663)

- `/health` -> `chainId 4663`, `chainOk true`, head block `111443036`.
- Factory `0x1f7d…2efa` + `getPool(WETH, USDG, 100)` -> `0x52e6…71Ca`.
- Snapshot at block `111443294`, hash `0xe534…7501`, tick `-199986`,
  liquidity `2689363089049072348`, `priceScaled 2066128901262464931431`
  (≈ `2066.13` USDG/WETH at scale 18), status `COMPLETE`.
- `POST /api/v1/intents` -> `201`, verdict `APPROVED`, no failed rules, fill
  recorded; replay with the same `idempotencyKey` -> `200` `replayed: true` and
  the same `fillId`.
- `/api/v1/portfolio` -> cash `9499950000` (9,499.95 USDG after a 500 USDG buy
  plus the 0.01% fee), position `241973264603445919` wei WETH,
  unrealized PnL `-102267` base units (≈ `-0.10` USDG, fee + price impact).

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
- **Contract package.** Domain types live in `src/domain/types.ts` until issue
  #6 (`packages/contracts`) lands; the swap-over is a mechanical import change.

## Known blockers

- Issue #6 contracts are not on `origin` yet, so the pin-and-rebase adaptation is
  still open.
- No auth/CSRF: do not expose beyond loopback.
- No container/runtime manifest for this API yet.
- The snapshot worker polls every 10 s (`SNAPSHOT_INTERVAL_MS`); the public RPC
  has no `eth_subscribe`.