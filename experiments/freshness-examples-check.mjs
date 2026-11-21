// Check the pins the freshness gate collects from examples/ against their latest versions.
import { checkDependencyRecords, collectDependencyRecords } from '../scripts/dependency-freshness.lib.mjs';
const records = (await collectDependencyRecords({ root: new URL('..', import.meta.url).pathname })).filter(record => record.location.startsWith('examples/'));
console.log(records);
const result = await checkDependencyRecords(records);
console.log({ stale: result.stale, errors: result.errors, current: result.current.length });
