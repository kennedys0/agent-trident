# Roadmap

Phases are complete only when the linked work has merged and its gates are green.
LIVE activation is prohibited in every phase below; it needs a separate CEO
approval that has never been given.

## Phase 1 — Foundation and PAPER vertical slice (complete)

1. Foundation: monorepo, API/web skeletons, migrations, health checks, design tokens. — merged in `aa30a22`.
2. Vertical slice: verified WETH/USDG snapshot, deterministic WAIT/BUY evaluation, fail-closed risk gate, paper order, ledger, UI. — contracts (#7), backend (#8), UI (#9) merged.
3. Reliability: checkpoints, restart recovery, replay/idempotency, stale/RPC fault injection, atomic audit. — merged via #8; independent re-review on `f4e1f6a` closed the reorg-recovery and risk-transaction defects.

## Phase 2 — Stability and security (PAPER only)

4. Sprint 2 workstreams:
   - S2-01 dependency security: `zod` GHSA-mrhx-c7xc-m3w5, patched upgrade, lockfile. (issue #12, PR #15)
   - S2-02 GitHub CI: deterministic gates, real-RPC isolated. (issue #11, PR #16)
   - S2-03 RPC security: hostname allowlist, HTTPS, chain ID 4663, no redirects, SSRF defenses. (issue #13, PR #18)
   - S2-04 technical debt: documentation accuracy, schema debt, halt visibility, fee-tier terminology, issue reconciliation. (issue #14, PR #17)
5. Documentation matches the implementation. Remaining debt is documented, not hidden:
   no transactional outbox (single synchronous writer), `portfolio_snapshots` /
   `strategy_configs` retained but unused, halt reason exposed at `/health` meta.

## Sprint 3 — Verified discovery and market intelligence (complete, PAPER only)

Every PR passed an independent security review and a QA gate before merge, and CI was green on each merge commit.

- S3-01 verified on-chain pool discovery: `PoolCreated` codec, bounded `eth_getLogs` scanning with durable checkpoint resume, reorg freeze/rewind, additive migration 006, and a discovered-pool registry that stays non-actionable. (issue #21, PR #29, merge `1e950a27`)
- S3-02 market intelligence: pool registry, block-pinned metrics with honest `ABSENT`/`OK`/`UNAVAILABLE` states, and a persistent watchlist. (issue #22, PR #25, merge `9ddc77e5d7`)
- S3-03 Discover UI: pool list and pool Inspector rendering discovery data as recorded, plus design polish. (PR #26, merge `2355b6a679`; polish PR #27, merge `2026f731`)
- S3-04 QA, reliability, and PAPER-only gate: sign-off reports and the acceptance matrix under `docs/qa`; the final gate ran the real-RPC suite against `main`. (issue #24, PR #28, merge `cafd6e9f`)
- Test-only repair of the ageing real-RPC discovery seed so the gate keeps passing honestly. (PR #30, merge `381725e3`)
- The 3 Low security findings on S3-01 are fixed: the reorg rewind is replay-proof and re-scans the stored range, the discovery worker paces every RPC call, and error classification uses numeric JSON-RPC codes and HTTP status. (PR #33, merge `d54af9c`)
- Watchlist click flow covered by automated tests (listing filter, inspector toggle, exact wire contract). (PR #34, merge `9aab25e9`)
- Remaining debt (documented, not hidden): the `chain.raw` escape hatch and the message-based retry classifier inside `ChainClient` still need a separate hardening PR; the destructive reorg drill is synthetic only, and the default discovery lookback is 2,000 blocks. Still blocked: Phase 3 deployment (auth/TLS/CSRF/rate limiting/backup drill) and the product decisions listed in `PRD.md`.

## Phase 3 — Deployment readiness (blocked; requires CEO approval)

6. Auth (single-admin), CSRF/Origin checks, rate limiting, body limits, TLS proxy, non-root read-only container, backup/restore drill with RPO/RTO, persistent volume, observability. None of this is implemented or approved yet.

## Phase 4 — Product expansion (not scheduled)

7. Scanner/watchlist, strategy configuration UI, positions/trades views, risk center, operations settings. Requires the CEO decisions listed in `PRD.md` (non-stock allowlist, quote asset, balances, risk limits, fee/slippage model, ETH→USDG price source).

## Not on the roadmap

- LIVE trading. A signer can only appear after a separate CEO approval and a security design that does not exist yet; activation is out of scope permanently until that explicit decision.
- Stock Token trading. Deliberately excluded from the MVP.
