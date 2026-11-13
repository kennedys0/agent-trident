import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isDistStale, newestMtime } from '../scripts/ensure-dist.mjs';

/**
 * The dev-server bug this guards: `@trident/api-contract` is imported from its
 * built `dist`, and a missing or stale `dist` makes the app fail at import
 * time with a confusing "does not provide an export named ..." error.
 */
test('a missing dist counts as stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'trident-contract-stale-'));
  try {
    const source = join(root, 'src');
    mkdirSync(source);
    writeFileSync(join(source, 'domain.ts'), 'export const a = 1;\n');
    assert.equal(isDistStale(join(root, 'dist', 'index.js'), source), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dist older than its sources counts as stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'trident-contract-stale-'));
  try {
    const source = join(root, 'src');
    mkdirSync(source);
    writeFileSync(join(source, 'domain.ts'), 'export const a = 1;\n');
    const dist = join(root, 'dist');
    mkdirSync(dist);
    const distEntry = join(dist, 'index.js');
    writeFileSync(distEntry, 'export const a = 1;\n');
    const old = new Date('2020-01-01T00:00:00Z');
    const recent = new Date(Date.now() + 60_000);
    utimesSync(distEntry, old, old);
    utimesSync(join(source, 'domain.ts'), recent, recent);
    assert.equal(isDistStale(distEntry, source), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dist newer than its sources is not stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'trident-contract-stale-'));
  try {
    const source = join(root, 'src');
    mkdirSync(source);
    writeFileSync(join(source, 'domain.ts'), 'export const a = 1;\n');
    const dist = join(root, 'dist');
    mkdirSync(dist);
    const distEntry = join(dist, 'index.js');
    writeFileSync(distEntry, 'export const a = 1;\n');
    const old = new Date('2020-01-01T00:00:00Z');
    const recent = new Date(Date.now() + 60_000);
    utimesSync(join(source, 'domain.ts'), old, old);
    utimesSync(distEntry, recent, recent);
    assert.equal(isDistStale(distEntry, source), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('newestMtime reports the most recent file in a tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'trident-contract-mtime-'));
  try {
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'nested', 'b.ts'), 'x\n');
    writeFileSync(join(root, 'a.ts'), 'x\n');
    const recent = new Date(Date.now() + 60_000);
    utimesSync(join(root, 'nested', 'b.ts'), recent, recent);
    assert.equal(newestMtime(root) > 0, true);
    assert.equal(newestMtime(join(root, 'missing')), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
