# TRIDENT

PAPER-only trading system for Robinhood Chain (chain ID `4663`). It polls the verified WETH/USDG Uniswap v3 pool, turns each block-pinned snapshot into a deterministic trading candidate, runs the candidate through a fail-closed risk gate, and records simulated orders, fills, ledger entries, and portfolio state in SQLite. A web console shows chain status, candidates, risk evidence, the paper portfolio, and the append-only audit journal.

The system never signs a transaction, never holds a key, and has no live execution path.

## Status

Local PAPER operation is implemented, tested, and merged to `main`. Public deployment is blocked; see [Limitations](#limitations).

- Proven: real RPC chain check, block-pinned quotes, deterministic strategy, risk rules `R01`–`R15`, one fill per evaluation, replay idempotency, balanced double-entry ledger, restart and reorg recovery, atomic audit, kill switch, responsive UI with honest stale, unavailable, and manual-review states.
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

The web dev server reads `TRIDENT_API_URL` to change its proxy target. The default is `http://127.0.0.1:8080`.

No secrets exist in this slice. Never commit `.env` and never paste a private key into it: there is no code that would use one.

## Verify the install

Run the same checks that gate the repository:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected results: typecheck and build finish clean; tests report contract 17, API 84 with 4 skipped real-RPC tests, and web 42.

To include the four tests that call the live RPC:

```bash
RUN_RPC_TESTS=1 pnpm --filter @trident/api test
```

To run the browser acceptance suite, start the API, then the web preview on port 4173, then:

```bash
pnpm --filter @trident/web exec playwright install chromium
pnpm --filter @trident/web exec playwright test
```

The suite covers the desktop Chromium viewport only. It expects a reachable API and a fresh database.

## Project layout

```
apps/api               Fastify API, chain client, strategy, risk gate, ledger, SQLite, worker
apps/web               React + Vite operations console
packages/api-contract  Zod schemas, generated OpenAPI document, and shared wire types
docs/evidence          Committed acceptance evidence for issue #5
```

The API builds `@trident/api-contract` before it type-checks or tests, so the API and the UI cannot drift from the contract quietly.

## Verified network facts

- Robinhood Chain mainnet chain ID: `4663`
- Public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Uniswap v3 factory: `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`
- QuoterV2: `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`
- WETH/USDG pool at the `0.01%` fee tier: `0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca`
- The public RPC is polling-only and non-archive. Historical state reaches roughly 5,000 blocks back, so the risk gate rejects snapshots beyond that window.

The testnet, chain ID `46630`, has no Uniswap v3 deployment and no USDG. It is unusable for this system.

## Limitations

Do not expose this application to a network you do not control.

- No authentication, CSRF protection, rate limiting, request body limit, or TLS. The API binds loopback only.
- No host allowlist for RPC endpoints; any HTTPS URL is accepted if it reports chain ID `4663`.
- `zod@3` is in use and needs an upgrade to clear a known advisory before any deployment review.
- No Dockerfile or Compose file is committed, so container hardening and backup and restore drills are unproven. CI covers deterministic gates only; see [docs/CI.md](docs/CI.md).
- One venue and one pool, no independent price oracle. A second RPC provider for finality and failover is future work.
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