# TRIDENT

TRIDENT is a Robinhood Chain paper-trading system. The first vertical slice observes verified WETH/USDG Uniswap v3 market data, produces deterministic decisions, applies a fail-closed risk gate, records simulated orders and portfolio state, and presents truthful operational status in a responsive web UI.

## Safety boundary

- Execution modes are limited to `OBSERVE` and `PAPER`.
- No signer, private key, wallet client, or transaction-send method is part of the Phase 1 application.
- Live trading remains out of scope until a separate, explicit CEO approval and security gate.

## Verified network facts

- Robinhood Chain mainnet chain ID: `4663`
- Public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Verified Uniswap v3 WETH/USDG pool (0.01%): `0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca`
- The public RPC is polling-only and non-archive; historical state is available only near the chain head.

See [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), and [TESTING.md](TESTING.md) before implementation.

