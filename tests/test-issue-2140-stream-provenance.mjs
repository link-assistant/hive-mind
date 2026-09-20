#!/usr/bin/env node
// Test file for issue #2140: a `solve --tool codex` run was reported as
//
//   Codex session ended without completing its turn
//   (turn.started=3, turn.completed=1, turn.failed=0);
//   the process exited 0 but was cut off mid-turn.
//
// even though it had finished: formal-ai PR #927 was updated and all 46 check
// runs on the run's final commit 2d9523c were success/skipped.
//
// Root cause (reconstructed in docs/case-studies/issue-2140, evidence under
// docs/case-studies/issue-2140/raw):
//   The run used solve v2.11.7, which parsed BOTH codex streams as protocol.
//   Codex's stderr OTEL `codex.tool_result` records dump the raw stdout of every
//   command codex ran — and this task had codex read a *stored codex log* from a
//   previous experiment (experiments/issue-2130/fakehome). That file's NDJSON,
//   including `thread.started` for the unrelated thread 019fc374-… and its
//   `turn.started`, was replayed into stderr twice. Counting those gave
//   turn.started=3 against codex's own single completed turn.
//
//   This is the #2136 defect recurring on a binary released before the fix: the
//   fix merged 2026-08-04 04:04 UTC and shipped in 2.11.10 at 04:16 UTC, while
//   this run started at 03:58 UTC.
//
// What is fixed here (the residual gaps #2136 left):
//   G1. `log()` silently dropped `options.stream`, so both codex streams were
//       written to the log as plain [INFO]. Determining which stream a line came
//       from required structural inference over 96k lines
//       (experiments/issue-2140/classify-turn-events.mjs). Provenance is now
//       recorded as [STDOUT]/[STDERR], for every tool integration.
//   G2. `thread.started` is the one lifecycle event carrying an identity. A
//       thread id on the protocol stream other than this session's is proof of an
//       echo; it is now recorded and surfaced.
//   G3. The completion-gate failure reason carried only the raw counts, which is
//       exactly what made the incident unfalsifiable from the posted comment. It
//       now carries the ordered lifecycle and the echo evidence.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { parseCodexExecJsonOutput, getCodexCompletionHealth } = await import('../src/codex.lib.mjs');
const { buildCodexRunDiagnostics } = await import('../src/codex.run-diagnostics.lib.mjs');
const { log, setLogFile } = await import('../src/lib.mjs');

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${error.message}`);
    failed++;
  }
};

const asyncTest = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${error.message}`);
    failed++;
  }
};

// ------------------------------------------------------------------
// Fixtures copied verbatim from the incident log
// (docs/case-studies/issue-2140/raw/turn-event-excerpts.log.txt).
// ------------------------------------------------------------------

const SESSION_THREAD = '019fcaed-943e-7091-9fa1-475c6bc56a7f';
const ECHOED_THREAD = '019fc374-eaec-78e3-851f-44dfcbb4ecd1';

// Codex's own protocol stream: one thread, one turn, started and completed.
const GENUINE_STDOUT = [`{"type":"thread.started","thread_id":"${SESSION_THREAD}"}`, '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"PR #927 updated; 305 integration tests passing."}}', '{"type":"turn.completed","usage":{"input_tokens":52130,"cached_input_tokens":50176,"output_tokens":871}}'].join('\n');

// One of the two stderr OTEL dumps that replayed the stored log file's NDJSON.
const ECHOED_STDERR = [
  '2026-08-04T04:02:40.230123Z  INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=shell call_id=exec-2140 arguments={"command":"cat codex-run.log"} duration_ms=27 success=true output=WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir "/tmp" (codex_home: AbsolutePathBuf("/tmp/gh-issue-solver-1785688606123/experiments/issue-2130/fakehome/.codex"))',
  'Reading additional input from stdin...',
  `{"type":"thread.started","thread_id":"${ECHOED_THREAD}"}`,
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Let me update hello.txt for you."}}',
  '2026-08-02T17:10:47.802363Z ERROR codex_core::tools::router: error=write_stdin failed: Unknown process id 0',
  '{"type":"item.started","item":{"id":"item_3","type":"command_execution","command":"/bin/bash -lc \'cat hello.txt\'","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
].join('\n');

