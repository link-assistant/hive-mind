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

import { isRateLimitError, parseRateLimitReset, computeRateLimitWait, configureGitHubRateLimitLogging, isGitHubRateLimitLoggingEnabled, ghWithRateLimitRetry, wrapDollarWithGhRetry, GhTimeoutError, callWithTimeout } from '../src/github-rate-limit.lib.mjs';
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
// Optional GitHub rate-limit usage logging
// ----------------------------------------------------------------------------

console.log('\n📋 GitHub rate-limit usage logging\n');

await test('is disabled by default and does not probe usage', async () => {
  const logs = [];
  let fetchCalls = 0;
  configureGitHubRateLimitLogging({
    enabled: false,
    log: msg => logs.push(msg),
    fetchUsage: async () => {
      fetchCalls++;
      return [{ resource: 'core', limit: 5000, used: 1, remaining: 4999, reset: 2_000_000_000 }];
    },
  });

  try {
    assert.equal(isGitHubRateLimitLoggingEnabled(), false);
    const result = await ghWithRateLimitRetry(async () => 'ok', { label: 'gh api repos', log: () => {} });
    assert.equal(result, 'ok');
    assert.equal(fetchCalls, 0);
    assert.deepEqual(logs, []);
  } finally {
    configureGitHubRateLimitLogging();
  }
});

await test('logs actual usage after a successful wrapped gh call when enabled', async () => {
  const logs = [];
  let fetchCalls = 0;
  configureGitHubRateLimitLogging({
    enabled: true,
    log: msg => logs.push(msg),
    fetchUsage: async () => {
      fetchCalls++;
      return [
        { resource: 'core', limit: 5000, used: 100 + fetchCalls, remaining: 4900 - fetchCalls, reset: 2_000_000_000 },
        { resource: 'graphql', limit: 5000, used: 10, remaining: 4990, reset: 2_000_000_000 },
      ];
    },
  });

  try {
    const result = await ghWithRateLimitRetry(async () => 'ok', { label: 'gh api repos', log: () => {} });
    assert.equal(result, 'ok');
    assert.equal(fetchCalls, 1);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /GitHub rate limits after gh api repos/);
    assert.match(logs[0], /core: 101\/5000 used/);
    assert.match(logs[0], /graphql: 10\/5000 used/);
  } finally {
    configureGitHubRateLimitLogging();
  }
});

await test('logs usage after a failed wrapped gh attempt without replacing the original error', async () => {
  const logs = [];
  let fetchCalls = 0;
  configureGitHubRateLimitLogging({
    enabled: true,
    log: msg => logs.push(msg),
    fetchUsage: async () => {
      fetchCalls++;
      return [{ resource: 'core', limit: 5000, used: 200, remaining: 4800, reset: 2_000_000_000 }];
    },
  });

  try {
    await assert.rejects(
      ghWithRateLimitRetry(
        async () => {
          throw new Error('HTTP 404: Not Found');
        },
        { label: 'gh api missing', log: () => {} }
      ),
      /HTTP 404/
    );
    assert.equal(fetchCalls, 1);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /GitHub rate limits after gh api missing/);
  } finally {
    configureGitHubRateLimitLogging();
  }
});

