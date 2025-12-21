#!/usr/bin/env node

/**
 * Test script for issue #873 phantom error detection fix
 *
 * This script tests that the fixed error detection logic:
 * 1. Does NOT flag "permission denied" in tool output as an error (false positive)
 * 2. DOES flag actual permission errors in stderr/non-JSON output
 * 3. DOES flag tool execution failures
 * 4. DOES flag explicit error message types
 */

// Simulate the error detection logic from src/agent.lib.mjs
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

// Fixed error detection function
const detectOutputErrors = (stdoutOutput, stderrOutput) => {
  const lines = stdoutOutput.split('\n');
  const nonToolOutputLines = [];

  // First, filter out completed tool outputs from stdout to avoid false positives
  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);

      // Check for explicit error message types
      if (msg.type === 'error' || msg.type === 'step_error') {
        return { detected: true, type: 'AgentError', match: line.substring(0, 100) };
      }

      // Check for failed tool execution
      if (msg.type === 'tool' && msg.state?.status === 'failed') {
        const errorMsg = msg.state.error || 'Tool execution failed';
        return { detected: true, type: 'ToolError', match: errorMsg };
      }

      // Skip completed tool outputs (they contain source code/data)
      if (msg.type === 'tool' && msg.state?.status === 'completed') {
        continue; // Don't scan successful tool output content
      }

      // Keep other JSON lines for scanning
      nonToolOutputLines.push(line);
    } catch (e) {
      // Not JSON or malformed - keep for pattern scanning
      nonToolOutputLines.push(line);
    }
  }

  // Combine filtered stdout with all stderr
  const filteredOutput = nonToolOutputLines.join('\n') + '\n' + stderrOutput;

  // Now scan the filtered output with error patterns
  for (const { pattern, type } of errorPatterns) {
    const match = filteredOutput.match(pattern);
    if (match) {
      return { detected: true, type, match: match[0] };
    }
  }

  return { detected: false };
};

// Old (buggy) error detection function
const detectOutputErrorsOld = (output) => {
  for (const { pattern, type } of errorPatterns) {
    const match = output.match(pattern);
    if (match) {
      return { detected: true, type, match: match[0] };
    }
  }
  return { detected: false };
};

// Test cases
console.log('🧪 Testing phantom error detection fix for issue #873\n');

// Test 1: Tool output containing "permission denied" in source code (FALSE POSITIVE BUG)
console.log('Test 1: Tool reads file containing "permission denied" text');
const test1Stdout = JSON.stringify({
  type: 'tool',
  tool: 'read',
  state: {
    status: 'completed',
    output: 'Line 404: await log(`PERMISSION DENIED: Cannot push`); // error handling code'
  }
}) + '\n' + JSON.stringify({
  type: 'step_finish',
  reason: 'stop'
});
const test1Stderr = '';

const test1Old = detectOutputErrorsOld(test1Stdout + test1Stderr);
const test1New = detectOutputErrors(test1Stdout, test1Stderr);

console.log('  Old logic:', test1Old.detected ? `❌ FALSE POSITIVE - ${test1Old.type}` : '✅ No error');
console.log('  New logic:', test1New.detected ? `❌ FAILED - ${test1New.type}` : '✅ PASS - No error detected');
console.log('  Expected: No error (false positive should be fixed)');
console.log('  Result:', test1New.detected ? '❌ FAIL' : '✅ PASS');
console.log();

// Test 2: Real permission error in stderr
console.log('Test 2: Actual permission denied error in stderr');
const test2Stdout = JSON.stringify({
  type: 'step_finish',
  reason: 'stop'
});
const test2Stderr = 'Error: permission denied when accessing /etc/shadow';

const test2Old = detectOutputErrorsOld(test2Stdout + test2Stderr);
const test2New = detectOutputErrors(test2Stdout, test2Stderr);

