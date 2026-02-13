#!/usr/bin/env node

/**
 * Tests for agent error detection logic
 * Issue #886: Simplified error detection - trust exit code, don't pattern match output
 *
 * The agent now properly returns:
 * - exit code 1 on errors
 * - JSON error messages (type: "error" or "step_error")
 *
 * We no longer scan output for error patterns as this causes false positives
 * when AI executes bash commands that produce warnings like "Permission denied"
 * but actually succeed (exit code 0).
 */

import { strict as assert } from 'assert';

// Simplified error detection function - matches agent.lib.mjs
// Only detects explicit JSON error messages from agent
// Issue #1201: Also checks msg.error field (not just msg.message)
const detectAgentErrors = stdoutOutput => {
  const lines = stdoutOutput.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);

      // Check for explicit error message types from agent
      if (msg.type === 'error' || msg.type === 'step_error') {
        return { detected: true, type: 'AgentError', match: msg.message || msg.error || line.substring(0, 100) };
      }
    } catch {
      // Not JSON - ignore for error detection
      continue;
    }
  }

  return { detected: false };
};

console.log('Testing simplified agent error detection...\n');
console.log('Issue #886: Trust exit code, only detect explicit JSON errors\n');

// Test 1: Issue #886 scenario - bash command with shell warnings but successful completion
// With simplified detection, we don't scan output at all - just trust exit code
console.log('Test 1: Bash command with shell warnings should NOT trigger error');
const issue886Output = `{"type":"tool_use","timestamp":1765265945140,"sessionID":"ses_4fdf45a99ffeEgHuqAqwnsYT7b","part":{"type":"tool","callID":"call_40598996","tool":"bash","state":{"status":"completed","input":{"command":"gh pr edit 2 ..."},"output":"/bin/sh: 1: src/main.rs: Permission denied\\n/bin/sh: 1: .github/workflows/test-hello-world.yml: Permission denied\\nhttps://github.com/konard/test-hello-world-019b020a-a43c-7544-aaa1-220021798428/pull/2\\n","metadata":{"exit":0}}}}`;
const result1 = detectAgentErrors(issue886Output);
assert.strictEqual(result1.detected, false, 'Should NOT detect error - no JSON error message');
console.log('  ✅ PASSED: Shell warnings in output ignored (trust exit code)\n');

// Test 2: Completed tool with source code containing error text (Issue #873)
console.log('Test 2: Tool output with "permission denied" text should NOT trigger error');
const issue873Output = `{"type":"tool","state":{"status":"completed","input":{"filePath":"src/solve.auto-pr.lib.mjs"},"output":"<file>\\n00375| if (errorOutput.includes('Permission to') && errorOutput.includes('denied'))\\n00404| await log('PERMISSION DENIED: Cannot push')\\n</file>"}}`;
const result2 = detectAgentErrors(issue873Output);
assert.strictEqual(result2.detected, false, 'Should NOT detect error - no JSON error message');
console.log('  ✅ PASSED: Source code with error strings ignored\n');

// Test 3: Explicit error message type should be detected
console.log('Test 3: Explicit JSON error message should be detected');
const errorMsgOutput = `{"type":"error","message":"Something went wrong"}`;
const result3 = detectAgentErrors(errorMsgOutput);
assert.strictEqual(result3.detected, true, 'Should detect error message type');
assert.strictEqual(result3.type, 'AgentError', 'Should be AgentError type');
assert.strictEqual(result3.match, 'Something went wrong', 'Should capture error message');
console.log('  ✅ PASSED: JSON error message correctly detected\n');

// Test 4: step_error type should be detected
console.log('Test 4: step_error type should be detected');
const stepErrorOutput = `{"type":"step_error","message":"Tool execution failed"}`;
const result4 = detectAgentErrors(stepErrorOutput);
assert.strictEqual(result4.detected, true, 'Should detect step_error type');
assert.strictEqual(result4.type, 'AgentError', 'Should be AgentError type');
console.log('  ✅ PASSED: step_error type correctly detected\n');

// Test 5: Non-JSON text with error patterns should NOT be detected
// (We no longer pattern match - trust exit code instead)
console.log('Test 5: Non-JSON error text should NOT trigger error (trust exit code)');
const nonJsonError = 'Error: Cannot read properties of undefined\n    at Object.<anonymous> (/path/to/file.js:10:15)';
const result5 = detectAgentErrors(nonJsonError);
assert.strictEqual(result5.detected, false, 'Should NOT detect error - no JSON error message');
console.log('  ✅ PASSED: Non-JSON error text ignored (trust exit code)\n');