await test('does not break wrapped gh calls when usage logging fails', async () => {
  configureGitHubRateLimitLogging({
    enabled: true,
    log: () => {
      throw new Error('logger failed');
    },
    fetchUsage: async () => [{ resource: 'core', limit: 5000, used: 300, remaining: 4700, reset: 2_000_000_000 }],
  });

  try {
    const result = await ghWithRateLimitRetry(async () => 'ok', { label: 'gh api user', log: () => {} });
    assert.equal(result, 'ok');
  } finally {
    configureGitHubRateLimitLogging();
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
// Issue #1811: GhTimeoutError + callWithTimeout
// ----------------------------------------------------------------------------

console.log('\n📋 callWithTimeout (issue #1811)\n');

await test('resolves when fn finishes before the deadline', async () => {
  const r = await callWithTimeout(() => Promise.resolve('done'), { timeoutMs: 50, commandPreview: 'gh api user' });
  assert.equal(r, 'done');
});

await test('rejects with GhTimeoutError when fn never resolves', async () => {
  let abortedInside = false;
  const stall = signal =>
    new Promise((_resolve, reject) => {
      if (signal) {
        signal.addEventListener('abort', () => {
          abortedInside = true;
          reject(new Error('aborted'));
        });
      }
      // Never resolve naturally.
    });
  await assert.rejects(
    () => callWithTimeout(stall, { timeoutMs: 25, commandPreview: 'gh api user' }),
    err => err instanceof GhTimeoutError && err.timeoutMs === 25 && err.command === 'gh api user'
  );
  // Signal must have fired so spawned children can be SIGTERMed.
  assert.equal(abortedInside, true);
});

await test('timeoutMs <= 0 disables the timeout entirely', async () => {
  let signalReceived = null;
  const r = await callWithTimeout(
    signal => {
      signalReceived = signal;
      return Promise.resolve('ok');
    },
    { timeoutMs: 0 }
  );
  assert.equal(r, 'ok');
  // Disabled mode still passes a non-aborting signal so callers can rely on
  // a stable signature; it just never fires.
  assert.ok(signalReceived && typeof signalReceived.aborted === 'boolean');
  assert.equal(signalReceived.aborted, false);
});

console.log('\n📋 ghWithRateLimitRetry with timeoutMs (issue #1811)\n');

await test('retries on GhTimeoutError up to the transient budget', async () => {
  let calls = 0;
  const stall = () => new Promise(() => {});
  const start = Date.now();
  await assert.rejects(
    () =>
      ghWithRateLimitRetry(
        signal => {
          calls++;
          // First two attempts hang; reject manually after a microtask so test
          // budget isn't exhausted waiting for callWithTimeout's 5ms.
          if (calls <= 3) return stall(signal);
          return Promise.resolve('ok');
        },
        {
          log: () => {},
          timeoutMs: 5,
          maxAttempts: 3,
          maxApiRetries: 3,
          // Avoid exponential-backoff sleeps in the test.
          retryBaseMs: 0,
        }
      ),
    err => err instanceof GhTimeoutError
  );
  // We attempted at least twice — exact count depends on retry budget impl.
  assert.ok(calls >= 2, `expected >=2 attempts, got ${calls}`);
  // Test must complete promptly — no minute-long hang.
  assert.ok(Date.now() - start < 5000, 'test must finish quickly');
});

await test('retryOnTimeout=false throws GhTimeoutError immediately', async () => {
  let calls = 0;
  const stall = () => new Promise(() => {});
  await assert.rejects(
    () =>
      ghWithRateLimitRetry(
        () => {
          calls++;
          return stall();
        },
        { log: () => {}, timeoutMs: 5, retryOnTimeout: false }
      ),
    err => err instanceof GhTimeoutError
  );
  assert.equal(calls, 1);
});

console.log('\n📋 wrapDollarWithGhRetry options form (issue #1811)\n');

await test('$({ timeoutMs }) returns a tagged-template function', async () => {
  const calls = [];
  const fakeDollar = (strings, ...values) => {
    calls.push([...strings]);
    return Promise.resolve('ok');
  };
  const wrapped = wrapDollarWithGhRetry(fakeDollar, { log: () => {} });
  const r = await wrapped({ timeoutMs: 5000 })`gh api user`;
  assert.equal(r, 'ok');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['gh api user']);
});

await test('$({ timeoutMs }) per-call timeout fires on hung gh', async () => {
  const hangingDollar = () => new Promise(() => {});
  const wrapped = wrapDollarWithGhRetry(hangingDollar, {
    log: () => {},
    maxAttempts: 1,
    maxApiRetries: 1,
    retryBaseMs: 0,
  });
  const start = Date.now();
  await assert.rejects(
    () => wrapped({ timeoutMs: 10, retryOnTimeout: false })`gh api user`,
    err => err instanceof GhTimeoutError && err.timeoutMs === 10
  );
  assert.ok(Date.now() - start < 1000, 'timeout must fire quickly');
});

await test('wrapper-level defaultTimeoutMs is applied when no per-call override', async () => {
  const hangingDollar = () => new Promise(() => {});
  const wrapped = wrapDollarWithGhRetry(hangingDollar, {
    log: () => {},
    defaultTimeoutMs: 10,
    maxAttempts: 1,
    maxApiRetries: 1,
    retryBaseMs: 0,
    retryOnTimeout: false,
  });
  const start = Date.now();
  await assert.rejects(
    () => wrapped`gh api user`,
    err => err instanceof GhTimeoutError && err.timeoutMs === 10
  );
  assert.ok(Date.now() - start < 1000, 'default timeout must fire quickly');
});

await test('defaultTimeoutMs=0 disables wrapper-level timeout', async () => {
  const fakeDollar = () => Promise.resolve('ok');
  const wrapped = wrapDollarWithGhRetry(fakeDollar, { log: () => {}, defaultTimeoutMs: 0 });
  const r = await wrapped`gh api user`;
  assert.equal(r, 'ok');
});

await test('verboseLog is called once per gh invocation with command preview', async () => {
  const fakeDollar = () => Promise.resolve('ok');
  const logged = [];
  const wrapped = wrapDollarWithGhRetry(fakeDollar, {
    log: () => {},
    defaultTimeoutMs: 5000,
    verboseLog: msg => logged.push(msg),
  });
  await wrapped`gh api user --jq .login`;
  assert.equal(logged.length, 1);
  assert.match(logged[0], /gh api user --jq \.login/);
  assert.match(logged[0], /timeoutMs=5000/);
});

await test('wrapper.gh({...}) is identical to wrapper({...})', async () => {
  const fakeDollar = () => Promise.resolve('ok');
  const wrapped = wrapDollarWithGhRetry(fakeDollar, { log: () => {} });
  const a = await wrapped({ timeoutMs: 1000 })`gh api user`;
  const b = await wrapped.gh({ timeoutMs: 1000 })`gh api user`;
  assert.equal(a, 'ok');
  assert.equal(b, 'ok');
});

await test('supportsOptionsForm=true invokes dollar({signal}) when supported', async () => {
  let optionsFormCalled = false;
  let templateArgs = null;
  const fakeDollar = (firstArg, ...rest) => {
    if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
      optionsFormCalled = true;
      return (strings, ...values) => {
        templateArgs = [strings, values];
        return Promise.resolve('ok');
      };
    }
    templateArgs = [firstArg, rest];
    return Promise.resolve('ok');
  };
  const wrapped = wrapDollarWithGhRetry(fakeDollar, {
    log: () => {},
    supportsOptionsForm: true,
  });
  await wrapped`gh api user`;
  assert.equal(optionsFormCalled, true, 'expected options-form path to be taken');
  assert.ok(templateArgs, 'tagged-template should have been invoked once');
});

await test('supportsOptionsForm omitted preserves single-call behavior for naive fakes', async () => {
  let calls = 0;
  const fakeDollar = (strings, ...values) => {
    calls++;
    return Promise.resolve('ok');
  };
  const wrapped = wrapDollarWithGhRetry(fakeDollar, { log: () => {} });
  await wrapped`gh api user`;
  assert.equal(calls, 1);
});

// Regression: $({ cwd: tempDir })`git ...` must forward cwd to the underlying
// dollar. Previously the wrapper treated unknown option keys as gh-retry
// options and silently dropped them, so cleanupClaudeFile (which relies on
// $({ cwd: tempDir })`git ...`) ran git in the wrong directory. See the
// test-issue-1791-gitkeep-cleanup failure investigated under issue #1811.
await test('$({ cwd }) forwards cwd to underlying dollar for non-gh tagged templates', async () => {
  const optionsFormCalls = [];
  let templateCalled = false;
  const fakeDollar = (firstArg, ...rest) => {
    if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
      optionsFormCalls.push(firstArg);
      return (strings, ...values) => {
        templateCalled = true;
        return Promise.resolve({ stdout: 'ok' });
      };
    }
    return Promise.resolve({ stdout: 'tagged-direct' });
  };
  const wrapped = wrapDollarWithGhRetry(fakeDollar, { log: () => {} });
  await wrapped({ cwd: '/some/dir' })`git status`;
  assert.equal(optionsFormCalls.length, 1, 'dollar({ cwd }) should be invoked once');
  assert.equal(optionsFormCalls[0].cwd, '/some/dir');
  assert.equal(templateCalled, true);
});

