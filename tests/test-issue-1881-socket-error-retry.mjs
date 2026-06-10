#!/usr/bin/env node
// Test file for issue #1881: "CLAUDE execution failed with API Error: The socket
// connection was closed unexpectedly."
//
// The Claude/Codex CLI surfaces transient network disconnects (the underlying
// Anthropic SDK fetch socket dropping mid-stream) as a synthetic assistant /
// result message:
//   "API Error: The socket connection was closed unexpectedly. For more
//    information, pass `verbose: true` in the second argument to fetch()"
//
// Before the fix, classifyRetryableError() did not recognise this family of
// errors, so isRetryable was false and the whole solve session aborted on a
// single dropped socket instead of retrying with --resume.
//
// Upstream: anthropics/claude-code#48837, #51107, #54287, #60133.

import assert from 'assert';
import { classifyRetryableError } from '../src/tool-retry.lib.mjs';

console.log('Testing socket/connection error retry classification (Issue #1881)\n');

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
// Section 1: The exact error message from issue #1881
// ============================================================
console.log('\n=== 1. Exact error message from issue #1881 ===');

const EXACT_MESSAGE = 'API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()';

test('exact issue #1881 message is classified as retryable', () => {
  const result = classifyRetryableError(EXACT_MESSAGE);
  assert.strictEqual(result.isRetryable, true, 'socket-closed error must be retryable');
});

test('exact issue #1881 message gets the socket/connection label', () => {
  const result = classifyRetryableError(EXACT_MESSAGE);
  assert.strictEqual(result.label, 'Socket/connection closed unexpectedly', `unexpected label: ${result.label}`);
});

test('socket-closed error is not treated as a capacity error (no model switch needed)', () => {
  const result = classifyRetryableError(EXACT_MESSAGE);
  assert.strictEqual(result.isCapacity, false, 'socket error is a network drop, not a capacity issue');
});

// The CLI also emits the message inside a result object — make sure normalization
// (which reads `.result` / `.message` / `.error.message`) still reaches the text.
test('socket-closed error wrapped in a result object is retryable', () => {
  const result = classifyRetryableError({ message: EXACT_MESSAGE });
  assert.strictEqual(result.isRetryable, true, 'wrapped socket-closed error must be retryable');
});

// ============================================================
// Section 2: Related transient socket / network signatures
// ============================================================
console.log('\n=== 2. Related transient socket / network signatures ===');

const RETRYABLE_NETWORK_CASES = ['socket hang up', 'request to https://api.anthropic.com/v1/messages failed: ECONNRESET', 'read ECONNRESET', 'Error: connection reset by peer', 'Connection error.', 'TypeError: fetch failed', 'network connection lost'];

for (const message of RETRYABLE_NETWORK_CASES) {
  test(`retryable: "${message.slice(0, 48)}"`, () => {
    const result = classifyRetryableError(message);
    assert.strictEqual(result.isRetryable, true, `"${message}" should be retryable`);
  });
}

// ============================================================
// Section 3: Non-transient errors stay non-retryable (no regressions)
// ============================================================
console.log('\n=== 3. Non-transient errors stay non-retryable ===');

const NON_RETRYABLE_CASES = ['Error: ENOENT: no such file or directory', 'SyntaxError: Unexpected token', 'Permission denied (publickey).', 'context_length_exceeded'];

for (const message of NON_RETRYABLE_CASES) {
  test(`non-retryable: "${message.slice(0, 48)}"`, () => {
    const result = classifyRetryableError(message);
    assert.strictEqual(result.isRetryable, false, `"${message}" should NOT be retryable`);
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

test('"stream disconnected before completion" remains retryable', () => {
  const result = classifyRetryableError('stream disconnected before completion');
  assert.strictEqual(result.isRetryable, true);
});

test('"API Error: 503" remains retryable', () => {
  const result = classifyRetryableError('API Error: 503 Service Unavailable');
  assert.strictEqual(result.isRetryable, true);
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
console.log('\n✅ All socket/connection error retry tests passed (Issue #1881)');
