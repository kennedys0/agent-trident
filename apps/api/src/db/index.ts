import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations.js';

export type Db = DatabaseSync;

export type OpenDatabaseOptions = { readonly applyMigrations?: boolean };

/**
 * Opens the SQLite database in WAL mode and applies pending migrations.
 * Migrations are tracked so a restart never re-applies a committed change.
 */
export function openDatabase(path: string, options: OpenDatabaseOptions = {}): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  if (options.applyMigrations !== false) applyMigrations(db);
  return db;
}

export function applyMigrations(db: Db): void {
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((row) => row.version),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

const openTransactions = new WeakSet<Db>();

/**
 * Runs work inside a single immediate transaction; any throw rolls back.
 * Nested calls join the open transaction so a service can be composed inside a
 * larger unit of work without splitting entity and audit writes apart.
 */
export function withTransaction<T>(db: Db, work: () => T): T {
  if (openTransactions.has(db)) return work();
  db.exec('BEGIN IMMEDIATE');
  openTransactions.add(db);
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    openTransactions.delete(db);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}