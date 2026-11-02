// Print terminal-tool-result state while folding the #3922 fixture events.
// Usage: node experiments/issue-3922-debug-replay.mjs tests/fixtures/issue-3922-gh-pr-checks-no-checks.jsonl
import fs from 'node:fs';
import { collectClaudeStreamEventFacts, updateTerminalToolResult } from '../src/claude.stream-events.lib.mjs';
const events = fs
  .readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(l => JSON.parse(l));
let t = null;
for (const e of events) {
  t = updateTerminalToolResult(t, collectClaudeStreamEventFacts(e));
  console.log(e.type, { ...t, toolUses: [...t.toolUses.keys()], error: t.error?.slice(-60) });
}
