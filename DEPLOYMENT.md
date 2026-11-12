# Deployment

There is no deployment today. This document states the binding constraints, not an
offer to deploy.

## Current environment (repository baseline)

- Node.js 24, pnpm 9.12.3 (pinned in `package.json`), Git.
- No Docker/Podman is available to validate a container manifest, and no Compose
  file or CI deployment is committed. A deterministic CI pipeline is an open PR
  (Sprint 2, S2-02); it is not a deployment and it is not merged yet.
- The application binds `127.0.0.1` by default. Do not expose it to any network
  you do not control.

## Hard requirements before any non-loopback exposure

- Persistent data directory outside disposable layers; database on local disk
  with WAL, not on NFS/overlay.
- Single instance only; the pid/`automation_state` lock is advisory — SQLite is
  the real guard. Never run two writers.
- Container: non-root UID 10001, read-only root filesystem, tmpfs for writable
  scratch, `cap_drop: ALL`, `no-new-privileges`, no Docker socket, no host
  network, resource limits, one persistent volume for `DATABASE_PATH`.
- Authentication (single-admin) with HttpOnly/Secure/SameSite=Strict cookie,
  CSRF/Origin checks, rate limiting, explicit body limit, TLS at a proxy.
- RPC: HTTPS only, hostname allowlist, chain ID 4663 asserted at boot and at
  read time, timeout/backoff/circuit breaking. No credentials in the repo,
  logs, browser bundle, or API errors; secrets are injected at runtime only.
- Backups: SQLite backup API (or `VACUUM INTO`) to a separate durable location,
  with checksum and a documented restore drill; retention and encryption
  decided by the CEO. RPO/RTO undecided.
- Observability that does not leak RPC URLs or secrets.
- `EXECUTION_MODE` must stay `OBSERVE` or `PAPER`. `LIVE` fails boot by design
  and no signing code exists at all.

## Halt semantics (operator-critical)

The kill switch (`new_entries_halted`) persists across restart. The cause is
persisted next to it in `new_entries_halted_reason` and exposed at
`GET /health` in `meta.haltReason`:

- `OPERATOR` — the operator engaged the halt.
- `CHAIN_REORG` — a confirmed chain reorg rewound chain-derived rows.
- `CHAIN_EVIDENCE_UNAVAILABLE` — the provider could not prove the checkpoint
  either way; data is frozen, nothing deleted, and the halt waits for a
  verified canonical read plus explicit operator release.

None of these auto-release. A `CHAIN_REORG` or `CHAIN_EVIDENCE_UNAVAILABLE`
halt means **do not resume entries**; investigate first.

## Backup and recovery (untested)

No backup/restore drill has been executed. Until one passes, treat the
database as the only copy of simulated state; do not delete it.

## Status and approvals

Deployment beyond loopback requires explicit CEO authorization. Until that
exists, this is a local PAPER tool. See [SECURITY.md](SECURITY.md) for the
threat model and [ROADMAP.md](ROADMAP.md) for what is and is not scheduled.
