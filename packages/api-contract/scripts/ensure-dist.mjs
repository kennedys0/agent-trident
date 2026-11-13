import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The web and API apps import `@trident/api-contract` from its built
 * `dist`. In development that `dist` can be missing, or older than `src`,
 * and the app then fails at import time with a confusing
 * "does not provide an export named ..." error instead of a clear message.
 *
 * `ensure-dist` builds the package when the output is missing or stale.
 */
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const distEntry = join(packageRoot, 'dist', 'index.js');
const sourceDir = join(packageRoot, 'src');
const repoRoot = join(packageRoot, '..', '..');
const lockDir = join(tmpdir(), 'trident-api-contract-build.lock');

/** Newest modification time under `directory`, or 0 when it cannot be read. */
export function newestMtime(directory) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(path));
    } else {
      newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}

/** True when `dist` is missing or older than the newest file in `src`. */
export function isDistStale(distEntryPath = distEntry, sourceDirectory = sourceDir) {
  let distTime;
  try {
    distTime = statSync(distEntryPath).mtimeMs;
  } catch {
    return true;
  }
  return newestMtime(sourceDirectory) > distTime;
}

/** Blocking sleep; the wait is short and this only runs in dev tooling. */
function sleep(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

/**
 * Builds the contract package when needed. A lock directory keeps two
 * concurrent `dev` processes from writing `dist` at the same time.
 */
export function ensureDist(options = {}) {
  if (!options.force && !isDistStale()) {
    return;
  }

  try {
    mkdirSync(lockDir, { recursive: false });
  } catch {
    // Another process is building. Wait for its output, then trust it.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (!isDistStale()) {
        return;
      }
      sleep(250);
    }
    throw new Error('Timed out waiting for @trident/api-contract to build.');
  }

  try {
    execFileSync('pnpm', ['--filter', '@trident/api-contract', 'build'], {
      stdio: 'inherit',
      cwd: repoRoot,
    });
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('ensure-dist.mjs')) {
  ensureDist({ force: process.argv.includes('--force') });
}
