#!/usr/bin/env node
// Issue #2140 — replay the captured run through the completion gate.
//
// Rebuilds the two Codex streams from the run log (see classify-turn-events.mjs
// for the provenance rule) and runs the *current* parser + completion gate over
// them under three models:
//
//   1. v2.11.7 (the version that produced the incident): both streams fed to the
//      protocol parser, and the pre-#2136 count rule
//      `turn.completed + turn.failed < max(turn.started, 1)`.
//   2. Order-aware gate only (#2136 Layer B) with the streams still merged.
//   3. Current main: streams separated (#2136 Layer A) + order-aware gate.
//
// Usage: node experiments/issue-2140/replay-completion-gate.mjs [path-to-log(.gz)]

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCodexExecJsonOutput } from '../../src/codex.lib.mjs';
import { getCodexCompletionHealth } from '../../src/codex-health.lib.mjs';
import { groupLogChunks, classifyChunk } from './classify-turn-events.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const logPath = process.argv[2] || path.join(here, '../../docs/case-studies/issue-2140/raw/solve-run-issue-905.log.txt.gz');

const readLog = file => {
  const buffer = fs.readFileSync(file);
  return (file.endsWith('.gz') ? zlib.gunzipSync(buffer) : buffer).toString('utf8');
};

/** Split the merged log back into the stdout / stderr text the child actually wrote. */
export const rebuildStreams = text => {
  const streams = { stdout: [], stderr: [], ordered: [] };
  for (const group of groupLogChunks(text)) {
    const source = classifyChunk(group);
    for (const { body } of group.lines) {
      streams[source].push(body);
      streams.ordered.push({ source, body });
    }
  }
  return {
    stdout: streams.stdout.join('\n'),
    stderr: streams.stderr.join('\n'),
    ordered: streams.ordered,
  };
};

const MODEL = 'gpt-5.6-sol';

const parseOrdered = (ordered, { separateStreams }) => {
  // Feed the lines in the order the process emitted them, one `parse` call per
  // stream switch, mirroring how executeCodexCommand consumes the chunks.
  let state = {};
  let buffer = [];
  let bufferSource = null;
  const flush = () => {
    if (!buffer.length) return;
    const source = separateStreams ? bufferSource : 'stdout';
    state = parseCodexExecJsonOutput(buffer.join('\n'), state, MODEL, { source });
    buffer = [];
  };
  for (const { source, body } of ordered) {
    if (source !== bufferSource) {
      flush();
      bufferSource = source;
    }
    buffer.push(body);
  }
  flush();
  return state;
};

// The pre-#2136 gate, verbatim from v2.11.7's src/codex-health.lib.mjs.
const legacyCompletionHealth = state => {
  const eventCounts = state.eventCounts || {};
  const turnStarted = eventCounts['turn.started'] || 0;
  const turnCompleted = eventCounts['turn.completed'] || 0;
  const turnFailed = state.turnFailures?.length || 0;
  const hadActivity = turnStarted > 0 || (state.commandExecutions || []).length > 0 || (eventCounts['item.completed'] || 0) > 0;
  const incompleteSession = hadActivity && turnCompleted + turnFailed < Math.max(turnStarted, 1);
  return {
    healthy: !incompleteSession,
    turnStarted,
    turnCompleted,
    turnFailed,
    reason: incompleteSession ? `Codex session ended without completing its turn (turn.started=${turnStarted}, turn.completed=${turnCompleted}, turn.failed=${turnFailed}); the process exited 0 but was cut off mid-turn.` : null,
  };
};

const report = (title, health, state) => {
  console.log(`\n── ${title}`);
  console.log(`   healthy: ${health.healthy}`);
  console.log(`   turn.started=${health.turnStarted}, turn.completed=${health.turnCompleted}, turn.failed=${health.turnFailed}`);
  console.log(`   turn lifecycle: ${(state.turnLifecycle || []).join(' → ') || '(none)'}`);
  const echoed = Object.entries(state.telemetryEventCounts || {})
    .map(([type, count]) => `${type}=${count}`)
    .join(', ');
  console.log(`   echoed (stderr, ignored): ${echoed || '(none)'}`);
  const reason = health.reason || health.reasons?.[0];
  if (reason) console.log(`   ❌ ${reason}`);
};

const main = () => {
  const text = readLog(logPath);
  const { ordered, stdout, stderr } = rebuildStreams(text);
  console.log(`log: ${path.relative(path.join(here, '../..'), logPath)}`);
  console.log(`rebuilt streams — stdout: ${stdout.split('\n').length} lines, stderr: ${stderr.split('\n').length} lines`);

  const merged = parseOrdered(ordered, { separateStreams: false });
  report('1. v2.11.7 — merged streams + count gate (what actually ran)', legacyCompletionHealth(merged), merged);
  report('2. #2136 Layer B only — merged streams + order-aware gate', getCodexCompletionHealth(merged), merged);

  const split = parseOrdered(ordered, { separateStreams: true });
  report('3. current main — separated streams + order-aware gate', getCodexCompletionHealth(split), split);
};

if (import.meta.url === `file://${process.argv[1]}`) main();
