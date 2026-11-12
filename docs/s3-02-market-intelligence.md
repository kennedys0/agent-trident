# S3-02 — Market Intelligence (issue #22)

Read-only Discover endpoints for pools discovered by S3-01. PAPER-only, no new
trade path, additive schema only. Nothing here is an oracle.

## Endpoints (envelope `{ data, meta }` as usual)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/pools?search=&limit=&offset=` | List; `limit` 1..50 (default 20), `offset` ≥ 0. Substring search (case-insensitive) over pool/token addresses and token symbols. Malformed query → 400. |
| GET | `/api/v1/pools/{address}` | Pool detail; refreshes from the pinned head via chain. 404 only for well-formed but untracked addresses. Refresh failure → `UNAVAILABLE` data + `meta.refreshError`. |
| GET | `/api/v1/watchlist` | Server-persisted list (`watchlist_entries`). |
| POST | `/api/v1/watchlist` | Body `{ address }`; `201` ADDED / `200` EXISTING (idempotent). Unknown asset → 404. Malformed → 400. |
| DELETE | `/api/v1/watchlist/{address}` | `200` with `result: REMOVED|ABSENT`; idempotent. Malformed → 400. |

## Data model and quality semantics

- `PoolSummary.metrics.price|liquidity|volume24h` are **per-metric** states:
  `AVAILABLE` | `STALE` (last persisted value + reason) | `UNAVAILABLE` (mandatory
  `reason`, never `0`, never estimated).
- **Volume is always `UNAVAILABLE` in this slice.** No verifiable, block-pinned
  per-pool volume source exists on the public RPC; it is reported as missing,
  not zero.
- `confidence` is always `LOW` with `confidenceReason`
  `single Uniswap v3 pool; a spot price is not an independent oracle`. A shallow
  single pool price is never presented as an independent oracle.
- Price is exposed both directions as integer strings scaled by 1e18:
  `token1PerToken0`, `token0PerToken1`. `priceImpactBps` direction follows the
  pool's position ordering (`token0`/`token1` from the pool, never assumed).
- Decimal scaling and token ordering are unit-tested; both orientations
  round-trip within integer floor-division loss.
- Freshness: `sourceTime` = block timestamp, `observedAt` = ingest clock, age
  computed at read; `age > MARKET_FRESHNESS_SECONDS` (default 30) ⇒ `STALE`.
  Boundary test pins `age == freshness` vs `freshness + 1`.
- Liquidity: raw Uniswap `L` (unitless) plus `reserve0`/`reserve1` in base units
  with explicit decimals, from `slot0` + `balanceOf` at the pinned block.
  Provenance string names block and source on every metric.

## Registry contract with S3-01

S3-02 does **not** create `discovered_pools`; it consumes it read-only, by
introspection of `sqlite_master`, and fails closed:

- table absent ⇒ zero discovered pools; only the verified WETH/USDG allowlist
  pool is reported (real, boot-verified).
- table present with unexpected/missing columns ⇒ `registryStatus: UNAVAILABLE`
  in `meta`, the verified pool is still reported, no fabricated data.
- invalid rows (bad address, decimals > 255, empty symbol, fee ≤ 0, token0 ==
  token1) are skipped and counted in `meta.registrySkipped`.

Expected columns (owned by S3-01):

```sql
discovered_pools(
  pool_address TEXT PRIMARY KEY,
  factory      TEXT NOT NULL,
  token0       TEXT NOT NULL,
  token1       TEXT NOT NULL,
  token0_symbol TEXT NOT NULL,
  token1_symbol TEXT NOT NULL,
  token0_decimals INTEGER NOT NULL,
  token1_decimals INTEGER NOT NULL,
  fee          INTEGER NOT NULL,
  first_seen_block INTEGER NOT NULL
)
```

## Persistence

Additive migration `005_market_intelligence` (no existing table altered or
dropped): `watchlist_entries` and `pool_market_snapshots` (idempotent, one row
per `(pool, block_number)`). Snapshots are written by the detail endpoint and
make list views available without any RPC call.

## Read-only proof for discovered assets

- `createIntentFromEvaluation` accepts an optional `allowlistPoolId`; the
  intents route passes the boot-verified pool, so an evaluation on a discovered
  pool is rejected with `INTENT_NOT_ACTIONABLE` (422) before any effect.
  Regression test: seeded discovered pool + BUY evaluation ⇒ 422.
- Discovered assets have no path into orders, fills, ledger, positions, or
  halts. Watchlist is the only mutation exposed for them.
- Live-network evidence below proves the detail endpoint reads real chain data.

## Evidence (live, read-only, 2026-11-12)

- `eth_chainId` = `4663`; factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`;
  fee tiers 100/500/3000/10000 derived from `getPool` + `pool.fee()` + `tickSpacing()`
  (recorded in README).
- `GET /api/v1/pools/<verified pool>` returns `AVAILABLE` metrics at a real block
  (see PR body for the captured run); volume is `UNAVAILABLE`.

## Limitations (stated, not hidden)

- No volume anywhere; no independent oracle; single deepest pool only for the
  PAPER venue. Discovered pools from S3-01 appear only after S3-01 merges and a
  registry exists — until then they cannot be shown honestly.
- No per-metric confidence other than uniform `LOW` (deliberate; no invented
  threshold scores).
- No chart series; list view uses persisted snapshots only.
- Watchlist stores addresses only; it confers no trade eligibility.
