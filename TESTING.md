# Testing

Tests report `VERIFIED`, `FAIL`, `BLOCKED`, or `UNVERIFIED`; fixture-only evidence cannot satisfy a real-network acceptance check.

## Priority gates

1. Real RPC reports chain ID 4663; a mismatched chain fails closed.
2. Backend block data matches a raw, timestamped RPC response.
3. Verified factory/pool/token code and identities match the allowlist.
4. Same snapshot and config produce identical strategy output and input hash.
5. Boundary and stale fixtures are rejected by risk; no order row exists.
6. Approved PAPER intent produces exactly one simulated order/fill and no transaction send.
7. Buy/sell accounting balances in integer base units.
8. Restart and replay create no duplicate intent, fill, or ledger effect.
9. API loss, RPC outage, and stale data appear truthfully in the UI.
10. UI passes 320/375/768/1024/1280 checks, light/dark, keyboard, focus, and no overflow.
11. Static and runtime scans prove live trading is disabled.

Evidence belongs in CI artifacts: commit SHA, lock hash, UTC times, redacted raw logs, RPC/API captures, immutable fixture hashes, read-only DB extracts, screenshots/traces, and JUnit results.