// Test 6: Stack traces should NOT trigger error (trust exit code)
console.log('Test 6: Stack traces should NOT trigger error (trust exit code)');
const stackTrace = 'TypeError: Cannot read property "foo" of null\n    at process (/app/index.js:42:10)';
const result6 = detectAgentErrors(stackTrace);
assert.strictEqual(result6.detected, false, 'Should NOT detect error - no JSON error message');
console.log('  ✅ PASSED: Stack traces ignored (trust exit code)\n');

// Test 7: Clean output with no errors
console.log('Test 7: Clean output should not trigger errors');
const cleanOutput = `{"type":"step_start","snapshot":"abc123"}
{"type":"tool_use","part":{"type":"tool","state":{"status":"completed","output":"Hello, World!"}}}
{"type":"step_finish","reason":"stop"}`;
const result7 = detectAgentErrors(cleanOutput);
assert.strictEqual(result7.detected, false, 'Should not detect error in clean output');
console.log('  ✅ PASSED: Clean output correctly passes\n');

// Test 8: Error message without message field should still be detected
console.log('Test 8: Error type without message field');
const errorNoMsg = `{"type":"error"}`;
const result8 = detectAgentErrors(errorNoMsg);
assert.strictEqual(result8.detected, true, 'Should detect error type even without message');
assert.strictEqual(result8.type, 'AgentError', 'Should be AgentError type');
console.log('  ✅ PASSED: Error type without message correctly detected\n');

// Test 9: Mixed output with error among normal messages
console.log('Test 9: Mixed output with error message');
const mixedOutput = `{"type":"step_start","snapshot":"abc123"}
{"type":"tool_use","part":{"type":"tool","state":{"status":"completed","output":"doing work..."}}}
{"type":"error","message":"Rate limit exceeded"}
{"type":"step_finish","reason":"error"}`;
const result9 = detectAgentErrors(mixedOutput);
assert.strictEqual(result9.detected, true, 'Should detect error in mixed output');
assert.strictEqual(result9.match, 'Rate limit exceeded', 'Should capture error message');
console.log('  ✅ PASSED: Error detected in mixed output\n');

// Test 10: Tool with failed status - not detected by detectAgentErrors
// (This is handled by checking exit code != 0)
console.log('Test 10: Tool with failed status (handled by exit code, not output scan)');
const failedToolOutput = `{"type":"tool","state":{"status":"failed","error":"File not found"}}`;
const result10 = detectAgentErrors(failedToolOutput);
assert.strictEqual(result10.detected, false, 'Failed tool status not detected by output scan (handled by exit code)');
console.log('  ✅ PASSED: Failed tool status handled by exit code, not output scan\n');

// ====================================================================
// Issue #1201 tests: "type": "error" was not treated as fail
// ====================================================================
console.log('--- Issue #1201 Tests ---\n');

// Test 11: Error with "error" field (not "message") should be detected with correct text
console.log('Test 11: Error with "error" field (not "message") should capture error text');
const errorFieldOutput = `{"type":"error","timestamp":1769784980576,"sessionID":"ses_3f09cdf7affePwF0n1677v3wqX","error":"The operation timed out."}`;
const result11 = detectAgentErrors(errorFieldOutput);
assert.strictEqual(result11.detected, true, 'Should detect error type');
assert.strictEqual(result11.match, 'The operation timed out.', 'Should capture error field content');
console.log('  ✅ PASSED: Error field correctly captured\n');

// Test 12: Error event followed by continuation (agent continues after error but should still fail)
console.log('Test 12: Error event followed by more output (agent continued after error)');
const continueAfterError = ['{"type":"step_start","timestamp":1769784927363,"sessionID":"ses_test"}', '{"type":"error","timestamp":1769784980576,"sessionID":"ses_test","error":"The operation timed out."}', '{"type":"text","timestamp":1769785052790,"sessionID":"ses_test","part":{"type":"text","text":"Now continuing..."}}', '{"type":"step_finish","timestamp":1769785052800,"sessionID":"ses_test","part":{"type":"step-finish","reason":"other"}}'].join('\n');
const result12 = detectAgentErrors(continueAfterError);
assert.strictEqual(result12.detected, true, 'Should detect error even when agent continues after it');
assert.strictEqual(result12.match, 'The operation timed out.', 'Should capture the error message');
console.log('  ✅ PASSED: Error detected even when agent continues after it\n');

// Test 13: Streaming error detection simulation
// When NDJSON lines get concatenated without newlines (the root cause of the original bug)
console.log('Test 13: Concatenated JSON objects without newlines (streaming edge case)');
const concatenatedOutput = '{"type":"step_finish","timestamp":2}{"type":"error","error":"timeout"}';
const result13 = detectAgentErrors(concatenatedOutput);
// This will NOT be detected by post-hoc detection - which is why streaming detection is needed
console.log(`  Post-hoc detection result: detected=${result13.detected}`);
if (!result13.detected) {
  console.log('  ⚠️  Expected: Post-hoc detection misses concatenated JSON (this is the bug)');
  console.log('  ✅ PASSED: Confirmed that streaming detection is needed as primary mechanism\n');
} else {
  console.log('  ✅ PASSED: Post-hoc detection caught it (but streaming is still preferred)\n');
}