console.log('  Old logic:', test2Old.detected ? `✅ Detected - ${test2Old.type}` : '❌ Missed error');
console.log('  New logic:', test2New.detected ? `✅ Detected - ${test2New.type}` : '❌ FAILED - Missed error');
console.log('  Expected: Error detected');
console.log('  Result:', test2New.detected ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 3: Tool execution failed
console.log('Test 3: Tool execution failure');
const test3Stdout = JSON.stringify({
  type: 'tool',
  tool: 'bash',
  state: {
    status: 'failed',
    error: 'Command failed with exit code 1'
  }
});
const test3Stderr = '';

const test3Old = detectOutputErrorsOld(test3Stdout + test3Stderr);
const test3New = detectOutputErrors(test3Stdout, test3Stderr);

console.log('  Old logic:', test3Old.detected ? `✅ Detected - ${test3Old.type}` : '❌ Missed error');
console.log('  New logic:', test3New.detected ? `✅ Detected - ${test3New.type}` : '❌ FAILED - Missed error');
console.log('  Expected: Error detected');
console.log('  Result:', test3New.detected ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 4: Explicit error message type
console.log('Test 4: Explicit error message type');
const test4Stdout = JSON.stringify({
  type: 'error',
  message: 'Something went wrong'
});
const test4Stderr = '';

const test4Old = detectOutputErrorsOld(test4Stdout + test4Stderr);
const test4New = detectOutputErrors(test4Stdout, test4Stderr);

console.log('  Old logic:', test4Old.detected ? `✅ Detected - ${test4Old.type}` : '❌ Missed error');
console.log('  New logic:', test4New.detected ? `✅ Detected - ${test4New.type}` : '❌ FAILED - Missed error');
console.log('  Expected: Error detected');
console.log('  Result:', test4New.detected ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 5: Stack trace in non-JSON output (real error)
console.log('Test 5: Stack trace in non-JSON output');
const test5Stdout = 'Some text\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)';
const test5Stderr = '';

const test5Old = detectOutputErrorsOld(test5Stdout + test5Stderr);
const test5New = detectOutputErrors(test5Stdout, test5Stderr);

console.log('  Old logic:', test5Old.detected ? `✅ Detected - ${test5Old.type}` : '❌ Missed error');
console.log('  New logic:', test5New.detected ? `✅ Detected - ${test5New.type}` : '❌ FAILED - Missed error');
console.log('  Expected: Error detected');
console.log('  Result:', test5New.detected ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 6: Multiple tool outputs with source code containing "throw new Error"
console.log('Test 6: Tool outputs containing "throw new Error" in source code');
const test6Stdout = JSON.stringify({
  type: 'tool',
  tool: 'read',
  state: {
    status: 'completed',
    output: 'function validate() { if (!valid) throw new Error("Invalid"); }'
  }
}) + '\n' + JSON.stringify({
  type: 'text',
  text: 'I found the validation code'
});
const test6Stderr = '';

const test6Old = detectOutputErrorsOld(test6Stdout + test6Stderr);
const test6New = detectOutputErrors(test6Stdout, test6Stderr);

console.log('  Old logic:', test6Old.detected ? `❌ FALSE POSITIVE - ${test6Old.type}` : '✅ No error');
console.log('  New logic:', test6New.detected ? `❌ FAILED - ${test6New.type}` : '✅ PASS - No error detected');
console.log('  Expected: No error (source code pattern should be ignored)');
console.log('  Result:', test6New.detected ? '❌ FAIL' : '✅ PASS');
console.log();

// Summary
console.log('═══════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════');

const allPassed = !test1New.detected && test2New.detected && test3New.detected &&
                  test4New.detected && test5New.detected && !test6New.detected;

if (allPassed) {
  console.log('✅ ALL TESTS PASSED');
  console.log('\nThe fix successfully:');
  console.log('  • Eliminates false positives from tool output content');
  console.log('  • Still detects real errors in stderr');
  console.log('  • Still detects tool execution failures');
  console.log('  • Still detects explicit error message types');
  console.log('  • Still detects stack traces in non-JSON output');
} else {
  console.log('❌ SOME TESTS FAILED');
  console.log('\nReview the test output above for details.');
  process.exit(1);
}
