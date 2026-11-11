# Security

## Phase 1 boundary

- Modes are a closed set: `OBSERVE | PAPER`; any other value fails startup.
- viem uses a public client only. Wallet clients, private-key accounts, signing, and `eth_send*` are forbidden.
- RPC URL stays server-side, must be HTTPS, and chain identity must be 4663.
- The app binds to `127.0.0.1` by default and must not be exposed publicly without validated authentication, TLS, CSRF protection, and rate limits.

## Required controls

- Persisted backend kill switch checked before worker startup and before each new entry.
- Append-only audit events with correlation IDs and redacted payloads.
- Structured error envelopes; no stack trace or internal RPC URL in browser responses.
- Lockfile, frozen installs, dependency review, secret scanning, and no remote installer scripts.
- Non-root, read-only container with dropped capabilities when a container runtime is available.

## Release blockers

- Any signing/send code, private-key configuration, or environment-only live activation.
- Chain mismatch accepted as healthy.
- Stale/unavailable data allowed to create an entry.
- Duplicate order/fill/ledger effects.
- Missing audit trail or exposed secret.

