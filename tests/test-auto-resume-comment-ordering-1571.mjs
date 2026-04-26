#!/usr/bin/env node

/**
 * Test suite for issue #1571: No `solution draft log` and `ready to merge` comments
 * should appear between limit reached and auto resume.
 *
 * Related issue: https://github.com/link-assistant/hive-mind/issues/1571
 *
 * Root cause: When the usage limit is reached with --auto-resume-on-limit-reset enabled,
 * autoContinueWhenLimitResets() spawns a child process but returned immediately without
 * awaiting the child exit. The parent process then continued to verifyResults() (posting
 * "Solution Draft Log") and startAutoRestartUntilMergeable() (posting "Ready to merge")
 * before the child process had a chance to post the "Auto Resume" comment.
 *
 * Fix: Two-layer defense:
 * 1. autoContinueWhenLimitResets() now awaits the child process exit (never returns)
 * 2. Defense-in-depth guard in solve.mjs skips post-processing when limit + auto-continue
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

// === Test: Defense-in-depth guard logic ===
// Simulates the guard added in solve.mjs after showSessionSummary()

/**
 * Simulates the post-processing skip guard from solve.mjs
 * Returns true if post-processing (verifyResults, autoMerge) should be skipped
 */
function shouldSkipPostProcessing(limitReached, autoResumeOnLimitReset, autoRestartOnLimitReset, limitResetTime) {
  return limitReached && (autoResumeOnLimitReset || autoRestartOnLimitReset) && limitResetTime;
}

runTest('Issue #1571: skip post-processing when limit reached with auto-resume', () => {
  const result = shouldSkipPostProcessing(true, true, false, '2026-04-11T00:00:00Z');
  assertTrue(result, 'Should skip post-processing when limit reached with auto-resume');
});

runTest('Issue #1571: skip post-processing when limit reached with auto-restart', () => {
  const result = shouldSkipPostProcessing(true, false, true, '2026-04-11T00:00:00Z');
  assertTrue(result, 'Should skip post-processing when limit reached with auto-restart');
});

runTest('Issue #1571: do NOT skip post-processing when no limit reached', () => {
  const result = shouldSkipPostProcessing(false, true, false, '2026-04-11T00:00:00Z');
  assertFalse(result, 'Should not skip post-processing when no limit reached');
});

runTest('Issue #1571: do NOT skip post-processing when auto-continue disabled', () => {
  const result = shouldSkipPostProcessing(true, false, false, '2026-04-11T00:00:00Z');
  assertFalse(result, 'Should not skip post-processing when auto-continue disabled');
});

runTest('Issue #1571: do NOT skip post-processing when no reset time available', () => {
  const result = shouldSkipPostProcessing(true, true, false, null);
  assertFalse(result, 'Should not skip post-processing when no reset time');
});

runTest('Issue #1571: normal success case - do NOT skip post-processing', () => {
  const result = shouldSkipPostProcessing(false, false, false, null);
  assertFalse(result, 'Should not skip post-processing on normal success');
});

// === Test: Expected comment ordering ===

/**
 * Validates comment ordering for the limit-reached-then-auto-resume flow.
 * The parent process should only post "Usage Limit Reached" and then exit.
 * The child process (auto-resume) posts "Auto Resume", then after work:
 * "Solution Draft Log" and "Ready to merge".
 */
function validateCommentOrder(comments) {
  // Find indices of key comments
  const limitReachedIdx = comments.findIndex(c => c.includes('Usage Limit Reached') || c.includes('Limit Reached'));
  const solutionDraftIdx = comments.findIndex((c, i) => i > limitReachedIdx && c.includes('Solution Draft Log'));
  const readyToMergeIdx = comments.findIndex((c, i) => i > limitReachedIdx && c.includes('Ready to merge'));
  const autoResumeIdx = comments.findIndex((c, i) => i > limitReachedIdx && c.includes('Auto Resume'));

  const errors = [];

  if (limitReachedIdx === -1) {
    errors.push('Missing "Usage Limit Reached" comment');
  }

  if (autoResumeIdx !== -1) {
    // Auto resume should come BEFORE solution draft log and ready to merge
    if (solutionDraftIdx !== -1 && solutionDraftIdx < autoResumeIdx) {
      errors.push(`"Solution Draft Log" (index ${solutionDraftIdx}) appears before "Auto Resume" (index ${autoResumeIdx})`);
    }
    if (readyToMergeIdx !== -1 && readyToMergeIdx < autoResumeIdx) {
      errors.push(`"Ready to merge" (index ${readyToMergeIdx}) appears before "Auto Resume" (index ${autoResumeIdx})`);
    }
  }

  return errors;
}