await test('$({ cwd }) forwards cwd to underlying dollar for gh tagged templates with no timeout', async () => {
  const optionsFormCalls = [];
  const fakeDollar = (firstArg, ...rest) => {
    if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
      optionsFormCalls.push(firstArg);
      return (strings, ...values) => Promise.resolve({ stdout: 'ok' });
    }
    return Promise.resolve({ stdout: 'tagged-direct' });
  };
  const wrapped = wrapDollarWithGhRetry(fakeDollar, { log: () => {}, defaultTimeoutMs: 0 });
  await wrapped({ cwd: '/some/dir' })`gh api user`;
  assert.equal(optionsFormCalls.length, 1, 'dollar({ cwd }) should be invoked once');
  assert.equal(optionsFormCalls[0].cwd, '/some/dir');
});

await test('$({ cwd }) and supportsOptionsForm merge cwd with signal for gh timeouts', async () => {
  const optionsFormCalls = [];
  const fakeDollar = (firstArg, ...rest) => {
    if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
      optionsFormCalls.push(firstArg);
      return (strings, ...values) => Promise.resolve({ stdout: 'ok' });
    }
    return Promise.resolve({ stdout: 'tagged-direct' });
  };
  const wrapped = wrapDollarWithGhRetry(fakeDollar, {
    log: () => {},
    supportsOptionsForm: true,
    defaultTimeoutMs: 1000,
  });
  await wrapped({ cwd: '/some/dir' })`gh api user`;
  assert.equal(optionsFormCalls.length, 1);
  assert.equal(optionsFormCalls[0].cwd, '/some/dir');
  assert.ok(optionsFormCalls[0].signal, 'signal should be present alongside cwd');
});

await test('$({ timeoutMs }) does not leak timeoutMs into dollar options', async () => {
  const optionsFormCalls = [];
  let bareCalls = 0;
  const fakeDollar = (firstArg, ...rest) => {
    if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
      optionsFormCalls.push(firstArg);
      return (strings, ...values) => Promise.resolve({ stdout: 'ok' });
    }
    bareCalls++;
    return Promise.resolve({ stdout: 'tagged-direct' });
  };
  const wrapped = wrapDollarWithGhRetry(fakeDollar, { log: () => {} });
  await wrapped({ timeoutMs: 5000 })`git status`;
  // Pure wrapper-only options + no dollar options → dollar should be invoked
  // as a plain tagged template, not via the options form.
  assert.equal(optionsFormCalls.length, 0);
  assert.equal(bareCalls, 1);
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------

console.log(`\n📊 ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
