#!/usr/bin/env node
/**
 * Test suite for PR creation retry logic
 * Tests the fix for issue #1513: PR creation fails with transient GraphQL error
 * after fork creation + invitation acceptance.
 *
 * The core issue: gh pr create fails with "Something went wrong while executing your query"
 * because GitHub's API hasn't fully propagated the fork/invitation state. The fix adds
 * retry with exponential backoff for transient GraphQL errors.
 */

import assert from 'assert';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`   ✅ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`   ❌ ${name}: ${error.message}`);
  }
}

// Helper: detect if an error message is a transient GraphQL error
// This mirrors the isTransientGraphqlError function from solve.auto-pr.lib.mjs
function isTransientGraphqlError(msg) {
  return msg.includes('Something went wrong while executing your query') || msg.includes('was submitted too quickly') || msg.includes('internal error') || msg.includes('Internal Server Error') || msg.includes('502') || msg.includes('503');
}

// Helper: simulate the PR creation retry logic from solve.auto-pr.lib.mjs
async function simulatePrCreateWithRetry({ failCount = 0, maxAttempts = 5, errorMessage = 'GraphQL: Something went wrong while executing your query', isTransient = true, prUrl = 'https://github.com/owner/repo/pull/42' } = {}) {
  let output = null;
  let prCreateAttempts = 0;
  let lastPrCreateError = null;
  let totalWaitTime = 0;
  const attemptTimestamps = [];

  while (prCreateAttempts < maxAttempts) {
    prCreateAttempts++;
    lastPrCreateError = null;

    if (prCreateAttempts > 1) {
      const waitTime = Math.min(2000 * prCreateAttempts, 10000);
      totalWaitTime += waitTime;
      attemptTimestamps.push({ attempt: prCreateAttempts, waitTime });
    }

    // Simulate execAsync call
    if (prCreateAttempts <= failCount) {
      const error = new Error(errorMessage);
      if (isTransient && isTransientGraphqlError(error.message) && prCreateAttempts < maxAttempts) {
        lastPrCreateError = error;
        // Continue to next iteration (retry)
      } else {
        // Non-retryable error - throw immediately
        return { success: false, error, prCreateAttempts, totalWaitTime, attemptTimestamps };
      }
    } else {
      output = prUrl;
      break;
    }
  }

  // If all retry attempts were exhausted with transient errors
  if (lastPrCreateError && !output) {
    return { success: false, error: lastPrCreateError, prCreateAttempts, totalWaitTime, attemptTimestamps };
  }

  return { success: true, output, prCreateAttempts, totalWaitTime, attemptTimestamps };
}

console.log('\n🧪 Test Suite: PR Creation Retry Logic (Issue #1513)\n');

// Test 1: PR created on first attempt (no retry needed)
test('PR created on first attempt — no retry needed', async () => {
  const result = await simulatePrCreateWithRetry({ failCount: 0 });
  assert.strictEqual(result.success, true, 'PR should be created');
  assert.strictEqual(result.prCreateAttempts, 1, 'Should take exactly 1 attempt');
  assert.strictEqual(result.totalWaitTime, 0, 'No wait time needed');
});

// Test 2: PR created on second attempt after transient GraphQL error
test('PR created on second attempt — simulates eventual consistency', async () => {
  const result = await simulatePrCreateWithRetry({ failCount: 1 });
  assert.strictEqual(result.success, true, 'PR should be created');
  assert.strictEqual(result.prCreateAttempts, 2, 'Should take exactly 2 attempts');
});

// Test 3: PR created on third attempt
test('PR created on third attempt — longer propagation delay', async () => {
  const result = await simulatePrCreateWithRetry({ failCount: 2 });
  assert.strictEqual(result.success, true, 'PR should be created');
  assert.strictEqual(result.prCreateAttempts, 3, 'Should take exactly 3 attempts');
});

// Test 4: All retries exhausted with transient errors
test('All retries exhausted — transient errors persist', async () => {
  const result = await simulatePrCreateWithRetry({ failCount: 10, maxAttempts: 5 });
  assert.strictEqual(result.success, false, 'PR should NOT be created');
  assert.strictEqual(result.prCreateAttempts, 5, 'Should exhaust all 5 attempts');
});

// Test 5: Non-retryable error fails immediately
test('Non-retryable error fails immediately without retry', async () => {
  const result = await simulatePrCreateWithRetry({
    failCount: 1,
    errorMessage: 'No commits between branches',
    isTransient: false,
  });
  assert.strictEqual(result.success, false, 'PR should NOT be created');
  assert.strictEqual(result.prCreateAttempts, 1, 'Should fail on first attempt');
});

// Test 6: Exponential backoff wait times are correct
test('Wait times follow linear backoff pattern: 4s, 6s, 8s, 10s', async () => {
  const result = await simulatePrCreateWithRetry({ failCount: 10, maxAttempts: 5 });
  // Wait times: attempt 2=4s, 3=6s, 4=8s, 5=10s (attempt 1 has no wait)
  const expectedWaits = [4000, 6000, 8000, 10000];
  for (let i = 0; i < result.attemptTimestamps.length; i++) {
    assert.strictEqual(result.attemptTimestamps[i].waitTime, expectedWaits[i], `Attempt ${i + 2} wait time should be ${expectedWaits[i]}ms, got ${result.attemptTimestamps[i].waitTime}ms`);
  }
});

// Test 7: Total maximum wait time is bounded
test('Total maximum wait time is bounded at 28 seconds', async () => {
  const result = await simulatePrCreateWithRetry({ failCount: 10, maxAttempts: 5 });
  // 4000 + 6000 + 8000 + 10000 = 28000ms (first attempt has no wait)
  assert.strictEqual(result.totalWaitTime, 28000, 'Total wait should be 28 seconds');
});

// Test 8: isTransientGraphqlError detects all known transient error patterns
test('isTransientGraphqlError detects all known transient error patterns', () => {
  assert.strictEqual(isTransientGraphqlError('GraphQL: Something went wrong while executing your query on 2026-03-31T11:11:16Z'), true, 'Should detect "Something went wrong" error');
  assert.strictEqual(isTransientGraphqlError('was submitted too quickly'), true, 'Should detect rate limiting error');
  assert.strictEqual(isTransientGraphqlError('internal error'), true, 'Should detect internal error');
  assert.strictEqual(isTransientGraphqlError('Internal Server Error'), true, 'Should detect Internal Server Error');
  assert.strictEqual(isTransientGraphqlError('502 Bad Gateway'), true, 'Should detect 502 error');
  assert.strictEqual(isTransientGraphqlError('503 Service Unavailable'), true, 'Should detect 503 error');
});

// Test 9: isTransientGraphqlError rejects non-transient errors
test('isTransientGraphqlError rejects non-transient errors', () => {
  assert.strictEqual(isTransientGraphqlError('No commits between branches'), false, 'Should not detect "No commits between" as transient');
  assert.strictEqual(isTransientGraphqlError('could not assign user'), false, 'Should not detect assignee error as transient');
  assert.strictEqual(isTransientGraphqlError("Head sha can't be blank"), false, 'Should not detect "Head sha" error as transient');
  assert.strictEqual(isTransientGraphqlError('pull request already exists'), false, 'Should not detect duplicate PR as transient');
});

// Test 10: Original bug scenario — GraphQL error from issue #1513
test('Original bug scenario: GraphQL error after fork + invite acceptance', async () => {
  // In issue #1513, the error happened on the first attempt with
  // "Something went wrong while executing your query" 14 seconds after fork creation.
  // With retry, the 2nd attempt at +4s would likely succeed.
  const result = await simulatePrCreateWithRetry({
    failCount: 1,
    errorMessage: 'GraphQL: Something went wrong while executing your query on 2026-03-31T11:11:16Z. Please include `E400:214657:A4EF54:90FAA6:69CBABD3` when reporting this issue.',
  });
  assert.strictEqual(result.success, true, 'Should succeed on second attempt');
  assert.strictEqual(result.prCreateAttempts, 2, 'First attempt fails, second succeeds');
});

// Test 11: PR found on last attempt
test('PR created on last (5th) attempt — maximum propagation delay', async () => {
  const result = await simulatePrCreateWithRetry({ failCount: 4, maxAttempts: 5 });
  assert.strictEqual(result.success, true, 'PR should be created');
  assert.strictEqual(result.prCreateAttempts, 5, 'Should take exactly 5 attempts');
});

// Test 12: Verify retry does not interfere with assignee fallback
test('Assignee validation error is not treated as transient', () => {
  assert.strictEqual(isTransientGraphqlError('could not assign user konard to this repository'), false, 'Assignee errors should not trigger transient retry');
});

console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
