#!/usr/bin/env node
// Test file for issue #1990: "For some reason docker isolation failed with 2 tasks".
//
// Root cause (reconstructed from the two captured failure logs, see
// docs/case-studies/issue-1990):
//   Two long-running `solve --tool codex` tasks ran in detached docker isolation.
//   Their containers ran out of disk: cargo builds died with "No space left on
//   device" / exit 101 and no commits were produced. Yet both runs were reported
//   as SUCCESS (Exit Code: 0). The codex process was cut off MID-TURN — both logs
//   end with turn.started=1, turn.completed=0, turn.failed=0 — but
//   executeCodexCommand declared success because the exit code was 0 and codex
//   emitted no `turn.failed`/error event. Under docker isolation a false success
//   also discards the container filesystem we needed to inspect and retry from.
//
// Fix: getCodexCompletionHealth() requires codex's own turn lifecycle to show a
// completed turn (turn.completed/turn.failed >= turn.started). An exit-0 run that
// was cut off mid-turn is now registered as a FAILURE (success:false), which
// preserves the session (argv.resume) for a context-preserving full restart and,
// under docker isolation, preserves the container filesystem.
//
// Echo-proofing (issue #1955 regression guard): disk-exhaustion strings are NOT a
// standalone failure gate. Codex echoes the stdout of every command it runs back
// into its own stream, so a COMPLETED turn whose command merely prints "No space
// left on device" (e.g. a `sed`/`cat` of a saved log — observed at exit_code 0 in
// the real logs) must still succeed.

import assert from 'node:assert/strict';

const { parseCodexExecJsonOutput, getCodexCompletionHealth, executeCodexCommand } = await import('../src/codex.lib.mjs');

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

