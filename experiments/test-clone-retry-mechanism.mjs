#!/usr/bin/env node

/**
 * Test script for the new clone retry mechanism
 * This script simulates various clone failure scenarios to verify the retry logic
 */

import { classifyCloneError } from '../src/solve.repository.lib.mjs';

// Test cases for error classification
const testCases = [
  {
    name: 'GitHub 500 Error',
    input: "remote: Internal Server Error\nfatal: unable to access 'https://github.com/user/repo.git/': The requested URL returned error: 500",
    expected: { type: 'TRANSIENT', retryable: true, description: 'GitHub server error' },
  },
  {
    name: 'GitHub 503 Error',
    input: "error: 503 Service Unailable\nfatal: unable to access 'https://github.com/user/repo.git/'",
    expected: { type: 'TRANSIENT', retryable: true, description: 'GitHub server error' },
  },
  {
    name: 'Connection Timeout',
    input: "fatal: unable to access 'https://github.com/user/repo.git/': Connection timed out",
    expected: { type: 'NETWORK', retryable: true, description: 'Network connectivity issue' },
  },
  {
    name: 'Authentication Error',
    input: 'error: 401 Authorization Required\nfatal: Authentication failed',
    expected: { type: 'PERMISSION', retryable: false, description: 'Authentication or permission error' },
  },
  {
    name: 'Repository Not Found',
    input: "error: 404 Not Found\nfatal: repository 'user/repo' not found",
    expected: { type: 'NOT_FOUND', retryable: false, description: 'Repository not found' },
  },
  {
    name: 'Rate Limit',
    input: 'error: API rate limit exceeded\nfatal: too many requests',
    expected: { type: 'RATE_LIMIT', retryable: true, description: 'Rate limit exceeded' },
  },
  {
    name: 'Unknown Error',
    input: 'fatal: some unexpected error occurred',
    expected: { type: 'UNKNOWN', retryable: true, description: 'Unknown error' },
  },
];

console.log('🧪 Testing clone error classification...\n');

let passedTests = 0;
let totalTests = testCases.length;

for (const testCase of testCases) {
  const result = classifyCloneError(testCase.input);
  const passed = JSON.stringify(result) === JSON.stringify(testCase.expected);

  console.log(`${passed ? '✅' : '❌'} ${testCase.name}`);
  console.log(`   Input: ${testCase.input.split('\n')[0]}...`);
  console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
  console.log(`   Actual:   ${JSON.stringify(result)}`);

  if (passed) {
    passedTests++;
  }

  console.log('');
}

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All tests passed! Error classification is working correctly.');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please review the implementation.');
  process.exit(1);
}
