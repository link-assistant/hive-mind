// Run the regression file against a preserved cache module without modifying
// the working source or another running test process.
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import process from 'node:process';
import { URL } from 'node:url';

const source = readFileSync(process.argv[2], 'utf8');
const target = new URL('../../src/usage-limits-cache.lib.mjs', import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    return url === target ? { format: 'module', source, shortCircuit: true } : nextLoad(url, context);
  },
});
await import('../../tests/issue-3785-limits-storage-revalidation.test.mjs');
