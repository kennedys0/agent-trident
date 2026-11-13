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

## Sprint 3 — Market intelligence, verified pool discovery, and the Discover UI (complete)

6. Sprint 3 workstreams, all merged to `main` with the QA and security gates green:
   - S3-02 market intelligence: pool registry with price/liquidity/provenance, a server-persisted watchlist, honest `ABSENT`/`OK`/`UNAVAILABLE` metric states, and `LOW` confidence. (issue #22, PR #25)
   - S3-03 Discover UI: pool list and pool Inspector rendering discovery data as it is, with loading, empty, error, and success states. (PR #26, polish PR #27)
   - S3-01 verified on-chain pool discovery: `PoolCreated` events decoded from the pinned Uniswap v3 factory, bounded checkpoint-based scanning, idempotent persistence, and a fail-closed reorg policy. (issue #21, PR #29)
   - S3-04 QA and reliability gate: QA reports, acceptance matrix, and the full gate run against real chain data. (issue #24, PR #28 and PR #30)
7. Rules that hold across Sprint 3:
   - A discovered pool is never actionable: `POST /api/v1/intents` for a discovered pool answers `422 INTENT_NOT_ACTIONABLE`; only the verified allowlist can be traded.
   - The public RPC has no verifiable volume source, so volume stays `UNAVAILABLE` with a reason and confidence stays `LOW`.
   - Discovery is bounded by `DISCOVERY_LOOKBACK_BLOCKS` (default `2000`, capped at `25000`); `DISCOVERY_ENABLED=0` switches the worker off.
8. Known Sprint 3 gaps, carried into Sprint 4 rather than silently dropped:
   - The browser-level watchlist click proof is automated in `apps/web/e2e/watchlist.spec.ts`; the deterministic CI job still runs typecheck, tests, and build only, so the Playwright suite needs the API and preview server running.
   - Reorg handling is proven with a synthetic provider only; a destructive live-chain reorg is unverified.
   - Three Low security findings (deeper-reorg orphan rows, `chain.raw` bypassing the internal throttle, regex-based error classification) stay in the backend backlog.

## Phase 3 — Deployment readiness (blocked; requires CEO approval)

9. Auth (single-admin), CSRF/Origin checks, rate limiting, body limits, TLS proxy, non-root read-only container, backup/restore drill with RPO/RTO, persistent volume, observability. None of this is implemented or approved yet.

## Phase 4 — Product expansion (not scheduled)

10. Strategy configuration UI, positions/trades views, risk center, operations settings. The watchlist itself already ships in Sprint 3; what is still missing is the scanner that proposes assets to watch. Requires the CEO decisions listed in `PRD.md` (non-stock allowlist, quote asset, balances, risk limits, fee/slippage model, ETH→USDG price source).

## Not on the roadmap

- LIVE trading. A signer can only appear after a separate CEO approval and a security design that does not exist yet; activation is out of scope permanently until that explicit decision.
- Stock Token trading. Deliberately excluded from the MVP.
