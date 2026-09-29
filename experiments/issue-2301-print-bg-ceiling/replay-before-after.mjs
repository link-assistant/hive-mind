// Issue #2301: replay the incident fixtures through the released (origin/main) stream folding and
// through this branch's folding. Usage: node experiments/issue-2301-print-bg-ceiling/replay-before-after.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { collectClaudeStreamEventFacts, updateTerminalToolResult } from '../../src/claude.stream-events.lib.mjs';
import { assessClaudeTurnCompletion, createClaudePrintTurnTracker } from '../../src/claude.print-turn.lib.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const oldPath = path.join(os.tmpdir(), `claude.stream-events.main-${process.pid}.mjs`);
fs.writeFileSync(oldPath, execFileSync('git', ['show', 'origin/main:src/claude.stream-events.lib.mjs'], { cwd: root }));
const before = await import(oldPath);

for (const name of ['links-notation-315-sweep.jsonl', 'browser-commander-106-sweep.jsonl']) {
  const events = fs
    .readFileSync(path.join(root, 'tests/fixtures/issue-2301', name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
  let oldTerminal = null;
  let newTerminal = null;
  const tracker = createClaudePrintTurnTracker();
  for (const data of events) {
    if (data.__stderr) {
      tracker.observeStderr(data.__stderr);
      continue;
    }
    oldTerminal = before.updateTerminalToolResult(oldTerminal, before.collectClaudeStreamEventFacts(data));
    const { afterResult } = tracker.observeEvent(data);
    newTerminal = updateTerminalToolResult(newTerminal, collectClaudeStreamEventFacts(data), { afterResult });
  }
  const s = tracker.snapshot();
  const verdict = assessClaudeTurnCompletion({ resultEvent: s.resultEvent, stoppedTaskCount: s.stoppedTaskCount, ceilingSeconds: s.ceilingSeconds, sessionId: 'session' });
  console.log(`== ${name}`);
  console.log(`  before (main): ${oldTerminal?.failed && !oldTerminal.benign ? `FAILED "Final tool result failed: ${oldTerminal.error.slice(0, 90)}…"` : 'success'}; no resume`);
  console.log(`  after (branch): final tool result failed=${Boolean(newTerminal?.failed)}; incomplete=${verdict.incomplete}; cancelled=${verdict.cancelledTasks}; resume=${verdict.shouldResume}; cause="${verdict.cause}"`);
}
fs.rmSync(oldPath, { force: true });
