#!/usr/bin/env node
// Test file for issue #2136: "Codex exited 0 but the run did not complete —
// treating as failure" on a run that had actually completed successfully.
//
// Root cause (reconstructed from the captured run log, see
// docs/case-studies/issue-2136):
//   `codex exec --json` writes its NDJSON protocol to STDOUT. Its STDERR carries
//   tracing/OTEL text (RUST_LOG=debug, enabled by `solve --verbose`), and every
//   `codex.tool_result` record dumps the raw stdout of the command codex just
//   ran. The task under solve drove ANOTHER agent CLI, whose NDJSON was replayed
//   verbatim inside such a record:
//
//     INFO codex_otel.log_only: event.name="codex.tool_result" … output=…
//     Output:
//     {"thread_id":"019fc742-…","type":"thread.started"}
//     {"type":"turn.started"}
//
//   codex.lib.mjs fed stderr through the same protocol parser as stdout, so the
//   nested agent's `turn.started` was counted as codex's own: turn.started=2 vs
//   turn.completed=1. The #1990 completion gate (turn.completed + turn.failed <
//   turn.started) then failed a run whose turn HAD completed — the work was done
//   (formal-ai PR #913 open, all CI green) and a "Solution Draft Failed" comment
//   was posted anyway.
//
// Fix, two independent layers:
//   A. parseCodexExecJsonOutput takes a `source`; only stdout is protocol. JSON
//      objects seen on stderr go to `telemetryEventCounts` (diagnostics only) and
//      never touch eventCounts / sessionId / usage / error buckets.
//   B. getCodexCompletionHealth uses the ORDERED `turnLifecycle` from the
//      protocol stream: a session is incomplete when the last lifecycle event is
//      a `turn.started`. A stray extra `turn.started` from any future echo path
//      can no longer flip a completed run to failed, while the #1990 shape (the
//      stream ends mid-turn) still fails.

import assert from 'node:assert/strict';

const { parseCodexExecJsonOutput, getCodexCompletionHealth, executeCodexCommand } = await import('../src/codex.lib.mjs');
const { buildCodexRunDiagnostics } = await import('../src/codex.run-diagnostics.lib.mjs');

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
// Fixtures taken from the real incident log (gist run.log, lines 1060,
// 9322-9331, 26634 — mirrored under docs/case-studies/issue-2136/raw).
// ------------------------------------------------------------------

// What codex itself emitted on stdout: one turn, started and completed.
const GENUINE_STDOUT = ['{"thread_id":"019fc725-cf6e-7242-a952-dd819e406a63","type":"thread.started"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"item_9","type":"agent_message","text":"PR: https://github.com/link-assistant/formal-ai/pull/913 — all five fresh GitHub Actions workflows passed."}}', '{"type":"turn.completed","usage":{"input_tokens":33450,"cached_input_tokens":32512,"output_tokens":63}}'].join('\n');

// What codex's stderr carried at the same time: an OTEL tool_result record whose
// `output=` dump replays the nested agent's NDJSON verbatim.
const TELEMETRY_STDERR = ['2026-08-03T10:54:47.430787Z  INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=write_stdin call_id=exec-7cd150d3 arguments={"session_id":68719,"chars":"","yield_time_ms":10000} duration_ms=10002 success=true output=Chunk ID: 4fc4fd', 'Wall time: 10.0021 seconds', 'Process running with session ID 68719', 'Output:', 'Total output lines: 168', '', '{"thread_id":"019fc742-c36e-7f20-87f0-6876ebf9b272","type":"thread.started"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I could not determine the request from local memory."}}', '{"type":"error","message":"Network lookup skipped in fixture"}', '2026-08-03T10:54:47.430856Z  INFO codex_otel.trace_safe: event.name="codex.tool_result" tool_name=write_stdin output_length=2083'].join('\n');

// The incident's echoed dump was truncated by codex ("Warning: truncated output")
// before the nested agent's own `turn.completed`, which is exactly why the counts
// went out of balance (turn.started=2 vs turn.completed=1). A longer-lived echo
// replays the completion too — and with it the nested run's token usage.
const TELEMETRY_STDERR_WITH_COMPLETION = [TELEMETRY_STDERR, '{"type":"turn.completed","usage":{"input_tokens":41451312,"output_tokens":98765}}'].join('\n');

console.log('Testing Codex telemetry-echoed turn events (Issue #2136)\n');

