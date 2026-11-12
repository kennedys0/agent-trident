# CI

Continuous integration is split into two workflows with very different trust
properties. A deterministic result and a network result must never be confused
with each other.

## `.github/workflows/ci.yml` — deterministic gates

Runs on `pull_request` targeting `main`, on `push` to `main`, and on manual
dispatch. It never reaches a live chain.

| Job | What it proves |
| --- | --- |
| `Deterministic gates (typecheck, tests, build)` | `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build` all succeed on Node 24 with pnpm 9.12.3. |
| `Dependency security (high and critical)` | `node scripts/audit-gate.mjs` finds no high or critical advisory in production dependencies that is not explicitly tracked. |

Notes:

- Every gate is a plain step with no `continue-on-error`. A failing command
  exits non-zero, the step fails, the job fails, and the workflow fails.
- The workspace pins `packageManager: pnpm@9.12.3` and `engines.node: ">=24"`.
  The workflows pin the same versions explicitly so a runner default cannot
  drift.
- `pnpm install --frozen-lockfile` fails when `pnpm-lock.yaml` disagrees with
  the manifests, so a stale lockfile cannot pass.
- The unit suite contains real-network tests gated behind `RUN_RPC_TESTS=1`.
  The deterministic job sets `RUN_RPC_TESTS=0` and includes an explicit guard
  step that fails the job if it is ever set to `1` there.

### Dependency security policy

`scripts/audit-gate.mjs` runs `pnpm audit --prod --json` and fails on any
high or critical advisory affecting production dependencies.

An advisory is tolerated only when `.github/audit-allowlist.json` names its
advisory id, the affected package, the tracking issue, and an expiry date.
The gate fails closed in every other direction:

- unknown high/critical advisory → fail;
- expired allowlist entry that still matches → fail;
- unreadable or unparsable audit output → fail.

An allowlist entry that no longer matches anything is reported as stale so it
can be deleted. The file is meant to shrink to nothing; it is not a permanent
suppression list.

## `.github/workflows/real-rpc.yml` — live network, isolated

Runs on `workflow_dispatch` and a daily schedule. It deliberately has **no**
`pull_request` trigger, so it can never colour a pull request result.

- Job name: `Real RPC checks (Robinhood Chain 4663, live network)`.
- Sets `RUN_RPC_TESTS=1` and `RPC_URL=https://rpc.mainnet.chain.robinhood.com`.
- Runs only `test/chain-rpc.test.ts` against the public RPC.

These checks are read-only: no signing, no private keys, no `eth_send*`. They
can fail for reasons outside the repository (network faults, upstream rate
limits), which is exactly why they are separated.

## Reproducing CI locally

Run the same commands the deterministic job runs:

```bash
node --version        # v24.x
pnpm --version        # 9.12.3
RUN_RPC_TESTS=0 pnpm install --frozen-lockfile
RUN_RPC_TESTS=0 pnpm typecheck
RUN_RPC_TESTS=0 pnpm test
RUN_RPC_TESTS=0 pnpm build
```

And the dependency gate:

```bash
pnpm install --frozen-lockfile
node scripts/audit-gate.mjs
```

Expected deterministic totals at the baseline this workflow was added:

- contract: 17 tests
- API: 84 passed, 4 real-RPC tests skipped
- web: 42 tests

## Not covered

- No container build or hardening check: the repository has no Dockerfile.
- No deploy step: there is no deployment target and no public exposure.
- No Firefox/WebKit or real-device browser run.
- Actions are referenced by major tag, not by commit SHA. Pinning to SHAs is a
  reasonable follow-up hardening step.