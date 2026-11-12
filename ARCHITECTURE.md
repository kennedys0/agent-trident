# Architecture

TRIDENT is a single-instance TypeScript modular monolith: Node.js 24, Fastify, viem, SQLite WAL, React, and Vite. Redis, Kafka, Kubernetes, microservices, and live signing are intentionally absent.

## Pipeline

`Robinhood Chain -> Chain Client -> Market Snapshot -> Strategy -> Risk Gate -> Paper Execution -> Ledger -> API -> UI`

## Boundaries

- Chain Client is the only RPC caller. It validates chain ID 4663, limits concurrency, backs off, and records provenance.
- Market Data admits only the verified WETH/USDG pool and marks partial or old data `STALE`/`UNAVAILABLE`.
- Strategy is a pure function over an immutable snapshot and versioned config.
- Risk Gate is the sole approver and fails closed on missing, stale, inconsistent, or over-limit data.
- Paper Execution accepts only an approved intent and never signs or sends a transaction.
- Ledger owns cash, positions, realized PnL, and append-only journal entries.
- API exposes domain views, not RPC or database representations.
- UI renders actual API states and never substitutes fixtures in production.

## Invariants

- At most one intent per evaluation and one order/fill per intent.
- An order and its approved risk decision are committed atomically.
- Settlement quantities are integer base-unit strings with explicit scales.
- A stale/incomplete snapshot cannot produce `BUY`.
- Automation halt persists across restart and blocks new entries while reconciliation remains active.

## Recovery

SQLite migrations run before workers. A database lock prevents a second active worker. Checkpoints include block number and hash; a restart re-proves the latest checkpoint before ingesting and freezes state on unverifiable evidence. There is no transactional outbox: every transaction commits synchronously inside the single writer, so there is no background fan-out to resume. Obsolete `PENDING` intents expire on their next execution attempt (`INTENT_EXPIRED`); there is no sweeper. Unique business keys (`order_intents.evaluation_id`, `order_intents.idempotency_key`, `orders.intent_id`, `fills.order_id`, `ledger_entries.business_key`) make replays read-only.

