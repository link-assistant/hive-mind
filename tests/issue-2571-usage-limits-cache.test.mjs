/**
 * @hive-mind-test-suite default
 *
 * Issue #2571: the production log has 564 Codex usage-API 401s (one every ~64s
 * while a Codex task waited in the queue) and 131 Claude 429s, often in pairs
 * two seconds apart. Failed usage lookups were not cached: the Claude check
 * looked for "Rate limited" in a message that says "has reached rate limit",
 * and 401s were never cached at all.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { getCachedClaudeLimits, getCachedCodexLimits, parseRetryAfterMs, resetLimitCache, CACHE_TTL } from '../src/limits.lib.mjs';

const dir = mkdtempSync(join(tmpdir(), 'issue-2571-limits-'));
const credentialsPath = join(dir, '.credentials.json');
writeFileSync(credentialsPath, '{}');

function counting(result) {
  const calls = { count: 0 };
  return { calls, fetchLimits: async () => (calls.count++, typeof result === 'function' ? result() : result) };
}

test('Retry-After is parsed from seconds and HTTP dates', () => {
  assert.equal(parseRetryAfterMs('1040'), 1_040_000);
  assert.equal(parseRetryAfterMs('Sun, 04 Oct 2026 22:20:00 GMT', Date.parse('Sun, 04 Oct 2026 22:19:00 GMT')), 60_000);
  assert.equal(parseRetryAfterMs('0'), null);
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs('soon'), null);
});

test('a Claude 429 is cached instead of re-asked every queue cycle', async () => {
  resetLimitCache();
  const { calls, fetchLimits } = counting({ success: false, error: 'Claude Usage API access has reached rate limit. Resets in 17m 20s (Oct 4, 10:37pm UTC)', failureKind: 'rate_limited', retryAfterMs: null });
  for (let i = 0; i < 5; i++) {
    const result = await getCachedClaudeLimits(false, { credentialsPath, fetchLimits });
    assert.equal(result.failureKind, 'rate_limited');
  }
  assert.equal(calls.count, 1);
});

test('a Retry-After longer than the usage TTL is honoured', async () => {
  resetLimitCache();
  const { calls, fetchLimits } = counting({ success: false, error: 'rate limit', failureKind: 'rate_limited', retryAfterMs: CACHE_TTL.USAGE_API * 2 });
  await getCachedClaudeLimits(false, { credentialsPath, fetchLimits });
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + CACHE_TTL.USAGE_API + 1000;
    await getCachedClaudeLimits(false, { credentialsPath, fetchLimits });
    assert.equal(calls.count, 1, 'Still inside Retry-After');
    Date.now = () => realNow() + CACHE_TTL.USAGE_API * 2 + 1000;
    await getCachedClaudeLimits(false, { credentialsPath, fetchLimits });
    assert.equal(calls.count, 2, 'Retry-After has passed');
  } finally {
    Date.now = realNow;
  }
});

test('concurrent callers share one usage request (the 429 pairs two seconds apart)', async () => {
  resetLimitCache();
  let release;
  const gate = new Promise(resolve => (release = resolve));
  const { calls, fetchLimits } = counting(async () => (await gate, { success: true, usage: {} }));
  const pending = [getCachedClaudeLimits(false, { credentialsPath, fetchLimits }), getCachedClaudeLimits(false, { credentialsPath, fetchLimits })];
  release();
  const [a, b] = await Promise.all(pending);
  assert.equal(calls.count, 1);
  assert.equal(a, b);
});

test('a Codex 401 is cached until the auth file changes', async () => {
  resetLimitCache();
  const authPath = join(dir, 'auth.json');
  writeFileSync(authPath, '{}');
  utimesSync(authPath, new Date('2026-10-04T11:00:00Z'), new Date('2026-10-04T11:00:00Z'));
  const { calls, fetchLimits } = counting({ success: false, error: 'Codex authentication expired. Please re-authenticate Codex with your ChatGPT account.', failureKind: 'auth' });
  for (let i = 0; i < 10; i++) await getCachedCodexLimits(false, { authPath, fetchLimits });
  assert.equal(calls.count, 1, 'The production log re-asked 564 times');

  // `codex login` rewrites auth.json: the next check must see the new token at once.
  utimesSync(authPath, new Date('2026-10-04T12:00:00Z'), new Date('2026-10-04T12:00:00Z'));
  await getCachedCodexLimits(false, { authPath, fetchLimits });
  assert.equal(calls.count, 2);
});

test('other failures (network, 5xx) are not cached', async () => {
  resetLimitCache();
  const { calls, fetchLimits } = counting({ success: false, error: 'Failed to fetch usage from API: 502 Bad Gateway' });
  await getCachedClaudeLimits(false, { credentialsPath, fetchLimits });
  await getCachedClaudeLimits(false, { credentialsPath, fetchLimits });
  assert.equal(calls.count, 2);
});

test('the real fetchers classify their failures', async () => {
  resetLimitCache();
  const { getClaudeUsageLimits, getCodexUsageLimits } = await import('../src/limits.lib.mjs');
  assert.equal((await getClaudeUsageLimits(false, join(dir, 'missing.json'))).failureKind, 'auth');
  assert.equal((await getCodexUsageLimits(false, join(dir, 'missing.json'))).failureKind, 'auth');
});
