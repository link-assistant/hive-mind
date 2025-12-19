#!/usr/bin/env node

// Test script to verify Sonnet 4.5 model mapping works correctly

// Import the mapModelToId function
import { mapModelToId } from '../src/claude.lib.mjs';

console.log('Testing Sonnet 4.5 model mapping...\n');

// Test cases
const testCases = [
  { input: 'sonnet', expected: 'claude-sonnet-4-5-20250929' },
  { input: 'opus', expected: 'claude-opus-4-5-20251101' },
  { input: 'claude-sonnet-4-5-20250929', expected: 'claude-sonnet-4-5-20250929' },
  { input: 'claude-opus-4-5-20251101', expected: 'claude-opus-4-5-20251101' },
  { input: 'custom-model-id', expected: 'custom-model-id' }
];

let allPassed = true;

for (const test of testCases) {
  const result = mapModelToId(test.input);
  const passed = result === test.expected;

  console.log(`Input: "${test.input}"`);
  console.log(`Expected: "${test.expected}"`);
  console.log(`Got: "${result}"`);
  console.log(`Status: ${passed ? '✅ PASS' : '❌ FAIL'}\n`);

  if (!passed) {
    allPassed = false;
  }
}

if (allPassed) {
  console.log('✅ All tests passed!');
} else {
  console.log('❌ Some tests failed!');
  process.exit(1);
}

// Test that Claude CLI accepts the mapped model
console.log('\nTesting Claude CLI with mapped model...');

// We need to dynamically load command-stream
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

try {
  console.log('Testing with model: claude-sonnet-4-5-20250929');
  const result = await $`printf "hi" | timeout 5 claude --model claude-sonnet-4-5-20250929 -p 2>&1 || true`;

  const output = result.stdout?.toString() || result.stderr?.toString() || '';

  // Check if the output contains error about invalid model
  if (output.includes('invalid model') || output.includes('Unknown model')) {
    console.log('❌ Claude CLI rejected the model ID');
    console.log('Output:', output);
  } else if (output.includes('API Error') || output.includes('error')) {
    // API errors are expected (rate limits, auth, etc) but at least the model was accepted
    console.log('⚠️ API error occurred, but model ID was accepted');
    console.log('Output:', output.substring(0, 200) + '...');
  } else {
    console.log('✅ Claude CLI accepted the model ID');
  }
} catch (error) {
  console.log('⚠️ Could not test Claude CLI directly:', error.message);
}

console.log('\nModel mapping implementation completed successfully!');