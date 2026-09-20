#!/usr/bin/env node
// Test file for issue #1955: "CODEX execution failed with Network lookup skipped
// in fixture".
//
// Root cause (reconstructed from the captured failure log, see
// docs/case-studies/issue-1955):
//   The Codex CLI (v0.141.0) prints OTEL telemetry to its output stream
//   (`codex_otel.log_only`, event.name="codex.tool_result") that contains a raw
//   `Output:` dump of every command's stdout. While working on an *unrelated*
//   task (formal-ai #518 — an "Agent CLI NDJSON adapter"), the codex agent ran a
//   command that printed an NDJSON fixture file whose contents included the line:
//     {"type":"error","message":"Network lookup skipped in fixture"}
//   Our line-by-line JSON parser saw that echoed line, JSON.parse()'d it, and
//   recorded it as a genuine Codex *stream* error — failing an otherwise
//   successful run (codex finished, working tree clean, CI passed, the turn
//   completed with NO turn.failed).
//
// Fix: getCodexErrorEventSummary() now treats stray non-`turn` error events as
// non-fatal whenever the turn completed successfully (a `turn.completed` event
// with no `turn.failed`). `turn.failed` remains the authoritative failure signal
// and is never suppressed.

import assert from 'node:assert/strict';

const { parseCodexExecJsonOutput, getCodexErrorEventSummary, executeCodexCommand } = await import('../src/codex.lib.mjs');
const { classifyRetryableError } = await import('../src/tool-retry.lib.mjs');

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

console.log('Testing Codex fixture-content false-positive error (Issue #1955)\n');

// ============================================================
// Section 1: The exact reproduction — echoed fixture content on a successful turn
// ============================================================
console.log('=== 1. Echoed fixture content must NOT fail a completed turn ===');

// Reconstructs the relevant slice of the real failure log: the structured codex
// protocol events (thread.started ... turn.completed) interleaved with the OTEL
// `Output:` dump lines, which are an echoed NDJSON fixture (session_start / text /
// tool_use / tool_result / error / text). Only the standalone `error` line ever
// confused the parser.
const FIXTURE_FALSE_POSITIVE_JSONL = [
  '{"type":"thread.started","thread_id":"thread_issue_1955"}',
  '{"type":"turn.started"}',
  '{"type":"item.started","item":{"id":"cmd_1","type":"command_execution","command":"sed -n \'1,20p\' fixtures/issue-518-agent.ndjson","aggregated_output":"","status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"cmd_1","type":"command_execution","command":"sed -n \'1,20p\' fixtures/issue-518-agent.ndjson","aggregated_output":"...","exit_code":0,"status":"completed"}}',
  // ↓ echoed OTEL "Output:" dump of the printed fixture file (NOT real protocol events)
  '{"type":"session_start","session_id":"issue-518-fixture"}',
  '{"type":"text","text":"I will inspect the home directory.\\n"}',
  '{"type":"tool_use","id":"call_ls_home","tool":"bash","input":{"command":"ls ~"}}',
  '{"type":"tool_result","id":"call_ls_home","tool":"bash","output":{"stdout":"Desktop\\nDocuments\\n","stderr":"","exitCode":0,"status":"completed"}}',
  '{"type":"error","message":"Network lookup skipped in fixture"}',
  '{"type":"text","text":"Desktop and Documents are present."}',
  // ↓ real codex completion — the turn SUCCEEDED, there is no turn.failed
  '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"Done. PR is ready for review."}}',
  '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":200,"output_tokens":50}}',
].join('\n');

test('parser still records the stray stream error (so it is observable)', () => {
  const parsed = parseCodexExecJsonOutput(FIXTURE_FALSE_POSITIVE_JSONL, {}, 'gpt-5.5');
  assert.equal(parsed.streamErrors.length, 1, 'the echoed error line is still captured for observability');
  assert.equal(parsed.eventCounts['turn.completed'], 1);
  assert.equal(parsed.turnFailures.length, 0, 'there must be no turn.failed');
});

test('error summary reports NO fatal error for a completed turn', () => {
  const parsed = parseCodexExecJsonOutput(FIXTURE_FALSE_POSITIVE_JSONL, {}, 'gpt-5.5');
  const summary = getCodexErrorEventSummary(parsed);
  assert.equal(summary.hasError, false, 'a completed turn must not be reported as a hard failure');
  assert.equal(summary.counts.stream, 0, 'the stray stream error must be reclassified as non-fatal');
});

test('the suppressed stray error is recorded in ignoredEvents with a reason', () => {
  const parsed = parseCodexExecJsonOutput(FIXTURE_FALSE_POSITIVE_JSONL, {}, 'gpt-5.5');
  const summary = getCodexErrorEventSummary(parsed);
  assert.equal(summary.ignoredEvents.length, 1);
  assert.equal(summary.ignoredEvents[0].message, 'Network lookup skipped in fixture');
  assert.match(summary.ignoredEvents[0].reason, /turn completed successfully/i);
  assert.equal(summary.ignoredCounts.stream, 1);
});

