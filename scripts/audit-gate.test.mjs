#!/usr/bin/env node
/**
 * Executable proof for the fail-closed paths in scripts/audit-gate.mjs.
 *
 * Run with: node --test scripts/audit-gate.test.mjs
 *
 * Two layers:
 * - unit: parse/evaluate functions, with a pinned clock;
 * - cli: the real entry point, spawned with fixture inputs, asserting exit
 *   codes so a regression in the wiring cannot pass silently.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateGate, isValidDate, parseAllowlist, parseAuditReport } from './audit-gate.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'audit-gate.mjs');

function auditReport(advisories = {}, vulnerabilities = {}) {
  return {
    actions: [],
    advisories,
    muted: [],
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        ...vulnerabilities,
      },
    },
  };
}

const zodAdvisory = {
  github_advisory_id: 'GHSA-mrhx-c7xc-m3w5',
  module_name: 'zod',
  severity: 'high',
  title: 'Zod can exhaust memory while validating oversized constrained collections',
  vulnerable_versions: '<4.6.6',
  patched_versions: '>=4.6.6',
  url: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5',
};

const validEntry = {
  advisory: 'GHSA-mrhx-c7xc-m3w5',
  package: 'zod',
  severity: 'high',
  reason: 'tracked by the dependency upgrade workstream',
  tracking: 'https://github.com/kennedys0/agent-trident/issues/12',
  expires: '2026-12-12',
};

function entry(overrides) {
  return { ...validEntry, ...overrides };
}

function allowlistText(entries) {
  return JSON.stringify({ description: 'test', entries });
}

// --- report shape -----------------------------------------------------------

test('a top-level audit error is a problem, not an empty clean report', () => {
  const { advisories, problems } = parseAuditReport({
    error: { code: 'ERR_PNPM_AUDIT_NO_LOCKFILE', message: 'No pnpm-lock.yaml found' },
  });
  assert.equal(advisories.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ERR_PNPM_AUDIT_NO_LOCKFILE|No pnpm-lock/);
});

test('a string top-level audit error is also a problem', () => {
  const { problems } = parseAuditReport({ error: 'registry unreachable' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /registry unreachable/);
});

test('an unknown report shape fails instead of reading as zero advisories', () => {
  const { problems } = parseAuditReport({ something: 'else' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /advisories/);
});

test('a non-object report fails', () => {
  assert.equal(parseAuditReport(null).problems.length, 1);
  assert.equal(parseAuditReport('{}').problems.length, 1);
});

test('a genuinely clean report is accepted with zero advisories', () => {
  const { advisories, problems } = parseAuditReport(auditReport());
  assert.deepEqual(problems, []);
  assert.equal(advisories.length, 0);
});

test('a summary claiming high vulnerabilities without advisory objects fails', () => {
  const { problems } = parseAuditReport(auditReport({}, { high: 2 }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /claims 2 high\/critical/);
});

// --- allowlist schema -------------------------------------------------------

test('an allowlist entry without expires fails (no permanent exceptions)', () => {
  const { expires, ...withoutExpiry } = validEntry;
  const { problems } = parseAllowlist(allowlistText([withoutExpiry]));
  assert.ok(problems.some((p) => /entries\[0\]\.expires is required/.test(p)), problems.join('; '));
});

test('an allowlist entry with an impossible date fails', () => {
  const { problems } = parseAllowlist(allowlistText([entry({ expires: '2026-02-31' })]));
  assert.ok(problems.some((p) => /real calendar date/.test(p)), problems.join('; '));
});

test('an allowlist entry with a non-ISO date fails', () => {
  const { problems } = parseAllowlist(allowlistText([entry({ expires: '12/12/2026' })]));
  assert.ok(problems.some((p) => /real calendar date/.test(p)), problems.join('; '));
});

test('an allowlist entry without tracking fails', () => {
  const { problems } = parseAllowlist(allowlistText([entry({ tracking: '' })]));
  assert.ok(problems.some((p) => /tracking is required/.test(p)), problems.join('; '));
});

test('an allowlist entry with a non-URL tracking value fails', () => {
  const { problems } = parseAllowlist(allowlistText([entry({ tracking: 'issue 12' })]));
  assert.ok(problems.some((p) => /tracking must be an http\(s\) URL/.test(p)), problems.join('; '));
});

test('an allowlist entry without advisory or package fails', () => {
  const { problems } = parseAllowlist(allowlistText([entry({ advisory: '', package: '' })]));
  assert.ok(problems.some((p) => /advisory is required/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /package is required/.test(p)), problems.join('; '));
});

test('an allowlist without an entries array fails', () => {
  assert.equal(parseAllowlist('{}').problems.length, 1);
  assert.equal(parseAllowlist('not json').problems.length, 1);
  assert.equal(parseAllowlist('').problems.length, 1);
});

test('a valid allowlist passes schema validation', () => {
  const { entries, problems } = parseAllowlist(allowlistText([validEntry]));
  assert.deepEqual(problems, []);
  assert.equal(entries.length, 1);
});

test('date validation accepts leap days and rejects shifted ones', () => {
  assert.equal(isValidDate('2028-02-29'), true);
  assert.equal(isValidDate('2026-02-29'), false);
  assert.equal(isValidDate('2026-12-12'), true);
});

// --- gate decision ----------------------------------------------------------

function parsed(advisories = [zodAdvisory]) {
  const report = auditReport(
    Object.fromEntries(advisories.map((a, i) => [String(i + 1), a])),
  );
  return parseAuditReport(report).advisories;
}

const pinnedToday = new Date('2026-11-12T00:00:00Z');

test('an unlisted high advisory blocks', () => {
  const { blocking, tolerated } = evaluateGate({
    advisories: parsed(),
    entries: [],
    today: pinnedToday,
  });
  assert.equal(blocking.length, 1);
  assert.equal(tolerated.length, 0);
  assert.match(blocking[0].reason, /not in/);
});

test('a matching live entry is tolerated, not blocking', () => {
  const entries = parseAllowlist(allowlistText([validEntry])).entries;
  const { blocking, tolerated, stale } = evaluateGate({
    advisories: parsed(),
    entries,
    today: pinnedToday,
  });
  assert.equal(blocking.length, 0);
  assert.equal(tolerated.length, 1);
  assert.equal(stale.length, 0);
});

test('an expired entry blocks even though it matches', () => {
  const entries = parseAllowlist(allowlistText([entry({ expires: '2026-01-01' })])).entries;
  const { blocking, tolerated } = evaluateGate({
    advisories: parsed(),
    entries,
    today: pinnedToday,
  });
  assert.equal(blocking.length, 1);
  assert.equal(tolerated.length, 0);
  assert.match(blocking[0].reason, /expired on 2026-01-01/);
});

test('an entry for another package does not tolerate the advisory', () => {
  const entries = parseAllowlist(allowlistText([entry({ package: 'left-pad' })])).entries;
  const { blocking } = evaluateGate({ advisories: parsed(), entries, today: pinnedToday });
  assert.equal(blocking.length, 1);
});

test('an entry that matches nothing is reported as stale, not blocking', () => {
  const entries = parseAllowlist(allowlistText([validEntry])).entries;
  const { blocking, tolerated, stale } = evaluateGate({
    advisories: [],
    entries,
    today: pinnedToday,
  });
  assert.equal(blocking.length, 0);
  assert.equal(tolerated.length, 0);
  assert.equal(stale.length, 1);
});

test('low and moderate advisories do not block', () => {
  const low = { ...zodAdvisory, github_advisory_id: 'GHSA-low', severity: 'low' };
  const { blocking } = evaluateGate({ advisories: parsed([low]), entries: [], today: pinnedToday });
  assert.equal(blocking.length, 0);
});

// --- cli exit codes ---------------------------------------------------------

function runGate({ report, allowlist }) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-gate-'));
  const reportPath = join(dir, 'audit.json');
  const allowlistPath = join(dir, 'allowlist.json');
  writeFileSync(reportPath, typeof report === 'string' ? report : JSON.stringify(report));
  writeFileSync(allowlistPath, allowlist);
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AUDIT_JSON_FILE: reportPath,
      AUDIT_ALLOWLIST_FILE: allowlistPath,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('CLI: an audit error report exits 1', () => {
  const result = runGate({
    report: { error: { code: 'ERR_PNPM_AUDIT_NO_LOCKFILE', message: 'No lockfile' } },
    allowlist: allowlistText([]),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ERR_PNPM_AUDIT_NO_LOCKFILE/);
});

test('CLI: unparsable audit output exits 1', () => {
  const result = runGate({ report: 'not json at all', allowlist: allowlistText([]) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not valid JSON/);
});

test('CLI: an allowlist entry without expires exits 1', () => {
  const { expires, ...withoutExpiry } = validEntry;
  const result = runGate({ report: auditReport(), allowlist: allowlistText([withoutExpiry]) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /expires is required/);
});

test('CLI: an unknown high advisory exits 1', () => {
  const result = runGate({
    report: auditReport({ 1: zodAdvisory }, { high: 1 }),
    allowlist: allowlistText([]),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GHSA-mrhx-c7xc-m3w5/);
});

test('CLI: a tracked, unexpired entry exits 0 and prints TOLERATED', () => {
  const result = runGate({
    report: auditReport({ 1: zodAdvisory }, { high: 1 }),
    allowlist: allowlistText([validEntry]),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TOLERATED GHSA-mrhx-c7xc-m3w5/);
});

test('CLI: a stale entry exits 0 and prints a notice', () => {
  const result = runGate({
    report: auditReport(),
    allowlist: allowlistText([validEntry]),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /::notice::Stale allowlist entry/);
});