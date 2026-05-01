#!/usr/bin/env node
/**
 * Tests for the rate-limit-safe gh wrapper module.
 *
 * Issue #1726: every gh API call must wait for (resetTime + bufferMs + jitterMs)
 * on rate-limit errors and propagate non-rate-limit errors immediately.
 *
 * Run with: node tests/github-rate-limit.test.mjs
 */

import assert from 'node:assert/strict';

import { isRateLimitError, parseRateLimitReset, computeRateLimitWait, ghWithRateLimitRetry, wrapDollarWithGhRetry } from '../src/github-rate-limit.lib.mjs';
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
// isRateLimitError
// ----------------------------------------------------------------------------

console.log('\n📋 isRateLimitError\n');

await test('detects "API rate limit exceeded"', () => {
  const err = new Error('HTTP 403: API rate limit exceeded for user ID 12345');
  assert.equal(isRateLimitError(err), true);
});

await test('detects secondary rate limit message', () => {
  const err = new Error('You have exceeded a secondary rate limit. Please wait a few minutes.');
  assert.equal(isRateLimitError(err), true);
});

await test('detects abuse-detection message', () => {
  const err = new Error('You have triggered an abuse detection mechanism.');
  assert.equal(isRateLimitError(err), true);
});

await test('reads rate-limit text from stderr', () => {
  const err = { message: 'cmd failed', stderr: Buffer.from('API rate limit exceeded\n') };
  assert.equal(isRateLimitError(err), true);
});

await test('reads rate-limit text from cause chain', () => {
  const err = new Error('outer');
  err.cause = new Error('rate limit exceeded for installation');
  assert.equal(isRateLimitError(err), true);
});

await test('returns false for ordinary network error', () => {
  assert.equal(isRateLimitError(new Error('connection reset by peer')), false);
});

await test('returns false for 404', () => {
  assert.equal(isRateLimitError(new Error('HTTP 404: Not Found')), false);
});

await test('returns false for null/undefined', () => {
  assert.equal(isRateLimitError(null), false);
  assert.equal(isRateLimitError(undefined), false);
});

// ----------------------------------------------------------------------------
// parseRateLimitReset
// ----------------------------------------------------------------------------

console.log('\n📋 parseRateLimitReset\n');

await test('parses X-RateLimit-Reset header (Unix epoch)', () => {
  const epoch = Math.floor(Date.now() / 1000) + 3600;
  const err = new Error(`HTTP 403\nX-RateLimit-Reset: ${epoch}\nAPI rate limit exceeded`);
  const reset = parseRateLimitReset(err);
  assert.ok(reset instanceof Date);
  assert.equal(reset.getTime(), epoch * 1000);
});

await test('parses Retry-After header', () => {
  const err = new Error('HTTP 403\nRetry-After: 120\nrate limit exceeded');
  const before = Date.now();
  const reset = parseRateLimitReset(err);
  const after = Date.now();
  assert.ok(reset instanceof Date);
  // The Retry-After is "seconds from now". Allow a small window for execution.
  assert.ok(reset.getTime() >= before + 120_000 - 50);
  assert.ok(reset.getTime() <= after + 120_000 + 50);
});

await test('returns null when no headers present', () => {
  const reset = parseRateLimitReset(new Error('rate limit exceeded'));
  assert.equal(reset, null);
});

// ----------------------------------------------------------------------------
// computeRateLimitWait
// ----------------------------------------------------------------------------

console.log('\n📋 computeRateLimitWait\n');

await test('wait = (reset - now) + bufferMs + jitter when reset is future', () => {
  const now = 1_000_000_000_000;
  const reset = new Date(now + 60_000); // 1 minute from "now"
  const { waitMs, bufferMs, jitterMs } = computeRateLimitWait(reset, now);
  assert.equal(bufferMs, limitReset.bufferMs);
  assert.ok(jitterMs >= 0 && jitterMs <= limitReset.jitterMs);
  assert.equal(waitMs, 60_000 + bufferMs + jitterMs);
});

await test('wait = bufferMs + jitter when reset is null', () => {
  const now = 1_000_000_000_000;
  const { waitMs, bufferMs, jitterMs } = computeRateLimitWait(null, now);
  assert.equal(waitMs, bufferMs + jitterMs);
});

await test('wait does not go negative when reset is in the past', () => {
  const now = 1_000_000_000_000;
  const reset = new Date(now - 60_000); // already past
  const { waitMs, bufferMs, jitterMs } = computeRateLimitWait(reset, now);
  // baseline wait clamped to 0
  assert.equal(waitMs, bufferMs + jitterMs);
});

await test('jitter falls within configured range over many samples', () => {
  const now = Date.now();
  const samples = Array.from({ length: 200 }, () => computeRateLimitWait(null, now).jitterMs);
  for (const s of samples) {
    assert.ok(s >= 0, `jitter ${s} below 0`);
    assert.ok(s <= limitReset.jitterMs, `jitter ${s} above ${limitReset.jitterMs}`);
  }
  const distinct = new Set(samples);
  assert.ok(distinct.size > 1, 'jitter should not be a constant');
});

