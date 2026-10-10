// Issue #2301: fold a captured `claude -p` run (repro-ceiling.sh .tsv + .stderr.txt) through the
// hive-mind tracker and print the same-session continuation prompt solve would send.
// Usage: node continuation-prompt.mjs out/agent-ceiling   (prints "<session_id>\n<prompt>")
import { readFileSync } from 'node:fs';
import { assessClaudeTurnCompletion, buildIncompleteTurnContinuationPrompt, createClaudePrintTurnTracker } from '../../src/claude.print-turn.lib.mjs';

const base = process.argv[2];
const tracker = createClaudePrintTurnTracker();
let sessionId = null;
for (const line of readFileSync(`${base}.tsv`, 'utf8').split('\n')) {
  const json = line.slice(line.indexOf('\t') + 1);
  if (!json) continue;
  try {
    const event = JSON.parse(json);
    sessionId ||= event.session_id || null;
    tracker.observeEvent(event);
  } catch {
    // Not a stream-json line.
  }
}
tracker.observeStderr(readFileSync(`${base}.stderr.txt`, 'utf8'));
const snapshot = tracker.snapshot();
const verdict = assessClaudeTurnCompletion({ resultEvent: snapshot.resultEvent, stoppedTaskCount: snapshot.stoppedTaskCount, ceilingSeconds: snapshot.ceilingSeconds, sessionId });
if (!verdict.shouldResume) {
  console.error('The run ended complete; nothing to resume.');
  process.exit(1);
}
console.log(sessionId);
console.log(buildIncompleteTurnContinuationPrompt({ cause: verdict.cause, ceilingSeconds: snapshot.ceilingSeconds, stoppedTasks: snapshot.stoppedTasks }));