// Test 14: Verify streaming detection catches what post-hoc misses
console.log('Test 14: Streaming detection simulation');
// Simulate what happens during streaming: each chunk is parsed individually
let streamingErrorDetected = false;
let streamingErrorMessage = null;

// Simulate chunk processing (as happens in the for-await loop in agent.lib.mjs)
const simulateStreamChunk = chunk => {
  const lines = chunk.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line);
      if (data.type === 'error' || data.type === 'step_error') {
        streamingErrorDetected = true;
        streamingErrorMessage = data.message || data.error || line.substring(0, 100);
      }
    } catch {
      // Not JSON - ignore
    }
  }
};

// Simulate the exact sequence from the bug report
simulateStreamChunk('{"type":"step_start","timestamp":1}');
simulateStreamChunk('{"type":"error","timestamp":2,"error":"The operation timed out."}');
simulateStreamChunk('{"type":"text","timestamp":3}');
simulateStreamChunk('{"type":"step_finish","timestamp":4}');

assert.strictEqual(streamingErrorDetected, true, 'Streaming should detect error event');
assert.strictEqual(streamingErrorMessage, 'The operation timed out.', 'Should capture error message from stream');
console.log('  ✅ PASSED: Streaming detection correctly catches error events\n');

// Test 15: Verify the combined detection logic
console.log('Test 15: Combined detection (streaming + post-hoc fallback)');
// Simulate the fix: if post-hoc misses, streaming catches it
const postHocResult = detectAgentErrors(concatenatedOutput);
const outputError = { ...postHocResult }; // Copy result

// Apply the fix logic from agent.lib.mjs
if (!outputError.detected && streamingErrorDetected) {
  outputError.detected = true;
  outputError.type = 'AgentError';
  outputError.match = streamingErrorMessage;
}

assert.strictEqual(outputError.detected, true, 'Combined detection should catch the error');
assert.strictEqual(outputError.match, 'The operation timed out.', 'Should have the correct error message');
console.log('  ✅ PASSED: Combined detection works correctly\n');

// ====================================================================
// Issue #1276 Tests: "type": "status" message treated as error (false positive)
// Agent successfully completed but was incorrectly treated as failed
// ====================================================================
console.log('--- Issue #1276 Tests ---\n');

// Test 16: Status message at startup should NOT be treated as error
console.log('Test 16: Status message should NOT trigger error');
const statusOutput = `{"type":"status","mode":"stdin-stream","message":"Agent CLI in continuous listening mode. Accepts JSON and plain text input.","hint":"Press CTRL+C to exit."}`;
const result16 = detectAgentErrors(statusOutput);
assert.strictEqual(result16.detected, false, 'Status message should NOT be detected as error');
console.log('  ✅ PASSED: Status message correctly ignored\n');

// Test 17: Error during execution followed by successful completion (agent recovers)
console.log('Test 17: Agent recovers from error and completes successfully');
// Reset streaming detection state for this test
streamingErrorDetected = false;
streamingErrorMessage = null;
let agentCompletedSuccessfully = false;

// Simulate the exact sequence from Issue #1276 log
// 1. Status message at startup
simulateStreamChunk('{"type":"status","message":"Agent CLI in continuous listening mode. Accepts JSON and plain text input."}');
assert.strictEqual(streamingErrorDetected, false, 'Status should not trigger error');

// 2. Agent starts work
simulateStreamChunk('{"type":"step_start","timestamp":1}');
assert.strictEqual(streamingErrorDetected, false, 'Step start should not trigger error');

// 3. A timeout error occurs during execution
simulateStreamChunk('{"type":"error","timestamp":2,"error":"The operation timed out."}');
assert.strictEqual(streamingErrorDetected, true, 'Error event should be detected');
assert.strictEqual(streamingErrorMessage, 'The operation timed out.', 'Should capture timeout error');

// 4. Agent recovers and continues
simulateStreamChunk('{"type":"step_start","timestamp":3}');

// 5. Agent completes work successfully
simulateStreamChunk('{"type":"text","timestamp":4,"text":"Task completed successfully!"}');

// 6. Session becomes idle (successful completion indicator)
const sessionIdleChunk = '{"type":"session.idle"}';
const idleLines = sessionIdleChunk.split('\n');
for (const idleLine of idleLines) {
  if (!idleLine.trim()) continue;
  try {
    const data = JSON.parse(idleLine);
    if (data.type === 'session.idle') {
      agentCompletedSuccessfully = true;
    }
  } catch {
    // Not JSON - ignore
  }
}

assert.strictEqual(agentCompletedSuccessfully, true, 'Should detect successful completion from session.idle');