console.log('Testing Codex stream provenance and echo diagnostics (Issue #2140)\n');

// ============================================================
// Section 1: the incident, reproduced and fixed
// ============================================================
console.log('=== 1. the #2140 incident ===');

// The two stderr dumps of the stored log, as they arrived in the real run.
const parseIncident = () => {
  let state = parseCodexExecJsonOutput(GENUINE_STDOUT.split('\n').slice(0, 2).join('\n'), {}, 'gpt-5.6-sol', { source: 'stdout' });
  state = parseCodexExecJsonOutput(ECHOED_STDERR, state, 'gpt-5.6-sol', { source: 'stderr' });
  state = parseCodexExecJsonOutput(ECHOED_STDERR, state, 'gpt-5.6-sol', { source: 'stderr' });
  state = parseCodexExecJsonOutput(GENUINE_STDOUT.split('\n').slice(2).join('\n'), state, 'gpt-5.6-sol', { source: 'stdout' });
  return state;
};

test('parsing both streams as protocol reproduces the reported counts', () => {
  // v2.11.7 behaviour: no `source`, so stderr defaulted to the protocol stream.
  let state = parseCodexExecJsonOutput(GENUINE_STDOUT.split('\n').slice(0, 2).join('\n'), {}, 'gpt-5.6-sol');
  state = parseCodexExecJsonOutput(ECHOED_STDERR, state, 'gpt-5.6-sol');
  state = parseCodexExecJsonOutput(ECHOED_STDERR, state, 'gpt-5.6-sol');
  state = parseCodexExecJsonOutput(GENUINE_STDOUT.split('\n').slice(2).join('\n'), state, 'gpt-5.6-sol');
  assert.equal(state.eventCounts['turn.started'], 3, 'the issue title reports turn.started=3');
  assert.equal(state.eventCounts['turn.completed'], 1, 'the issue title reports turn.completed=1');
});

test('with stream separation the run has exactly one started, completed turn', () => {
  const state = parseIncident();
  assert.equal(state.eventCounts['turn.started'], 1);
  assert.equal(state.eventCounts['turn.completed'], 1);
  assert.deepEqual(state.turnLifecycle, ['turn.started', 'turn.completed']);
  assert.equal(state.telemetryEventCounts['turn.started'], 2, 'both echoed starts must be visible as telemetry');
});

test('the incident run is healthy', () => {
  const health = getCodexCompletionHealth(parseIncident());
  assert.equal(health.healthy, true, 'the run finished — PR #927 was updated with 46 green checks');
  assert.deepEqual(health.reasons, []);
});

test('the echoed thread never becomes the session id', () => {
  assert.equal(parseIncident().sessionId, SESSION_THREAD);
});

// ============================================================
// Section 2: G1 — log() records stream provenance
// ============================================================
console.log('\n=== 2. log() honours options.stream ===');

const withCapturedLog = async fn => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2140-log-'));
  const file = path.join(dir, 'run.log');
  const originalLog = console.log;
  const originalError = console.error;
  const console_ = { stdout: [], stderr: [] };
  console.log = message => console_.stdout.push(String(message));
  console.error = message => console_.stderr.push(String(message));
  try {
    setLogFile(file);
    await fn();
    return { contents: await fs.readFile(file, 'utf8'), console: console_ };
  } finally {
    setLogFile(null);
    console.log = originalLog;
    console.error = originalError;
    await fs.rm(dir, { recursive: true, force: true });
  }
};

await asyncTest('mirrored stderr is tagged [STDERR] in the log file', async () => {
  const { contents } = await withCapturedLog(() => log('{"type":"turn.started"}', { stream: 'stderr' }));
  assert.ok(contents.includes('[STDERR] {"type":"turn.started"}'), `expected a [STDERR] tag, got: ${contents.trim()}`);
});

