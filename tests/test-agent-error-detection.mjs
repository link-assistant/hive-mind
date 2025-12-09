#!/usr/bin/env node

/**
 * Tests for agent error detection logic
 * Specifically testing for false positives with completed tool outputs
 * See: docs/case-studies/issue-886-false-positive-error-detection/README.md
 */

import { strict as assert } from 'assert';

// Recreate the error patterns and detection logic from agent.lib.mjs
const errorPatterns = [
  { pattern: /ProviderModelNotFoundError/i, type: 'ProviderModelNotFoundError' },
  { pattern: /ModelNotFoundError/i, type: 'ModelNotFoundError' },
  { pattern: /\s+at\s+\S+\s+\([^)]+:\d+:\d+\)/m, type: 'StackTrace' },
  { pattern: /throw new \w+Error/i, type: 'ThrowError' },
  { pattern: /authentication failed/i, type: 'AuthenticationError' },
  { pattern: /permission denied/i, type: 'PermissionError' },
  { pattern: /ENOENT|EACCES|EPERM/i, type: 'FileSystemError' },
  { pattern: /TypeError:|ReferenceError:|SyntaxError:/i, type: 'JavaScriptError' },
  { pattern: /Cannot read propert(y|ies) of (undefined|null)/i, type: 'NullReferenceError' },
  { pattern: /Uncaught Exception:/i, type: 'UncaughtException' },
  { pattern: /Unhandled Rejection/i, type: 'UnhandledRejection' },
];

// Copy of the fixed detectOutputErrors function
const detectOutputErrors = (stdoutOutput, stderrOutput) => {
  const lines = stdoutOutput.split('\n');
  const nonToolOutputLines = [];

  // Helper to extract tool state from various JSON message formats
  const getToolState = (msg) => {
    // Format 1: { type: "tool_use", part: { type: "tool", state: {...} } }
    if (msg.type === 'tool_use' && msg.part?.type === 'tool') {
      return msg.part.state;
    }
    // Format 2: { type: "tool", state: {...} }
    if (msg.type === 'tool') {
      return msg.state;
    }
    return null;
  };

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);

      // Check for explicit error message types
      if (msg.type === 'error' || msg.type === 'step_error') {
        return { detected: true, type: 'AgentError', match: line.substring(0, 100) };
      }

      // Get tool state from various JSON formats
      const toolState = getToolState(msg);

      if (toolState) {
        // Check for failed tool execution
        if (toolState.status === 'failed') {
          const errorMsg = toolState.error || 'Tool execution failed';
          return { detected: true, type: 'ToolError', match: errorMsg };
        }

        // Skip completed tool outputs entirely
        if (toolState.status === 'completed') {
          continue;
        }
      }

      nonToolOutputLines.push(line);
    } catch {
      nonToolOutputLines.push(line);
    }
  }

  const filteredOutput = nonToolOutputLines.join('\n') + '\n' + stderrOutput;

  for (const { pattern, type } of errorPatterns) {
    const match = filteredOutput.match(pattern);
    if (match) {
      return { detected: true, type, match: match[0] };
    }
  }

  return { detected: false };
};

console.log('Testing agent error detection...\n');

// Test 1: Issue #886 scenario - bash command with shell warnings but successful completion
console.log('Test 1: Bash command with shell warnings but successful completion (Issue #886)');
const issue886Output = `{"type":"tool_use","timestamp":1765265945140,"sessionID":"ses_4fdf45a99ffeEgHuqAqwnsYT7b","part":{"type":"tool","callID":"call_40598996","tool":"bash","state":{"status":"completed","input":{"command":"gh pr edit 2 ..."},"output":"/bin/sh: 1: src/main.rs: Permission denied\\n/bin/sh: 1: .github/workflows/test-hello-world.yml: Permission denied\\nhttps://github.com/konard/test-hello-world-019b020a-a43c-7544-aaa1-220021798428/pull/2\\n","metadata":{"exit":0}}}}`;
const result1 = detectOutputErrors(issue886Output, '');
assert.strictEqual(result1.detected, false, 'Should NOT detect error for completed tool with shell warnings');
console.log('  ✅ PASSED: No false positive for completed bash tool with "Permission denied" in output\n');

