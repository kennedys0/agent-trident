#!/usr/bin/env node
/**
 * Dependency security gate for CI.
 *
 * Runs `pnpm audit --prod --json`, then fails the job when a high or critical
 * advisory affects production dependencies and is not covered by a tracked,
 * time-boxed entry in .github/audit-allowlist.json.
 *
 * Design rules:
 * - Fail closed: an unreadable audit result, an error report, or an unknown
 *   report shape fails the gate. "No advisories key" is never read as clean.
 * - Fail on unknown risk: only advisories listed by id are tolerated.
 * - Validate the allowlist: every entry needs advisory, package, tracking URL,
 *   and a real expiry date. A malformed entry fails the gate instead of
 *   silently becoming a permanent exception.
 * - Expire trust: an allowlist entry past its `expires` date fails the gate.
 * - No silent rot: an allowlist entry that no longer matches any advisory is
 *   reported as stale so it gets deleted, but does not fail the build (the
 *   advisory it covers may have been fixed by another branch first).
 *
 * The parsing and evaluation functions are exported so
 * scripts/audit-gate.test.mjs can prove the fail-closed paths.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const REQUIRED_ENTRY_FIELDS = ['advisory', 'package', 'tracking', 'expires'];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strict YYYY-MM-DD that also exists in the calendar (rejects 2026-02-31). */
export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validate the allowlist document. Returns `{ entries, problems }`; a
 * non-empty `problems` means the gate must fail, never ignore the file.
 */
export function parseAllowlist(text) {
  const problems = [];

  if (typeof text !== 'string' || text.trim() === '') {
    return { entries: [], problems: ['allowlist file is empty or unreadable'] };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { entries: [], problems: [`allowlist is not valid JSON: ${error.message}`] };
  }

  if (!isPlainObject(parsed)) {
    return { entries: [], problems: ['allowlist root must be a JSON object'] };
  }
  if (!Array.isArray(parsed.entries)) {
    return { entries: [], problems: ['allowlist must contain an "entries" array'] };
  }

  const entries = [];

  parsed.entries.forEach((entry, index) => {
    const where = `entries[${index}]`;
    if (!isPlainObject(entry)) {
      problems.push(`${where} must be an object`);
      return;
    }

    for (const field of REQUIRED_ENTRY_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        problems.push(`${where}.${field} is required and must be a non-empty string`);
      }
    }

    if (typeof entry.tracking === 'string' && entry.tracking.trim() !== '') {
      if (!/^https?:\/\/\S+$/i.test(entry.tracking)) {
        problems.push(`${where}.tracking must be an http(s) URL`);
      }
    }

    if (typeof entry.expires === 'string' && entry.expires.trim() !== '') {
      if (!isValidDate(entry.expires)) {
        problems.push(`${where}.expires must be a real calendar date formatted YYYY-MM-DD`);
      }
    }

    if (entry.severity !== undefined && entry.severity !== null) {
      if (!BLOCKING_SEVERITIES.has(String(entry.severity).toLowerCase())) {
        problems.push(`${where}.severity, when present, must be "high" or "critical"`);
      }
    }

    entries.push(entry);
  });

  return { entries, problems };
}

/**
 * Validate the parsed audit report and normalise it into advisories.
 * Returns `{ advisories, problems }`. A report with a top-level `error` or an
 * unrecognised shape is a failure, not an empty result.
 */
export function parseAuditReport(report) {
  const problems = [];

  if (!isPlainObject(report) && !Array.isArray(report)) {
    return { advisories: [], problems: ['audit report is not a JSON object or array'] };
  }

  if (isPlainObject(report) && report.error !== undefined && report.error !== null) {
    let detail;
    if (typeof report.error === 'string') {
      detail = report.error;
    } else if (isPlainObject(report.error)) {
      detail = [report.error.code, report.error.message].filter(Boolean).join(': ') ||
        JSON.stringify(report.error);
    } else {
      detail = JSON.stringify(report.error);
    }
    return { advisories: [], problems: [`pnpm audit reported an error: ${detail}`] };
  }

  const advisories = [];

  if (isPlainObject(report)) {
    if (!isPlainObject(report.advisories)) {
      return {
        advisories: [],
        problems: [
          'audit report has no "advisories" object; refusing to read an unknown shape as clean',
        ],
      };
    }

    for (const [id, info] of Object.entries(report.advisories)) {
      if (!isPlainObject(info)) {
        problems.push(`advisory ${id} is not an object`);
        continue;
      }
      advisories.push({
        id: String(id),
        advisory: info.github_advisory_id ?? `npm-${id}`,
        package: info.module_name ?? 'unknown',
        severity: String(info.severity ?? 'unknown').toLowerCase(),
        title: info.title ?? '',
        vulnerable: info.vulnerable_versions ?? '',
        patched: info.patched_versions ?? '',
        url: info.url ?? '',
      });
    }

    // Cross-check: if the summary claims blocking vulnerabilities but no
    // advisory objects came back, the report is inconsistent. Fail closed.
    const summary = report.metadata?.vulnerabilities;
    if (isPlainObject(summary)) {
      const claimed = Number(summary.high ?? 0) + Number(summary.critical ?? 0);
      if (claimed > 0 && advisories.length === 0) {
        return {
          advisories: [],
          problems: [
            `audit report claims ${claimed} high/critical vulnerabilities but lists no advisories`,
          ],
        };
      }
    }

    return { advisories, problems };
  }

  for (const info of report) {
    if (!isPlainObject(info)) {
      problems.push('audit report contains a non-object entry');
      continue;
    }
    advisories.push({
      id: String(info.id ?? info.github_advisory_id ?? 'unknown'),
      advisory: info.github_advisory_id ?? String(info.id ?? 'unknown'),
      package: info.module_name ?? 'unknown',
      severity: String(info.severity ?? 'unknown').toLowerCase(),
      title: info.title ?? '',
      vulnerable: info.vulnerable_versions ?? '',
      patched: info.patched_versions ?? '',
      url: info.url ?? '',
    });
  }

  return { advisories, problems };
}

