// Smoke-test the use-m pins refreshed in PR #3191 for the freshness gate
// (command-stream 2.4.0, links-notation 0.26.0): the SIGTERM exit chunk (143)
// and `pid` (#3015), plain/failing commands, argument quoting, and the
// links-notation Parser that src/lenv-reader.lib.mjs and src/lino.lib.mjs use.
import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';
const use = await ensureUseM();
const { $ } = await use('command-stream@2.4.0');
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
const lino = await use('links-notation@0.26.0');
const parser = new lino.Parser();
console.log('lino', JSON.stringify(parser.parse('(a: b c)').map(link => link.toString())));
console.log('lino multiline', JSON.stringify(parser.parse('KEY: value\nOTHER: "two words"').map(link => link.toString())));
process.exit(0);
