#!/usr/bin/env node
// Test file for issue #1935: "We have regression or bug" — a 5-hour "session
// limit" (and the weekly limit) is misclassified as a transient server-side
// rate limit and put through the short exponential-backoff retry loop instead of
// being treated as an account usage limit (post a comment + wait until the exact
// reset moment).
//
// Root cause (regression from PR #1924):
//   claude.lib.mjs unconditionally set `isRateLimitError = true` whenever the
//   Claude CLI result reported `api_error_status === 429`. But real account usage
//   limits ALSO arrive with api_error_status === 429 and a result like:
//     "You've hit your session limit · resets 4pm (UTC)"
//   so they were routed through the transient-retry path:
//     "⚠️ Server rate limited (429) detected. Retry 1/10 in 2 min ..."
//   instead of the usage-limit path that calculates the exact reset time and waits.
//
// Reference log (gist):
//   https://gist.github.com/konard/afbe979c6f349153b1399f54758c2584
//
// The fix:
//   1. claude.lib.mjs only sets isRateLimitError for a structured 429 when the
//      message is NOT a usage limit (`!isUsageLimitError(lastMessage)`).
//   2. usage-limit.lib.mjs detects the "hit your session limit" / "hit your weekly
//      limit" phrasing (and still extracts the reset time + timezone).

import assert from 'assert';
import { isUsageLimitError, detectUsageLimit, extractResetTime, extractTimezone } from '../src/usage-limit.lib.mjs';
import { classifyRetryableError } from '../src/tool-retry.lib.mjs';

console.log('Testing session-limit (429) usage-limit classification (Issue #1935)\n');

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
};

// The exact message captured in the issue log (api_error_status: 429).
const SESSION_LIMIT_MESSAGE = "You've hit your session limit · resets 4pm (UTC)";
const WEEKLY_LIMIT_MESSAGE = "You've hit your weekly limit · resets Jan 15, 8am (UTC)";

// ============================================================
// Section 1: The exact session-limit message from issue #1935
// ============================================================
console.log('\n=== 1. Exact session-limit message from issue #1935 ===');

test('session-limit message IS detected as a usage limit', () => {
  assert.strictEqual(isUsageLimitError(SESSION_LIMIT_MESSAGE), true, 'must be detected as a usage limit (so we wait for reset, not retry)');
});

test('session-limit message is NOT a transient-retryable error', () => {
  // It must go to the usage-limit reset-time wait, not the exponential-backoff
  // retry loop. classifyRetryableError must keep it non-retryable.
  const result = classifyRetryableError(SESSION_LIMIT_MESSAGE);
  assert.strictEqual(result.isRetryable, false, 'session limit must not be retried as a transient throttle');
});

test('session-limit reset time is extracted as "4:00 PM"', () => {
  assert.strictEqual(extractResetTime(SESSION_LIMIT_MESSAGE), '4:00 PM');
});

test('session-limit timezone is extracted as "UTC"', () => {
  assert.strictEqual(extractTimezone(SESSION_LIMIT_MESSAGE), 'UTC');
});

test('detectUsageLimit returns full info for the session-limit message', () => {
  const info = detectUsageLimit(SESSION_LIMIT_MESSAGE);
  assert.strictEqual(info.isUsageLimit, true);
  assert.strictEqual(info.resetTime, '4:00 PM');
  assert.strictEqual(info.timezone, 'UTC');
});

// ============================================================
// Section 2: The weekly-limit variant
// ============================================================
console.log('\n=== 2. Weekly-limit variant ===');

test('weekly-limit message IS detected as a usage limit', () => {
  assert.strictEqual(isUsageLimitError(WEEKLY_LIMIT_MESSAGE), true);
});

test('weekly-limit message is NOT transient-retryable', () => {
  assert.strictEqual(classifyRetryableError(WEEKLY_LIMIT_MESSAGE).isRetryable, false);
});

test('weekly-limit reset time is extracted with the date', () => {
  assert.strictEqual(extractResetTime(WEEKLY_LIMIT_MESSAGE), 'Jan 15, 8:00 AM');
});

// ============================================================
// Section 3: "hit your <window> limit" without a parseable reset time
// ============================================================
// Backstop: even if the reset-time regex does not match (wording change), the
// account-limit phrasing alone must still flag a usage limit so we never silently
// fall back to the transient-retry loop.
console.log('\n=== 3. "hit your <window> limit" backstop ===');

test('"You\'ve hit your session limit" alone is a usage limit', () => {
  assert.strictEqual(isUsageLimitError("You've hit your session limit"), true);
});

test('"You\'ve hit your weekly limit" alone is a usage limit', () => {
  assert.strictEqual(isUsageLimitError("You've hit your weekly limit"), true);
});

// ============================================================
// Section 4: The transient 429 (issue #1924) must STAY retryable
// ============================================================
// Regression guard the other way: a genuine "not your usage limit" 429 must keep
// going through the transient-retry path and must NOT be detected as a usage limit.
console.log('\n=== 4. Transient 429 (Issue #1924) stays a transient retry ===');

const TRANSIENT_429 = 'API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited';

test('transient 429 is NOT a usage limit', () => {
  assert.strictEqual(isUsageLimitError(TRANSIENT_429), false, 'must not be detected as a usage limit (no reset time to wait for)');
});

test('transient 429 IS retryable', () => {
  assert.strictEqual(classifyRetryableError(TRANSIENT_429).isRetryable, true);
});

// ============================================================
// Section 5: The exact claude.lib.mjs guard logic (regression simulation)
// ============================================================
// Mirror the decision claude.lib.mjs makes for a structured 429 result event:
//   isRateLimitError = (api_error_status === 429) && !isUsageLimitError(message)
// This is the precise line that regressed in #1924.
console.log('\n=== 5. claude.lib.mjs 429 guard simulation ===');

const decideRateLimit = (apiErrorStatus, message) => apiErrorStatus === 429 && !isUsageLimitError(message);

test('session-limit 429 → NOT flagged as transient rate limit', () => {
  assert.strictEqual(decideRateLimit(429, SESSION_LIMIT_MESSAGE), false, 'session limit must fall through to the usage-limit handler');
});

test('weekly-limit 429 → NOT flagged as transient rate limit', () => {
  assert.strictEqual(decideRateLimit(429, WEEKLY_LIMIT_MESSAGE), false);
});

test('transient 429 → flagged as transient rate limit', () => {
  assert.strictEqual(decideRateLimit(429, TRANSIENT_429), true, 'genuine transient throttle still retries');
});

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
console.log('\n✅ All session-limit (429) usage-limit tests passed (Issue #1935)');
