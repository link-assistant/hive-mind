// Smoke-test the command-stream 2.1.0 use-m pin refreshed for the freshness gate in PR #2802.
import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';
const use = await ensureUseM();
const { $ } = await use('command-stream@2.1.0');
const { QUIET_PROBE } = await import('../../src/quiet-probe.lib.mjs');
const ok = await $({ mirror: false })`echo hello`;
console.log('ok', ok.code, JSON.stringify(ok.stdout.toString()));
const bad = await $(QUIET_PROBE)`sh -c 'echo oops >&2; exit 3'`;
console.log('bad', bad.code, JSON.stringify(bad.stderr.toString()));
const name = 'a b';
const quoted = await $({ mirror: false })`printf %s ${name}`;
console.log('quoted', JSON.stringify(quoted.stdout.toString()));
const lino = await use('links-notation@0.25.2');
const parser = new lino.Parser();
console.log('lino', JSON.stringify(parser.parse('(a: b c)').map(link => link.toString())));
process.exit(0);
