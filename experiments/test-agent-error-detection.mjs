#!/usr/bin/env node
/**
 * Test script for agent error detection patterns
 * This script tests that error patterns are correctly detected even when exit code is 0
 */

// Error patterns to detect failures even when exit code is 0
const errorPatterns = [
  { pattern: /ProviderModelNotFoundError/i, type: 'ProviderModelNotFoundError' },
  { pattern: /ModelNotFoundError/i, type: 'ModelNotFoundError' },
  { pattern: /\s+at\s+\S+\s+\([^)]+:\d+:\d+\)/m, type: 'StackTrace' },  // Stack trace pattern
  { pattern: /throw new \w+Error/i, type: 'ThrowError' },
  { pattern: /authentication failed/i, type: 'AuthenticationError' },
  { pattern: /permission denied/i, type: 'PermissionError' },
  { pattern: /ENOENT|EACCES|EPERM/i, type: 'FileSystemError' },
  { pattern: /TypeError:|ReferenceError:|SyntaxError:/i, type: 'JavaScriptError' },
  { pattern: /Cannot read propert(y|ies) of (undefined|null)/i, type: 'NullReferenceError' },
  { pattern: /Uncaught Exception:/i, type: 'UncaughtException' },
  { pattern: /Unhandled Rejection/i, type: 'UnhandledRejection' },
];

// Helper function to detect errors in output
const detectOutputErrors = (output) => {
  for (const { pattern, type } of errorPatterns) {
    const match = output.match(pattern);
    if (match) {
      return { detected: true, type, match: match[0] };
    }
  }
  return { detected: false };
};

// Test cases
const testCases = [
  {
    name: 'ProviderModelNotFoundError from PR #864',
    input: `519 |       providerID,
520 |       modelID,
521 |     })
522 |
523 |     const provider = s.providers[providerID]
524 |     if (!provider) throw new ModelNotFoundError({ providerID, modelID })
                              ^
ProviderModelNotFoundError: Provi****************Error
 data: {
  providerID: "anthropic",
  modelID: "claude-3-5-sonnet",
},

      at getModel (/home/hive/.bun/install/global/node_modules/@link-assistant/agent/src/provider/provider.ts:524:26)`,
    expected: { detected: true, type: 'ProviderModelNotFoundError' }
  },
  {
    name: 'Stack trace detection',
    input: `Error: Something went wrong
      at myFunction (/path/to/file.js:123:45)
      at Object.<anonymous> (/path/to/other.js:10:20)`,
    expected: { detected: true, type: 'StackTrace' }
  },
  {
    name: 'TypeError detection',
    input: 'TypeError: Cannot read properties of undefined (reading "foo")',
    expected: { detected: true, type: 'JavaScriptError' }
  },
  {
    name: 'Null reference error detection',
    input: 'Cannot read property of null',
    expected: { detected: true, type: 'NullReferenceError' }
  },
  {
    name: 'Authentication failed',
    input: 'Error: Authentication failed. Please check your credentials.',
    expected: { detected: true, type: 'AuthenticationError' }
  },
  {
    name: 'Permission denied',
    input: 'Error: Permission denied while accessing /etc/shadow',
    expected: { detected: true, type: 'PermissionError' }
  },
  {
    name: 'File not found (ENOENT)',
    input: 'Error: ENOENT: no such file or directory, open \'/tmp/test.txt\'',
    expected: { detected: true, type: 'FileSystemError' }
  },
  {
    name: 'Valid JSON output (no error)',
    input: `{
  "type": "step_start",
  "timestamp": 1765236916365,
  "sessionID": "ses_4ffae5350ffel9Uelq2VYSx4CA"
}`,
    expected: { detected: false }
  },
  {
    name: 'Successful tool output',
    input: '✅ Agent command completed\nSession ID: ses_123456',
    expected: { detected: false }
  },
  {
    name: 'Uncaught Exception',
    input: 'Uncaught Exception: Something terrible happened',
    expected: { detected: true, type: 'UncaughtException' }
  },
  {
    name: 'Unhandled Promise Rejection',
    input: 'Unhandled Rejection at: Promise {...} reason: Error: API timeout',
    expected: { detected: true, type: 'UnhandledRejection' }
  }
];

console.log('🧪 Testing agent error detection patterns...\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = detectOutputErrors(testCase.input);
  const success = result.detected === testCase.expected.detected &&
    (!testCase.expected.type || result.type === testCase.expected.type);

  if (success) {
    console.log(`✅ PASS: ${testCase.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${testCase.name}`);
    console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`   Got: ${JSON.stringify(result)}`);
    failed++;
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
