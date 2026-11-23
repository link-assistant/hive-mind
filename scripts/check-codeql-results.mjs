#!/usr/bin/env node
/**
 * Fail the CodeQL job when the analysis has any finding (issue #4025).
 *
 * `github/codeql-action/analyze` uploads its results to code scanning and
 * passes even when it finds problems, so 44 open alerts piled up on main with
 * every CodeQL check green (a false negative). This gate reads the SARIF
 * reports the action writes with `output:` and fails on:
 *
 * - any result;
 * - an `error` or `warning` tool notification (for example files the extractor
 *   could not parse, which would otherwise be silently skipped);
 * - an invocation that did not succeed, or a malformed or missing report.
 *
 * Adapted from link-foundation/js-ai-driven-development-pipeline-template
 * scripts/check-codeql-results.mjs.
 *
 * Usage: node scripts/check-codeql-results.mjs [directory]   (default: codeql-results)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function reportsIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return reportsIn(file);
    return entry.isFile() && /\.sarif(?:\.json)?$/.test(entry.name) ? [file] : [];
  });
}

function describeLocations(locations) {
  if (!Array.isArray(locations)) return '';
  return locations
    .map(location => {
      const physical = location?.physicalLocation;
      return `${physical?.artifactLocation?.uri ?? 'unknown location'}:${physical?.region?.startLine ?? '?'}`;
    })
    .join(', ');
}

function invocationDiagnostics(invocation, file, runIndex) {
  const failures = [];
  for (const key of ['toolExecutionNotifications', 'toolConfigurationNotifications']) {
    const notifications = invocation[key];
    if (notifications === undefined) continue;
    if (!Array.isArray(notifications)) {
      failures.push(`${file} run ${runIndex}: malformed ${key}`);
      continue;
    }
    for (const notification of notifications) {
      const level = notification?.level ?? 'warning';
      const message = notification?.message?.text ?? notification?.message?.markdown;
      if (!notification || typeof notification !== 'object' || Array.isArray(notification) || typeof message !== 'string' || !['error', 'warning', 'note', 'none'].includes(level)) {
        failures.push(`${file} run ${runIndex}: malformed ${key} notification`);
      } else if (level === 'error' || level === 'warning') {
        const id = notification.descriptor?.id ?? notification.associatedRule?.id ?? 'unknown diagnostic';
        failures.push(`${file} run ${runIndex}: ${key} ${id} ${describeLocations(notification.locations)} [${level}] ${message}`);
      }
    }
  }
  return failures;
}

function checkRun(run, index, file) {
  const invocationsOk = run?.invocations === undefined || (Array.isArray(run.invocations) && run.invocations.every(invocation => invocation?.executionSuccessful === true));
  if (typeof run?.tool?.driver?.name !== 'string' || !run.tool.driver.name.trim() || !Array.isArray(run.results) || !invocationsOk) {
    throw new Error(`Invalid results/tool or unsuccessful invocation in run ${index}`);
  }
  return [...(run.invocations ?? []).flatMap(invocation => invocationDiagnostics(invocation, file, index)), ...run.results.map(finding => `${file} run ${index}: ${finding?.ruleId ?? 'unknown rule'} [${finding?.level ?? 'unspecified severity'}] ${describeLocations(finding?.locations)} ${finding?.message?.text ?? 'CodeQL finding'}`)];
}

function checkReport(file) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (report?.version !== '2.1.0' || !Array.isArray(report.runs) || !report.runs.length) {
    throw new Error('Invalid SARIF version or missing runs');
  }
  return report.runs.flatMap((run, index) => {
    try {
      return checkRun(run, index, file);
    } catch (error) {
      return [`${file}: ${error.message}`];
    }
  });
}

/**
 * Check every SARIF report under `directory`.
 * @returns {number} the number of clean reports
 * @throws when there is no report, or any report has a finding or an error
 */
export function checkCodeqlResults(directory, log = console.error) {
  const files = reportsIn(directory);
  if (!files.length) throw new Error(`Missing CodeQL SARIF reports: ${directory}`);
  const failures = [];
  for (const file of files) {
    try {
      failures.push(...checkReport(file));
    } catch (error) {
      failures.push(`${file}: ${error.message}`);
    }
  }
  for (const failure of failures) log(failure);
  if (failures.length) throw new Error(`CodeQL result gate rejected ${failures.length} finding(s) or report error(s)`);
  return files.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(`CodeQL result gate: ${checkCodeqlResults(process.argv[2] || 'codeql-results')} clean report(s)`);
  } catch (error) {
    console.error(`::error title=CodeQL findings::${error.message}`);
    process.exitCode = 1;
  }
}
