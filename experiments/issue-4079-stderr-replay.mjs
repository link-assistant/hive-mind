// Usage: node experiments/issue-4079-stderr-replay.mjs <solve.log>
// Replays the [STDERR] lines of a solve log through the Codex stderr filter as
// though they were raw stderr. The original run sent each record's INFO header
// line to the trace file and logged only its continuation lines, so a
// synthetic header is put back before every record (at the start, and after
// each line that ends one with `conversation.id=`). Prints sizes only.
import { readFileSync } from 'node:fs';
import { createCodexStderrLog } from '../src/codex-stderr-log.lib.mjs';
const lines = readFileSync(process.argv[2], 'utf8').split('\n');
const stderr = lines.filter(line => line.includes('] [STDERR] ')).map(line => line.slice(line.indexOf('] [STDERR] ') + 11));
let traceLines = 0;
const log = createCodexStderrLog({ tracePath: '/dev/null', append: (_p, text) => (traceLines += text.split('\n').length - 1) });
const kept = [];
const HEADER = '2026-11-17T15:40:46.100Z  INFO codex_otel.log_only: event.name="codex.tool_result" arguments=';
let needHeader = true;
for (const line of stderr) {
  if (needHeader && !/^\S*?\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+[A-Z]+\s/.test(line)) kept.push(...log.write(`${HEADER}\n`));
  needHeader = line.includes('conversation.id=');
  kept.push(...log.write(`${line}\n`));
}
kept.push(...log.end());
const identity = kept.filter(line => /user\.(email|account_id)=(?!"?<redacted>)/.test(line)).length;
console.log({
  stderrLinesInOriginalLog: stderr.length,
  keptLines: kept.length,
  traceLines,
  unredactedIdentityLinesKept: identity,
  longestDotRunCollapsed: kept
    .filter(l => l.includes('previous line repeated'))
    .map(l => l.match(/\d+/)[0])
    .slice(0, 5),
});