function isExpired(entry, today) {
  // Entries reach here only after parseAllowlist validated the date, so a
  // missing or unusable date can no longer mean "never expires".
  const expiry = new Date(`${entry.expires}T23:59:59Z`);
  return expiry.getTime() < today.getTime();
}

function matchingEntry(entries, advisory) {
  return entries.find((entry) => {
    const idMatches =
      entry.advisory === advisory.advisory || entry.advisory === advisory.id;
    const packageMatches = entry.package === advisory.package;
    return idMatches && packageMatches;
  });
}

/**
 * Decide what blocks and what is tolerated. Pure function: `today` is passed
 * in so tests can pin the clock.
 */
export function evaluateGate({ advisories, entries, today = new Date() }) {
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
        reason: `allowlist entry expired on ${entry.expires} (tracking: ${entry.tracking})`,
      });
      continue;
    }
    tolerated.push({ advisory, entry });
  }

  const stale = entries.filter((entry) => !usedEntries.has(entry));

  return { blocking, tolerated, stale };
}

function collectCounts(advisories) {
  return advisories.reduce((acc, item) => {
    acc[item.severity] = (acc[item.severity] ?? 0) + 1;
    return acc;
  }, {});
}

function runAudit() {
  // Fixture input exists for scripts/audit-gate.test.mjs only; CI sets nothing
  // and therefore always spawns the real audit.
  const fixture = process.env['AUDIT_JSON_FILE'];
  if (fixture) {
    return { stdout: readFileSync(resolve(fixture), 'utf8'), stderr: '' };
  }

  // `pnpm audit` exits non-zero when it finds advisories AND when it fails, so
  // the exit code is not a reliable signal. Parse stdout instead.
  const result = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });

  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function loadAllowlistText() {
  const override = process.env['AUDIT_ALLOWLIST_FILE'];
  const path = override ? resolve(override) : join(repoRoot, '.github', 'audit-allowlist.json');
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null; // nothing tolerated
    throw error;
  }
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

export function main() {
  const problems = [];

  const allowlistText = loadAllowlistText();
  const allowlist = allowlistText === null ? { entries: [], problems: [] } : parseAllowlist(allowlistText);
  problems.push(...allowlist.problems);

  const { stdout, stderr } = runAudit();
  const trimmed = (stdout ?? '').trim();

  let report;
  if (!trimmed) {
    problems.push(`pnpm audit produced no JSON output (stderr: ${stderr.trim() || '(empty)'})`);
    report = null;
  } else {
    try {
      report = JSON.parse(trimmed);
    } catch {
      // Tolerate a non-JSON banner before the document.
      const start = trimmed.indexOf('{');
      if (start === -1) {
        problems.push(`pnpm audit output is not valid JSON (stderr: ${stderr.trim() || '(empty)'})`);
        report = null;
      } else {
        try {
          report = JSON.parse(trimmed.slice(start));
        } catch {
          problems.push(
            `pnpm audit output is not valid JSON (stderr: ${stderr.trim() || '(empty)'})`,
          );
          report = null;
        }
      }
    }
  }

  const parsedReport = report === null ? { advisories: [], problems: [] } : parseAuditReport(report);
  problems.push(...parsedReport.problems);

  const { blocking, tolerated, stale } = evaluateGate({
    advisories: parsedReport.advisories,
    entries: allowlist.entries,
  });

  const counts = collectCounts(parsedReport.advisories);

  console.log('Dependency audit (production dependencies)');
  console.log(
    `  advisories: ${parsedReport.advisories.length}` +
      (parsedReport.advisories.length > 0
        ? ` (${Object.entries(counts)
            .map(([severity, count]) => `${severity}: ${count}`)
            .join(', ')})`
        : ''),
  );
  console.log('  blocking severity: high, critical');
  console.log(`  allowlisted entries: ${allowlist.entries.length}`);

  for (const { advisory, entry } of tolerated) {
    console.log(
      `  TOLERATED ${advisory.advisory} ${advisory.package}@${advisory.vulnerable}` +
        ` until ${entry.expires} (${entry.tracking})`,
    );
  }

  for (const entry of stale) {
    console.log(
      `::notice::Stale allowlist entry ${entry.advisory} no longer matches any production advisory; remove it from .github/audit-allowlist.json.`,
    );
  }

  for (const problem of problems) {
    console.error(`::error::${problem}`);
  }

  for (const { advisory, reason } of blocking) {
    console.error(
      `::error::${advisory.severity.toUpperCase()} ${advisory.advisory} ` +
        `${advisory.package} (${advisory.vulnerable} -> fix ${advisory.patched || 'unknown'}): ` +
        `${advisory.title || 'advisory'} [${reason}] ${advisory.url}`,
    );
  }

  if (problems.length > 0) {
    fail(`dependency gate could not evaluate the audit reliably (${problems.length} problem(s)).`);
  }

  if (blocking.length > 0) {
    fail(
      `${blocking.length} blocking dependency advisor${blocking.length === 1 ? 'y' : 'ies'} found.`,
    );
  }

  console.log('PASS: no unapproved high or critical production advisories.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}