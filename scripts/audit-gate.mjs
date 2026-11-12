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
 *   report shape fails the gate. "No advisories key" is never read as clean,
 *   and a bare array root is an unknown shape because pnpm never emits one.
 * - Fail on unknown risk: only advisories listed by id are tolerated. Every
 *   advisory must carry a package name and a severity from a fixed set, so a
 *   partial or reformatted report cannot hide a high advisory as "unknown".
 * - Cross-check the summary against the advisories that were actually read. The
 *   summary is mandatory and the counts must match exactly, so an incomplete
 *   report cannot claim there is nothing to report.
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
const NON_BLOCKING_SEVERITIES = ['info', 'low', 'moderate'];
const KNOWN_SEVERITIES = new Set([...NON_BLOCKING_SEVERITIES, ...BLOCKING_SEVERITIES]);
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
 * Validate one advisory object and normalise it. Missing or wrong-typed fields
 * are pushed to `problems` so the gate fails; they are never silently widened
 * into "unknown", because an unknown severity would be skipped by
 * evaluateGate() and turn a high advisory into a pass.
 */
function normaliseAdvisory({ key, info, where, problems }) {
  if (!isPlainObject(info)) {
    problems.push(`${where} is not an object; cannot read the advisory`);
    return null;
  }

  const moduleName = info.module_name;
  if (typeof moduleName !== 'string' || moduleName.trim() === '') {
    problems.push(`${where}.module_name is required and must be a non-empty string`);
  }

  const rawSeverity = info.severity;
  const severity = typeof rawSeverity === 'string' ? rawSeverity.trim().toLowerCase() : '';
  if (!KNOWN_SEVERITIES.has(severity)) {
    problems.push(
      `${where}.severity must be one of ${[...KNOWN_SEVERITIES].join(', ')}; ` +
        `received ${JSON.stringify(rawSeverity ?? null)}`,
    );
  }

  const githubId = info.github_advisory_id;
  if (githubId !== undefined && githubId !== null) {
    if (typeof githubId !== 'string' || githubId.trim() === '') {
      problems.push(`${where}.github_advisory_id, when present, must be a non-empty string`);
    }
  }

  const id = key ?? '';
  if (typeof id !== 'string' || id.trim() === '') {
    problems.push(`${where} has no advisory identifier`);
  }

  const hasGithubId = typeof githubId === 'string' && githubId.trim() !== '';

  return {
    id: String(id),
    advisory: hasGithubId ? githubId : String(id),
    package: typeof moduleName === 'string' && moduleName.trim() !== '' ? moduleName : 'unknown',
    severity,
    title: typeof info.title === 'string' ? info.title : '',
    vulnerable: typeof info.vulnerable_versions === 'string' ? info.vulnerable_versions : '',
    patched: typeof info.patched_versions === 'string' ? info.patched_versions : '',
    url: typeof info.url === 'string' ? info.url : '',
  };
}

/**
 * Read a summary counter. Absent, null, fractional, negative, or non-numeric
 * values are failures: mapping them to zero would let an incomplete report
 * claim there is nothing to report.
 */
function readCount(value, where, problems) {
  if (!Number.isSafeInteger(value) || value < 0) {
    problems.push(
      `${where} must be a non-negative integer; received ${JSON.stringify(value ?? null)}`,
    );
    return null;
  }
  return value;
}

/**
 * Validate the parsed audit report and normalise it into advisories.
 * Returns `{ advisories, problems }`. A report with a top-level `error`, a bare
 * array root, or any other unrecognised shape is a failure, not an empty
 * result.
 */
