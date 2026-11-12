# Phase 1 issue reconciliation (recommendation)

Phase 1 is code-complete on `main` (`e92e261`). This file maps each Phase 1
issue to its evidence so the coordinator (Atlas) can close them in one pass.
**No issue was closed by the author of this file.** Each entry states the
evidence to cite and a recommendation; closure belongs to the issue owner or
the coordinator.

| Issue | Title | State | Evidence to cite | Recommendation |
|---|---|---|---|---|
| #1 | Phase 1: execute independent vertical-slice acceptance plan | OPEN | PR #8 merged (merge `4ba6a65`); PR #9 merged (merge `bb8db31`); Probe plan AT-01..AT-16; reruns on `f4e1f6a`: AT-04 closed (checkpoint/reorg HOLD vs PROVEN), AT-16 closed (13/13 atomic fault injection), risk-race 7/7; real-RPC 4/4 on mainnet 4663; API 84 at the Phase 1 baseline + 4 RPC skip, with later Sprint 2 coverage added. Limits to record, not hide: AT-03 no-pool negative, AT-07 live-network SELL/closed position, and a destructive live-chain reorg were never executed; AT-13/AT-14 are Chromium emulation, not physical devices | Recommend close as **complete with documented limits**; closure belongs to Probe (acceptance owner). If Probe does not sign off, leave open and link this file |
| #2 | Phase 1: implement PAPER-only backend vertical slice | CLOSED | PR #8 merged; merge `4ba6a65`; PAPER-only, fail-closed gates, restart/replay evidence | No action |
| #3 | Phase 1: security and deployment gate for PAPER release | OPEN | Sentinel re-review: no signing/`eth_send*`/key material; `LIVE` fails boot; halt persists across restart; audit append-only (triggers) + atomic entity+audit; error envelope without stack/RPC URL; PID lock documented as advisory; integer money. F1 closed at `f4e1f6a` (all risk inputs read inside the write transaction). Explicitly unverified: Docker hardening (no runtime), backup/restore drill, container manifest, and deployment workflow — deployment gate, not Phase 1 PAPER local | Recommend closing the **Phase 1 PAPER gate** with the above evidence; keep deployment blockers tracked in `SECURITY.md`/`DEPLOYMENT.md`. Closure belongs to Sentinel + coordinator |
| #4 | Phase 1: Pixel design review and responsive quality gate | OPEN | Pixel sign-off on the merged UI (contrast `.banner--danger .meta` fixed to 6.02:1, WCAG AA); responsive states 320–1280 light/dark; Playwright 24/24; axe zero serious/critical; evidence under `docs/evidence/issue-5/` | Recommend close; closure belongs to Pixel (gate owner) |
| #5 | Phase 1: implement operational neo-brutalist web UI | OPEN | PR #9 merged; merge `bb8db31`; web 42/42; 24/24 Playwright against real backend/RPC; reorg manual-review 409 with single POST; truthful UNAVAILABLE/STALE states; no LIVE control | Recommend close; closure belongs to Atlas (coordinator) with Forge/Probe evidence |
| #6 | Phase 1: define and enforce API/domain contracts | CLOSED | PR #7 merged; merge `87b887a`; Zod single source, generated OpenAPI/types, drift gate, 17/17 contract tests | No action |

## What stays open after reconciliation

- Sprint 2 PRs #15, #16, #17, and #18 address issues #12, #11, #14, and #13
  respectively. They do not close the separate deployment gate below.
- Deployment gate: auth/CSRF/rate limit/TLS, container hardening, backup/restore
  drill, CEO product decisions (asset allowlist, quote, balances, risk limits,
  fee model, ETH→USDG price source). None of these are closed by Phase 1.
- LIVE activation: never approved; not scheduled.

## Verification commands for the coordinator

```bash
git clone https://github.com/kennedys0/agent-trident.git && cd agent-trident
npm install -g pnpm@9.12.3 && pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build
RUN_RPC_TESTS=1 pnpm --filter @trident/api test   # opt-in, hits mainnet read-only
```
