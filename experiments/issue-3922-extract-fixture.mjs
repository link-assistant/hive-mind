// Extract the final main-thread events (tool_use → tool_result → text → result) of the
// Usage: node experiments/issue-3922-extract-fixture.mjs docs/case-studies/issue-3922/raw/solution-draft-log.txt tests/fixtures/issue-3922-gh-pr-checks-no-checks.jsonl
// failing #3922 session from the saved solve log into a JSONL fixture.
import fs from 'node:fs';
const [logPath, outPath] = process.argv.slice(2);
const lines = fs.readFileSync(logPath, 'utf8').split('\n');
const events = [];
let buf = null;
for (const line of lines) {
  const m = line.match(/^\[[^\]]+\] \[INFO\] (.*)$/);
  if (!m) continue;
  const body = m[1];
  if (buf === null && body === '{') buf = ['{'];
  else if (buf !== null) {
    buf.push(body);
    if (body === '}') {
      try {
        events.push(JSON.parse(buf.join('\n')));
      } catch {}
      buf = null;
    }
  }
}
const sessionId = '2221232c-d6ed-4208-bb08-882c6ebf1f69';
const session = events.filter(e => e.session_id === sessionId);
const start = session.findIndex(e => e.type === 'assistant' && e.message?.content?.some(c => c.id === 'toolu_01Tp886FgSshigqr5t1c8UMt'));
const end = session.findIndex(e => e.type === 'result');
const keep = session.slice(start, end + 1).map(({ wire_tool_inputs, wire_ingest_context, ...e }) => e);
fs.writeFileSync(outPath, keep.map(e => JSON.stringify(e)).join('\n') + '\n');
console.log(`wrote ${keep.length} events:`, keep.map(e => `${e.type}${e.subtype ? ':' + e.subtype : ''}`).join(' → '));