export function parseAuditReport(report) {
  const problems = [];

  if (!isPlainObject(report)) {
    return {
      advisories: [],
      problems: [
        Array.isArray(report)
          ? 'audit report is a bare array; pnpm emits {"advisories": {...}} and no legacy array schema is defined, refusing to guess'
          : 'audit report is not a JSON object',
      ],
    };
  }

  if (report.error !== undefined && report.error !== null) {
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

  if (!isPlainObject(report.advisories)) {
    return {
      advisories: [],
      problems: [
        'audit report has no "advisories" object; refusing to read an unknown shape as clean',
      ],
    };
  }

  const advisories = [];

  for (const [id, info] of Object.entries(report.advisories)) {
    const advisory = normaliseAdvisory({
      key: id,
      info,
      where: `advisories[${id}]`,
      problems,
    });
    if (advisory) advisories.push(advisory);
  }

  // Cross-check the summary against what was actually read. The summary is
  // mandatory: pnpm always emits metadata.vulnerabilities, so a report without
  // counters cannot prove it listed every blocking advisory. The counts must
  // also agree exactly (pnpm derives them from the same advisory map), so an
  // undercount is as untrustworthy as an overcount.
  const metadata = report.metadata;
  if (!isPlainObject(metadata)) {
    problems.push(
      'audit report has no "metadata" object; cannot confirm the vulnerability counts',
    );
  } else if (!isPlainObject(metadata.vulnerabilities)) {
    problems.push(
      'audit report has no "metadata.vulnerabilities" object; cannot confirm the vulnerability counts',
    );
  } else {
    const high = readCount(
      metadata.vulnerabilities.high,
      'metadata.vulnerabilities.high',
      problems,
    );
    const critical = readCount(
      metadata.vulnerabilities.critical,
      'metadata.vulnerabilities.critical',
      problems,
    );
    const readable = advisories.filter((advisory) => BLOCKING_SEVERITIES.has(advisory.severity))
      .length;

    if (high !== null && critical !== null) {
      const claimed = high + critical;
      if (claimed !== readable) {
        problems.push(
          `audit summary reports ${claimed} high/critical vulnerabilities but ${readable} ` +
            'blocking advisories were read; refusing to trust an inconsistent report',
        );
      }
    }

    // The same accounting applies below the blocking threshold: a report that
    // disagrees with itself has not been read reliably, whatever the severity.
    for (const severity of NON_BLOCKING_SEVERITIES) {
      const count = readCount(
        metadata.vulnerabilities[severity],
        `metadata.vulnerabilities.${severity}`,
        problems,
      );
      const listed = advisories.filter((advisory) => advisory.severity === severity).length;
      if (count !== null && count !== listed) {
        problems.push(
          `audit summary reports ${count} ${severity} vulnerabilities but ${listed} ` +
            `${severity} advisories were read; refusing to trust an inconsistent report`,
        );
      }
    }
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
    if (!idMatches || !packageMatches) return false;
    // An entry that declares a severity may only tolerate that severity, so a
    // "high" exception cannot silently absorb a critical advisory.
    if (entry.severity !== undefined && entry.severity !== null) {
      return String(entry.severity).toLowerCase() === advisory.severity;
    }
    return true;
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
  let parsedOutput = false;
  if (!trimmed) {
    problems.push(`pnpm audit produced no JSON output (stderr: ${stderr.trim() || '(empty)'})`);
  } else {
    try {
      report = JSON.parse(trimmed);
      parsedOutput = true;
    } catch {
      // Tolerate a non-JSON banner before the document.
      const start = trimmed.indexOf('{');
      if (start === -1) {
        problems.push(`pnpm audit output is not valid JSON (stderr: ${stderr.trim() || '(empty)'})`);
      } else {
        try {
          report = JSON.parse(trimmed.slice(start));
          parsedOutput = true;
        } catch {
          problems.push(
            `pnpm audit output is not valid JSON (stderr: ${stderr.trim() || '(empty)'})`,
          );
        }
      }
    }
  }

  // Track parsing success explicitly. JSON `null` is valid JSON but not a
  // report, and it must reach parseAuditReport() so the unknown shape fails
  // instead of being mistaken for "no output" and skipped.
  const parsedReport = parsedOutput
    ? parseAuditReport(report)
    : { advisories: [], problems: [] };
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