await asyncTest('executeCodexCommand returns success for the issue #1955 stream', async () => {
  const logLines = [];
  const fakeDollar = () => () => ({
    async *stream() {
      yield { type: 'stdout', data: Buffer.from(FIXTURE_FALSE_POSITIVE_JSONL) };
      yield { type: 'exit', code: 0 };
    },
  });

  const result = await executeCodexCommand({
    tempDir: process.cwd(),
    branchName: 'issue-1955-test',
    prompt: 'test prompt',
    systemPrompt: '',
    argv: { model: 'gpt-5.5', verbose: false },
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

  assert.equal(result.success, true, 'the run must succeed despite the echoed fixture error line');
  assert.ok(!logLines.some(line => line.includes('Codex emitted error event')), 'must NOT log the echoed fixture line as a fatal Codex error');
});

// ============================================================
// Section 2: Regressions — genuine failures must still fail
// ============================================================
console.log('\n=== 2. Genuine Codex failures still fail (no over-suppression) ===');

test('a real error + turn.failed (no turn.completed) is still fatal', () => {
  const jsonl = ['{"type":"thread.started","thread_id":"thread_real_fail"}', '{"type":"error","message":"Selected model is at capacity. Please try a different model."}', '{"type":"turn.failed","error":{"message":"Selected model is at capacity. Please try a different model."}}'].join('\n');
  const summary = getCodexErrorEventSummary(parseCodexExecJsonOutput(jsonl, {}, 'gpt-5.5'));
  assert.equal(summary.hasError, true, 'turn.failed must remain fatal');
  assert.equal(summary.counts.turn, 1);
});

test('a stray error with NO turn.completed and NO turn.failed is still fatal', () => {
  // Process died mid-stream: no evidence of success, so do not suppress.
  const jsonl = ['{"type":"thread.started","thread_id":"thread_mid"}', '{"type":"error","message":"unexpected internal error"}'].join('\n');
  const summary = getCodexErrorEventSummary(parseCodexExecJsonOutput(jsonl, {}, 'gpt-5.5'));
  assert.equal(summary.hasError, true, 'without turn.completed the error stays fatal');
  assert.equal(summary.counts.stream, 1);
});

// ============================================================
// Section 3: Expanded transient network retry classification (Issue #1955)
// ============================================================
console.log('\n=== 3. Expanded transient network retry classification ===');

const RETRYABLE_NETWORK_CASES = [
  ['getaddrinfo ENOTFOUND api.openai.com', 'DNS resolution failure'],
  ['getaddrinfo EAI_AGAIN api.github.com', 'DNS resolution failure'],
  ['Temporary failure in name resolution', 'DNS resolution failure'],
  ['Error: connect ETIMEDOUT 140.82.121.6:443', 'Transient network connection failure'],
  ['connect ECONNREFUSED 127.0.0.1:443', 'Transient network connection failure'],
  ['connect EHOSTUNREACH', 'Transient network connection failure'],
  ['connect ENETUNREACH', 'Transient network connection failure'],
  ['write EPIPE', 'Transient network connection failure'],
  ['502 Bad Gateway', 'Gateway error (502/504/52x)'],
  ['504 Gateway Timeout', 'Gateway error (502/504/52x)'],
  ['error code: 522', 'Gateway error (502/504/52x)'],
  ['503 Service Unavailable', '503 network error'],
];

for (const [message, expectedLabel] of RETRYABLE_NETWORK_CASES) {
  test(`retryable: "${message}" -> ${expectedLabel}`, () => {
    const result = classifyRetryableError(message);
    assert.equal(result.isRetryable, true, `"${message}" should be retryable`);
    assert.equal(result.isCapacity, false, `"${message}" is a network fault, not capacity`);
    assert.equal(result.label, expectedLabel, `unexpected label: ${result.label}`);
  });
}

test('the fixture phrase "Network lookup skipped in fixture" is NOT treated as a retryable network error', () => {
  // Guard: the expanded DNS/network patterns must not accidentally match the
  // echoed fixture phrase that triggered issue #1955 — it is not an error at all.
  const result = classifyRetryableError('Network lookup skipped in fixture');
  assert.equal(result.isRetryable, false);
  assert.equal(result.label, null);
});

const NON_RETRYABLE_CASES = ['Error: ENOENT: no such file or directory', 'SyntaxError: Unexpected token', 'context_length_exceeded', 'Permission denied (publickey).'];
for (const message of NON_RETRYABLE_CASES) {
  test(`non-retryable: "${message.slice(0, 40)}"`, () => {
    assert.equal(classifyRetryableError(message).isRetryable, false, `"${message}" should NOT be retryable`);
  });
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
console.log('\n✅ All issue #1955 tests passed');
