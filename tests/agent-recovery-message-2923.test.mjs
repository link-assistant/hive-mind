#!/usr/bin/env node
/**
 * Regression coverage for issue #2923: the Formal AI Draft run 37959364207 logged
 *
 *   ℹ️  Agent recovered from earlier error and completed successfully
 *   ❌ Agent reported error: Error: File not found: /tmp/gh-issue-solver-1791563735645/e.g
 *
 * for the same error. The run correctly failed (the error record in the output
 * fails the run, issue #1201), so the "recovered" line was false.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2923
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveStreamingErrorRecovery } from '../src/agent-command.lib.mjs';
import { detectAgentErrorsInOutput } from '../src/agent.lib.mjs';

// The error record from run 37959364207 (trimmed), followed by the agent's own reply.
const RUN_37959364207_OUTPUT = [JSON.stringify({ type: 'error', sessionID: 'ses_ede7a269affeB7JZl5VhKcJrEu', error: 'Error: File not found: /tmp/gh-issue-solver-1791563735645/e.g' }), JSON.stringify({ type: 'text', part: { text: 'The command failed: Error: File not found: /tmp/gh-issue-solver-1791563735645/e.g' } }), JSON.stringify({ type: 'step_finish', part: { reason: 'stop' } })].join('\n');

test('an error that still fails the run is never logged as recovered', () => {
  const outputError = detectAgentErrorsInOutput(RUN_37959364207_OUTPUT);
  assert.equal(outputError.detected, true, 'the error record fails the run (issue #1201)');
  const recovery = resolveStreamingErrorRecovery({ exitCode: 0, agentCompletedSuccessfully: true, streamingErrorDetected: true, outputErrorDetected: outputError.detected });
  assert.equal(recovery.clearStreamingError, true);
  assert.doesNotMatch(recovery.message, /recovered|completed successfully/);
  assert.match(recovery.message, /still fails the run/);
});

test('a streaming error with no error record in the output is a real recovery (issue #1276)', () => {
  const recovery = resolveStreamingErrorRecovery({ exitCode: 0, agentCompletedSuccessfully: true, streamingErrorDetected: true, outputErrorDetected: false });
  assert.deepEqual(recovery, { clearStreamingError: true, message: 'ℹ️  Agent recovered from earlier error and completed successfully' });
});

test('nothing is cleared or logged on a non-zero exit or an unfinished session', () => {
  assert.deepEqual(resolveStreamingErrorRecovery({ exitCode: 1, agentCompletedSuccessfully: true, streamingErrorDetected: true, outputErrorDetected: false }), { clearStreamingError: false, message: null });
  assert.deepEqual(resolveStreamingErrorRecovery({ exitCode: 0, agentCompletedSuccessfully: false, streamingErrorDetected: true, outputErrorDetected: false }), { clearStreamingError: false, message: null });
  assert.deepEqual(resolveStreamingErrorRecovery({ exitCode: 0, agentCompletedSuccessfully: false, streamingErrorDetected: false, outputErrorDetected: false }), { clearStreamingError: true, message: null });
});
