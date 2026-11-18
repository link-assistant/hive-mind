// Usage: node experiments/issue-4079-degenerate-replay.mjs <solve.log>
// Replays the [STDERR] lines of a solve log through the issue #4079 degenerate
// output detector and prints the log line and timestamp at which the turn
// guard would have stopped the turn. The original log lost each record's INFO
// header (it went to the trace file), so a synthetic `codex.tool_result`
// header is put back before every record, as in issue-4079-stderr-replay.mjs.
// Prints positions and counts only, never log content.
import { readFileSync } from 'node:fs';
import { createDegenerateOutputDetector } from '../src/codex-turn-guard.lib.mjs';

const lines = readFileSync(process.argv[2], 'utf8').split('\n');
const detector = createDegenerateOutputDetector({ limit: Number(process.env.LIMIT || 200) });
const HEADER = '2026-11-17T15:40:46.100Z  INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=exec arguments=';
let needHeader = true;
let stderrLines = 0;
for (let index = 0; index < lines.length; index++) {
  const at = lines[index].indexOf('] [STDERR] ');
  if (at < 0) continue;
  stderrLines++;
  const line = lines[index].slice(at + 11);
  if (needHeader && !/^\S*?\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+[A-Z]+\s/.test(line)) detector.observeStderr(HEADER);
  needHeader = line.includes('conversation.id=');
  const hit = detector.observeStderr(line);
  if (hit) {
    const stamp = lines[index].match(/^\[([^\]]+)\]/)?.[1] ?? '?';
    const failed = lines.findIndex((text, i) => i > index && text.includes('max_output_tokens'));
    console.log({ stoppedAtLogLine: index + 1, timestamp: stamp, source: hit.source, run: hit.count, stderrLinesSeen: stderrLines, logLinesBeforeMaxOutputTokens: failed > 0 ? failed - index : null });
    process.exit(0);
  }
}
console.log({ stoppedAtLogLine: null, stderrLines });
