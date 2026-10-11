// Smoke-test command-stream 2.3.0 (pin refreshed in PR #2918 for the freshness gate) on the
// behaviors Issue #3015 depends on: the SIGTERM exit chunk (143), `pid` for the process-group
// check, plain and failing commands, and argument quoting.
import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';
const use = await ensureUseM();
const { $ } = await use('command-stream@2.3.0');
const { QUIET_PROBE } = await import('../../src/quiet-probe.lib.mjs');
const cmd = $({ mirror: false })`sh -c 'echo "{\"type\":\"result\"}"; sleep 30'`;
let pid = null;
setTimeout(() => {
  pid = cmd.pid ?? cmd.child?.pid ?? null;
  cmd.kill('SIGTERM');
}, 1000);
const types = [];
for await (const chunk of cmd.stream()) types.push(chunk.type === 'exit' ? `exit(${chunk.code})` : chunk.type);
console.log('chunks:', types.join(', '), 'result.code:', cmd.result?.code, 'pid:', typeof pid === 'number');
const ok = await $({ mirror: false })`echo hello`;
console.log('ok', ok.code, JSON.stringify(ok.stdout.toString()));
const bad = await $(QUIET_PROBE)`sh -c 'echo oops >&2; exit 3'`;
console.log('bad', bad.code, JSON.stringify(bad.stderr.toString()));
const name = 'a b';
const quoted = await $({ mirror: false })`printf %s ${name}`;
console.log('quoted', JSON.stringify(quoted.stdout.toString()));
process.exit(0);