await asyncTest('mirrored stdout is tagged [STDOUT] in the log file', async () => {
  const { contents } = await withCapturedLog(() => log('{"type":"turn.started"}', { stream: 'stdout' }));
  assert.ok(contents.includes('[STDOUT] {"type":"turn.started"}'), `expected a [STDOUT] tag, got: ${contents.trim()}`);
});

await asyncTest('the two streams of one run stay distinguishable in the log', async () => {
  // The exact question experiments/issue-2140/classify-turn-events.mjs had to
  // answer by inference — now answerable by reading the log.
  const { contents } = await withCapturedLog(async () => {
    await log(GENUINE_STDOUT, { stream: 'stdout' });
    await log(ECHOED_STDERR, { stream: 'stderr' });
  });
  const turnStarts = contents.split('\n').filter(line => line.includes('{"type":"turn.started"}'));
  assert.equal(turnStarts.length, 2, 'both turn.started lines are in the log');
  assert.equal(turnStarts.filter(line => line.includes('[STDOUT]')).length, 1, 'exactly one is codex protocol');
  assert.equal(turnStarts.filter(line => line.includes('[STDERR]')).length, 1, 'exactly one is an echo');
});

await asyncTest('mirrored stderr is written to our stderr, not stdout', async () => {
  const { console: captured } = await withCapturedLog(async () => {
    await log('child stdout line', { stream: 'stdout' });
    await log('child stderr line', { stream: 'stderr' });
  });
  assert.deepEqual(captured.stderr, ['child stderr line']);
  assert.deepEqual(captured.stdout, ['child stdout line']);
});

await asyncTest('an explicit level still wins over the stream tag', async () => {
  const { contents, console: captured } = await withCapturedLog(() => log('boom', { stream: 'stderr', level: 'error' }));
  assert.ok(contents.includes('[ERROR] boom'), `expected [ERROR], got: ${contents.trim()}`);
  assert.deepEqual(captured.stderr, ['boom']);
});

await asyncTest('logs without a stream option are unchanged', async () => {
  const { contents, console: captured } = await withCapturedLog(() => log('plain message'));
  assert.ok(contents.includes('[INFO] plain message'));
  assert.deepEqual(captured.stdout, ['plain message']);
});

await asyncTest('every tool integration tags the output it mirrors', async () => {
  // The defect was cross-codebase: all five tool integrations passed
  // `{ stream: 'stderr' }` into a `log()` that ignored it.
  for (const tool of ['codex', 'claude', 'gemini', 'opencode', 'qwen']) {
    const source = await fs.readFile(new URL(`../src/${tool}.lib.mjs`, import.meta.url), 'utf8');
    assert.ok(source.includes("{ stream: 'stderr' }"), `${tool}.lib.mjs must tag mirrored stderr`);
    assert.ok(source.includes("{ stream: 'stdout' }"), `${tool}.lib.mjs must tag mirrored stdout`);
    assert.ok(!source.includes("{ stream: 'raw' }"), `${tool}.lib.mjs must not use an unrecognised stream name`);
  }
});

// ============================================================
// Section 3: G2 — a foreign thread id is decisive echo evidence
// ============================================================
console.log('\n=== 3. foreign thread detection on the protocol stream ===');

// Codex starts exactly one thread per `codex exec`, so this can only happen if an
// echo reaches stdout — a path we have not observed, but which the whole #2136 /
// #2140 class says we should be able to recognise rather than silently miscount.
const leakedToStdout = () => {
  let state = parseCodexExecJsonOutput(GENUINE_STDOUT.split('\n').slice(0, 2).join('\n'), {}, 'gpt-5.6-sol', { source: 'stdout' });
  state = parseCodexExecJsonOutput(`{"type":"thread.started","thread_id":"${ECHOED_THREAD}"}\n{"type":"turn.started"}`, state, 'gpt-5.6-sol', { source: 'stdout' });
  return state;
};

