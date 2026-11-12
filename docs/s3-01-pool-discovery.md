# S3-01 — Verified on-chain pool discovery

Discovers Uniswap v3 `PoolCreated` events from the verified Robinhood Chain
factory and exposes them, read-only, through the S3-02 Discover registry.
PAPER only; no execution path reads from `discovered_pools`.

## Event layout (corrected, verified live)

`PoolCreated` is declared with `token0`, `token1` and `fee` **indexed**:

```
topic0 = keccak256("PoolCreated(address,address,uint24,int24,address)")
       = 0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118
topics = [topic0, token0 (padded), token1 (padded), fee (uint24)]
data   = tickSpacing (int24, 32 bytes) || pool (address, 32 bytes, left-padded)
```

This matches the real log at block `112297142` (`fee` in topic3 = `0x2710` = 10000,
`tickSpacing` = `0x00c8` = 200 — the standard Uniswap fee↔tickSpacing pairing).

## Registry contract with S3-02 (fixed)

S3-02 reads `discovered_pools` read-only via introspection; S3-01 writes it.
No overlap in code: S3-01 owns `discovered_pools` + `discovery_checkpoints`,
S3-02 owns `watchlist_entries` + `pool_market_snapshots`.

Columns are contractual; a mismatch fails closed on the S3-02 side.

## Architecture

- `chain/poolCodec.ts` — pure decode/validate of `PoolCreated` logs; exports the
  pinned factory address, expected bytecode `keccak256` and `topic0`.
- `services/discovery.ts` — one discovery tick: factory verification (code size +
  bytecode hash, once per process), checkpoint resume/repair, bounded getLogs
  scan, row validation + idempotent insert, audit.
- `services/discoveryWorker.ts` — 30 s polling, `timer.unref()`, never lets a
  discovery failure touch the execution path; on factory mismatch the discovery
  path goes dark for the process lifetime.
- `db/discoveryRepositories.ts` — checkpoint + rows I/O; `ON CONFLICT DO NOTHING`
  everywhere; rewind deletes rows at/above a proven divergence block.

### Checkpoint and resume

`discovery_checkpoints` (singleton): `from_block`, `to_block`, `block_hash`.
First run scans a bounded `DISCOVERY_LOOKBACK_BLOCKS` lookback (default 2000,
aim: seed once, then cheap steady-state polls). On restart, the stored hash at
`to_block` is re-read; mismatch → proven same-height replacement → rewind.
`blockHash` fills on first successful read of the stored tip after restart.

### Reorg semantics (freeze vs rewind)

- **Freeze (UNAVAILABLE)** when the checkpoint block cannot be re-read or the
  head regresses below it — rows stay, ingest stops, one audit row per ongoing
  incident (`discovery.frozen`), no deletions.
- **Rewind** only on proven replacement: same-height hash mismatch vs the
  stored `block_hash`. Deletes rows with `first_seen_block >= divergenceBlock`,
  re-anchors the checkpoint one block lower, audits addresses.

### Bounds and fail-closed behavior

- `eth_getLogs` chunks of 200 blocks (cap 500); on the 10,000-log cap error,
  halving 200 → 100 → 25, then range `UNAVAILABLE` — never an unbounded loop.
- Logs (not state) are retained far beyond the state window; the discovery gap
  sanity bound is 100,000 blocks, not the 5,000-block state bound.
- ERC-20 `symbol`/`decimals` read failures, empty/>64-char symbols, decimals
  outside `0..255`, `token0 >= token1`, fee not in `{100, 500, 3000, 10000}`,
  `tickSpacing <= 0` ⇒ row skipped + counted (`registrySkipped` via S3-02
  introspection, `skippedRows` in audit). Never a 500, never fabricated.
- Factory bytecode mismatch at process start ⇒ discovery dark until restart;
  PAPER execution unaffected.
- Discovered pools are **non-actionable**: the intents path rejects any
  evaluation whose snapshot pool is not the verified allowlist pool (422).

## Known limits

- Initial seed scan is bounded by `DISCOVERY_LOOKBACK_BLOCKS` (default 2000);
  much older events require an explicit larger value or will be discovered
  incrementally on subsequent polls.
- The discovery port binds `ChainClient`'s guarded fetch; no new RPC path.
- Volume and "is this pool relevant" are not discovery concerns — S3-02.
- Live destructive reorg drill not executed (synthetic fixtures only).

## Evidence

See the PR description and `docs/qa/` for captured runs. Real-RPC tests live in
`test/discovery-rpc.test.ts`, gated `RUN_RPC_TESTS=1`, never in CI.
