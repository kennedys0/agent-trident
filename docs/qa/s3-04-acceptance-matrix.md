# S3-04 Acceptance Matrix — Sprint 3 QA, reliability, PAPER-only

- **Baseline:** `main` `4cd05c7bab66d424d110110a66379592ad72e6f1` (Sprint 2 merged).
- **Matrix prepared:** 2026-11-12T05:47Z.
- **Toolchain:** Node `v24.22.2`, pnpm `9.12.3`, Linux.
- **Scope:** independent verification of S3-01 (pool discovery), S3-02 (market intelligence), S3-03 (Discover UI), plus cross-cutting reliability and PAPER-only gates.
- **Owner:** Probe (QA). Security review: Sentinel. No merge without CEO authorization.

## Status and evidence rules

| Status | Meaning |
|---|---|
| PASS | Executed on the exact head SHA; evidence reproducible; expectation met. |
| FAIL | Executed; expectation not met. Blocks merge. |
| BLOCKED | Cannot execute because a dependency is missing (PR absent, environment unavailable). Not a pass. |
| UNVERIFIED | Not yet executed on the item's head SHA. |

Evidence classes:

- **D** — deterministic suite / typecheck / build.
- **F** — deterministic fixture or adversarial harness (fake RPC/DB/API).
- **R** — real Robinhood Chain 4663 / live RPC; always run outside the `pull_request` CI path.
- **DB** — temporary SQLite DB inspection (schema, constraints, `PRAGMA integrity_check`, row counts).
- **S** — static scan of source, diff, workflows, lockfile.
- **U** — browser e2e (Playwright + axe), viewports 320/375/768/1024/1280.

Gate rules:

1. Fixture-only evidence never satisfies an item marked **R**.
2. A single FAIL in a blocking row blocks merge; BLOCKED and UNVERIFIED are reported as such, never rounded up.
3. Deterministic gates must pass on the PR head with `RUN_RPC_TESTS=0`.
4. Real-RPC checks run separately (`RUN_RPC_TESTS=1`) and never gate a PR by themselves.
5. Any test deletion, `.skip`, `continue-on-error`, or relaxed assertion is a blocking finding.

## Baseline evidence on `main` `4cd05c7` — PASS

| Check | Command | Result |
|---|---|---|
| Frozen install | `pnpm install --frozen-lockfile` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Contract tests | `pnpm --filter @trident/api-contract test` | 19/19 |
| API tests (deterministic) | `pnpm test` (`apps/api`) | 156 passed, 4 skipped (real-RPC only), 11 files passed + 1 skipped |
| Web tests | `pnpm test` (`apps/web`) | 42/42, 4 files |
| Production build | `pnpm build` | exit 0; web bundle 440.79 kB / 132.63 kB gzip |
| Audit gate | `node scripts/audit-gate.mjs` | 0 advisories, 0 allowlist entries, exit 0 |
| Audit gate tests | `node --test scripts/audit-gate.test.mjs` | 49/49 |
| Signer/live scan (source) | `grep -rnE 'eth_send|sendRawTransaction|writeContract|sendTransaction|privateKey|mnemonic|walletClient|createWalletClient|signTransaction|signTypedData' apps packages scripts` | no matches |
| LIVE UI strings | `grep -rn 'LIVE' apps packages` | only tests/docs asserting no LIVE control; contract rejects `mode: LIVE` |

Baseline log: `/tmp/opencode/probe-s3-04-baseline.log`.

## Real-chain provenance (baseline, read-only, separate from CI) — PASS

