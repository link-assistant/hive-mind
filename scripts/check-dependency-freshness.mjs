#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { appendFile, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkDependencyRecords, collectDependencyRecords, formatFreshnessReport, freshnessEnforcement, lockfileLagRecords } from './dependency-freshness.lib.mjs';

const run = promisify(execFile);
const npmOptions = { maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60 * 1000 };

// npm outdated exits 1 for outdated packages; other failures are fatal.
let outdated;
try {
  outdated = JSON.parse((await run('npm', ['outdated', '--json'], npmOptions)).stdout || '{}');
} catch (error) {
  if (error.code !== 1 || !error.stdout?.trim()) throw error;
  outdated = JSON.parse(error.stdout);
  if (outdated.error) throw new Error(JSON.stringify(outdated.error), { cause: error });
}

// Refresh a copy of the lockfile without installing anything, so the check
// also works on a runner with no node_modules (`npm outdated --all` reads the
// installed tree and would see nothing there).
const refreshedLockfile = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hive-lockfile-'));
  try {
    for (const file of ['package.json', 'package-lock.json', '.npmrc']) if (existsSync(file)) await copyFile(file, path.join(directory, file));
    await run('npm', ['update', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { ...npmOptions, cwd: directory });
    return JSON.parse(await readFile(path.join(directory, 'package-lock.json'), 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const records = await collectDependencyRecords();
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
for (const [name, entry] of Object.entries(outdated)) {
  const current = entry.current || lock.packages?.[`node_modules/${name}`]?.version;
  if (!current || current !== entry.latest) records.push({ kind: 'npm', name, current: current || 'missing', policy: 'exact', location: `package-lock.json#${name}` });
}
const result = await checkDependencyRecords(records);
// Transitive lockfile entries must be at the newest version their dependents allow (`npm update`).
const lockfileLag = lockfileLagRecords(lock, await refreshedLockfile());
result.stale.push(...lockfileLag);

console.log(`Dependency freshness: ${result.current.length}/${records.length} declarations current, ${lockfileLag.length} lockfile entries behind their allowed range`);
for (const record of result.exceptions) console.log(`EXCEPTION ${record.location}: ${record.name}: ${record.exception}`);
const report = formatFreshnessReport({ stale: result.stale, errors: result.errors, mode: freshnessEnforcement(process.env.GITHUB_EVENT_NAME) });
for (const line of report.lines) (report.exitCode ? console.error : console.log)(line);
if (report.summary && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report.summary);
process.exitCode = report.exitCode;
