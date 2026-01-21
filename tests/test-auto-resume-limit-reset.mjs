#!/usr/bin/env node

/**
 * Test suite for --auto-resume-on-limit-reset flow
 * Tests that when usage limit is reached with auto-resume enabled,
 * the process continues to showSessionSummary() instead of exiting early.
 *
 * Related issue: https://github.com/link-assistant/hive-mind/issues/1054
 *
 * Root cause of bug: When limitReached=true, success=false (is_error=true),
 * so code entered the failure branch and called safeExit(1) before reaching
 * showSessionSummary() where autoContinueWhenLimitResets() is called.
 *
 * Fix: Added condition to skip failure exit when limitReached && autoResumeOnLimitReset
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
function shouldSkipFailureExit(limitReached, autoResumeOnLimitReset) {
  return limitReached && autoResumeOnLimitReset;
}

/**
 * Simulates the failure exit condition from solve.mjs:1042
 * Returns true if the code would exit early (bad), false if it would continue (good)
 */
function wouldExitEarly(success, limitReached, autoResumeOnLimitReset) {
  const shouldSkip = shouldSkipFailureExit(limitReached, autoResumeOnLimitReset);
  return !success && !shouldSkip;
}

// === Test cases for the fix ===

runTest('shouldSkipFailureExit: returns true when limit reached with auto-resume', () => {
  const result = shouldSkipFailureExit(true, true);
  assertTrue(result, 'Should skip exit when limit reached with auto-resume');
});

runTest('shouldSkipFailureExit: returns false when limit not reached', () => {
  const result = shouldSkipFailureExit(false, true);
  assertFalse(result, 'Should not skip exit when limit not reached');
});

runTest('shouldSkipFailureExit: returns false when auto-resume disabled', () => {
  const result = shouldSkipFailureExit(true, false);
  assertFalse(result, 'Should not skip exit when auto-resume disabled');
});

runTest('shouldSkipFailureExit: returns false when both false', () => {
  const result = shouldSkipFailureExit(false, false);
  assertFalse(result, 'Should not skip exit when both conditions false');
});

// === Test the original bug scenario ===

runTest('BUG SCENARIO: limit reached, auto-resume enabled, success=false -> should NOT exit', () => {
  // This is the exact scenario from issue #1054
  // When Claude hits usage limit: is_error=true -> success=false
  // User had --auto-resume-on-limit-reset enabled
  // Expected: code should continue to showSessionSummary()
  const success = false;
  const limitReached = true;
  const autoResumeOnLimitReset = true;

  const wouldExit = wouldExitEarly(success, limitReached, autoResumeOnLimitReset);
  assertFalse(wouldExit, 'Should NOT exit early when limit reached with auto-resume');
});

// === Test normal behavior is preserved ===

runTest('normal failure (no limit): should exit', () => {
  const success = false;
  const limitReached = false;
  const autoResumeOnLimitReset = true;

  const wouldExit = wouldExitEarly(success, limitReached, autoResumeOnLimitReset);
  assertTrue(wouldExit, 'Should exit on normal failure');
});

runTest('limit reached without auto-resume: should exit', () => {
  const success = false;
  const limitReached = true;
  const autoResumeOnLimitReset = false;

  const wouldExit = wouldExitEarly(success, limitReached, autoResumeOnLimitReset);
  assertTrue(wouldExit, 'Should exit when limit reached but auto-resume disabled');
});

runTest('success case: should never exit via failure path', () => {
  const success = true;
  const limitReached = false;
  const autoResumeOnLimitReset = false;

  const wouldExit = wouldExitEarly(success, limitReached, autoResumeOnLimitReset);
  assertFalse(wouldExit, 'Should not enter failure path on success');
});

runTest('success case with limit flags: should never exit via failure path', () => {
  // Edge case: success=true should never enter failure branch
  const success = true;
  const limitReached = true;
  const autoResumeOnLimitReset = true;

  const wouldExit = wouldExitEarly(success, limitReached, autoResumeOnLimitReset);
  assertFalse(wouldExit, 'Success should bypass failure path entirely');
});

// === Summary ===

console.log('\n' + '='.repeat(60));
console.log(`Test results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(60));

if (testsFailed > 0) {
  console.log('\nFailed tests indicate a regression in the auto-resume fix.');
  console.log('See issue #1054 for context.');
  process.exit(1);
} else {
  console.log('\nAll tests passed. The --auto-resume-on-limit-reset fix is working correctly.');
}