// ============================================================
// Section 1: the parser must not treat stderr as protocol
// ============================================================
console.log('=== 1. parseCodexExecJsonOutput source separation ===');

const parseIncident = () => {
  let state = parseCodexExecJsonOutput(GENUINE_STDOUT, {}, 'gpt-5.6-sol', { source: 'stdout' });
  state = parseCodexExecJsonOutput(TELEMETRY_STDERR, state, 'gpt-5.6-sol', { source: 'stderr' });
  return state;
};

test('echoed turn.started on stderr is NOT counted as a codex event', () => {
  const state = parseIncident();
  assert.equal(state.eventCounts['turn.started'], 1, 'only codex’s own turn.started may be counted');
  assert.equal(state.eventCounts['turn.completed'], 1);
  assert.equal(state.eventCounts['thread.started'], 1);
});

test('echoed events are surfaced separately for diagnostics', () => {
  const state = parseIncident();
  assert.equal(state.telemetryEventCounts['turn.started'], 1);
  assert.equal(state.telemetryEventCounts['thread.started'], 1);
  assert.equal(state.telemetryEventCounts['error'], 1);
});

test('echoed thread.started does not hijack the session id', () => {
  const state = parseIncident();
  assert.equal(state.sessionId, '019fc725-cf6e-7242-a952-dd819e406a63', 'the session id must stay codex’s own thread');
});

test('echoed turn.completed does not inflate token usage', () => {
  let state = parseCodexExecJsonOutput(GENUINE_STDOUT, {}, 'gpt-5.6-sol', { source: 'stdout' });
  state = parseCodexExecJsonOutput(TELEMETRY_STDERR_WITH_COMPLETION, state, 'gpt-5.6-sol', { source: 'stderr' });
  assert.equal(state.tokenUsage.stepCount, 1, 'only codex’s own turn.completed may be accounted');
  assert.equal(state.tokenUsage.outputTokens, 63);
  assert.ok(state.tokenUsage.inputTokens < 41451312, 'the nested agent’s 41M input tokens must not be billed to this run');
});

test('echoed error event does not become a stream error (#1955 class)', () => {
  const state = parseIncident();
  assert.equal(state.streamErrors.length, 0);
  assert.equal(state.itemErrors.length, 0);
});

test('stdout parsing is unchanged when no source is passed (default protocol)', () => {
  const state = parseCodexExecJsonOutput(GENUINE_STDOUT, {}, 'gpt-5.6-sol');
  assert.equal(state.eventCounts['turn.completed'], 1);
  assert.deepEqual(state.turnLifecycle, ['turn.started', 'turn.completed']);
});

test('stderr text diagnostics still work (#2102 plugin-install rejection)', () => {
  const rejection = 'INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=request_plugin_install call_id=c1 arguments={"plugin_id":"playwright@openai-curated-remote"} success=false output=plugin_id must match one of the entries in the <recommended_plugins> list';
  const state = parseCodexExecJsonOutput(rejection, {}, 'gpt-5.6-sol', { source: 'stderr' });
  assert.equal(state.pluginInstallRejections.length, 1, 'text-only stderr diagnostics must keep being parsed');
});

// ============================================================
// Section 2: the completion gate is order-aware (defence in depth)
// ============================================================
console.log('\n=== 2. getCodexCompletionHealth turn-lifecycle order ===');

test('the exact incident state is healthy', () => {
  const health = getCodexCompletionHealth(parseIncident(), { lastMessage: 'PR: https://github.com/link-assistant/formal-ai/pull/913' });
  assert.equal(health.healthy, true, 'a completed run must not be failed because of echoed telemetry');
  assert.equal(health.incompleteSession, false);
  assert.equal(health.reasons.length, 0);
});

test('a stray extra turn.started before a completed turn does not fail the run', () => {
  // Layer B alone: pretend an echoed turn.started still reached the counters.
  const health = getCodexCompletionHealth({
    eventCounts: { 'turn.started': 2, 'turn.completed': 1 },
    turnLifecycle: ['turn.started', 'turn.started', 'turn.completed'],
    commandExecutions: [],
  });
  assert.equal(health.healthy, true, 'the last lifecycle event is a completion, so the session finished');
  assert.equal(health.turnStarted, 2);
});

