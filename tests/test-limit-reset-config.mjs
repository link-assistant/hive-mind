#!/usr/bin/env node

/**
 * Test suite for limit reset buffer and jitter configuration
 * Tests the increased buffer time and random jitter to avoid thundering herd
 *
 * Related issues:
 *   - https://github.com/link-assistant/hive-mind/issues/1236
 *   - https://github.com/link-assistant/hive-mind/issues/1152
 *
 * Run with: node tests/test-limit-reset-config.mjs
 */

import { limitReset } from '../src/config.lib.mjs';
import { formatResetTimeWithRelative } from '../src/usage-limit.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('\x1b[32m\u2713 PASSED\x1b[0m');
    testsPassed++;
  } catch (error) {
    console.log(`\x1b[31m\u2717 FAILED: ${error.message}\x1b[0m`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`${message}: expected truthy value, got "${value}"`);
  }
}

// === Buffer Configuration Tests ===

runTest('limitReset.bufferMs default is 10 minutes (Issue #1236)', () => {
  // Default should be 10 minutes (increased from 5 minutes)
  assertEqual(limitReset.bufferMs, 10 * 60 * 1000, 'Default buffer should be 10 minutes (600000ms)');
});

runTest('limitReset.jitterMs default is 5 minutes (Issue #1236)', () => {
  // Default jitter range should be 5 minutes (0 to 5 minutes random)
  assertEqual(limitReset.jitterMs, 5 * 60 * 1000, 'Default jitter should be 5 minutes (300000ms)');
});

runTest('limitReset.bufferMs is a positive number', () => {
  assertTrue(limitReset.bufferMs > 0, 'Buffer should be positive');
  assertTrue(Number.isInteger(limitReset.bufferMs), 'Buffer should be an integer');
});

runTest('limitReset.jitterMs is a positive number', () => {
  assertTrue(limitReset.jitterMs > 0, 'Jitter should be positive');
  assertTrue(Number.isInteger(limitReset.jitterMs), 'Jitter should be an integer');
});

runTest('total maximum wait (buffer + jitter) is 15 minutes', () => {
  const maxTotalMs = limitReset.bufferMs + limitReset.jitterMs;
  assertEqual(maxTotalMs, 15 * 60 * 1000, 'Maximum total buffer+jitter should be 15 minutes');
});

// === Jitter Distribution Tests ===

runTest('random jitter generates values within range [0, jitterMs)', () => {
  // Run 100 iterations to verify jitter range
  for (let i = 0; i < 100; i++) {
    const jitter = Math.floor(Math.random() * limitReset.jitterMs);
    assertTrue(jitter >= 0, `Jitter should be >= 0, got ${jitter}`);
    assertTrue(jitter < limitReset.jitterMs, `Jitter should be < ${limitReset.jitterMs}, got ${jitter}`);
  }
});

runTest('random jitter produces varied values (not always 0)', () => {
  // Run 50 iterations - at least one should be > 0
  let hasNonZero = false;
  for (let i = 0; i < 50; i++) {
    const jitter = Math.floor(Math.random() * limitReset.jitterMs);
    if (jitter > 0) {
      hasNonZero = true;
      break;
    }
  }
  assertTrue(hasNonZero, 'At least one jitter value should be non-zero in 50 iterations');
});

// === formatResetTimeWithRelative Integration Tests (Issue #1236) ===

runTest('formatResetTimeWithRelative formats future time with relative and UTC', () => {
  // Use a time that's definitely in the future
  const result = formatResetTimeWithRelative('8:00 PM');
  assertTrue(result.includes('in'), 'Should include relative time prefix "in"');
  assertTrue(result.includes('UTC'), 'Should include UTC timezone');
  assertTrue(result.includes('('), 'Should include opening parenthesis');
  assertTrue(result.includes(')'), 'Should include closing parenthesis');
});

runTest('formatResetTimeWithRelative handles null input', () => {
  const result = formatResetTimeWithRelative(null);
  assertEqual(result, null, 'Should return null for null input');
});

runTest('formatResetTimeWithRelative handles unparseable input', () => {
  const result = formatResetTimeWithRelative('invalid-time');
  assertEqual(result, 'invalid-time', 'Should return original string for unparseable input');
});

runTest('formatResetTimeWithRelative handles timezone parameter', () => {
  const result = formatResetTimeWithRelative('8:00 PM', 'UTC');
  assertTrue(result.includes('in'), 'Should include relative time with timezone');
  assertTrue(result.includes('UTC'), 'Should include UTC in output');
});

// === Fallback behavior tests ===

runTest('formatResetTimeWithRelative OR original time provides a valid string', () => {
  // This tests the pattern used in github.lib.mjs:
  // formatResetTimeWithRelative(limitResetTime, timezone) || limitResetTime
  const testCases = [
    { input: '4:00 PM', desc: 'simple time' },
    { input: 'Jan 15, 8:00 AM', desc: 'date+time' },
    { input: 'invalid', desc: 'unparseable' },
  ];

  for (const tc of testCases) {
    const formatted = formatResetTimeWithRelative(tc.input, null) || tc.input;
    assertTrue(typeof formatted === 'string', `Fallback pattern should produce string for ${tc.desc}`);
    assertTrue(formatted.length > 0, `Fallback pattern should produce non-empty string for ${tc.desc}`);
  }
});

// === Summary ===

console.log('\n' + '='.repeat(50));
console.log(`Test results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(50));

if (testsFailed > 0) {
  process.exit(1);
}
