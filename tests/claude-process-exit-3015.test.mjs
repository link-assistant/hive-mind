#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Unit tests for src/claude.process-exit.lib.mjs and the summary guard in
 * extractToolErrorCore (Issue #3015).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { describeExitCode, interpretClaudeExitCode, isProcessGroupAlive, isSuccessSummaryText, selectClaudeFailureMessage } from '../src/claude.process-exit.lib.mjs';
import { extractToolErrorCore, formatToolExecutionFailure } from '../src/lib.mjs';

const summary = 'I fixed the four `/queue` problems from the issue and log, and marked PR #2824 ready for review.';

test('describeExitCode names the signal for 128 + n codes', () => {
  assert.equal(describeExitCode(143), '143 (SIGTERM)');
  assert.equal(describeExitCode(137), '137 (SIGKILL)');
  assert.equal(describeExitCode(1), '1');
});

test('the solver killing the CLI after a successful result is ignored', () => {
  const verdict = interpretClaudeExitCode({ code: 143, forceExitTriggered: true, resultCloseTimeoutFired: true, resultSuccessReceived: true });
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.failed, false);
  assert.equal(verdict.ignored, true);
  assert.match(verdict.reason, /143 \(SIGTERM\)/);
});

test('a post-result kill after an error result keeps its exit code', () => {
  const verdict = interpretClaudeExitCode({ code: 143, forceExitTriggered: true, resultCloseTimeoutFired: true, resultSuccessReceived: false });
  assert.deepEqual(verdict, { exitCode: 143, failed: false, ignored: false, reason: null });
});

test('other solver kills keep the code but leave the verdict to their own flags', () => {
  const verdict = interpretClaudeExitCode({ code: 143, forceExitTriggered: true, resultCloseTimeoutFired: false, resultSuccessReceived: true });
  assert.deepEqual(verdict, { exitCode: 143, failed: false, ignored: false, reason: null });
});

test('a non-zero exit the solver did not cause is a failure', () => {
  assert.deepEqual(interpretClaudeExitCode({ code: 1, resultSuccessReceived: true }), { exitCode: 1, failed: true, ignored: false, reason: null });
  assert.deepEqual(interpretClaudeExitCode({ code: 143 }), { exitCode: 143, failed: true, ignored: false, reason: null });
});

test('exit 0 and missing codes are not failures', () => {
  assert.equal(interpretClaudeExitCode({ code: 0 }).failed, false);
  assert.equal(interpretClaudeExitCode({ code: undefined }).failed, false);
  assert.equal(interpretClaudeExitCode({ code: null }).failed, false);
});

test('isSuccessSummaryText compares whitespace-normalized text', () => {
  assert.equal(isSuccessSummaryText(`  ${summary.replace(/ /g, '\n')} `, summary), true);
  assert.equal(isSuccessSummaryText('API Error: 500', summary), false);
  assert.equal(isSuccessSummaryText(summary, null), false);
  assert.equal(isSuccessSummaryText('', ''), false);
});

test('selectClaudeFailureMessage replaces the success summary with an exit description', () => {
  assert.equal(selectClaudeFailureMessage({ lastMessage: summary, exitCode: 143, resultSuccessReceived: true, resultSummary: summary }), 'Claude CLI exited with code 143 (SIGTERM) after reporting a successful result');
  assert.equal(selectClaudeFailureMessage({ lastMessage: summary, exitCode: 0, resultSuccessReceived: true, resultSummary: summary }), 'Claude session failed after reporting a successful result');
});

test('selectClaudeFailureMessage keeps real error text', () => {
  assert.equal(selectClaudeFailureMessage({ lastMessage: 'Final tool result failed: Exit code 1', exitCode: 0, resultSuccessReceived: true, resultSummary: summary }), 'Final tool result failed: Exit code 1');
  assert.equal(selectClaudeFailureMessage({ lastMessage: summary, exitCode: 1, resultSuccessReceived: false, resultSummary: null }), summary);
});

test('extractToolErrorCore never publishes the work summary as the error, for any tool', () => {
  for (const tool of ['claude', 'codex', 'agent', 'opencode']) {
    const toolResult = { success: false, resultSummary: summary, errorInfo: { message: summary } };
    assert.equal(extractToolErrorCore({ toolResult }), null);
    assert.equal(formatToolExecutionFailure({ tool, toolResult }), `${tool.toUpperCase()} execution failed`);
  }
});

test('extractToolErrorCore still reports real errors next to a summary', () => {
  const toolResult = { success: false, resultSummary: summary, errorInfo: { message: 'API Error: Output blocked by content filtering policy' } };
  assert.equal(formatToolExecutionFailure({ tool: 'claude', toolResult }), 'CLAUDE execution failed with API Error: Output blocked by content filtering policy');
});

test('isProcessGroupAlive maps kill(0) outcomes', () => {
  assert.equal(
    isProcessGroupAlive(42, () => true),
    true
  );
  const fail = code => () => {
    throw Object.assign(new Error(code), { code });
  };
  assert.equal(isProcessGroupAlive(42, fail('ESRCH')), false);
  assert.equal(isProcessGroupAlive(42, fail('EPERM')), true);
});

test('isProcessGroupAlive sees a real group until it is killed', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  // A single-process group: an orphaned grandchild would stay a zombie member of the group on
  // hosts whose PID 1 does not reap (e.g. a container running node as PID 1).
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  await new Promise(resolve => child.once('spawn', resolve));
  assert.equal(isProcessGroupAlive(child.pid), true);
  const exited = new Promise(resolve => child.once('exit', resolve));
  process.kill(-child.pid, 'SIGKILL');
  await exited;
  assert.equal(isProcessGroupAlive(child.pid), false);
});