| Probe | Result |
|---|---|
| `eth_chainId` | `0x1237` = **4663** |
| Head at probe time | block `112298569`, hash `0xfe02a2bb2098607af7109aeba43db7a72a9b0072cecba31ce871d320eaec05d7`, `2026-11-12T05:45:43Z` |
| Factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` code | 24,535 bytes, non-empty; keccak256 `0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739` |
| `PoolCreated` topic0 | `0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118` (matches `PoolCreated(address,address,uint24,int24,address)`) |
| Bounded `eth_getLogs`, 2,000 blocks | 1 real event at block `112297142`, 4 topics, fee `10000`, token0 `0x0bd7…ad73`, token1 `0x5b77…10a1` |
| Raw capture | `/tmp/opencode/probe-s3-04-poollogs.json`, sha256 `06de294dc7824566b976a61b28d5a423764dc2bbdac545af8d7a4cc88b7bb211` |

This proves the real evidence path exists. It does **not** satisfy S3-01 acceptance until the implementation reads the same data.

## S3-01 — verified on-chain pool discovery

| ID | Acceptance item | Method | Status now |
|---|---|---|---|
| S301-01 | Live RPC reports chain 4663; a mismatched chain fails closed | D + R | UNVERIFIED (baseline provenance PASS) |
| S301-02 | Verified factory address and provenance are pinned exactly; wrong/unknown factory rejected | F + S + R | UNVERIFIED |
| S301-03 | Factory code hash is checked; changed bytecode fails closed | F + R | UNVERIFIED |
| S301-04 | `PoolCreated` decoded correctly: token0/token1/fee/tickSpacing/pool; token order preserved | D + F + R | UNVERIFIED |
| S301-05 | Real known pool is discovered from factory events, no fixture substitution | R | UNVERIFIED |
| S301-06 | Polling stays inside RPC limits: bounded ranges, `getLogs` chunking, no unbounded `eth_getLogs` | F + S + R | UNVERIFIED |
| S301-07 | History beyond the ~5,000-block window is reported `UNAVAILABLE`, not fabricated or silently skipped | F + R | UNVERIFIED |
| S301-08 | Token contract validation: code present, ERC-20 `symbol`/`decimals` readable, decimals in range, malformed metadata rejected | F + R | UNVERIFIED |
| S301-09 | Pool identity: address matches factory derivation, token pair unique, allowed fee tiers only | F | UNVERIFIED |
| S301-10 | Duplicate protection: overlapping ranges and repeated events create one pool/observation, no duplicate rows | F + DB | UNVERIFIED |
| S301-11 | Restart resumes from a durable checkpoint with no gap and no replay duplication | F + DB | UNVERIFIED |
| S301-12 | Reorg: same-height hash replacement, parent mismatch, rollback, and canonical-unavailable are handled fail-closed | F + DB | UNVERIFIED |
| S301-13 | RPC failure/backoff: timeouts, 429/5xx, malformed responses retried with bounded backoff; no tight loop; state frozen/halted truthfully | F | UNVERIFIED |
| S301-14 | No signer, private key, `eth_send*`, `writeContract`, or live execution added | S | UNVERIFIED |
| S301-15 | Real-RPC tests are skipped when `RUN_RPC_TESTS=0` and cannot run in `pull_request` CI | D + S | UNVERIFIED |
| S301-16 | Schema changes are additive, constrained (PK/FK/unique), and non-destructive | DB + S | UNVERIFIED |

## S3-02 — truthful market intelligence and persistent watchlists

| ID | Acceptance item | Method | Status now |
|---|---|---|---|
| S302-01 | Decimal scaling correct for 6/18-decimal tokens and mixed decimals | D | UNVERIFIED |
| S302-02 | Token ordering correct: price is token1 per token0 after adjustment; reversed pools agree | D | UNVERIFIED |
| S302-03 | Liquidity value persisted with source and observation block/time | DB + D | UNVERIFIED |
| S302-04 | Unverifiable volume is `UNAVAILABLE`, never `0` or estimated | D + F | UNVERIFIED |
| S302-05 | Staleness deterministic at the boundary; `AVAILABLE`/`STALE`/`UNAVAILABLE` transitions | D + F | UNVERIFIED |
| S302-06 | Freshness/confidence indicators persist and are exposed by the API | D + DB | UNVERIFIED |
| S302-07 | Shallow/single-pool price is explicitly low confidence, not an oracle | D + S | UNVERIFIED |
| S302-08 | Watchlist add/remove is idempotent and survives restart | DB + D | UNVERIFIED |
| S302-09 | Watchlist rejects invalid, unknown, wrong-case and non-address input | D + F | UNVERIFIED |
| S302-10 | Search/filter by token address: match, no match, malformed input | D + F | UNVERIFIED |
| S302-11 | Every discovered asset stays read-only; no trade-eligibility or order path | S + D | UNVERIFIED |
| S302-12 | Existing WETH/USDG PAPER slice still works end to end | D | UNVERIFIED |
| S302-13 | API contract/OpenAPI updated and regenerated; no breaking drift | D + S | UNVERIFIED |
| S302-14 | No fabricated metrics: each value is sourced or null, never invented | S + D | UNVERIFIED |

## S3-03 — Discover UI with real data

| ID | Acceptance item | Method | Status now |
|---|---|---|---|
| S303-01 | All displayed metrics come from S3 API responses; no mock/default production numbers | U + S | UNVERIFIED |
| S303-02 | Listings render real discovered pools; empty state is truthful | U | UNVERIFIED |
| S303-03 | Address search/filter works: match, no results, invalid input | U | UNVERIFIED |
| S303-04 | Token Inspector shows real fields, provenance, and exact chain-4663 explorer links | U + S | UNVERIFIED |
| S303-05 | Watchlist add/remove round-trips to persistent backend; no dead controls | U + DB | UNVERIFIED |
| S303-06 | Loading state is announced and shows no invented numbers | U | UNVERIFIED |
| S303-07 | Empty, error, offline and unavailable states are distinct; retry works | U | UNVERIFIED |
| S303-08 | Stale data is labelled stale and cannot look healthy | U | UNVERIFIED |
| S303-09 | API 4xx/5xx/timeout handled without crashing or inventing data | U + F | UNVERIFIED |
| S303-10 | Layouts at 320/375/768/1024/1280 with no overflow; light/dark | U | UNVERIFIED |
| S303-11 | Keyboard order, visible focus, no trap; primary actions reachable | U | UNVERIFIED |
| S303-12 | Contrast meets WCAG AA in light and dark | U | UNVERIFIED |
| S303-13 | Reduced-motion preference respected | U + S | UNVERIFIED |
| S303-14 | Design tokens and PAPER semantics intact; no LIVE control or ambiguity | U + S | UNVERIFIED |
| S303-15 | External links use exact addresses and safe `rel`/`target` | S + U | UNVERIFIED |

## Cross-cutting reliability, database and security

| ID | Acceptance item | Method | Status now |
|---|---|---|---|
| X-01 | No signer/private key/wallet client/`eth_send*`/LIVE path anywhere in source or diff | S | PASS (baseline); re-run per PR |
| X-02 | PAPER is the only executable mode at runtime; contract rejects `LIVE` | D + S | PASS (baseline); re-run per PR |
| X-03 | No new high/critical production advisory; audit gate green | D | PASS (baseline); re-run per PR |
| X-04 | Full deterministic suite + production build pass on PR head | D | PASS (baseline); per PR pending |
| X-05 | `RUN_RPC_TESTS=0` isolation guard and no real-RPC job on `pull_request` | S | PASS (baseline); re-run per PR |
| X-06 | No gate weakening: no deleted tests, new `.skip`, `continue-on-error`, or relaxed assertions | S (diff) | UNVERIFIED |
| X-07 | DB consistency after restart/reorg: FKs, unique keys, `PRAGMA integrity_check` ok, no orphan rows | DB + F | UNVERIFIED |
| X-08 | Concurrent discovery/worker runs remain idempotent; no duplicate pool/snapshot/ledger effects | F + DB | UNVERIFIED |
| X-09 | Discovery/reorg decisions produce audit evidence; logs contain no secrets | DB + S | UNVERIFIED |
| X-10 | Migrations are additive and replay-safe; no destructive change | DB + S | UNVERIFIED |
| X-11 | Real-RPC provenance recorded with commit SHA, UTC time, head block/hash, raw capture hash | R | PASS (baseline); per PR pending |
| X-12 | RPC guard preserved: host allowlist, HTTPS, chain 4663, no SSRF regression | D + S | UNVERIFIED |
| X-13 | API inputs validated at boundaries; address/query parsers reject malformed data | D + F | UNVERIFIED |
| SEC-01 | Sentinel threat-model findings triaged and dispositioned, no open blocker | Coordination | UNVERIFIED |

## Per-PR execution procedure

1. Record head SHA, base `4cd05c7`, ancestry, `merged=false`, `mergeable_state`, and the exact diff file list; unexpected files are a blocking finding.
2. `pnpm install --frozen-lockfile`; `pnpm typecheck`; per-package `test`; `pnpm build`.
3. Run the new deterministic tests. Mutation-check at least two critical assertions per feature (duplicate protection, reorg decision, staleness boundary, allowlist/validation) to prove tests bite.
4. Run real-RPC checks separately with `RUN_RPC_TESTS=1` and the public 4663 endpoint; capture head block/hash and raw JSON-RPC evidence.
5. Run DB probes on a temporary database: schema, constraints, `integrity_check`, row counts before/after restart/reorg.
6. Start API + web preview and run Playwright/axe at 320/375/768/1024/1280, light/dark, keyboard, offline/error/stale states.
7. Scan the diff for signing/live code, gate weakening, workflow changes and lockfile changes.
8. Publish per-item PASS/FAIL/BLOCKED/UNVERIFIED with commands, exit codes, artifact paths, and blocking findings that name trigger, consequence and required fix.

## Blocking conditions

- Any acceptance item FAIL on the PR head.
- Any signer/private key/`eth_send*`/LIVE/automatic-trading path.
- Fixture data presented as production or real-chain evidence substituted by fixtures.
- Duplicate discovery, checkpoint loss, or reorg inconsistency.
- A weakened gate, skipped test, or `continue-on-error`.
- Real-RPC tests wired into the deterministic PR path.

## Current gate state

- No S3-01/S3-02/S3-03 PR exists yet; all four `sprint3/*` branches point at `4cd05c7`.
- Baseline gates on `4cd05c7`: **PASS** (evidence above).
- Feature acceptance: **UNVERIFIED** for every S3-01/02/03 item.
- Overall: **BLOCKED on PR availability**, not a failure. The matrix is ready; testing starts when a PR head appears.

## Security coordination with Sentinel

- Probe covers functional behavior, reliability, DB consistency, UI/a11y and the deterministic/PAPER gates.
- Sentinel covers the threat model: factory/RPC trust boundaries, token metadata, log polling, checkpoint/reorg integrity, API inputs, explorer links, watchlists, and absence of signing/live paths.
- Shared evidence: real-RPC captures, DB extracts, static scans, and per-PR head SHA. Sentinel's findings get a disposition row (SEC-01) before any PASS.
- No gate is relaxed for either review; independent FAILs are preserved.