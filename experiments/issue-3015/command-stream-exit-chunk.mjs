// Issue #3015: does command-stream's stream() yield an `exit` chunk, and with which code
// when the process is killed by SIGTERM after it has already printed its result?
import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';
if (typeof globalThis.use === 'undefined') await ensureUseM();
const { $ } = await use('command-stream');
const cmd = $({ mirror: false })`sh -c 'echo "{\"type\":\"result\"}"; sleep 30'`;
setTimeout(() => cmd.kill('SIGTERM'), 1000);
const types = [];
for await (const chunk of cmd.stream()) {
  types.push(chunk.type === 'exit' ? `exit(${chunk.code})` : chunk.type);
}
console.log('chunks:', types.join(', '));
console.log('result.code:', cmd.result?.code);
