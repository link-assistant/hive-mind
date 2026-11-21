/* global console */
// List every declaration the dependency freshness gate collects from images and code (no network).
import { collectDependencyRecords } from '../../scripts/dependency-freshness.lib.mjs';

const records = await collectDependencyRecords();
for (const record of records.filter(r => ['github', 'container', 'docker'].includes(r.kind) || r.location.startsWith('src/'))) {
  console.log(`${record.location}\t${record.kind}\t${record.name}@${record.current}${record.exception ? `\texception ${record.exception}` : ''}`);
}
console.log('total', records.length);