test('a second thread id on the protocol stream is recorded as foreign', () => {
  assert.deepEqual(leakedToStdout().foreignThreadIds, [ECHOED_THREAD]);
});

test('the session id survives a foreign thread.started', () => {
  assert.equal(leakedToStdout().sessionId, SESSION_THREAD);
});

test('a repeated foreign thread id is recorded once', () => {
  let state = leakedToStdout();
  state = parseCodexExecJsonOutput(`{"type":"thread.started","thread_id":"${ECHOED_THREAD}"}`, state, 'gpt-5.6-sol', { source: 'stdout' });
  assert.deepEqual(state.foreignThreadIds, [ECHOED_THREAD]);
});

test('a clean run records no foreign threads', () => {
  assert.deepEqual(parseIncident().foreignThreadIds, []);
});

test('foreign thread ids are reported in the run diagnostics', () => {
  const lines = buildCodexRunDiagnostics({ state: leakedToStdout(), exitCode: 0, mappedModel: 'gpt-5.6-sol' }).map(entry => entry.message);
  assert.ok(
    lines.some(line => line.includes('Foreign thread IDs') && line.includes(ECHOED_THREAD)),
    'the log must name the foreign thread'
  );
});

// ============================================================
// Section 4: G3 — a failure verdict carries its own evidence
// ============================================================
console.log('\n=== 4. the completion gate explains itself ===');

const cutOffWithEchoes = () => {
  // A genuine #1990 cut-off (the stream ends on turn.started) that also saw
  // echoed telemetry — the case where the counts alone are most misleading.
  let state = parseCodexExecJsonOutput(['{"type":"thread.started","thread_id":"' + SESSION_THREAD + '"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"c1","type":"command_execution","command":"cargo build","aggregated_output":"","exit_code":0,"status":"completed"}}'].join('\n'), {}, 'gpt-5.6-sol', { source: 'stdout' });
  state = parseCodexExecJsonOutput(ECHOED_STDERR, state, 'gpt-5.6-sol', { source: 'stderr' });
  return state;
};

test('a genuine cut-off is still failed', () => {
  const health = getCodexCompletionHealth(cutOffWithEchoes());
  assert.equal(health.healthy, false);
  assert.equal(health.incompleteSession, true);
});

test('the failure reasons include the ordered turn lifecycle', () => {
  const { reasons } = getCodexCompletionHealth(cutOffWithEchoes());
  assert.ok(
    reasons.some(reason => reason.includes('Turn lifecycle in order: turn.started')),
    `expected the lifecycle in the reasons, got: ${JSON.stringify(reasons)}`
  );
});

test('the failure reasons disclose the echoed turn.started lines', () => {
  const { reasons } = getCodexCompletionHealth(cutOffWithEchoes());
  assert.ok(
    reasons.some(reason => reason.includes('1 echoed turn.started on codex stderr')),
    `expected the echo diagnostics in the reasons, got: ${JSON.stringify(reasons)}`
  );
});

test('the failure reasons name a foreign thread id when one reached the protocol stream', () => {
  const state = leakedToStdout();
  const { reasons } = getCodexCompletionHealth(state);
  assert.equal(getCodexCompletionHealth(state).healthy, false, 'this fixture ends on a turn.started');
  assert.ok(
    reasons.some(reason => reason.includes(ECHOED_THREAD)),
    `expected the foreign thread id in the reasons, got: ${JSON.stringify(reasons)}`
  );
});

test('a healthy run produces no echo diagnostics', () => {
  const health = getCodexCompletionHealth(parseIncident());
  assert.deepEqual(health.reasons, []);
  assert.equal(health.echoedTurnStarts, 2, 'the count is still exposed for callers');
  assert.deepEqual(health.turnLifecycle, ['turn.started', 'turn.completed']);
});

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
console.log('\n✅ All issue #2140 tests passed');
