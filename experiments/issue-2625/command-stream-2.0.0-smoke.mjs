// Smoke-test command-stream 2.0.0 through the hive-mind use-m loader (issue #2625).
import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';
const use = await ensureUseM();
const { $ } = await use('command-stream@2.0.0');
const { QUIET_PROBE } = await import('../../src/quiet-probe.lib.mjs');
const ok = await $({ mirror: false })`echo hello`;
console.log('ok', ok.code, JSON.stringify(ok.stdout.toString()));
const bad = await $(QUIET_PROBE)`sh -c 'echo oops >&2; exit 3'`;
console.log('bad', bad.code, JSON.stringify(bad.stderr.toString()));
const name = 'a b';
const quoted = await $({ mirror: false })`printf %s ${name}`;
console.log('quoted', JSON.stringify(quoted.stdout.toString()));
process.exit(0);
