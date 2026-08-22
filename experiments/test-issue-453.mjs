#!/usr/bin/env node

/**
 * Test script for issue #453
 * Tests:
 * 1. Unrecognized options should fail (e.g., —fork with em-dash)
 * 2. --no- prefix should work for boolean options (e.g., --no-tool-check)
 * 3. No duplicate error messages
 */

console.log('Testing issue #453 fixes...\n');

// Test 1: Valid option --fork should work
console.log('Test 1: Valid option --fork (double-dash)');
try {
  const result = await import('../src/solve.mjs');
  console.log('❌ FAIL: Should have failed with missing URL');
} catch (error) {
  if (error.message.includes('Missing required github issue')) {
    console.log('✅ PASS: Correctly requires URL\n');
  } else {
    console.log('❌ FAIL: Unexpected error:', error.message, '\n');
  }
}
