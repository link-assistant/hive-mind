#!/usr/bin/env node
// Test script to verify issue #1165 fix
// This simulates the error detection logic from claude.lib.mjs

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

console.log('=== Summary ===');
console.log(`Passed: ${passed}/${testCases.length}`);
console.log(`Failed: ${failed}/${testCases.length}`);

if (failed > 0) {
  process.exit(1);
}
