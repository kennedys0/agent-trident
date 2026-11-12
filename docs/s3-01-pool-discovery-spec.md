# S3-01 — Verified on-chain pool discovery (spec for Nexus)

Status: implementation spec, no code here. Owner of the implementation: Nexus.
Reviewer after PR opens: Nova (architecture), Probe (QA), Sentinel (security).

Scope: discover Uniswap v3 `PoolCreated` events from the verified factory on
Robinhood Chain `4663`, validate them, persist them idempotently, and expose them
through the S3-02 Discover API. The WETH/USDG PAPER slice and the execution path
must not change. Discovered pools are observation-only, never actionable.

## Non-negotiable constraints

- PAPER only. No signer, private key, wallet client, `eth_send*`, `writeContract`,
  `LIVE`. Read-only RPC via the existing guarded fetch/allowlist (`rpc-guard.ts`,
  `client.ts`). Do **not** modify `rpc-guard.ts`, `chain/client.ts`, `config.ts`,
  or `audit-gate`; if you think one must change, stop and ask in the channel.
- Additive migration only. No `ALTER`/`DROP` of existing tables. SQL parameterized.
- Zod strict at input and output. Registry rows are untrusted input even though
  they are locally stored.
- Non-archive RPC (~5,000 blocks of state). `eth_getLogs` cap: 10,000 logs. No
  `eth_subscribe`; polling only.

## Tables (migration `006_pool_discovery`, additive)

```sql
CREATE TABLE discovered_pools (
  pool_address     TEXT PRIMARY KEY CHECK (length(pool_address) = 42 AND lower(substr(pool_address, 1, 2)) = '0x'),
  factory          TEXT NOT NULL CHECK (lower(factory) = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa'),
  token0           TEXT NOT NULL CHECK (length(token0) = 42 AND lower(substr(token0, 1, 2)) = '0x'),
  token1           TEXT NOT NULL CHECK (length(token1) = 42 AND lower(substr(token1, 1, 2)) = '0x'),
  token0_symbol    TEXT NOT NULL CHECK (length(token0_symbol) BETWEEN 1 AND 64 AND token0_symbol = trim(token0_symbol) AND instr(token0_symbol, x'00') = 0),
  token1_symbol    TEXT NOT NULL CHECK (length(token1_symbol) BETWEEN 1 AND 64 AND token1_symbol = trim(token1_symbol) AND instr(token1_symbol, x'00') = 0),
  token0_decimals  INTEGER NOT NULL CHECK (token0_decimals BETWEEN 0 AND 255),
  token1_decimals  INTEGER NOT NULL CHECK (token1_decimals BETWEEN 0 AND 255),
  fee              INTEGER NOT NULL CHECK (fee IN (100, 500, 3000, 10000)),
  tick_spacing     INTEGER NOT NULL CHECK (tick_spacing > 0),
  first_seen_block INTEGER NOT NULL CHECK (first_seen_block >= 0),
  first_seen_tx    TEXT NOT NULL CHECK (length(first_seen_tx) = 66 AND lower(substr(first_seen_tx, 1, 2)) = '0x'),
  log_index        INTEGER NOT NULL CHECK (log_index >= 0),
  discovered_at    TEXT NOT NULL,
  CHECK (lower(token0) < lower(token1)),              -- Uniswap orders by address
  UNIQUE (factory, token0, token1, fee),              -- one row per pool identity
  UNIQUE (first_seen_tx, log_index)                   -- one row per event
);

CREATE TABLE discovery_checkpoints (
  id          INTEGER PRIMARY KEY CHECK (id = 1),      -- singleton
  chain_id    INTEGER NOT NULL CHECK (chain_id = 4663),
  from_block  INTEGER NOT NULL CHECK (from_block >= 0),
  to_block    INTEGER NOT NULL CHECK (to_block >= from_block),
  block_hash  TEXT,                                    -- canonical hash at to_block, when known
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_discovered_pools_seen ON discovered_pools (first_seen_block DESC);
```

### Resume semantics

- Checkpoint stores `from_block..to_block` inclusive, plus the hash of `to_block`
  when known. On restart: re-read the stored `block_hash` at `to_block`; if the
  provider cannot resolve that block or the hash moved → fail closed for
  discovery only (registry `UNAVAILABLE`), do not rewind execution state.
- First run, no checkpoint: set `from_block = max(0, head - DISCOVERY_LOOKBACK_BLOCKS)`
  (default 2,000, env-tunable, hard cap 4,000 — never older than ~5,000).
- A gap older than the RPC window is reported as `UNAVAILABLE` (a marker recorded
  in logs/audit), never silently skipped and never fabricated.

### Idempotency

- `INSERT ... ON CONFLICT(pool_address) DO NOTHING` + report whether the row was
  inserted. One pool = one row; re-discovery is a read.
- `UNIQUE (first_seen_tx, log_index)` catches event-level duplicates even if
  pool identity races.
- Bootstrap order: scan `[from_block, head]` once, then poll head.

## Polling and `getLogs` bounds

- Poll interval default 30s; single in-flight request; backoff `250ms → 8s` +
  jitter on 429/5xx/timeout (same pattern as Sprint 2), max 3 retries per call.
- `eth_getLogs` chunk size default 200 blocks; hard cap 500. On the 10,000-log
  cap error (`-32000 ... exceeds limit of 10000`), halve the chunk (200 → 100 →
  25); if still capped at 25 blocks, mark the range `UNAVAILABLE`, log + audit,
  skip it, continue from `to_block + 1`. Never loop unbounded; never scan the
  same block twice after a crash.
