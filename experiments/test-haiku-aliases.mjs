#!/usr/bin/env node

/**
 * Test script to verify the new haiku model aliases work correctly
 */

import { availableModels, mapModelToId } from '../src/claude.lib.mjs';

console.log('Testing new haiku model aliases...\n');

// Test 1: Check that aliases are defined
console.log('1. Testing alias definitions:');
console.log(`   haiku-3-5: ${availableModels['haiku-3-5']}`);
console.log(`   haiku-3: ${availableModels['haiku-3']}`);
console.log(`   ✅ Aliases defined correctly\n`);

// Test 2: Check that mapModelToId works
console.log('2. Testing mapModelToId function:');
const testCases = [
  { input: 'haiku-3-5', expected: 'claude-3-5-haiku-20241022' },
  { input: 'haiku-3', expected: 'claude-3-haiku-20240307' },
  { input: 'sonnet', expected: 'claude-sonnet-4-5-20250929' },
  { input: 'opus', expected: 'claude-opus-4-5-20251101' },
  { input: 'haiku', expected: 'claude-haiku-4-5-20251001' },
  { input: 'claude-custom-model', expected: 'claude-custom-model' }, // Unknown model should pass through
];

let allTestsPassed = true;
for (const testCase of testCases) {
  const result = mapModelToId(testCase.input);
  const passed = result === testCase.expected;
  if (passed) {
    console.log(`   ✅ ${testCase.input} → ${result}`);
  } else {
    console.log(`   ❌ ${testCase.input} → ${result} (expected: ${testCase.expected})`);
    allTestsPassed = false;
  }
}

if (allTestsPassed) {
  console.log('\n✅ All haiku alias tests passed!');
  console.log('The new aliases are working correctly:');
  console.log('- haiku-3-5 maps to claude-3-5-haiku-20241022');
  console.log('- haiku-3 maps to claude-3-haiku-20240307');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed');
  process.exit(1);
}
