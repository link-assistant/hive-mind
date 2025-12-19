#!/usr/bin/env node
// Test script for haiku model support (issue #577)
// This script tests that the haiku model alias is correctly mapped to the full model ID

import { mapModelToId } from '../src/claude.lib.mjs';

console.log('Testing haiku model support...\n');

// Test cases
const testCases = [
  { input: 'haiku', expected: 'claude-haiku-4-5-20251001', description: 'haiku alias' },
  { input: 'sonnet', expected: 'claude-sonnet-4-5-20250929', description: 'sonnet alias' },
  { input: 'opus', expected: 'claude-opus-4-5-20251101', description: 'opus alias' },
  { input: 'claude-haiku-4-5-20251001', expected: 'claude-haiku-4-5-20251001', description: 'full haiku model ID' },
  { input: 'some-other-model', expected: 'some-other-model', description: 'unknown model (passthrough)' },
];

let allPassed = true;

for (const testCase of testCases) {
  const result = mapModelToId(testCase.input);
  const passed = result === testCase.expected;
  allPassed = allPassed && passed;

  const status = passed ? '✅' : '❌';
  console.log(`${status} ${testCase.description}`);
  console.log(`   Input: ${testCase.input}`);
  console.log(`   Expected: ${testCase.expected}`);
  console.log(`   Got: ${result}`);
  if (!passed) {
    console.log(`   ⚠️  FAILED`);
  }
  console.log('');
}

if (allPassed) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed!');
  process.exit(1);
}
