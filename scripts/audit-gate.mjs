#!/usr/bin/env node
/**
 * Dependency security gate for CI.
 *
 * Runs `pnpm audit --prod --json`, then fails the job when a high or critical
 * advisory affects production dependencies and is not covered by a tracked,
 * time-boxed entry in .github/audit-allowlist.json.
 *
 * Design rules:
 * - Fail closed: an unreadable or unparsable audit result fails the gate.
 * - Fail on unknown risk: only advisories listed by id are tolerated.
 * - Expire trust: an allowlist entry past its `expires` date fails the gate.
 * - No silent rot: an allowlist entry that no longer matches any advisory is
 *   reported as stale so it gets deleted, but does not fail the build (the
 *   advisory it covers may have been fixed by another branch first).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowlistPath = join(repoRoot, '.github', 'audit-allowlist.json');

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function loadAllowlist() {
  let raw;
  try {
    raw = readFileSync(allowlistPath, 'utf8');
  } catch {
    // Missing allowlist is not an error: it just means nothing is tolerated.
    return { entries: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return { entries };
  } catch (error) {
    fail(`Cannot parse ${allowlistPath}: ${error.message}`);
  }
}

function runAudit() {
  // `pnpm audit` exits non-zero when it finds advisories; the exit code is
  // therefore not a reliable signal. Parse stdout instead.
  const result = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });

  const stdout = (result.stdout ?? '').trim();
  const stderr = (result.stderr ?? '').trim();

  if (!stdout) {
    fail(`pnpm audit produced no JSON output. stderr: ${stderr || '(empty)'}`);
  }

  try {
    return JSON.parse(stdout);
  } catch {
    // Tolerate a non-JSON banner before the document.
    const start = stdout.indexOf('{');
    if (start !== -1) {
      try {
        return JSON.parse(stdout.slice(start));
      } catch {
        /* fall through */
      }
    }
    fail(`pnpm audit output is not valid JSON. stderr: ${stderr || '(empty)'}`);
  }
}

/** Normalise the two shapes pnpm has produced for `audit --json`. */
function collectAdvisories(report) {
  const advisories = [];

  if (report && typeof report === 'object' && report.advisories) {
    for (const [id, info] of Object.entries(report.advisories)) {
      advisories.push({
        id: String(id),
        advisory: info?.github_advisory_id ?? `npm-${id}`,
        package: info?.module_name ?? 'unknown',
        severity: String(info?.severity ?? 'unknown').toLowerCase(),
        title: info?.title ?? '',
        vulnerable: info?.vulnerable_versions ?? '',
        patched: info?.patched_versions ?? '',
        url: info?.url ?? info?.references?.split?.('\n')?.[0] ?? '',
      });
    }
    return advisories;
  }

  if (Array.isArray(report)) {
    for (const info of report) {
      advisories.push({
        id: String(info?.id ?? info?.github_advisory_id ?? 'unknown'),
        advisory: info?.github_advisory_id ?? String(info?.id ?? 'unknown'),
        package: info?.module_name ?? 'unknown',
        severity: String(info?.severity ?? 'unknown').toLowerCase(),
        title: info?.title ?? '',
        vulnerable: info?.vulnerable_versions ?? '',
        patched: info?.patched_versions ?? '',
        url: info?.url ?? '',
      });
    }
  }

  return advisories;
}

function isExpired(entry, today) {
  if (!entry.expires) return false;
  const expiry = new Date(`${entry.expires}T23:59:59Z`);
  if (Number.isNaN(expiry.getTime())) return true; // unusable date fails closed
  return expiry.getTime() < today.getTime();
}

function matchingEntry(entries, advisory) {
  return entries.find((entry) => {
    const idMatches =
      entry.advisory &&
      (entry.advisory === advisory.advisory || entry.advisory === advisory.id);
    const packageMatches = !entry.package || entry.package === advisory.package;
    return Boolean(idMatches) && packageMatches;
  });
}

function main() {
  const today = new Date();
  const { entries } = loadAllowlist();
  const report = runAudit();
  const advisories = collectAdvisories(report);
  const blocking = [];
  const tolerated = [];
  const usedEntries = new Set();

  for (const advisory of advisories) {
    if (!BLOCKING_SEVERITIES.has(advisory.severity)) continue;

    const entry = matchingEntry(entries, advisory);
    if (!entry) {
      blocking.push({ advisory, reason: 'not in .github/audit-allowlist.json' });
      continue;
    }
    usedEntries.add(entry);
    if (isExpired(entry, today)) {
      blocking.push({
        advisory,
        reason: `allowlist entry expired on ${entry.expires} (tracking: ${entry.tracking ?? 'n/a'})`,
      });
      continue;
    }
    tolerated.push({ advisory, entry });
  }

  const counts = advisories.reduce((acc, item) => {
    acc[item.severity] = (acc[item.severity] ?? 0) + 1;
    return acc;
  }, {});

  console.log('Dependency audit (production dependencies)');
  console.log(
    `  advisories: ${advisories.length}` +
      (advisories.length > 0
        ? ` (${Object.entries(counts)
            .map(([severity, count]) => `${severity}: ${count}`)
            .join(', ')})`
        : ''),
  );
  console.log(`  blocking severity: high, critical`);
  console.log(`  allowlisted entries: ${entries.length}`);

  for (const { advisory, entry } of tolerated) {
    console.log(
      `  TOLERATED ${advisory.advisory} ${advisory.package}@${advisory.vulnerable}` +
        ` until ${entry.expires} (${entry.tracking ?? 'no tracking link'})`,
    );
  }

  for (const entry of entries) {
    if (!usedEntries.has(entry)) {
      console.log(
        `::notice::Stale allowlist entry ${entry.advisory} no longer matches any production advisory; remove it from .github/audit-allowlist.json.`,
      );
    }
  }

  if (blocking.length > 0) {
    for (const { advisory, reason } of blocking) {
      console.error(
        `::error::${advisory.severity.toUpperCase()} ${advisory.advisory} ` +
          `${advisory.package} (${advisory.vulnerable} -> fix ${advisory.patched || 'unknown'}): ` +
          `${advisory.title || 'advisory'} [${reason}] ${advisory.url}`,
      );
    }
    fail(`${blocking.length} blocking dependency advisor${blocking.length === 1 ? 'y' : 'ies'} found.`);
  }

  console.log('PASS: no unapproved high or critical production advisories.');
}

main();