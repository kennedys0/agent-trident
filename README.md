# TRIDENT

PAPER-only trading system for Robinhood Chain (chain ID `4663`). It polls the verified WETH/USDG Uniswap v3 pool, turns each block-pinned snapshot into a deterministic trading candidate, runs the candidate through a fail-closed risk gate, and records simulated orders, fills, ledger entries, and portfolio state in SQLite. A web console shows chain status, candidates, risk evidence, the paper portfolio, and the append-only audit journal.

The system never signs a transaction, never holds a key, and has no live execution path.

## Status

Local PAPER operation is implemented, tested, and merged to `main`. Sprint 3 (market intelligence, verified on-chain pool discovery, and the Discover UI) is merged. Public deployment is blocked; see [Limitations](#limitations).

- Proven: real RPC chain check, block-pinned quotes, deterministic strategy, risk rules `R01`–`R15`, one fill per evaluation, replay idempotency, balanced double-entry ledger, restart and reorg recovery, atomic audit, kill switch, responsive UI with honest stale, unavailable, and manual-review states.
- Proven in Sprint 3: verified `PoolCreated` pool discovery on Robinhood Chain (`s3-01-registry` venue, factory bytecode pinned), a pool registry with price/liquidity/provenance and a server-persisted watchlist, and the Discover list plus pool Inspector UI.
- Not yet proven: destructive reorg on the live chain (synthetic provider only), physical devices, Firefox, WebKit, real screen readers, and any deployment behind auth, TLS, or a container.
- Never in scope for this phase: `LIVE` mode, wallets, signing, `eth_send*`.

## Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 24 or newer | The API uses the built-in `node:sqlite` module |
| pnpm | 9.12.3 | The exact version is pinned in `package.json` |
| Git | any recent version | |
| Network | outbound HTTPS | Access to `https://rpc.mainnet.chain.robinhood.com` |

The full workspace needs about 1 GB of disk after install and build.

## Install and run locally

Follow these steps from a terminal. Each step states what you should see before you continue.

### 1. Get the code and install dependencies

```bash
git clone https://github.com/kennedys0/agent-trident.git
cd agent-trident
npm install -g pnpm@9.12.3
pnpm --version
pnpm install --frozen-lockfile
```

`pnpm --version` must print `9.12.3`. Skip the install command if pnpm is already there. Node.js 24 ships Corepack, so `corepack enable` also works when that command is on your PATH.

### 2. Create the configuration file

```bash
cp .env.example .env
```

The defaults target Robinhood Chain mainnet and write the database to `./data/trident.sqlite`. `RPC_URL` is the only value without a fallback, so the API refuses to boot if it is missing, is not HTTPS, embeds credentials, or names a host outside `RPC_ALLOWED_HOSTS`.

Edit `.env` only if you need a different port, database path, or RPC endpoint. Keep `EXPECTED_CHAIN_ID=4663`; any other value aborts boot. To use another provider, add its bare hostname to `RPC_ALLOWED_HOSTS` (comma separated). Loopback, private, link-local and IP-literal hosts are rejected even if listed.

### 3. Build the workspace

```bash
pnpm build
```

This builds `@trident/api-contract`, then the API, then the web app. The command ends without an error and creates `apps/api/dist` and `apps/web/dist`.

### 4. Start the API

Run this from the repository root so the relative database path resolves there:

```bash
node --env-file=.env apps/api/dist/server.js
```

The API binds `127.0.0.1:8080`. Within a few seconds it logs a successful chain check and begins polling every 10 seconds. Confirm it is healthy in a second terminal:

```bash
curl -s http://127.0.0.1:8080/health
```

You should see `"chainId":4663`, `"chainOk":true`, and a current block number. The first market snapshot appears after the first worker tick, so a request to `/api/v1/markets/weth-usdg/snapshot` can return `404` for up to 10 seconds.

If boot stops with `Invalid configuration`, a value in `.env` is missing or malformed. If it stops with a chain ID mismatch, the RPC endpoint is not Robinhood Chain mainnet.

### 5. Start the web console

In a second terminal:

```bash
pnpm --filter @trident/web dev
```

Open http://127.0.0.1:5173. The dev server proxies `/api` and `/health` to the API on port 8080.

### 6. Stop both processes

Press `Ctrl+C` in each terminal. The API releases its database lock and closes SQLite on `SIGINT`. Only one API process can use a database file at a time.

### Run the production build of the web app

```bash
pnpm --filter @trident/web build
pnpm --filter @trident/web preview
```

The preview server listens on http://127.0.0.1:4173 and uses the same API proxy.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `EXECUTION_MODE` | `PAPER` | `OBSERVE` or `PAPER`; any other value aborts boot |
| `RPC_URL` | none | HTTPS JSON-RPC endpoint, required; must match `RPC_ALLOWED_HOSTS` |
| `RPC_ALLOWED_HOSTS` | `rpc.mainnet.chain.robinhood.com` | Comma-separated bare hostnames approved for RPC traffic |
| `EXPECTED_CHAIN_ID` | `4663` | Must equal `4663` |
| `DATABASE_PATH` | `./data/trident.sqlite` | SQLite file, relative to the working directory |
| `PORT` | `8080` | API port |
| `HOST` | `127.0.0.1` | API bind address |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, or `debug` |
| `MARKET_FRESHNESS_SECONDS` | `30` | A snapshot older than this reads as `STALE` |
| `OPENING_CASH_USDG_BASE` | `10000000000` | Simulated opening cash in USDG base units (6 decimals) |
| `DISCOVERY_ENABLED` | `1` | Set to `0` to switch off the pool-discovery worker entirely |
| `DISCOVERY_LOOKBACK_BLOCKS` | `2000` | Blocks the first discovery scan looks back; capped at `25000` |

The web dev server reads `TRIDENT_API_URL` to change its proxy target. The default is `http://127.0.0.1:8080`.

No secrets exist in this slice. Never commit `.env` and never paste a private key into it: there is no code that would use one.

## Verify the install

Run the same checks that gate the repository:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected results: typecheck and build finish clean; tests report contract 25, API 187 with 5 skipped real-RPC tests, and web 76.

To include the eight tests that call the live RPC:

```bash
RUN_RPC_TESTS=1 pnpm --filter @trident/api test
```

To run the browser acceptance suite, start the API, then the web preview on port 4173, then:

```bash
pnpm --filter @trident/web exec playwright install chromium
pnpm --filter @trident/web exec playwright test
```

The suite covers the desktop Chromium viewport only. It expects a reachable API and a fresh database. It includes `e2e/watchlist.spec.ts`, which clicks the Watch button on a live pool and proves the change reaches the API and survives a reload.

## Project layout

```
apps/api               Fastify API, chain client, strategy, risk gate, ledger, SQLite, worker, Discover (read-only market intelligence, S3-02), pool discovery worker (S3-01)
apps/web               React + Vite operations console, Discover list and pool Inspector UI (S3-03)
packages/api-contract  Zod schemas, generated OpenAPI document, and shared wire types
docs/evidence          Committed acceptance evidence for issue #5
docs/qa               Sprint 3 QA summary, acceptance matrix, and gate reports
docs/s3-01-pool-discovery.md       Pool discovery design and invariants
docs/s3-02-market-intelligence.md  Registry, watchlist, and market-intelligence contracts
```

The API builds `@trident/api-contract` before it type-checks or tests, so the API and the UI cannot drift from the contract quietly.

## Verified network facts

- Robinhood Chain mainnet chain ID: `4663`
- Public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Uniswap v3 factory: `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`
- QuoterV2: `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`
- WETH/USDG pool at Uniswap v3 **fee tier 100** (100/1,000,000 = 0.01%, tick spacing 1): `0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca`. "Fee tier 100" is the protocol term; "0.01%" is the same thing in plain percent. It is not "100 bps" (that would be 1%). The other on-chain tiers are `500` (0.05%, spacing 10), `3000` (0.3%, spacing 60), and `10000` (1%, spacing 200). Verified against the mainnet contract on 2026-11-12: `getPool(WETH, USDG, 100)` → `0x52e6…71Ca`, `pool.fee()` → `100`, `tickSpacing()` → `1`
- The public RPC is polling-only and non-archive. Historical state reaches roughly 5,000 blocks back, so the risk gate rejects snapshots beyond that window.
- Fee tiers are shown in percent in the Discover UI: tier `100` → `0.01%`, `500` → `0.05%`, `3000` → `0.3%`, `10000` → `1%`. The label divides the tier by `10000`. The string `0.0001%` belongs to tier `1`, which is not a Uniswap v3 tier on this chain and never appears in the UI.

The testnet, chain ID `46630`, has no Uniswap v3 deployment and no USDG. It is unusable for this system.

## Limitations

Do not expose this application to a network you do not control.

- No authentication, CSRF protection, rate limiting, request body limit, or TLS. The API binds loopback only.
- RPC endpoints require HTTPS, an exact `RPC_ALLOWED_HOSTS` match, public DNS resolution, and chain ID `4663`; redirects are rejected. DNS-rebinding between boot validation and later requests is not fully eliminated.
- No Dockerfile or Compose file is committed, so container hardening and backup and restore drills are unproven. CI covers deterministic gates only; see [docs/CI.md](docs/CI.md).
- Completed Phase 1 issues are reconciled, with close recommendations, in [docs/phase-1-reconciliation.md](docs/phase-1-reconciliation.md). They remain open until the coordinator closes them.
- One venue and one pool, no independent price oracle. A second RPC provider for finality and failover is future work.
- Discovered pools are read-only. A pool found by the discovery worker is never actionable: `POST /api/v1/intents` for a discovered pool answers `422 INTENT_NOT_ACTIONABLE`, and only the verified allowlist can be traded.
- Discovery reads a bounded window. The first scan looks back `DISCOVERY_LOOKBACK_BLOCKS` blocks (default `2000`, capped at `25000`); older pools are only found when the worker has been running long enough or the lookback is raised.
- Discovered pools carry no volume. The public RPC has no verifiable volume source, so volume reads `UNAVAILABLE` with a reason and confidence stays `LOW`.
- The kill switch is not released automatically after a reorg or missing chain evidence. An operator must clear it.
- The public RPC has no `eth_subscribe`, so latency and freshness depend on the 10-second poll.

## Further reading

- [PRD.md](PRD.md) — product scope, acceptance tests, and release gates
- [ARCHITECTURE.md](ARCHITECTURE.md) — components, data flow, and invariants
- [SECURITY.md](SECURITY.md) — threat model and deployment gates
- [TESTING.md](TESTING.md) — evidence rules and priority gates
- [DEPLOYMENT.md](DEPLOYMENT.md) — environment and hardening constraints
- [DESIGN.md](DESIGN.md) — visual system and UI states
- [ROADMAP.md](ROADMAP.md) — phased plan
- [apps/api/README.md](apps/api/README.md) — endpoints, schema invariants, and backend evidence