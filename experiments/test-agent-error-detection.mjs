#!/usr/bin/env node
/**
 * Experiment script for testing agent error detection
 * Issue #886: Simplified error detection - trust exit code, don't pattern match output
 *
 * This experiment demonstrates why we removed pattern matching:
 * - AI agents execute bash commands that may produce warnings like "Permission denied"
 * - These warnings appear in output but don't indicate failure (exit code 0)
 * - Pattern matching causes false positives in normal operation
 *
 * New approach:
 * - Trust exit code (0 = success, non-zero = failure)
 * - Only detect explicit JSON error messages from agent
 */

// Simplified error detection function - matches agent.lib.mjs
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

// Test cases demonstrating the simplified approach
const testCases = [
  {
    name: 'Issue #886: Shell warnings in bash output (false positive before fix)',
    input: `{"type":"tool_use","part":{"type":"tool","state":{"status":"completed","output":"/bin/sh: 1: src/main.rs: Permission denied\\nhttps://github.com/repo/pull/2\\n","metadata":{"exit":0}}}}`,
    expected: { detected: false },
    comment: 'Should NOT detect - exit code 0, just shell warning'
  },
  {
    name: 'Issue #873: Source code containing error strings',
    input: `{"type":"tool","state":{"status":"completed","output":"if (err.includes('Permission denied')) { ... }"}}`,
    expected: { detected: false },
    comment: 'Should NOT detect - just source code content'
  },
  {
    name: 'Explicit JSON error message',
    input: '{"type":"error","message":"Rate limit exceeded"}',
    expected: { detected: true, type: 'AgentError' },
    comment: 'Should detect - explicit error from agent'
  },
  {
    name: 'step_error message',
    input: '{"type":"step_error","message":"Tool execution failed"}',
    expected: { detected: true, type: 'AgentError' },
    comment: 'Should detect - explicit step_error'
  },
  {
    name: 'Stack trace in non-JSON output (now ignored)',
    input: `Error: Something went wrong
      at myFunction (/path/to/file.js:123:45)
      at Object.<anonymous> (/path/to/other.js:10:20)`,
    expected: { detected: false },
    comment: 'Should NOT detect - trust exit code instead of pattern matching'
  },
  {
    name: 'TypeError in output (now ignored)',
    input: 'TypeError: Cannot read properties of undefined (reading "foo")',
    expected: { detected: false },
    comment: 'Should NOT detect - trust exit code instead'
  },
  {
    name: 'ENOENT error text (now ignored)',
    input: "Error: ENOENT: no such file or directory, open '/tmp/test.txt'",
    expected: { detected: false },
    comment: 'Should NOT detect - trust exit code instead'
  },
  {
    name: 'Clean successful output',
    input: `{"type":"step_start","snapshot":"abc123"}
{"type":"step_finish","reason":"stop"}`,
    expected: { detected: false },
    comment: 'Should NOT detect - normal successful execution'
  },
  {
    name: 'Error among other JSON messages',
    input: `{"type":"step_start"}
{"type":"error","message":"API connection failed"}
{"type":"step_finish","reason":"error"}`,
    expected: { detected: true, type: 'AgentError' },
    comment: 'Should detect - has explicit error message'
  }
];

console.log('🧪 Testing simplified agent error detection...\n');
console.log('Issue #886: Trust exit code, only detect explicit JSON errors\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = detectAgentErrors(testCase.input);
  const success = result.detected === testCase.expected.detected &&
    (!testCase.expected.type || result.type === testCase.expected.type);

  if (success) {
    console.log(`✅ PASS: ${testCase.name}`);
    console.log(`   ${testCase.comment}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${testCase.name}`);
    console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`   Got: ${JSON.stringify(result)}`);
    console.log(`   ${testCase.comment}`);
    failed++;
  }
  console.log();
}

console.log(`📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
  console.log('\nNote: Error detection now relies on:');
  console.log('  1. Exit code (non-zero = error)');
  console.log('  2. Explicit JSON error messages (type: "error" or "step_error")');
  console.log('Pattern matching has been removed to prevent false positives.');
  process.exit(0);
}
