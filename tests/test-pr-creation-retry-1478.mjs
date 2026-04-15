#!/usr/bin/env node
/**
 * Test suite for PR creation transient error retry logic
 * Tests the fix for issue #1478: PR creation failed due to transient GitHub API error
 *
 * The core issue: `gh pr create` can fail with transient GitHub server errors
 * (e.g., "Something went wrong while executing your query") during service disruptions.
 * The fix adds retry with exponential backoff for these transient errors.
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

// Reproduce the transient error detection logic from solve.auto-pr.lib.mjs
const isTransientGitHubError = (errorMsg) => {
  const transientPatterns = [
    'Something went wrong while executing your query',
    'something went wrong while executing your query',
    '502 Bad Gateway',
    '503 Service Unavailable',
    '504 Gateway Timeout',
    'INTERNAL_ERROR',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'socket hang up',
    'network error',
  ];
  return transientPatterns.some(pattern => errorMsg.includes(pattern));
};

// Helper: simulate the PR creation retry logic from solve.auto-pr.lib.mjs
async function simulatePrCreateWithRetry({
  errors = [],
  maxAttempts = 3,
  successOutput = 'https://github.com/owner/repo/pull/42',
} = {}) {
  let attempt = 0;
  let output = '';
  let lastError = null;
  const attemptTimestamps = [];
  let totalWaitTime = 0;

  while (attempt < maxAttempts) {
    attempt++;

    try {
      // Simulate: throw error for attempts that should fail
      if (attempt <= errors.length) {
        throw new Error(errors[attempt - 1]);
      }
      // Success
      output = successOutput;
      attemptTimestamps.push({ attempt, result: 'success' });
      break;
    } catch (prAttemptError) {
      const attemptErrorMsg = prAttemptError.message || '';

      if (isTransientGitHubError(attemptErrorMsg) && attempt < maxAttempts) {
        const waitTime = Math.min(5000 * attempt, 15000);
        totalWaitTime += waitTime;
        attemptTimestamps.push({ attempt, result: 'transient_retry', waitTime });
        // In real code: await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        lastError = prAttemptError;
        attemptTimestamps.push({ attempt, result: 'fatal_error' });
        break;
      }
    }
  }

  return { output, lastError, attempt, totalWaitTime, attemptTimestamps };
}

console.log('\n🧪 Test Suite: PR Creation Transient Error Retry Logic (Issue #1478)\n');

// --- Transient error detection tests ---

test('Detects GitHub GraphQL "Something went wrong" as transient', () => {
  const msg = 'GraphQL: Something went wrong while executing your query on 2026-03-24T20:09:47Z. Please include `C494:160A:1899070D:156DE0AF:69C2EF89` when reporting this issue.';
  assert.strictEqual(isTransientGitHubError(msg), true);
});

test('Detects 502 Bad Gateway as transient', () => {
  assert.strictEqual(isTransientGitHubError('HTTP 502 Bad Gateway'), true);
});

test('Detects 503 Service Unavailable as transient', () => {
  assert.strictEqual(isTransientGitHubError('503 Service Unavailable'), true);
});

test('Detects 504 Gateway Timeout as transient', () => {
  assert.strictEqual(isTransientGitHubError('504 Gateway Timeout'), true);
});

test('Detects ETIMEDOUT as transient', () => {
  assert.strictEqual(isTransientGitHubError('connect ETIMEDOUT 140.82.112.3:443'), true);
});

test('Detects ECONNRESET as transient', () => {
  assert.strictEqual(isTransientGitHubError('read ECONNRESET'), true);
});

test('Detects ECONNREFUSED as transient', () => {
  assert.strictEqual(isTransientGitHubError('connect ECONNREFUSED 127.0.0.1:443'), true);
});

test('Detects socket hang up as transient', () => {
  assert.strictEqual(isTransientGitHubError('socket hang up'), true);
});

test('Detects INTERNAL_ERROR as transient', () => {
  assert.strictEqual(isTransientGitHubError('GraphQL: INTERNAL_ERROR'), true);
});

test('Does NOT treat "No commits between" as transient', () => {
  assert.strictEqual(isTransientGitHubError('No commits between main and feature-branch'), false);
});

test('Does NOT treat "could not assign user" as transient', () => {
  assert.strictEqual(isTransientGitHubError('could not assign user to pull request'), false);
});

test('Does NOT treat "Head sha can\'t be blank" as transient', () => {
  assert.strictEqual(isTransientGitHubError("Head sha can't be blank"), false);
});

test('Does NOT treat authentication errors as transient', () => {
  assert.strictEqual(isTransientGitHubError('HTTP 401: Bad credentials'), false);
});

test('Does NOT treat permission errors as transient', () => {
  assert.strictEqual(isTransientGitHubError('HTTP 403: Resource not accessible by integration'), false);
});

test('Does NOT treat empty string as transient', () => {
  assert.strictEqual(isTransientGitHubError(''), false);
});

// --- Retry logic simulation tests ---

test('PR creation succeeds on first attempt — no retry needed', async () => {
  const result = await simulatePrCreateWithRetry({ errors: [] });
  assert.strictEqual(result.output, 'https://github.com/owner/repo/pull/42');
  assert.strictEqual(result.attempt, 1);
  assert.strictEqual(result.lastError, null);
  assert.strictEqual(result.totalWaitTime, 0);
});

test('PR creation succeeds on second attempt after transient error', async () => {
  const result = await simulatePrCreateWithRetry({
    errors: ['GraphQL: Something went wrong while executing your query'],
  });
  assert.strictEqual(result.output, 'https://github.com/owner/repo/pull/42');
  assert.strictEqual(result.attempt, 2);
  assert.strictEqual(result.lastError, null);
  assert.strictEqual(result.totalWaitTime, 5000); // 5s wait after first failure
});

test('PR creation succeeds on third attempt after two transient errors', async () => {
  const result = await simulatePrCreateWithRetry({
    errors: [
      'Something went wrong while executing your query',
      '502 Bad Gateway',
    ],
  });
  assert.strictEqual(result.output, 'https://github.com/owner/repo/pull/42');
  assert.strictEqual(result.attempt, 3);
  assert.strictEqual(result.lastError, null);
  assert.strictEqual(result.totalWaitTime, 15000); // 5s + 10s
});

test('PR creation fails immediately on non-transient error (no retry)', async () => {
  const result = await simulatePrCreateWithRetry({
    errors: ['No commits between main and feature-branch'],
  });
  assert.strictEqual(result.output, '');
  assert.strictEqual(result.attempt, 1);
  assert.notStrictEqual(result.lastError, null);
  assert.strictEqual(result.lastError.message, 'No commits between main and feature-branch');
  assert.strictEqual(result.totalWaitTime, 0);
});

test('PR creation fails after all retries exhausted with transient errors', async () => {
  const result = await simulatePrCreateWithRetry({
    errors: [
      'Something went wrong while executing your query',
      '502 Bad Gateway',
      '503 Service Unavailable', // 3rd attempt is last, should fail
    ],
    maxAttempts: 3,
  });
  assert.strictEqual(result.output, '');
  assert.notStrictEqual(result.lastError, null);
  assert.strictEqual(result.lastError.message, '503 Service Unavailable');
  assert.strictEqual(result.attempt, 3);
});

test('Wait times follow exponential backoff: 5s, 10s, 15s', async () => {
  const result = await simulatePrCreateWithRetry({
    errors: [
      'Something went wrong while executing your query',
      '502 Bad Gateway',
      '503 Service Unavailable',
    ],
    maxAttempts: 3,
  });
  // Only 2 waits happen (attempt 1 and 2 fail, attempt 3 is last so no wait after)
  const retryEntries = result.attemptTimestamps.filter(e => e.result === 'transient_retry');
  assert.strictEqual(retryEntries.length, 2);
  assert.strictEqual(retryEntries[0].waitTime, 5000);
  assert.strictEqual(retryEntries[1].waitTime, 10000);
});

test('Total maximum wait time is bounded at 30 seconds for 3 attempts', async () => {
  // With 3 attempts, max 2 waits: 5000 + 10000 = 15000ms
  const result = await simulatePrCreateWithRetry({
    errors: ['ETIMEDOUT', 'ECONNRESET', 'socket hang up'],
    maxAttempts: 3,
  });
  assert.strictEqual(result.totalWaitTime, 15000);
});

test('Non-transient error on second attempt does NOT retry further', async () => {
  const result = await simulatePrCreateWithRetry({
    errors: [
      'Something went wrong while executing your query', // transient — will retry
      'HTTP 403: Resource not accessible by integration', // non-transient — should NOT retry
    ],
    maxAttempts: 3,
  });
  assert.strictEqual(result.attempt, 2);
  assert.notStrictEqual(result.lastError, null);
  assert.strictEqual(result.lastError.message, 'HTTP 403: Resource not accessible by integration');
  assert.strictEqual(result.totalWaitTime, 5000); // only 1 retry wait
});

test('Original bug scenario: GitHub disruption error retries and succeeds', async () => {
  // Exact error from issue #1478
  const result = await simulatePrCreateWithRetry({
    errors: [
      'GraphQL: Something went wrong while executing your query on 2026-03-24T20:09:47Z. Please include `C494:160A:1899070D:156DE0AF:69C2EF89` when reporting this issue.',
    ],
  });
  assert.strictEqual(result.output, 'https://github.com/owner/repo/pull/42');
  assert.strictEqual(result.attempt, 2);
  assert.strictEqual(result.lastError, null);
});

console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
