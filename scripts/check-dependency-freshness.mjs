#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

import { checkDependencyRecords, collectDependencyRecords } from './dependency-freshness.lib.mjs';

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
for (const record of result.stale) console.error(`STALE ${record.location}: ${record.name} ${record.current} -> ${record.latest} (${record.policy})`);
for (const record of result.errors) console.error(`ERROR ${record.location}: ${record.name}: ${record.error}`);

if (result.stale.length > 0 || result.errors.length > 0) {
  console.error(`Dependency freshness failed: ${result.stale.length} stale, ${result.errors.length} unresolved.`);
  process.exitCode = 1;
} else {
  console.log('All tracked dependency declarations are current.');
}
