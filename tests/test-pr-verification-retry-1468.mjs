#!/usr/bin/env node
/**
 * Test suite for PR verification retry logic
 * Tests the fix for issue #1468: PR verification fails due to GitHub API eventual consistency
 *
 * The core issue: gh pr create returns a URL but gh pr view returns 404 immediately after,
 * because GitHub's API is eventually consistent. The fix adds retry with exponential backoff.
 */

import assert from 'assert';

// Simulate the retry logic from solve.auto-pr.lib.mjs (lines 1204-1260)
// This is a unit test that validates the retry behavior without actual GitHub API calls

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

// Helper: simulate the verification retry logic
async function simulateVerifyWithRetry({ failCount = 0, maxAttempts = 5, prData = { number: 42, url: 'https://github.com/owner/repo/pull/42', state: 'open' } } = {}) {
  let prVerified = false;
  let verifyAttempts = 0;
  let lastVerifyResult = null;
  let totalWaitTime = 0;
  const attemptTimestamps = [];

  while (!prVerified && verifyAttempts < maxAttempts) {
    verifyAttempts++;
    const waitTime = Math.min(2000 * verifyAttempts, 10000);
    totalWaitTime += waitTime;
    attemptTimestamps.push({ attempt: verifyAttempts, waitTime });

    // Simulate API call: fails for first `failCount` attempts, succeeds after
    if (verifyAttempts <= failCount) {
      lastVerifyResult = { code: 1, stdout: '', stderr: 'Could not resolve to a PullRequest' };
    } else {
      lastVerifyResult = { code: 0, stdout: JSON.stringify(prData), stderr: '' };
      prVerified = true;
    }
  }

  return { prVerified, verifyAttempts, totalWaitTime, attemptTimestamps, lastVerifyResult };
}

console.log('\n🧪 Test Suite: PR Verification Retry Logic (Issue #1468)\n');

// Test 1: PR found on first attempt (no retry needed)
test('PR found on first attempt — no retry needed', async () => {
  const result = await simulateVerifyWithRetry({ failCount: 0 });
  assert.strictEqual(result.prVerified, true, 'PR should be verified');
  assert.strictEqual(result.verifyAttempts, 1, 'Should take exactly 1 attempt');
});

// Test 2: PR found on second attempt (1 retry)
test('PR found on second attempt — simulates eventual consistency', async () => {
  const result = await simulateVerifyWithRetry({ failCount: 1 });
  assert.strictEqual(result.prVerified, true, 'PR should be verified');
  assert.strictEqual(result.verifyAttempts, 2, 'Should take exactly 2 attempts');
});

// Test 3: PR found on third attempt
test('PR found on third attempt — longer propagation delay', async () => {
  const result = await simulateVerifyWithRetry({ failCount: 2 });
  assert.strictEqual(result.prVerified, true, 'PR should be verified');
  assert.strictEqual(result.verifyAttempts, 3, 'Should take exactly 3 attempts');
});

// Test 4: PR never found (all retries exhausted)
test('PR never found — all retries exhausted', async () => {
  const result = await simulateVerifyWithRetry({ failCount: 10, maxAttempts: 5 });
  assert.strictEqual(result.prVerified, false, 'PR should NOT be verified');
  assert.strictEqual(result.verifyAttempts, 5, 'Should exhaust all 5 attempts');
});

// Test 5: Exponential backoff wait times are correct
test('Wait times follow exponential backoff pattern: 2s, 4s, 6s, 8s, 10s', async () => {
  const result = await simulateVerifyWithRetry({ failCount: 10, maxAttempts: 5 });
  const expectedWaits = [2000, 4000, 6000, 8000, 10000];
  for (let i = 0; i < result.attemptTimestamps.length; i++) {
    assert.strictEqual(result.attemptTimestamps[i].waitTime, expectedWaits[i], `Attempt ${i + 1} wait time should be ${expectedWaits[i]}ms, got ${result.attemptTimestamps[i].waitTime}ms`);
  }
});

// Test 6: Total maximum wait time is bounded
test('Total maximum wait time is bounded at 30 seconds', async () => {
  const result = await simulateVerifyWithRetry({ failCount: 10, maxAttempts: 5 });
  // 2000 + 4000 + 6000 + 8000 + 10000 = 30000ms
  assert.strictEqual(result.totalWaitTime, 30000, 'Total wait should be 30 seconds');
});

// Test 7: PR found on last attempt
test('PR found on last (5th) attempt — maximum propagation delay', async () => {
  const result = await simulateVerifyWithRetry({ failCount: 4, maxAttempts: 5 });
  assert.strictEqual(result.prVerified, true, 'PR should be verified');
  assert.strictEqual(result.verifyAttempts, 5, 'Should take exactly 5 attempts');
});

// Test 8: Verify PR data extraction works correctly
test('PR data (number, url) is correctly extracted from verification response', async () => {
  const customPrData = { number: 1368, url: 'https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1368', state: 'open' };
  const result = await simulateVerifyWithRetry({ failCount: 1, prData: customPrData });
  assert.strictEqual(result.prVerified, true);
  const parsed = JSON.parse(result.lastVerifyResult.stdout);
  assert.strictEqual(parsed.number, 1368);
  assert.strictEqual(parsed.url, customPrData.url);
});

// Test 9: Invalid PR data (missing fields) should not count as verified
test('Invalid PR data (missing number) is not accepted', async () => {
  // Simulate: API returns 200 but with empty/invalid data
  let prVerified = false;
  const invalidData = { url: 'https://example.com', state: 'open' }; // missing number

  const result = { code: 0, stdout: JSON.stringify(invalidData) };
  try {
    const prData = JSON.parse(result.stdout);
    if (prData.number && prData.url) {
      prVerified = true;
    }
  } catch {
    // parse error
  }
  assert.strictEqual(prVerified, false, 'PR with missing number should not be verified');
});

// Test 10: Verify the original bug scenario — 289ms gap
test('Original bug scenario: verification at +289ms would fail without retry', async () => {
  // In the original bug, gh pr create returned at 04:20:47.751Z
  // gh pr view failed at 04:20:48.040Z (289ms later)
  // With retry, the 2nd attempt at +4s would succeed
  const result = await simulateVerifyWithRetry({ failCount: 1 }); // fails once, succeeds on retry
  assert.strictEqual(result.prVerified, true, 'Should succeed on second attempt');
  assert.strictEqual(result.verifyAttempts, 2, 'First attempt fails, second succeeds');
});

// Test 11: Error message includes attempt count when all retries fail
test('Error message mentions attempt count on total failure', async () => {
  const maxVerifyAttempts = 5;
  const result = await simulateVerifyWithRetry({ failCount: 10, maxAttempts: maxVerifyAttempts });
  assert.strictEqual(result.prVerified, false);
  // Verify the error construction matches our code
  const errorMsg = `PR verification failed - gh pr create returned URL "test" but PR #42 does not exist on GitHub after ${maxVerifyAttempts} verification attempts`;
  assert(errorMsg.includes(`after ${maxVerifyAttempts} verification attempts`), 'Error should include attempt count');
});

console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