// ----------------------------------------------------------------------------
// ghWithRateLimitRetry
// ----------------------------------------------------------------------------

console.log('\n📋 ghWithRateLimitRetry\n');

await test('returns immediately when fn succeeds', async () => {
  let calls = 0;
  const result = await ghWithRateLimitRetry(async () => {
    calls++;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

await test('rethrows non-rate-limit errors without retrying', async () => {
  let calls = 0;
  await assert.rejects(
    ghWithRateLimitRetry(
      async () => {
        calls++;
        throw new Error('HTTP 404: Not Found');
      },
      { maxAttempts: 5 }
    ),
    /HTTP 404/
  );
  assert.equal(calls, 1, 'must not retry on 404');
});

await test('retries rate-limit error and succeeds without sleeping past test budget', async () => {
  // Stash limitReset to keep total wait short for the test (small buffer + 0 jitter).
  const origBuffer = limitReset.bufferMs;
  const origJitter = limitReset.jitterMs;
  limitReset.bufferMs = 5;
  limitReset.jitterMs = 0;
  try {
    let calls = 0;
    const logs = [];
    const result = await ghWithRateLimitRetry(
      async () => {
        calls++;
        if (calls === 1) {
          // Past reset → baselineWait is clamped to 0, so total wait ≈ 5 ms.
          const past = Math.floor((Date.now() - 60_000) / 1000);
          throw new Error(`HTTP 403\nX-RateLimit-Reset: ${past}\nAPI rate limit exceeded`);
        }
        return 'recovered';
      },
      { maxAttempts: 3, log: msg => logs.push(msg) }
    );
    assert.equal(result, 'recovered');
    assert.equal(calls, 2);
    assert.ok(
      logs.some(l => l.includes('rate limit')),
      'should log the rate-limit wait message'
    );
  } finally {
    limitReset.bufferMs = origBuffer;
    limitReset.jitterMs = origJitter;
  }
});

await test('throws after maxAttempts of persistent rate-limit errors', async () => {
  const origBuffer = limitReset.bufferMs;
  const origJitter = limitReset.jitterMs;
  limitReset.bufferMs = 5;
  limitReset.jitterMs = 0;
  try {
    let calls = 0;
    await assert.rejects(
      ghWithRateLimitRetry(
        async () => {
          calls++;
          throw new Error('API rate limit exceeded');
        },
        { maxAttempts: 2, log: () => {} }
      ),
      /rate limit/
    );
    assert.equal(calls, 2);
  } finally {
    limitReset.bufferMs = origBuffer;
    limitReset.jitterMs = origJitter;
  }
});

// ----------------------------------------------------------------------------
// wrapDollarWithGhRetry
// ----------------------------------------------------------------------------

console.log('\n📋 wrapDollarWithGhRetry\n');

await test('passes non-gh commands through to the underlying $ unchanged', async () => {
  const calls = [];
  const fakeDollar = (strings, ...values) => {
    calls.push({ strings: [...strings], values });
    return Promise.resolve('ok');
  };
  const wrapped = wrapDollarWithGhRetry(fakeDollar);
  const r = await wrapped`ls -la`;
  assert.equal(r, 'ok');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].strings, ['ls -la']);
});

await test('retries gh commands on rate-limit error', async () => {
  const origBuffer = limitReset.bufferMs;
  const origJitter = limitReset.jitterMs;
  limitReset.bufferMs = 5;
  limitReset.jitterMs = 0;
  try {
    let attempts = 0;
    const fakeDollar = () => {
      attempts++;
      if (attempts === 1) {
        const past = Math.floor((Date.now() - 60_000) / 1000);
        return Promise.reject(new Error(`HTTP 403\nX-RateLimit-Reset: ${past}\nAPI rate limit exceeded`));
      }
      return Promise.resolve('recovered');
    };
    const wrapped = wrapDollarWithGhRetry(fakeDollar, { log: () => {} });
    const r = await wrapped`gh api rate_limit`;
    assert.equal(r, 'recovered');
    assert.equal(attempts, 2);
  } finally {
    limitReset.bufferMs = origBuffer;
    limitReset.jitterMs = origJitter;
  }
});

await test('does not retry gh commands on non-rate-limit errors', async () => {
  let attempts = 0;
  const fakeDollar = () => {
    attempts++;
    return Promise.reject(new Error('HTTP 404: Not Found'));
  };
  const wrapped = wrapDollarWithGhRetry(fakeDollar, { log: () => {}, maxAttempts: 5 });
  await assert.rejects(() => wrapped`gh api repos/owner/repo`, /HTTP 404/);
  assert.equal(attempts, 1);
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------

console.log(`\n📊 ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