test('a genuine cut-off mid-turn still fails (#1990 guard)', () => {
  const health = getCodexCompletionHealth(parseCodexExecJsonOutput(['{"thread_id":"t"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"c1","type":"command_execution","command":"cargo build","aggregated_output":"No space left on device (os error 28)\\n","exit_code":101,"status":"completed"}}'].join('\n'), {}, 'gpt-5.6-sol', { source: 'stdout' }));
  assert.equal(health.healthy, false, 'a stream that ends on turn.started is still incomplete');
  assert.equal(health.incompleteSession, true);
  assert.equal(health.diskPressureDetected, true);
});

test('a multi-turn run cut off in its SECOND turn still fails', () => {
  const health = getCodexCompletionHealth({
    eventCounts: { 'turn.started': 2, 'turn.completed': 1, 'item.completed': 3 },
    turnLifecycle: ['turn.started', 'turn.completed', 'turn.started'],
    commandExecutions: [],
  });
  assert.equal(health.healthy, false);
  assert.equal(health.incompleteSession, true);
});

test('states without an ordered lifecycle keep the original count rule', () => {
  const health = getCodexCompletionHealth({ eventCounts: { 'turn.started': 1, 'turn.completed': 0 }, commandExecutions: [] });
  assert.equal(health.incompleteSession, true, 'hand-built states (older callers) still use the count comparison');
});

// ============================================================
// Section 3: diagnostics explain the discrepancy
// ============================================================
console.log('\n=== 3. verbose diagnostics ===');

test('ignored echoed events and the turn lifecycle are reported', () => {
  const lines = buildCodexRunDiagnostics({ state: parseIncident(), exitCode: 0, mappedModel: 'gpt-5.6-sol' }).map(entry => entry.message);
  assert.ok(
    lines.some(line => line.includes('Echoed protocol-shaped lines on codex stderr')),
    'the log must explain which protocol-shaped lines were ignored'
  );
  assert.ok(
    lines.some(line => line.includes('turn lifecycle: turn.started → turn.completed')),
    'the log must show the observed turn lifecycle'
  );
});

// ============================================================
// Section 4: executeCodexCommand end-to-end
// ============================================================
console.log('\n=== 4. executeCodexCommand keeps the completed run successful ===');

const runCodex = async chunks => {
  const logLines = [];
  const fakeDollar = () => () => ({
    async *stream() {
      for (const chunk of chunks) {
        yield chunk.type === 'exit' ? chunk : { type: chunk.type, data: Buffer.from(chunk.data) };
      }
    },
  });
  const argv = { model: 'gpt-5.5', verbose: true };
  const result = await executeCodexCommand({
    tempDir: process.cwd(),
    branchName: 'issue-2136-test',
    prompt: 'test prompt',
    systemPrompt: '',
    argv,
    log: async message => {
      logLines.push(String(message));
    },
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    codexPath: 'codex',
    $: fakeDollar,
    owner: null,
    repo: null,
    prNumber: null,
    calculatePricing: async () => null,
  });
  return { result, logLines, argv };
};

await asyncTest('a completed turn whose stderr echoes another agent’s NDJSON stays success:true', async () => {
  const { result, logLines } = await runCodex([
    { type: 'stdout', data: GENUINE_STDOUT },
    { type: 'stderr', data: TELEMETRY_STDERR },
    { type: 'exit', code: 0 },
  ]);
  assert.equal(result.success, true, 'the run completed — it must not be reported as a failure');
  assert.ok(!logLines.some(line => line.includes('did not complete')), 'must not log the "did not complete" failure');
  assert.equal(result.sessionId, '019fc725-cf6e-7242-a952-dd819e406a63');
});

await asyncTest('an echoed NDJSON split across stderr chunks is still ignored (#2119 buffering)', async () => {
  const half = Math.floor(TELEMETRY_STDERR.length / 2);
  const { result } = await runCodex([
    { type: 'stdout', data: GENUINE_STDOUT },
    { type: 'stderr', data: TELEMETRY_STDERR.slice(0, half) },
    { type: 'stderr', data: TELEMETRY_STDERR.slice(half) },
    { type: 'exit', code: 0 },
  ]);
  assert.equal(result.success, true);
});

await asyncTest('a genuinely incomplete run is still failed (#1990 end-to-end guard)', async () => {
  const { result, logLines } = await runCodex([
    { type: 'stdout', data: ['{"type":"thread.started","thread_id":"thread_cut"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"c1","type":"command_execution","command":"cargo test","aggregated_output":"","exit_code":0,"status":"completed"}}'].join('\n') },
    { type: 'stderr', data: TELEMETRY_STDERR },
    { type: 'exit', code: 0 },
  ]);
  assert.equal(result.success, false, 'a run cut off mid-turn must still be a failure');
  assert.ok(logLines.some(line => line.includes('did not complete')));
});

