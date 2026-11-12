# Roadmap

Phases are complete only when the linked work has merged and its gates are green.
LIVE activation is prohibited in every phase below; it needs a separate CEO
approval that has never been given.

## Phase 1 — Foundation and PAPER vertical slice (complete)

1. Foundation: monorepo, API/web skeletons, migrations, health checks, design tokens. — merged in `aa30a22`.
2. Vertical slice: verified WETH/USDG snapshot, deterministic WAIT/BUY evaluation, fail-closed risk gate, paper order, ledger, UI. — contracts (#7), backend (#8), UI (#9) merged.
3. Reliability: checkpoints, restart recovery, replay/idempotency, stale/RPC fault injection, atomic audit. — merged via #8; independent re-review on `f4e1f6a` closed the reorg-recovery and risk-transaction defects.

## Phase 2 — Stability and security (current, PAPER only)

4. Sprint 2 workstreams, each on its own branch with its own PR to `main`:
   - S2-01 dependency security: `zod` GHSA-mrhx-c7xc-m3w5, patched upgrade, lockfile. (issue #12, open PR #15)
   - S2-02 GitHub CI: deterministic gates, real-RPC isolated. (issue #11, open PR #16)
   - S2-03 RPC security: hostname allowlist, HTTPS, chain ID 4663, no redirects, SSRF defenses. (issue #13)
   - S2-04 technical debt: documentation accuracy, schema debt, halt visibility, fee-tier terminology, issue reconciliation. (issue #14, this change)
5. Documentation matches the implementation. Remaining debt is documented, not hidden:
   no transactional outbox (single synchronous writer), `portfolio_snapshots` /
   `strategy_configs` retained but unused, halt reason exposed at `/health` meta.

## Phase 3 — Deployment readiness (blocked; requires CEO approval)

6. Auth (single-admin), CSRF/Origin checks, rate limiting, body limits, TLS proxy, non-root read-only container, backup/restore drill with RPO/RTO, persistent volume, observability. None of this is implemented or approved yet.

## Phase 4 — Product expansion (not scheduled)

7. Scanner/watchlist, strategy configuration UI, positions/trades views, risk center, operations settings. Requires the CEO decisions listed in `PRD.md` (non-stock allowlist, quote asset, balances, risk limits, fee/slippage model, ETH→USDG price source).

## Not on the roadmap

- LIVE trading. A signer can only appear after a separate CEO approval and a security design that does not exist yet; activation is out of scope permanently until that explicit decision.
- Stock Token trading. Deliberately excluded from the MVP.
