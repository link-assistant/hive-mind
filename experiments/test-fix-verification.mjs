#!/usr/bin/env node
// Test script to verify issue #1165 fix
// This simulates the error detection logic from claude.lib.mjs
//
// Two layers of protection are now implemented:
// 1. Text pattern matching for "not found" in stderr (original fix)
// 2. Exit code 127 detection (more reliable, added per PR feedback)

const testCases = [
  // Command not found patterns
  { input: '/bin/sh: 1: claude: not found', expectedDetected: true, description: 'Shell command not found' },
  { input: 'command not found: claude', expectedDetected: true, description: 'Zsh command not found' },
  { input: 'bash: claude: command not found', expectedDetected: true, description: 'Bash command not found' },
  { input: 'zsh: command not found: claude', expectedDetected: true, description: 'Zsh variant' },

  // Other error patterns that should still work
  { input: 'Error: Something went wrong', expectedDetected: true, description: 'Error: prefix' },
  { input: 'Connection error occurred', expectedDetected: true, description: 'Contains error' },
  { input: 'Process failed to start', expectedDetected: true, description: 'Contains failed' },

  // Warnings that should NOT be detected
  { input: '⚠️ This is a warning', expectedDetected: false, description: 'Warning with emoji' },
  { input: '⚠ Warning: something failed', expectedDetected: false, description: 'Warning indicator' },

  // Normal output that should NOT be detected
  { input: 'Hello world', expectedDetected: false, description: 'Normal output' },
  { input: 'Processing...', expectedDetected: false, description: 'Status message' },
  { input: '', expectedDetected: false, description: 'Empty string' },
];

// The FIXED detection logic from claude.lib.mjs (line 1065)
const detectError = str => {
  const trimmed = str.trim();
  const isWarning = trimmed.startsWith('⚠️') || trimmed.startsWith('⚠');
  // Issue #1165: Also detect "command not found" errors
  // Note: The original code uses this as a condition for pushing to array,
  // so empty string correctly results in no push (falsy). Converting to boolean for test.
  return !!(
    trimmed &&
    !isWarning &&
    (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed') || trimmed.includes('not found')) // <-- The fix!
  );
};

console.log('=== Issue #1165 Fix Verification ===\n');

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const detected = detectError(tc.input);
  const status = detected === tc.expectedDetected ? '✅ PASS' : '❌ FAIL';

  if (detected === tc.expectedDetected) {
    passed++;
  } else {
    failed++;
  }

  console.log(`${status}: ${tc.description}`);
  console.log(`  Input: "${tc.input}"`);
  console.log(`  Expected: ${tc.expectedDetected}, Got: ${detected}`);
  console.log('');
}

console.log('=== Summary: Text Pattern Detection ===');
console.log(`Passed: ${passed}/${testCases.length}`);
console.log(`Failed: ${failed}/${testCases.length}`);

// Test exit code-based detection (the more reliable approach added per PR feedback)
console.log('\n=== Exit Code Detection (PR #1166 Enhancement) ===\n');

const exitCodeTestCases = [
  { exitCode: 127, shouldFail: true, description: 'Exit code 127 (command not found)' },
  { exitCode: 126, shouldFail: false, description: 'Exit code 126 (permission denied) - not command not found specific' },
  { exitCode: 0, shouldFail: false, description: 'Exit code 0 (success)' },
  { exitCode: 1, shouldFail: false, description: 'Exit code 1 (general error) - not command not found specific' },
];

// Simulates the exit code detection logic from claude.lib.mjs
const detectCommandNotFoundByExitCode = exitCode => {
  return exitCode === 127;
};

for (const tc of exitCodeTestCases) {
  const detected = detectCommandNotFoundByExitCode(tc.exitCode);
  const status = detected === tc.shouldFail ? '✅ PASS' : '❌ FAIL';

  if (detected === tc.shouldFail) {
    passed++;
  } else {
    failed++;
  }

  console.log(`${status}: ${tc.description}`);
  console.log(`  Exit code: ${tc.exitCode}`);
  console.log(`  Expected command not found: ${tc.shouldFail}, Got: ${detected}`);
  console.log('');
}

console.log('=== Final Summary ===');
console.log(`Total passed: ${passed}`);
console.log(`Total failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
