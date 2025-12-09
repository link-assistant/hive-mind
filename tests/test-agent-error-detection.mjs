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
const detectAgentErrors = (stdoutOutput) => {
  const lines = stdoutOutput.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);

      // Check for explicit error message types from agent
      if (msg.type === 'error' || msg.type === 'step_error') {
        return { detected: true, type: 'AgentError', match: msg.message || line.substring(0, 100) };
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

console.log('========================================');
console.log('All tests passed! ✅');
console.log('========================================');
console.log('\nNote: Error detection now relies primarily on:');
console.log('  1. Exit code (non-zero = error)');
console.log('  2. Explicit JSON error messages (type: "error" or "step_error")');
console.log('Pattern matching in output has been removed to prevent false positives.');
