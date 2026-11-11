import { nowIso, type Db } from './index.js';

const LOCK_KEY = 'worker_instance';

export class InstanceLockError extends Error {
  constructor(holder: string) {
    super(`Another TRIDENT worker is already active (pid ${holder}); refusing to start a second one`);
    this.name = 'InstanceLockError';
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Single-writer guard. A second process that finds a live pid fails to boot,
 * which keeps the chain cursor and ledger single-owner.
 */
export function acquireInstanceLock(db: Db, pid = process.pid): void {
  const row = db.prepare('SELECT value FROM automation_state WHERE key = ?').get(LOCK_KEY) as { value: string } | undefined;
  if (row) {
    const holder = Number(row.value);
    if (Number.isFinite(holder) && holder !== pid && isAlive(holder)) {
      throw new InstanceLockError(String(holder));
    }
  }
  db.prepare(
    'INSERT INTO automation_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(LOCK_KEY, String(pid), nowIso());
}

export function releaseInstanceLock(db: Db, pid = process.pid): void {
  const row = db.prepare('SELECT value FROM automation_state WHERE key = ?').get(LOCK_KEY) as { value: string } | undefined;
  if (row && Number(row.value) === pid) {
    db.prepare('DELETE FROM automation_state WHERE key = ?').run(LOCK_KEY);
  }
}