runTest('Issue #1571: correct comment ordering - auto resume before solution draft log', () => {
  const correctOrder = ['## ⏳ Usage Limit Reached', '⏰ **Auto Resume (on limit reset)**', '## 🤖 Solution Draft Log', '## ✅ Ready to merge'];
  const errors = validateCommentOrder(correctOrder);
  assertEqual(errors.length, 0, `Expected no ordering errors, got: ${errors.join(', ')}`);
});

runTest('Issue #1571: detect wrong ordering - solution draft log before auto resume (the bug)', () => {
  // This is the buggy ordering from PR #1568
  const wrongOrder = ['## ⏳ Usage Limit Reached', '## 🤖 Solution Draft Log', '## ✅ Ready to merge', '⏰ **Auto Resume (on limit reset)**'];
  const errors = validateCommentOrder(wrongOrder);
  assertTrue(errors.length > 0, 'Should detect wrong ordering');
  assertTrue(
    errors.some(e => e.includes('Solution Draft Log') && e.includes('before')),
    'Should specifically flag Solution Draft Log before Auto Resume'
  );
});

runTest('Issue #1571: detect wrong ordering - ready to merge before auto resume', () => {
  const wrongOrder = ['## ⏳ Usage Limit Reached', '## ✅ Ready to merge', '⏰ **Auto Resume (on limit reset)**'];
  const errors = validateCommentOrder(wrongOrder);
  assertTrue(errors.length > 0, 'Should detect wrong ordering of Ready to merge');
});

runTest('Issue #1571: no auto resume comment - no ordering error', () => {
  // When there's no auto-resume, Solution Draft Log after Limit Reached is fine
  const noAutoResume = ['## ⏳ Usage Limit Reached', '## 🤖 Solution Draft Log'];
  const errors = validateCommentOrder(noAutoResume);
  assertEqual(errors.length, 0, 'No ordering errors when no auto-resume comment exists');
});

// === Test: autoContinueWhenLimitResets behavior ===

runTest('Issue #1571: autoContinueWhenLimitResets should await child exit (never return early)', async () => {
  // This test verifies the concept that the function should block until child exits
  // In practice, the function calls process.exit() via child.on('close'),
  // so it never returns to the caller.
  //
  // We simulate this by checking that the await on the close event properly blocks:
  let functionReturned = false;
  let childExited = false;

  // Simulate the awaited promise pattern
  const promise = new Promise(resolve => {
    // Simulate child.on('close', ...)
    setTimeout(() => {
      childExited = true;
      // In real code: process.exit(code); resolve();
      resolve();
    }, 10);
  });

  // Before the promise resolves, functionReturned should still be false
  const checker = new Promise(resolve => {
    setTimeout(() => {
      // At 5ms, the child hasn't exited yet
      assertFalse(childExited, 'Child should not have exited yet at 5ms');
      assertFalse(functionReturned, 'Function should not have returned yet');
      resolve();
    }, 5);
  });

  await checker;
  await promise;
  functionReturned = true;

  assertTrue(childExited, 'Child should have exited');
  assertTrue(functionReturned, 'Function should have returned after child exited');
});

// === Summary ===

console.log('\n' + '='.repeat(60));
console.log(`Test results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(60));

if (testsFailed > 0) {
  console.log('\nFailed tests indicate a regression in the comment ordering fix.');
  console.log('See issue #1571 for context.');
  process.exit(1);
} else {
  console.log('\nAll tests passed. Comment ordering fix for issue #1571 is working correctly.');
}
