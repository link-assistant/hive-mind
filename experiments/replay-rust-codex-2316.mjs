// Replays the Rust --tool codex log through the shared guard (issue #2316).
import { readFileSync } from 'node:fs';
import { createToolCallLoopGuard } from '../src/tool-call-loop-guard.lib.mjs';
const lines = readFileSync(new URL('../docs/case-studies/issue-2320/logs/rust-codex.log', import.meta.url), 'utf8').split('\n');
let stopped = 0;
const guard = createToolCallLoopGuard({
  log: async m => console.log(m.slice(0, 300)),
  stopSession: async () => {
    stopped++;
    return true;
  },
});
let calls = 0;
for (const line of lines) {
  const m = line.match(/^\[[^\]]+\] \[STDOUT\] (.*)$/);
  if (!m) continue;
  if (m[1].includes('"item.completed"') && m[1].includes('command_execution')) calls++;
  if (await guard.observeOutput(`${m[1]}\n`)) break;
}
console.log({ calls, stopped, tripped: guard.tripped, count: guard.verdict?.count });
