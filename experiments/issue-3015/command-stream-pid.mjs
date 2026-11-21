// Issue #3015: can claude.lib.mjs's killProcessTree reach the process group?
// It reads `execCommand.pid || execCommand._pid`; when both are undefined it falls back to
// execCommand.kill(), and whether that reaches a grandchild decides if the CLI survives.
import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';
if (typeof globalThis.use === 'undefined') await ensureUseM();
const { $ } = await use('command-stream');
const cmd = $({ mirror: false })`sh -c 'sleep 30 & echo child=$!; wait'`;
let started = false;
for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout' && !started) {
    started = true;
    console.log('stdout:', chunk.data.toString().trim());
    console.log('execCommand.pid:', cmd.pid, 'execCommand._pid:', cmd._pid, 'child.pid:', cmd.child?.pid);
    cmd.kill('SIGTERM');
  }
  if (chunk.type === 'exit') console.log('exit chunk code:', chunk.code, 'result.code:', cmd.result?.code);
}
