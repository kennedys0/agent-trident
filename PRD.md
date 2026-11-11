# Product Requirements — Vertical Slice

Status: Approved by the project prompt on 2026-11-11.

## Problem

The operator needs a truthful, auditable way to observe Robinhood Chain market data and evaluate a constrained paper trade without exposing funds. A dashboard without real chain provenance, deterministic decisions, backend risk enforcement, and persistent accounting would create false confidence.

## In scope

- Verify Robinhood Chain mainnet identity and retrieve current block data.
- Observe the verified Uniswap v3 WETH/USDG 0.01% pool.
- Produce a block-pinned market snapshot with provenance and freshness state.
- Evaluate one deterministic strategy and enforce a fail-closed risk policy.
- Simulate paper orders and persist an auditable portfolio journal.
- Show actual system, market, decision, risk, and paper-portfolio states in a responsive neo-brutalist UI.

## Out of scope

- Live or testnet transaction signing and submission.
- Unverified tokens, pools, routers, or market-data providers.
- Multi-chain support, leverage, lending, bridges, tokenized securities, and AI trade signals.
- Profitability claims and fabricated historical performance.

## Done when

1. The app rejects a non-4663 RPC and reports real block provenance from chain 4663.
2. One WETH/USDG observation reaches strategy, risk, paper execution, persistence, and UI with correlated IDs and no signing path.
3. Restart/replay does not duplicate orders or ledger effects; stale or unavailable data cannot produce a new entry.

## First deliverable

One PAPER-only WETH/USDG vertical slice using the verified pool and QuoterV2, with truthful empty/error/stale behavior.

## Defaults selected for the reversible prototype

- Quote asset: USDG.
- Opening paper cash: 10,000 USDG (10,000,000,000 base units), labeled simulated.
- Market freshness: 30 seconds.
- One open position maximum; maximum position allocation 5%; minimum observed pool balances are not treated as a price oracle.
- Strategy initially returns `WAIT` unless all required inputs are complete and fresh.

