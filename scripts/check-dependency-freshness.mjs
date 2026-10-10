#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, readFile } from 'node:fs/promises';

import { checkDependencyRecords, collectDependencyRecords, formatFreshnessReport, freshnessEnforcement } from './dependency-freshness.lib.mjs';

// npm outdated exits 1 for outdated packages; other failures are fatal.
let outdated;
try {
  outdated = JSON.parse((await promisify(execFile)('npm', ['outdated', '--json'], { maxBuffer: 8 * 1024 * 1024 })).stdout || '{}');
} catch (error) {
  if (error.code !== 1 || !error.stdout?.trim()) throw error;
  outdated = JSON.parse(error.stdout);
  if (outdated.error) throw new Error(JSON.stringify(outdated.error), { cause: error });
}
const records = await collectDependencyRecords();
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
for (const [name, entry] of Object.entries(outdated)) {
  const current = entry.current || lock.packages?.[`node_modules/${name}`]?.version;
  if (!current || current !== entry.latest) records.push({ kind: 'npm', name, current: current || 'missing', policy: 'exact', location: `package-lock.json#${name}` });
}
const result = await checkDependencyRecords(records);

console.log(`Dependency freshness: ${result.current.length}/${records.length} declarations current`);
for (const record of result.exceptions) console.log(`EXCEPTION ${record.location}: ${record.name}: ${record.exception}`);
const report = formatFreshnessReport({ stale: result.stale, errors: result.errors, mode: freshnessEnforcement(process.env.GITHUB_EVENT_NAME) });
for (const line of report.lines) (report.exitCode ? console.error : console.log)(line);
if (report.summary && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report.summary);
process.exitCode = report.exitCode;