// Test 2: Completed tool with source code containing error text (Issue #873)
console.log('Test 2: Tool reads file containing "permission denied" string (Issue #873)');
const issue873Output = `{"type":"tool","state":{"status":"completed","input":{"filePath":"src/solve.auto-pr.lib.mjs"},"output":"<file>\\n00375| if (errorOutput.includes('Permission to') && errorOutput.includes('denied'))\\n00404| await log('PERMISSION DENIED: Cannot push')\\n</file>"}}`;
const result2 = detectOutputErrors(issue873Output, '');
assert.strictEqual(result2.detected, false, 'Should NOT detect error for completed tool reading source code');
console.log('  ✅ PASSED: No false positive for source code containing "permission denied"\n');

// Test 3: Failed tool should still be detected
console.log('Test 3: Failed tool execution should be detected');
const failedToolOutput = `{"type":"tool","state":{"status":"failed","error":"File not found: /nonexistent.txt"}}`;
const result3 = detectOutputErrors(failedToolOutput, '');
assert.strictEqual(result3.detected, true, 'Should detect failed tool');
assert.strictEqual(result3.type, 'ToolError', 'Should be ToolError type');
console.log('  ✅ PASSED: Failed tool correctly detected\n');

// Test 4: Explicit error message type
console.log('Test 4: Explicit error message type should be detected');
const errorMsgOutput = `{"type":"error","message":"Something went wrong"}`;
const result4 = detectOutputErrors(errorMsgOutput, '');
assert.strictEqual(result4.detected, true, 'Should detect error message type');
assert.strictEqual(result4.type, 'AgentError', 'Should be AgentError type');
console.log('  ✅ PASSED: Error message type correctly detected\n');

// Test 5: Error in stderr (not in tool output)
console.log('Test 5: Error pattern in stderr should be detected');
const result5 = detectOutputErrors('{"type":"step_start"}', 'ENOENT: no such file or directory');
assert.strictEqual(result5.detected, true, 'Should detect error in stderr');
assert.strictEqual(result5.type, 'FileSystemError', 'Should be FileSystemError type');
console.log('  ✅ PASSED: Error in stderr correctly detected\n');

// Test 6: Non-JSON error text in stdout
console.log('Test 6: Non-JSON error text in stdout should be detected');
const nonJsonError = 'Error: Cannot read properties of undefined';
const result6 = detectOutputErrors(nonJsonError, '');
assert.strictEqual(result6.detected, true, 'Should detect error in non-JSON output');
assert.strictEqual(result6.type, 'NullReferenceError', 'Should be NullReferenceError type');
console.log('  ✅ PASSED: Non-JSON error text correctly detected\n');

// Test 7: tool_use format (wrapper format) should also skip completed tools
console.log('Test 7: tool_use wrapper format with completed tool');
const toolUseFormat = `{"type":"tool_use","part":{"type":"tool","state":{"status":"completed","output":"throw new Error('test')"}}}`;
const result7 = detectOutputErrors(toolUseFormat, '');
assert.strictEqual(result7.detected, false, 'Should NOT detect error in completed tool_use format');
console.log('  ✅ PASSED: tool_use wrapper format with completed status correctly skipped\n');

// Test 8: tool_use format with failed tool should be detected
console.log('Test 8: tool_use wrapper format with failed tool');
const failedToolUse = `{"type":"tool_use","part":{"type":"tool","state":{"status":"failed","error":"Command timed out"}}}`;
const result8 = detectOutputErrors(failedToolUse, '');
assert.strictEqual(result8.detected, true, 'Should detect failed tool_use');
assert.strictEqual(result8.type, 'ToolError', 'Should be ToolError type');
console.log('  ✅ PASSED: Failed tool_use correctly detected\n');

// Test 9: Step finish messages (not tool output) should be scanned
console.log('Test 9: Non-tool JSON messages should be scanned');
const stepFinishWithError = `{"type":"step_finish","reason":"error","message":"permission denied accessing API"}`;
const result9 = detectOutputErrors(stepFinishWithError, '');
assert.strictEqual(result9.detected, true, 'Should detect error pattern in non-tool JSON');
console.log('  ✅ PASSED: Error in step_finish message correctly detected\n');

// Test 10: Clean output with no errors
console.log('Test 10: Clean output should not trigger errors');
const cleanOutput = `{"type":"step_start","snapshot":"abc123"}
{"type":"tool_use","part":{"type":"tool","state":{"status":"completed","output":"Hello, World!"}}}
{"type":"step_finish","reason":"stop"}`;
const result10 = detectOutputErrors(cleanOutput, '');
assert.strictEqual(result10.detected, false, 'Should not detect error in clean output');
console.log('  ✅ PASSED: Clean output correctly passes\n');

console.log('========================================');
console.log('All tests passed! ✅');
console.log('========================================');
