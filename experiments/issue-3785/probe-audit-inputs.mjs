// Run the retained safety regressions against the pre-fix audit or current code.
// All homes and credentials in the tests are disposable synthetic fixtures.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../../src/agent-config-audit.lib.mjs', import.meta.url);
let auditUrl = sourceUrl.href;
if (process.argv.includes('--baseline')) {
  const baseline = execFileSync('git', ['show', 'e5ccc5eec7cc6d7338c0a012b27c72e280755c1a:src/agent-config-audit.lib.mjs'], { encoding: 'utf8', maxBuffer: 128 * 1024 });
  const source = baseline.replace("'./codex-capability-preflight.lib.mjs'", JSON.stringify(new URL('./codex-capability-preflight.lib.mjs', sourceUrl).href));
  auditUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const tests = (await readFile(new URL('../../tests/issue-3785-audit-inputs.test.mjs', import.meta.url), 'utf8')).replace("'../src/agent-config-audit.lib.mjs'", JSON.stringify(auditUrl));
await import(`data:text/javascript;base64,${Buffer.from(tests).toString('base64')}`);