const runCodex = async jsonl => {
  const logLines = [];
  const fakeDollar = () => () => ({
    async *stream() {
      yield { type: 'stdout', data: Buffer.from(jsonl) };
      yield { type: 'exit', code: 0 };
    },
  });
  const argv = { model: 'gpt-5.5', verbose: false };
  const result = await executeCodexCommand({
    tempDir: process.cwd(),
    branchName: 'issue-1990-test',
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

console.log('Testing Codex exit-0-but-incomplete false success (Issue #1990)\n');

// ============================================================
// Section 1: getCodexCompletionHealth — the protocol-level gate
// ============================================================
console.log('=== 1. getCodexCompletionHealth turn-lifecycle gate ===');

// Reconstructed shape of the real failures: a turn started, a command ran, then
// the process was cut off — NO turn.completed, NO turn.failed.
const INCOMPLETE_JSONL = ['{"type":"thread.started","thread_id":"thread_1990"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"cmd_1","type":"command_execution","command":"cargo test","aggregated_output":"   Compiling formal-ai v0.1.0\\n","exit_code":0,"status":"completed"}}'].join('\n');

// A genuinely healthy run: the turn completed.
const COMPLETE_JSONL = ['{"type":"thread.started","thread_id":"thread_ok"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"Done."}}', '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'].join('\n');

// A COMPLETED run whose command echoed a disk-error phrase (issue #1955 class):
// codex re-emits command stdout, so `sed`/`cat` of a saved log that contains
// "No space left on device" appears here at exit_code 0. Must NOT fail.
const COMPLETE_BUT_ECHOES_DISK_JSONL = ['{"type":"thread.started","thread_id":"thread_echo"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"cmd_1","type":"command_execution","command":"sed -n \'1,5p\' /tmp/build.log","aggregated_output":"rustc-LLVM ERROR: IO failure on output stream: No space left on device\\n","exit_code":0,"status":"completed"}}', '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"The earlier build hit a disk error; I cleaned target/ and tests pass now."}}', '{"type":"turn.completed","usage":{"input_tokens":20,"output_tokens":8}}'].join('\n');

// An incomplete run that ALSO shows real disk pressure in a command output.
const INCOMPLETE_WITH_DISK_JSONL = ['{"type":"thread.started","thread_id":"thread_disk"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"cmd_1","type":"command_execution","command":"cargo build","aggregated_output":"error: could not compile `formal-ai`\\nCaused by:\\n  No space left on device (os error 28)\\n","exit_code":101,"status":"completed"}}'].join('\n');

test('incomplete session (turn.started=1, turn.completed=0) is NOT healthy', () => {
  const health = getCodexCompletionHealth(parseCodexExecJsonOutput(INCOMPLETE_JSONL, {}, 'gpt-5.5'));
  assert.equal(health.healthy, false, 'a cut-off mid-turn run must not be healthy');
  assert.equal(health.incompleteSession, true);
  assert.equal(health.turnStarted, 1);
  assert.equal(health.turnCompleted, 0);
  assert.match(health.reasons.join(' '), /without completing its turn/i);
});

test('completed turn is healthy', () => {
  const health = getCodexCompletionHealth(parseCodexExecJsonOutput(COMPLETE_JSONL, {}, 'gpt-5.5'));
  assert.equal(health.healthy, true);
  assert.equal(health.incompleteSession, false);
  assert.equal(health.turnCompleted, 1);
});

test('completed turn that ECHOES a disk-error phrase stays healthy (no #1955 false positive)', () => {
  const health = getCodexCompletionHealth(parseCodexExecJsonOutput(COMPLETE_BUT_ECHOES_DISK_JSONL, {}, 'gpt-5.5'));
  assert.equal(health.healthy, true, 'echoed "No space left on device" on a completed turn must NOT fail the run');
  // Disk pressure may be observed as diagnostics, but it is never the failure reason on a completed turn.
  assert.equal(health.reasons.length, 0, 'a completed turn must have no failure reasons');
});

test('incomplete session WITH real disk pressure reports both signals', () => {
  const health = getCodexCompletionHealth(parseCodexExecJsonOutput(INCOMPLETE_WITH_DISK_JSONL, {}, 'gpt-5.5'));
  assert.equal(health.healthy, false);
  assert.equal(health.incompleteSession, true);
  assert.equal(health.diskPressureDetected, true, 'the os error 28 in command output is surfaced as diagnostics');
  assert.match(health.reasons.join(' '), /No space left on device/i);
});

test('empty/no-activity stream is not spuriously flagged', () => {
  const health = getCodexCompletionHealth(parseCodexExecJsonOutput('{"type":"thread.started","thread_id":"t"}', {}, 'gpt-5.5'));
  assert.equal(health.healthy, true, 'a stream with no turns and no commands must not be failed');
  assert.equal(health.incompleteSession, false);
});

// ============================================================
// Section 2: executeCodexCommand end-to-end
// ============================================================
console.log('\n=== 2. executeCodexCommand registers the broken run as failure ===');

await asyncTest('exit-0 incomplete session returns success:false and preserves the session', async () => {
  const { result, logLines, argv } = await runCodex(INCOMPLETE_JSONL);
  assert.equal(result.success, false, 'an exit-0 run cut off mid-turn must be registered as a failure');
  assert.equal(result.incompleteSession, true);
  assert.equal(argv.resume, result.sessionId, 'the session must be preserved for a context-preserving restart');
  assert.ok(
    logLines.some(line => line.includes('did not complete')),
    'must log why the run was failed'
  );
});

await asyncTest('exit-0 incomplete session WITH disk pressure surfaces disk diagnostics', async () => {
  const { result, logLines } = await runCodex(INCOMPLETE_WITH_DISK_JSONL);
  assert.equal(result.success, false);
  assert.equal(result.diskPressureDetected, true);
  assert.ok(
    logLines.some(line => line.includes('Disk-exhaustion evidence')),
    'must surface disk evidence in the log'
  );
});

await asyncTest('a completed turn still returns success:true', async () => {
  const { result } = await runCodex(COMPLETE_JSONL);
  assert.equal(result.success, true, 'a genuinely completed turn must still succeed');
});

await asyncTest('a completed turn echoing a disk phrase still returns success:true (#1955 guard)', async () => {
  const { result, logLines } = await runCodex(COMPLETE_BUT_ECHOES_DISK_JSONL);
  assert.equal(result.success, true, 'echoed disk phrase on a completed turn must NOT be failed');
  assert.ok(!logLines.some(line => line.includes('did not complete')), 'must not claim the completed run was incomplete');
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
console.log('\n✅ All issue #1990 tests passed');