- `topic0` = `0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118`
  for `PoolCreated(address,address,uint24,int24,address)`.
- Verify the factory before any `getLogs`: `getCodeSize(factory) > 0` and compare
  `keccak256(factoryCode)` against the constant recorded at implementation time
  (probe measured `0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739`;
  re-derive and pin during implementation). Mismatch ⇒ discovery disabled for
  this boot (registry `UNAVAILABLE`), process keeps running, PAPER slice unaffected.

## Reorg semantics (discovery-only; no trading state at stake)

Rule: **no rewind without proven divergence.**

- **UNAVAILABLE evidence** (provider cannot answer for the checkpoint block, or
  head is behind without re-read confirmation) ⇒ **freeze**: keep all rows, set
  registry `UNAVAILABLE`, stop ingesting, log + audit `discovery.frozen`.
  Do not delete, do not quarantine, do not re-anchor.
- **PROVEN divergence** before any rewind:
  - same-height hash replacement at a stored checkpoint block (re-read block and
    it differs from stored hash), or
  - child block parent hash does not match stored checkpoint, or
  - head < checkpoint with the head re-read and confirmed.
- **Rewind on proven divergence:** delete discovery rows with
  `first_seen_block >= divergenceBlock` (they will be re-discovered on rescan),
  audit `discovery.reorg.rewound` with the deleted pool addresses. PAPER
  execution rows are untouched — discovery holds no trading state. Re-anchor
  checkpoint at the highest surviving canonical block.

## Fail-closed rules, per layer

| Layer | Failure | Behavior |
|---|---|---|
| Factory | bytecode unknown/mismatch/unreachable | registry `UNAVAILABLE`; discovery disabled; PAPER slice unaffected |
| Registry columns | unexpected/missing columns (S3-02 adapter) | `UNAVAILABLE` + verified allowlist only (already enforced by S3-02) |
| Event | malformed payload, bad addresses, `token0 >= token1`, fee not in allowlist, `tickSpacing <= 0` | skip event + audit `discovery.event.rejected` with reason + count |
| ERC-20 metadata | `symbol`/`decimals` read reverts, empty, >64 chars, decimals outside 0..255 | skip row + count `registrySkipped`; never store |
| Pool readiness | zero reserves/liquidity at discovery time | row kept; S3-02 reports metrics `UNAVAILABLE` (not a discovery error) |
| Registry list | registry table unreadable | `UNAVAILABLE` for the discovered list; verified pool still served |
| RPC | timeout/429/5xx/malformed | backoff + bounded retries; repeated failure ⇒ skip range, registry stays `AVAILABLE` from stored rows |
| Pagination/cursor | offset beyond tracked rows | return what exists; never synthesize rows |

## Required tests

Unit (deterministic fixtures, no network; label fixtures immutable/versioned):

1. Decode `PoolCreated` from a captured real log; assert token order, fee, tick spacing, pool address passthrough.
2. `token0 >= token1` ⇒ rejected.
3. Fee not in `{100, 500, 3000, 10000}` ⇒ rejected.
4. `tick_spacing <= 0` ⇒ rejected.
5. `symbol()` reverts / empty / 65 chars / decimals 256 / non-integer ⇒ row skipped, counted.
6. Dedup: same event replayed ⇒ `changes = 0`, one row.
7. Two pools same tokens different fee ⇒ both kept; same tokens same fee ⇒ one.
8. Checkpoint: init from `head - LOOKBACK`; restart resumes without re-scan or overlap; gap > 5,000 ⇒ `UNAVAILABLE` marker.
9. `getLogs` cap error ⇒ chunk halving; still capped ⇒ range `UNAVAILABLE`, no infinite loop.
10. Reorg: same-height replacement ⇒ rewind of rows ≥ divergence; unproven head-behind ⇒ freeze (zero rows deleted).
11. Malformed registry columns ⇒ `UNAVAILABLE`, zero rows leak.
12. Migration `006` additive: no existing table altered; replay on migrated DB clean.

Real-RPC (`RUN_RPC_TESTS=1` only, never in deterministic CI):

13. Factory bytecode hash matches pinned constant.
14. Bounded 2,000-block scan returns ≥1 real `PoolCreated` (integration), decodes and persists correctly.
15. `eth_getLogs` bounded range responds; over-cap range halves correctly.
16. Discovered pool appears via `GET /api/v1/pools` with `venue:'s3-01-registry'` and correct token order/decimals.

Acceptance gate for merge: unit suite green, real-RPC 4/4 green, CI 2/2 green,
PAPER slice untouched, registry fail-closed proven, discovered pool cannot be
used for intents (422).

## Data contract with S3-02 (must stay true)

- Registry statuses: `ABSENT` (no table) / `OK` (rows read) / `UNAVAILABLE`
  (malformed/unreadable). S3-02 already implements all three.
- Discovered pools are non-actionable: `POST /api/v1/intents` on an evaluation of
  a discovered pool returns `422 INTENT_NOT_ACTIONABLE`. Onboarding a discovered
  pool to trading requires a deliberate separate decision + allowlist change, not
  this PR.
- Volume stays `UNAVAILABLE`; confidence stays `LOW`; PAPER-only; no signer.

## Evidence for the PR

Bounded real-RPC scan logs (block range, event count, accepted/rejected counts),
live `GET /api/v1/pools` showing a discovered pool, restart resume proof, and
`422` on intent for a discovered pool. Keep raw captures out of the repo.
