#!/usr/bin/env node
// Test file for issue #1924: "Auto resume on `CLAUDE execution failed with API
// Error: Server is temporarily limiting requests (not your usage limit) · Rate
// limited` is missing".
//
// The Claude CLI surfaces a server-side temporary rate limit (HTTP 429) as a
// synthetic assistant / result message:
//   "API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited"
// The result event reports `api_error_status: 429`, the response carries
// `x-should-retry: true`, and the stream emits a `rate_limit_event` with
// `status: "rejected"`.
//
// Before the fix:
//   - isUsageLimitError() returned false (correctly — the message explicitly
//     says "not your usage limit", so there is no reset time to wait for), AND
//   - classifyRetryableError() returned isRetryable: false (no matching pattern).
// With neither detector matching, the whole solve session aborted with
// "Claude command failed with exit code 1" instead of auto-resuming.
//
// The fix teaches classifyRetryableError() to recognise this transient 429 so it
// is retried with the session preserved (--resume) after a backoff. Because the
// throttle is request-rate (not model capacity), isCapacity stays false (no model
// switch). The fix lives in the shared tool-retry helper, so it applies to every
// tool (claude, codex, gemini, opencode, qwen, agent).
//
// Reference log (gist):
//   https://gist.github.com/konard/936c8f264ecd7f9957642252cb76d268

import assert from 'assert';
import { classifyRetryableError } from '../src/tool-retry.lib.mjs';
import { isUsageLimitError } from '../src/usage-limit.lib.mjs';

console.log('Testing server rate-limit (429) retry classification (Issue #1924)\n');

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

// ============================================================
// Section 1: The exact error message from issue #1924
// ============================================================
console.log('\n=== 1. Exact error message from issue #1924 ===');

const EXACT_MESSAGE = 'API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited';

test('exact issue #1924 message is classified as retryable', () => {
  const result = classifyRetryableError(EXACT_MESSAGE);
  assert.strictEqual(result.isRetryable, true, '429 rate-limit error must be retryable');
});

test('exact issue #1924 message gets the server rate-limited label', () => {
  const result = classifyRetryableError(EXACT_MESSAGE);
  assert.strictEqual(result.label, 'Server rate limited (429)', `unexpected label: ${result.label}`);
});

test('server rate limit is not treated as a capacity error (no model switch)', () => {
  const result = classifyRetryableError(EXACT_MESSAGE);
  assert.strictEqual(result.isCapacity, false, 'request-rate throttle is not a model-capacity issue');
});

test('exact issue #1924 message is NOT a usage limit (no reset time to wait for)', () => {
  // It explicitly says "not your usage limit" — routing it through the
  // usage-limit reset-time wait would block indefinitely on a phantom reset.
  assert.strictEqual(isUsageLimitError(EXACT_MESSAGE), false, 'must not be detected as a usage/quota limit');
});

// The CLI also emits the message inside a result object — make sure normalization
// (which reads `.result` / `.message` / `.error.message`) still reaches the text.
test('rate-limit error wrapped in an object is retryable', () => {
  const result = classifyRetryableError({ message: EXACT_MESSAGE });
  assert.strictEqual(result.isRetryable, true, 'wrapped rate-limit error must be retryable');
});

// ============================================================
// Section 2: Related 429 / rate-limit signatures
// ============================================================
console.log('\n=== 2. Related 429 / rate-limit signatures ===');

const RETRYABLE_RATE_LIMIT_CASES = ['Server is temporarily limiting requests', 'API Error: rate_limit (429)', 'rate limited · not your usage limit'];

for (const message of RETRYABLE_RATE_LIMIT_CASES) {
  test(`retryable: "${message.slice(0, 48)}"`, () => {
    const result = classifyRetryableError(message);
    assert.strictEqual(result.isRetryable, true, `"${message}" should be retryable`);
  });
}

// ============================================================
// Section 3: Real usage/quota limits stay NON-retryable here
// ============================================================
// These must be handled by detectUsageLimit() (wait for reset time), not by the
// transient-retry path, so classifyRetryableError must keep them non-retryable.
console.log('\n=== 3. Real usage/quota limits are NOT transient-retryable ===');

const USAGE_LIMIT_CASES = ["You've hit your usage limit. Limit resets 5am.", 'Session limit reached ∙ resets 10pm', 'Weekly limit reached'];

for (const message of USAGE_LIMIT_CASES) {
  test(`usage limit (not transient-retryable): "${message.slice(0, 48)}"`, () => {
    const result = classifyRetryableError(message);
    assert.strictEqual(result.isRetryable, false, `"${message}" must be handled as a usage limit, not a transient retry`);
    assert.strictEqual(isUsageLimitError(message), true, `"${message}" should be detected as a usage limit`);
  });
}

// ============================================================
// Section 4: Pre-existing transient classifications still work
// ============================================================
console.log('\n=== 4. Pre-existing transient classifications still work ===');

test('"Overloaded" remains retryable (capacity)', () => {
  const result = classifyRetryableError('Overloaded');
  assert.strictEqual(result.isRetryable, true);
  assert.strictEqual(result.isCapacity, true);
});

test('"Request timed out" remains retryable', () => {
  const result = classifyRetryableError('Request timed out');
  assert.strictEqual(result.isRetryable, true);
});

test('"API Error: 503" remains retryable', () => {
  const result = classifyRetryableError('API Error: 503 Service Unavailable');
  assert.strictEqual(result.isRetryable, true);
});

test('socket-closed (Issue #1881) remains retryable', () => {
  const result = classifyRetryableError('API Error: The socket connection was closed unexpectedly.');
  assert.strictEqual(result.isRetryable, true);
});

// ============================================================
// Section 5: Non-transient errors stay non-retryable (no regressions)
// ============================================================
console.log('\n=== 5. Non-transient errors stay non-retryable ===');

const NON_RETRYABLE_CASES = ['Error: ENOENT: no such file or directory', 'SyntaxError: Unexpected token', 'context_length_exceeded'];

for (const message of NON_RETRYABLE_CASES) {
  test(`non-retryable: "${message.slice(0, 48)}"`, () => {
    const result = classifyRetryableError(message);
    assert.strictEqual(result.isRetryable, false, `"${message}" should NOT be retryable`);
  });
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
console.log('\n✅ All server rate-limit (429) retry tests passed (Issue #1924)');
