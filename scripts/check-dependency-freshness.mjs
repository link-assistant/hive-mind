#!/usr/bin/env node

import { checkDependencyRecords, collectDependencyRecords } from './dependency-freshness.lib.mjs';

const records = await collectDependencyRecords();
const result = await checkDependencyRecords(records);

console.log(`Dependency freshness: ${result.current.length}/${records.length} declarations current`);
for (const record of result.stale) console.error(`STALE ${record.location}: ${record.name} ${record.current} -> ${record.latest} (${record.policy})`);
for (const record of result.errors) console.error(`ERROR ${record.location}: ${record.name}: ${record.error}`);

if (result.stale.length > 0 || result.errors.length > 0) {
  console.error(`Dependency freshness failed: ${result.stale.length} stale, ${result.errors.length} unresolved.`);
  process.exitCode = 1;
} else {
  console.log('All tracked dependency declarations are current.');
}
