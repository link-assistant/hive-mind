#!/usr/bin/env node
/**
 * Decide the npm-audit job from `npm audit --json` output (issue #2198, #4079).
 *
 * `npm audit --audit-level=high` alone has no way to accept an advisory that
 * cannot be fixed yet: GHSA-fc5q-39xc-vjpf covers every published picomatch
 * release and lists no patched version, so the job turned red on every branch
 * with nothing to upgrade to. This gate fails on every high or critical
 * advisory except those recorded in scripts/npm-audit-exceptions.json, and an
 * exception only holds while the advisory still reports the exact vulnerable
 * range it was accepted for. It fails again when:
 *
 * - the advisory's range changes (a fixed release was published: upgrade, then
 *   delete the exception);
 * - the advisory is no longer reported (delete the stale exception);
 * - the audit itself failed (registry error, malformed or missing report).
 *
 * Usage: node scripts/check-npm-audit.mjs <npm-audit.json> [exceptions.json]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_EXCEPTIONS_PATH = fileURLToPath(new URL('./npm-audit-exceptions.json', import.meta.url));
const FAILING_SEVERITIES = new Set(['high', 'critical']);

/** High and critical advisories in an `npm audit --json` report, one per advisory URL and package. */
export function failingAdvisories(report) {
  if (!report || typeof report !== 'object' || report.error || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    throw new Error(`npm audit did not produce a report${report?.error ? `: ${report.error.summary || report.error.code || JSON.stringify(report.error)}` : ''}`);
  }
  const advisories = new Map();
  for (const entry of Object.values(report.vulnerabilities)) {
    for (const via of entry?.via ?? []) {
      // String entries point at another package's entry, which lists the advisory itself.
      if (typeof via !== 'object' || !via || !FAILING_SEVERITIES.has(via.severity)) continue;
      advisories.set(`${via.url} ${via.name}`, { url: via.url, package: via.name, range: via.range, severity: via.severity, title: via.title });
    }
  }
  return [...advisories.values()];
}

/**
 * @param {object} report - parsed `npm audit --json` output
 * @param {Array<{advisory: string, package: string, range: string, reason: string}>} exceptions
 * @returns {{failures: string[], accepted: string[]}}
 */
export function checkNpmAudit(report, exceptions) {
  if (!Array.isArray(exceptions)) throw new Error('The exceptions file must hold a JSON array');
  const failures = [];
  const accepted = [];
  const used = new Set();
  for (const advisory of failingAdvisories(report)) {
    const exception = exceptions.find(candidate => candidate.advisory === advisory.url && candidate.package === advisory.package);
    if (!exception) {
      failures.push(`${advisory.package} ${advisory.range} [${advisory.severity}] ${advisory.title} - ${advisory.url}`);
      continue;
    }
    used.add(exception);
    if (exception.range !== advisory.range) {
      failures.push(`${advisory.url} now reports ${advisory.package} ${advisory.range} (accepted for ${exception.range}): a fixed release may exist - upgrade ${advisory.package}, then remove the exception from scripts/npm-audit-exceptions.json`);
      continue;
    }
    accepted.push(`${advisory.package} ${advisory.range} - ${advisory.url}: ${exception.reason}`);
  }
  for (const exception of exceptions) {
    if (!used.has(exception)) failures.push(`${exception.advisory} (${exception.package}) is no longer reported: remove the stale exception from scripts/npm-audit-exceptions.json`);
  }
  return { failures, accepted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [reportPath, exceptionsPath = DEFAULT_EXCEPTIONS_PATH] = process.argv.slice(2);
    if (!reportPath) throw new Error('Usage: node scripts/check-npm-audit.mjs <npm-audit.json> [exceptions.json]');
    const { failures, accepted } = checkNpmAudit(JSON.parse(readFileSync(reportPath, 'utf8')), JSON.parse(readFileSync(exceptionsPath, 'utf8')));
    for (const line of accepted) console.log(`Accepted advisory: ${line}`);
    for (const line of failures) console.error(`::error::${line}`);
    if (failures.length) process.exitCode = 1;
    else console.log('npm audit: no unaccepted high or critical advisories.');
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