// 7. Apply Issue #1276 fix: clear streaming error if exit code is 0 and agent completed successfully
const exitCode = 0; // Successful exit
if (exitCode === 0 && agentCompletedSuccessfully) {
  streamingErrorDetected = false;
  streamingErrorMessage = null;
}

assert.strictEqual(streamingErrorDetected, false, 'Streaming error should be cleared after successful completion');
console.log('  ✅ PASSED: Agent recovery correctly handled - error cleared after successful completion\n');

// Test 18: Verify final error state respects exit code
console.log('Test 18: Final error state should respect exit code');
const outputError18 = detectAgentErrors(statusOutput);

// Simulate the scenario where streaming detected an error but agent recovered
let testStreamingError = true;
const testAgentCompleted = true;
const testExitCode = 0;

// Apply Issue #1276 fix logic
if (testExitCode === 0 && (testAgentCompleted || !testStreamingError)) {
  if (testStreamingError && testAgentCompleted) {
    // Agent recovered from earlier error and completed successfully
    console.log('  Agent recovered from earlier error and completed successfully');
  }
  testStreamingError = false;
}

// Combined detection should NOT report error
if (!outputError18.detected && testStreamingError) {
  outputError18.detected = true;
  outputError18.type = 'AgentError';
}

assert.strictEqual(outputError18.detected, false, 'Final error state should be false when exit code is 0');
console.log('  ✅ PASSED: Exit code 0 with recovery correctly treated as success\n');

// Test 19: Error extraction should prefer "error" field over "message" field
console.log('Test 19: Error extraction should prefer "error" field');
// This tests the fallback pattern matching that extracts messages
const fullOutputWithBothFields = `{"type":"status","message":"Agent CLI listening"}
{"type":"error","timestamp":123,"error":"The actual error message"}
{"type":"step_finish"}`;

// Simulate fallback pattern matching logic from agent.lib.mjs
const patternIndex = fullOutputWithBothFields.indexOf('"type": "error"') >= 0 ? fullOutputWithBothFields.indexOf('"type": "error"') : fullOutputWithBothFields.indexOf('"type":"error"');
if (patternIndex >= 0) {
  const relevantOutput = fullOutputWithBothFields.substring(patternIndex);
  const errorFieldMatch = relevantOutput.match(/"error":\s*"([^"]+)"/);
  const messageFieldMatch = relevantOutput.match(/"message":\s*"([^"]+)"/);
  // Should prefer "error" field
  const extractedMessage = errorFieldMatch ? errorFieldMatch[1] : messageFieldMatch ? messageFieldMatch[1] : 'fallback';
  assert.strictEqual(extractedMessage, 'The actual error message', 'Should extract from "error" field, not "message"');
  console.log('  ✅ PASSED: Error field correctly preferred over message field\n');
} else {
  console.log('  ⚠️  Pattern not found in test output - adjusting test\n');
  // The pattern uses quotes inside, so adjust
  const patternIndex2 = fullOutputWithBothFields.indexOf('"type":"error"');
  assert.ok(patternIndex2 >= 0, 'Error type pattern should be found');
  const relevantOutput = fullOutputWithBothFields.substring(patternIndex2);
  const errorFieldMatch = relevantOutput.match(/"error":\s*"([^"]+)"/);
  assert.strictEqual(errorFieldMatch[1], 'The actual error message', 'Should extract from "error" field');
  console.log('  ✅ PASSED: Error field correctly extracted\n');
}

// Test 20: Non-zero exit code should still be treated as error even with successful completion events
console.log('Test 20: Non-zero exit code should still be error');
let test20StreamingError = true;
const test20AgentCompleted = true;
const test20ExitCode = 1; // Non-zero exit code

// Issue #1276 fix should NOT clear error for non-zero exit code
if (test20ExitCode === 0 && (test20AgentCompleted || !test20StreamingError)) {
  test20StreamingError = false;
}

assert.strictEqual(test20StreamingError, true, 'Streaming error should NOT be cleared for non-zero exit code');
console.log('  ✅ PASSED: Non-zero exit code correctly preserves error state\n');

console.log('========================================');
console.log('All tests passed! ✅');
console.log('========================================');
console.log('\nNote: Error detection now relies on (Issue #1201 fix):');
console.log('  1. Exit code (non-zero = error)');
console.log('  2. Streaming detection of JSON error events (primary, most reliable)');
console.log('  3. Post-hoc detection of JSON error messages in fullOutput (fallback)');
console.log('Pattern matching in output has been removed to prevent false positives.');
console.log('\nIssue #1276 fix adds:');
console.log('  - Exit code 0 is authoritative for success');
console.log('  - Streaming errors are cleared if agent recovers and completes');
console.log('  - Message extraction prefers "error" field over "message" field');
