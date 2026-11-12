# Sprint 3 QA Summary (S3-04)

- **Issue:** #24 — S3-03 QA, reliability, and PAPER-only gate (owners: Probe QA + Sentinel security)
- **Date:** 2026-11-12
- **Sprint 3 head verified:** `main` `2355b6a6796ea9bf37cd9f7afb79802be00a2a53` (after PR #25 → #26 merged)
- **Overall QA verdict:** PASS for S3-02 and S3-03 (including post-merge main); **UNVERIFIED for S3-01** — no implementation exists, which remains the only sprint blocker.

## 1. Verdict per workstream

| Workstream | Head reviewed | QA verdict | Notes |
|---|---|---|---|
| S3-01 Pool Discovery (issue #21) | branch `sprint3/s3-01-pool-discovery` = `main`, 0 commits above it; no PR | **UNVERIFIED** | Nothing to test. Owner: Nexus. Registry path exercised only via S3-02 fail-closed tests (`ABSENT`). |
| S3-02 Market Intelligence (PR #25) | `2e7ffa620b41946d67bf529b1b952b8d7c23fa6d` | **PASS** (0 blocker) | Full report: `docs/qa/reports/s3-02-gate.md`. Sentinel security gate: PASS (2 Low non-blocking). |
| S3-03 Discover UI (PR #26) | `0822346d6074aecb3ede16d04b680d410e078dc0`, fix `2e69f61c55d4f54a8fd585c74878730bc2961fac` | **FAIL → PASS after fix** | Blocker F-1 (dark active-nav contrast 1.21:1, WCAG AA 4.5:1) found, fixed (`var(--status-ink)`), re-verified 14.78:1 measured, 102/112 runtime checks pass, 0 `color-contrast` violations. Full report: `docs/qa/reports/s3-03-review.md`. |
| Post-merge `main` `2355b6a` | both merge commits | **PASS** | See §3. |

## 2. Coverage against issue #24 verification list

| Check | Status | Evidence |
|---|---|---|
| Chain 4663 connectivity + verified factory identity | PASS | `RUN_RPC_TESTS=1` → `chain-rpc.test.ts` 4/4 (chainId 4663, pool derived from factory `0x1f7d75…2efa`, token metadata) on `2e7ffa6` and post-merge `main` |
| `PoolCreated` discovery + token/pool validation | UNVERIFIED | S3-01 not implemented; S3-02 side covered only by registry `ABSENT` fail-closed |
| Duplicate handling / restart recovery | PASS | snapshot upsert idempotent per `(pool, block)` (`marketIntel.test.ts:103`); watchlist add→restart (new process)→entry persists→delete round-trip, live |
| Reorg rollback/replay | UNVERIFIED | discovery flow (S3-01) absent; `chain_reorg*` tables pre-existing but unused by S3-02 |
| RPC failure/backoff, bounded polling | PARTIAL | transport failure states PASS (400/500/offline in S3-03 runtime probe, distinct banners + retry); discovery backoff UNVERIFIED (S3-01) |
| Stale / missing / untrusted data behavior | PASS | live: `UNAVAILABLE` (no observation) → `AVAILABLE` (refresh) → `STALE` (freshness window) → `AVAILABLE` (pinned detail refresh); empty pool never fakes zero; registry rows sanitized/skipped (`marketIntel.ts:77-101`); malformed registry → fail-closed (`marketIntel.test.ts:233`) |
| Database consistency + watchlist persistence | PASS | migration 005 additive only (`migrations.ts:289-320`); restart persistence live; parameterized SQL throughout (Sentinel) |
| Discover UI empty/error/stale/offline + mobile | PASS | S3-03 runtime probe: all states distinct at 320/375/768/1024/1280, 0 overflow; 102/112 checks pass (remaining 10 = `page-has-heading-one`, pre-existing, non-blocking F-2) |
| Static/runtime proof of no signing or live execution | PASS | both PR diffs: 0 signer/private-key/`eth_send*`/LIVE patterns; runtime `EXECUTION_MODE=PAPER`, chainId 4663 across all live runs |
| Real-RPC tests isolated from deterministic CI | PASS | `chain-rpc.test.ts:11-18` gated by `RUN_RPC_TESTS` (4 skipped by default); `ci.yml` never reaches a live chain by design; `real-rpc.yml` dispatch/cron only |

## 3. Post-merge `main` sign-off (`2355b6a679`)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm -r typecheck` | exit 0 |
| `pnpm -r test` | exit 0 — contract **25/25 + OpenAPI drift clean**, API **169 passed + 4 skipped** (real-RPC gated), web **74/74** |
| `pnpm -r build` | exit 0 |
| `pnpm audit:gate` | exit 0, 0 advisory |
| `pnpm audit:gate:test` | 49/49 |
| `RUN_RPC_TESTS=1 … chain-rpc` | 4/4 PASS |
| GitHub CI on both merge commits | `Deterministic gates` + `Dependency security` = success |

## 4. Reviews recorded (issue #24 acceptance)

| Reviewer | Scope | Verdict | Where |
|---|---|---|---|
| Pixel | S3-03 design/visual @ `0822346` | PASS, 0 blocking, 4 non-blocking polish | channel `channel-result-f8dd8e46…` |
| Sentinel | S3-03 security @ `0822346` | PASS, 0 blocking, 2 Low (`ExplorerLink.tsx:25`, `:10`) | channel `channel-result-96f5473c…` |
| Probe | S3-03 QA @ `0822346` → fix `2e69f61` | FAIL (F-1) → **PASS on re-verification** | `docs/qa/reports/s3-03-review.md` |
| Probe | S3-02 QA @ `2e7ffa6` | PASS, 0 blocker | `docs/qa/reports/s3-02-gate.md` |
| Sentinel | S3-02 security @ `2e7ffa6` | PASS, 0 blocker, 2 Low (`app.ts:460,468` raw RPC error message; `app.ts:421-480` refresh rate-limit) | channel `channel-result-1a70cfa7…` |
| Architecture/design docs | `docs/s3-02-market-intelligence.md`, `ARCHITECTURE.md`, `README.md` updated in PR #25 | recorded | repo |

## 5. Open findings (non-blocking, do not block the sprint)

- Probe **F-2**: Pool Inspector has no `<h1>` (axe `page-has-heading-one` on default rules; evidence harness filters to WCAG tags).
- Probe **F-3**: footer copy says "contract mismatch" while title is "Backend error"; theme toggle unreachable <1024px (pre-existing); "FEE0.3%" tight at 320px.
- Sentinel **N-1/N-2**: raw `refreshError` message to client (`app.ts:460,468`); no per-endpoint rate limit on detail refresh (`app.ts:421-480`).
- Pixel: 4 visual polish items (filter-chip border token, `feeLabel <50 → "0%"`, theme-toggle mobile, collapse spacing).
- Sprint 2 leftovers: pin Actions to SHA, bump vitest 3→4, bundle size, `real-rpc.yml` not yet triggered.

These require an owner decision (fix now vs. defer); none was waived silently.

## 6. Evidence index

- `docs/qa/s3-04-acceptance-matrix.md` — acceptance instrument (baseline `main` `4cd05c7`).
- `docs/qa/reports/s3-02-gate.md` — full S3-02 QA gate report (commands, live results, file:line).
- `docs/qa/reports/s3-03-review.md` — full S3-03 review (F-1 finding + fix verification, 112-check runtime comparison).
- `docs/evidence/s3-03/` — Forge's fixture evidence (labeled FIXTURE; audited 25/25, never substituted for real-chain runs above).

## 7. Merge authorization

PRs #25 and #26 were merged to `main` only after the user authorized the sequence in-channel and both QA and security gates passed with 0 blockers. **This S3-04 PR is opened for review and must not be merged without CEO authorization**, per issue #24.