// ============================================================
// Section 5: same defect class in the qwen path
// ============================================================
// qwen-code also writes its stream-json protocol to stdout while qwen.lib.mjs
// parsed BOTH streams with it. There the blast radius is different but larger in
// one way: a JSON object shaped like an error on stderr lands in `state.errors`,
// and a single entry there fails the run outright.
console.log('\n=== 5. qwen stream separation (same defect class) ===');

const { parseQwenStreamJsonOutput, executeQwenCommand } = await import('../src/qwen.lib.mjs');

test('an error-shaped JSON object on qwen stderr is not a qwen error event', () => {
  let state = parseQwenStreamJsonOutput('{"type":"session.started","session_id":"session-2136"}\n{"type":"result","result":"Done."}\n');
  state = parseQwenStreamJsonOutput('[DEBUG] replaying tool output:\n{"type":"error","message":"Network lookup skipped in fixture"}\n', state, { source: 'stderr' });
  assert.equal(state.errors.length, 0, 'echoed error JSON on stderr must not fail the run');
  assert.equal(state.telemetryEventCounts.error, 1, 'but it must stay visible as a diagnostic');
});

test('qwen stderr records do not hijack the session id or token usage', () => {
  let state = parseQwenStreamJsonOutput('{"type":"session.started","session_id":"session-2136"}\n{"type":"result","result":"Done.","usage":{"input_tokens":10,"output_tokens":2}}\n');
  state = parseQwenStreamJsonOutput('{"type":"session.started","session_id":"nested-run"}\n{"type":"result","usage":{"input_tokens":9999999,"output_tokens":123456}}\n', state, { source: 'stderr' });
  assert.equal(state.sessionId, 'session-2136');
  assert.equal(state.tokenUsage.stepCount, 1);
  assert.equal(state.tokenUsage.outputTokens, 2);
});

test('a terminal result event echoed on stderr does not satisfy the #1990 gate', () => {
  let state = parseQwenStreamJsonOutput('{"type":"session.started","session_id":"session-2136"}\n{"type":"assistant","message":{"content":"working"}}\n');
  state = parseQwenStreamJsonOutput('{"type":"result","result":"echoed from a nested agent"}\n', state, { source: 'stderr' });
  assert.equal(state.eventCounts.result || 0, 0, 'an echoed terminal event must not mask a cut-off run');
});

test('qwen stdout and stderr are framed by independent buffers', () => {
  // A stdout record split across chunks must not be corrupted by stderr text
  // arriving in between.
  let state = parseQwenStreamJsonOutput('{"type":"result","res');
  state = parseQwenStreamJsonOutput('[DEBUG] unrelated stderr line\n', state, { source: 'stderr' });
  state = parseQwenStreamJsonOutput('ult":"Done."}\n', state);
  assert.equal(state.eventCounts.result, 1, 'the split stdout record must still parse');
});

await asyncTest('qwen run whose stderr echoes an error JSON still succeeds', async () => {
  const fs = (await import('node:fs')).promises;
  const os = (await import('node:os')).default;
  const path = (await import('node:path')).default;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-2136-'));
  const logLines = [];
  const result = await executeQwenCommand({
    tempDir,
    branchName: 'issue-2136-test',
    prompt: 'Proceed.',
    systemPrompt: '',
    argv: { model: 'qwen', url: 'https://github.com/link-assistant/hive-mind/issues/2136', verbose: true },
    log: async message => logLines.push(String(message)),
    formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
    getResourceSnapshot: async () => ({ memory: '\nMem: 1 2', load: '0.00' }),
    waitForRetryDelay: async () => {},
    qwenPath: 'qwen',
    $: () => () => ({
      async *stream() {
        yield { type: 'stdout', data: Buffer.from('{"type":"session.started","session_id":"session-2136"}\n{"type":"result","result":"Done."}\n') };
        yield { type: 'stderr', data: Buffer.from('{"type":"error","message":"Network lookup skipped in fixture"}\n') };
        yield { type: 'exit', code: 0 };
      },
    }),
  });
  await fs.rm(tempDir, { recursive: true, force: true });
  assert.equal(result.success, true, 'an echoed error object on stderr must not fail a completed qwen run');
  assert.ok(
    logLines.some(line => line.includes('JSON records on qwen stderr')),
    'the ignored records must be reported in verbose mode'
  );
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
console.log('\n✅ All issue #2136 tests passed');
