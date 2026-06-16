#!/usr/bin/env node
// Test file for issue #1937: "API Error: Stream idle timeout - partial response received"
//
// When the Anthropic streaming response stalls mid-answer (no bytes for the SDK's
// idle window after the model has already emitted part of its response), the Claude
// CLI aborts the turn and surfaces a synthetic assistant / result message:
//   "API Error: Stream idle timeout - partial response received"
//
// This is a transient network/streaming stall (a slow or stuck server-sent-events
// socket), not a request-content error, so the session is still valid and safe to
// resume with `--resume <sessionId>` (same context). Before the fix,
// classifyRetryableError() did not recognise this family of errors, so isRetryable
// was false and the whole solve session aborted with exit code 1 instead of retrying.
//
// Reproduced from the gist log attached to issue #1937 (result event):
//   { "type": "result", "is_error": true, "subtype": "success",
//     "result": "API Error: Stream idle timeout - partial response received", ... }

import assert from 'assert';
import { classifyRetryableError } from '../src/tool-retry.lib.mjs';

console.log('Testing stream idle timeout retry classification (Issue #1937)\n');

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
// Section 1: The exact error message from issue #1937
// ============================================================
console.log('\n=== 1. Exact error message from issue #1937 ===');

const EXACT_MESSAGE = 'API Error: Stream idle timeout - partial response received';

test('exact issue #1937 message is classified as retryable', () => {
  const result = classifyRetryableError(EXACT_MESSAGE);
  assert.strictEqual(result.isRetryable, true, 'stream-idle-timeout error must be retryable');
});

test('exact issue #1937 message gets the stream idle timeout label', () => {
  const result = classifyRetryableError(EXACT_MESSAGE);
  assert.strictEqual(result.label, 'Stream idle timeout (partial response)', `unexpected label: ${result.label}`);
});

test('stream idle timeout is not treated as a capacity error (no model switch, resume same context)', () => {
  const result = classifyRetryableError(EXACT_MESSAGE);
  assert.strictEqual(result.isCapacity, false, 'stream idle timeout is a streaming stall, not a capacity issue');
});

// The CLI emits the message inside a result object — make sure normalization
// (which reads `.result` / `.message` / `.error.message`) still reaches the text.
test('stream idle timeout wrapped in a { result } object is retryable', () => {
  const result = classifyRetryableError({ result: EXACT_MESSAGE });
  assert.strictEqual(result.isRetryable, true, 'wrapped (result) stream-idle-timeout error must be retryable');
});

test('stream idle timeout wrapped in a { message } object is retryable', () => {
  const result = classifyRetryableError({ message: EXACT_MESSAGE });
  assert.strictEqual(result.isRetryable, true, 'wrapped (message) stream-idle-timeout error must be retryable');
});

// ============================================================
// Section 2: Related casing / phrasing variants
// ============================================================
console.log('\n=== 2. Related casing / phrasing variants ===');

const RETRYABLE_VARIANTS = ['API Error: Stream idle timeout - partial response received', 'stream idle timeout', 'Stream Idle Timeout - Partial Response Received', 'API Error: idle timeout reached, partial response received'];

for (const message of RETRYABLE_VARIANTS) {
  test(`retryable: "${message.slice(0, 56)}"`, () => {
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

test('socket-closed (Issue #1881) remains retryable', () => {
  const result = classifyRetryableError('API Error: The socket connection was closed unexpectedly.');
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
console.log('\n✅ All stream idle timeout retry tests passed (Issue #1937)');
