# Deployment

The current sandbox has Node.js 24, pnpm, Git, 4 vCPU, about 7.8 GiB RAM, and 24 GiB free disk. It does not have Docker/Podman, `gh`, or the sqlite3 CLI, so container-hardening checks and Compose execution are currently unverified.

The application must use a persistent data directory outside disposable layers. Default host binding is loopback. A future container must run as UID 10001, use a read-only root filesystem and tmpfs, drop all capabilities, set `no-new-privileges`, omit the Docker socket and host networking, and expose no live-signing profile.

Backups use the SQLite backup API to a separate durable location with checksum and a documented restore drill. Deployment outside the sandbox requires explicit authorization.

