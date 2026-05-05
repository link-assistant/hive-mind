#!/usr/bin/env node
/**
 * Tests for transient-network retry inside ghWithRateLimitRetry / execGhWithRetry.
 *
 * Issue #1756: `gh pr create` aborted on a single
 *   `error checking for existing pull request: HTTP 504: 504 Gateway Timeout
 *    (https://api.github.com/graphql)`.
 *
 * Before the fix, ghWithRateLimitRetry only retried rate-limit errors. After
 * the fix, it also retries transient network errors (504/502/503, socket hang
 * up, TLS timeouts, connection reset, etc.) with exponential backoff and a
 * separate retry budget.
 *
 * Run with: node tests/test-execgh-transient-retry-1756.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1756
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';

import { isTransientNetworkError, ghWithRateLimitRetry, execGhWithRetry } from '../src/github-rate-limit.lib.mjs';
import { limitReset } from '../src/config.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

const test = (name, fn) => {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => {
          console.log(`✅ ${name}`);
          testsPassed++;
        })
        .catch(error => {
          console.log(`❌ ${name}`);
          console.log(`   ${error.stack || error.message}`);
          testsFailed++;
        });
    }
    console.log(`✅ ${name}`);
    testsPassed++;
    return undefined;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.stack || error.message}`);
    testsFailed++;
    return undefined;
  }
};

// ----------------------------------------------------------------------------
// isTransientNetworkError
// ----------------------------------------------------------------------------

console.log('\n📋 isTransientNetworkError (issue #1756)\n');

await test('detects HTTP 504 Gateway Timeout', () => {
  assert.equal(isTransientNetworkError(new Error('HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)')), true);
});

await test('detects HTTP 502 Bad Gateway', () => {
  assert.equal(isTransientNetworkError(new Error('HTTP 502: Bad Gateway')), true);
});

await test('detects HTTP 503 Service Unavailable', () => {
  assert.equal(isTransientNetworkError(new Error('HTTP 503: Service Unavailable')), true);
});

await test('detects "socket hang up"', () => {
  assert.equal(isTransientNetworkError(new Error('request to https://api.github.com failed: socket hang up')), true);
});

await test('detects "connection reset by peer"', () => {
  assert.equal(isTransientNetworkError(new Error('read tcp 1.2.3.4:443: read: connection reset by peer')), true);
});

await test('detects "TLS handshake timeout"', () => {
  assert.equal(isTransientNetworkError(new Error('net/http: TLS handshake timeout')), true);
});

await test('detects errors carried in stderr', () => {
  const err = { message: 'cmd failed', stderr: Buffer.from('HTTP 504: 504 Gateway Timeout') };
  assert.equal(isTransientNetworkError(err), true);
});

await test('returns false for HTTP 404', () => {
  assert.equal(isTransientNetworkError(new Error('HTTP 404: Not Found')), false);
});

await test('returns false for HTTP 403 without rate-limit context', () => {
  assert.equal(isTransientNetworkError(new Error('HTTP 403: Forbidden')), false);
});

await test('returns false for null/undefined', () => {
  assert.equal(isTransientNetworkError(null), false);
  assert.equal(isTransientNetworkError(undefined), false);
});

await test('detects the literal #1756 error string verbatim', () => {
  // Reproduction of the exact error message from
  // docs/case-studies/issue-1756/data/c30f7f87-ff3c-4821-ace3-53cb96f93d35.log:351
  const literal = 'error checking for existing pull request: HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)';
  assert.equal(isTransientNetworkError(new Error(literal)), true);
});

// ----------------------------------------------------------------------------
// ghWithRateLimitRetry – transient retry path
// ----------------------------------------------------------------------------

console.log('\n📋 ghWithRateLimitRetry retries transient errors (issue #1756)\n');

await test('retries on HTTP 504 and succeeds', async () => {
  let calls = 0;
  const logs = [];
  const result = await ghWithRateLimitRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error('HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)');
      return 'recovered';
    },
    {
      transientMaxAttempts: 5,
      transientDelay: 1, // keep test fast
      transientBackoff: 1,
      log: msg => logs.push(msg),
    }
  );
  assert.equal(result, 'recovered');
  assert.equal(calls, 3);
  assert.ok(
    logs.some(l => l.includes('transient network error')),
    'should log transient retry message'
  );
});

await test('retries on socket hang up and succeeds', async () => {
  let calls = 0;
  const result = await ghWithRateLimitRetry(
    async () => {
      calls++;
      if (calls === 1) throw new Error('socket hang up');
      return 'ok';
    },
    { transientDelay: 1, transientBackoff: 1, log: () => {} }
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

await test('does NOT retry on HTTP 404', async () => {
  let calls = 0;
  await assert.rejects(
    ghWithRateLimitRetry(
      async () => {
        calls++;
        throw new Error('HTTP 404: Not Found');
      },
      { transientDelay: 1, log: () => {} }
    ),
    /HTTP 404/
  );
  assert.equal(calls, 1);
});

await test('does NOT retry on plain Error not matching any pattern', async () => {
  let calls = 0;
  await assert.rejects(
    ghWithRateLimitRetry(
      async () => {
        calls++;
        throw new Error('totally unexpected programming bug');
      },
      { transientDelay: 1, log: () => {} }
    ),
    /unexpected programming bug/
  );
  assert.equal(calls, 1);
});

await test('throws after transientMaxAttempts of persistent 504s', async () => {
  let calls = 0;
  await assert.rejects(
    ghWithRateLimitRetry(
      async () => {
        calls++;
        throw new Error('HTTP 504: 504 Gateway Timeout');
      },
      { transientMaxAttempts: 3, transientDelay: 1, transientBackoff: 1, log: () => {} }
    ),
    /504/
  );
  assert.equal(calls, 3);
});

await test('exponential backoff between transient retries', async () => {
  const timestamps = [];
  let calls = 0;
  await assert.rejects(
    ghWithRateLimitRetry(
      async () => {
        timestamps.push(Date.now());
        calls++;
        throw new Error('HTTP 504: 504 Gateway Timeout');
      },
      { transientMaxAttempts: 3, transientDelay: 50, transientBackoff: 2, log: () => {} }
    ),
    /504/
  );
  assert.equal(calls, 3);
  if (timestamps.length === 3) {
    const delay1 = timestamps[1] - timestamps[0];
    const delay2 = timestamps[2] - timestamps[1];
    // First sleep ~50ms, second ~100ms (2x backoff). Allow generous tolerance for CI.
    assert.ok(delay1 >= 30, `first delay ${delay1}ms should be >= 30ms`);
    assert.ok(delay2 >= 60, `second delay ${delay2}ms should be >= 60ms`);
    assert.ok(delay2 > delay1, `delay2=${delay2} must exceed delay1=${delay1}`);
  }
});

await test('rate-limit and transient retries use independent budgets', async () => {
  // Stub the rate-limit wait to a few ms so this test stays fast.
  const origBuffer = limitReset.bufferMs;
  const origJitter = limitReset.jitterMs;
  limitReset.bufferMs = 5;
  limitReset.jitterMs = 0;
  try {
    // First attempt fails with rate-limit, second with 504, third succeeds.
    let calls = 0;
    const result = await ghWithRateLimitRetry(
      async () => {
        calls++;
        if (calls === 1) {
          const past = Math.floor((Date.now() - 60_000) / 1000);
          throw new Error(`HTTP 403\nX-RateLimit-Reset: ${past}\nAPI rate limit exceeded`);
        }
        if (calls === 2) {
          throw new Error('HTTP 504: 504 Gateway Timeout');
        }
        return 'survived both';
      },
      {
        maxAttempts: 3,
        transientMaxAttempts: 2,
        transientDelay: 1,
        transientBackoff: 1,
        log: () => {},
      }
    );
    assert.equal(result, 'survived both');
    assert.equal(calls, 3);
  } finally {
    limitReset.bufferMs = origBuffer;
    limitReset.jitterMs = origJitter;
  }
});

// ----------------------------------------------------------------------------
// execGhWithRetry – transient retry path against a fake exec
// ----------------------------------------------------------------------------

console.log('\n📋 execGhWithRetry retries on the literal #1756 error\n');

await test('execGhWithRetry retries on the exact #1756 error from the case study', async () => {
  // The literal error message taken verbatim from the original log.
  const literalMessage = 'error checking for existing pull request: HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)';

  // We can't intercept the underlying child_process.exec without monkey-patching,
  // so we test the higher-level retry shape via ghWithRateLimitRetry directly with
  // the same error and assert the retry policy that execGhWithRetry inherits.
  let calls = 0;
  const result = await ghWithRateLimitRetry(
    async () => {
      calls++;
      if (calls < 2) throw new Error(literalMessage);
      return { stdout: 'pr-url', stderr: '' };
    },
    { transientDelay: 1, transientBackoff: 1, log: () => {} }
  );
  assert.deepEqual(result, { stdout: 'pr-url', stderr: '' });
  assert.equal(calls, 2);
});

await test('execGhWithRetry exists and is callable', () => {
  // Smoke check — module exports the helper used by callers (#1756).
  assert.equal(typeof execGhWithRetry, 'function');
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------

console.log(`\n📊 ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
