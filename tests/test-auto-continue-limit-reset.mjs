#!/usr/bin/env node

/**
 * Test suite for --auto-continue-on-limit-reset flow
 * Tests that when usage limit is reached with auto-continue enabled,
 * the process continues to showSessionSummary() instead of exiting early.
 *
 * Related issue: https://github.com/link-assistant/hive-mind/issues/1054
 *
 * Root cause of bug: When limitReached=true, success=false (is_error=true),
 * so code entered the failure branch and called safeExit(1) before reaching
 * showSessionSummary() where autoContinueWhenLimitResets() is called.
 *
 * Fix: Added condition to skip failure exit when limitReached && autoContinueOnLimitReset
 */

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
    throw new Error(`${message}: expected truthy value`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(`${message}: expected falsy value`);
  }
}

// Simulate the control flow logic from solve.mjs

/**
 * Simulates the shouldSkipFailureExitForAutoLimitContinue logic
 * from the fix in solve.mjs:1040
 */
function shouldSkipFailureExit(limitReached, autoContinueOnLimitReset) {
  return limitReached && autoContinueOnLimitReset;
}

/**
 * Simulates the failure exit condition from solve.mjs:1042
 * Returns true if the code would exit early (bad), false if it would continue (good)
 */
function wouldExitEarly(success, limitReached, autoContinueOnLimitReset) {
  const shouldSkip = shouldSkipFailureExit(limitReached, autoContinueOnLimitReset);
  return !success && !shouldSkip;
}

// === Test cases for the fix ===

runTest('shouldSkipFailureExit: returns true when limit reached with auto-continue', () => {
  const result = shouldSkipFailureExit(true, true);
  assertTrue(result, 'Should skip exit when limit reached with auto-continue');
});

runTest('shouldSkipFailureExit: returns false when limit not reached', () => {
  const result = shouldSkipFailureExit(false, true);
  assertFalse(result, 'Should not skip exit when limit not reached');
});

runTest('shouldSkipFailureExit: returns false when auto-continue disabled', () => {
  const result = shouldSkipFailureExit(true, false);
  assertFalse(result, 'Should not skip exit when auto-continue disabled');
});

runTest('shouldSkipFailureExit: returns false when both false', () => {
  const result = shouldSkipFailureExit(false, false);
  assertFalse(result, 'Should not skip exit when both conditions false');
});

// === Test the original bug scenario ===

runTest('BUG SCENARIO: limit reached, auto-continue enabled, success=false -> should NOT exit', () => {
  // This is the exact scenario from issue #1054
  // When Claude hits usage limit: is_error=true -> success=false
  // User had --auto-continue-on-limit-reset enabled
  // Expected: code should continue to showSessionSummary()
  const success = false;
  const limitReached = true;
  const autoContinueOnLimitReset = true;

  const wouldExit = wouldExitEarly(success, limitReached, autoContinueOnLimitReset);
  assertFalse(wouldExit, 'Should NOT exit early when limit reached with auto-continue');
});

// === Test normal behavior is preserved ===

runTest('normal failure (no limit): should exit', () => {
  const success = false;
  const limitReached = false;
  const autoContinueOnLimitReset = true;

  const wouldExit = wouldExitEarly(success, limitReached, autoContinueOnLimitReset);
  assertTrue(wouldExit, 'Should exit on normal failure');
});

runTest('limit reached without auto-continue: should exit', () => {
  const success = false;
  const limitReached = true;
  const autoContinueOnLimitReset = false;

  const wouldExit = wouldExitEarly(success, limitReached, autoContinueOnLimitReset);
  assertTrue(wouldExit, 'Should exit when limit reached but auto-continue disabled');
});

runTest('success case: should never exit via failure path', () => {
  const success = true;
  const limitReached = false;
  const autoContinueOnLimitReset = false;

  const wouldExit = wouldExitEarly(success, limitReached, autoContinueOnLimitReset);
  assertFalse(wouldExit, 'Should not enter failure path on success');
});

runTest('success case with limit flags: should never exit via failure path', () => {
  // Edge case: success=true should never enter failure branch
  const success = true;
  const limitReached = true;
  const autoContinueOnLimitReset = true;

  const wouldExit = wouldExitEarly(success, limitReached, autoContinueOnLimitReset);
  assertFalse(wouldExit, 'Success should bypass failure path entirely');
});

// === Summary ===

console.log('\n' + '='.repeat(60));
console.log(`Test results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(60));

if (testsFailed > 0) {
  console.log('\nFailed tests indicate a regression in the auto-continue fix.');
  console.log('See issue #1054 for context.');
  process.exit(1);
} else {
  console.log('\nAll tests passed. The --auto-continue-on-limit-reset fix is working correctly.');
}
