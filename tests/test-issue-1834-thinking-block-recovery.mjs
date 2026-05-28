#!/usr/bin/env node
// Test file for issue #1834: Corrupted extended-thinking blocks make a Claude Code
// session permanently un-resumable.
//
// Error reproduced from the issue:
//   API Error: 400 messages.1.content.19: `thinking` or `redacted_thinking` blocks
//   in the latest assistant message cannot be modified. These blocks must remain as
//   they were in the original response.
//
// Root cause (upstream anthropics/claude-code#63147): when extended thinking is
// combined with tool use, Claude Code persists a thinking block to the on-disk
// session transcript with the `thinking` text emptied to "" while keeping the
// original `signature`. On resume the API validates the signature against the now
// empty text and rejects every subsequent turn with a 400. The only recovery is to
// discard the session and start fresh, so classifyRetryableError flags the error
// with `requiresFreshSession: true` (NOT plain `isRetryable`, which would resume the
// same corrupted session forever).

import assert from 'assert';

const { classifyRetryableError } = await import('../src/tool-retry.lib.mjs');
const { retryLimits } = await import('../src/config.lib.mjs');

console.log('Testing Corrupted Thinking-Block Recovery (Issue #1834)\n');

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
// Section 1: Error classification
// ============================================================
console.log('\n=== 1. classifyRetryableError detection ===');

// The exact message from the issue gist log (req_011CbVfZ3PnFwVTwDXLGCBuW).
const issueMessage = 'API Error: 400 messages.1.content.19: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response.';

test('Flags the issue #1834 message as requiresFreshSession', () => {
  const result = classifyRetryableError(issueMessage);
  assert.strictEqual(result.requiresFreshSession, true, `Expected requiresFreshSession=true, got: ${result.requiresFreshSession}`);
});

test('Does NOT mark the corrupted-thinking error as plain isRetryable', () => {
  const result = classifyRetryableError(issueMessage);
  assert.strictEqual(result.isRetryable, false, 'Corrupted thinking blocks must not use the resume-retry path (would loop forever)');
});

test('Is not classified as a capacity error', () => {
  const result = classifyRetryableError(issueMessage);
  assert.strictEqual(result.isCapacity, false, 'Corrupted thinking blocks are not a capacity error');
});

test('Provides a descriptive label', () => {
  const result = classifyRetryableError(issueMessage);
  assert(typeof result.label === 'string' && result.label.length > 0, 'Should provide a human-readable label');
  assert(result.label.toLowerCase().includes('thinking'), `Label should mention thinking blocks, got: ${result.label}`);
});

test('Detects redacted_thinking variant', () => {
  const msg = 'API Error: 400 messages.2.content.5: `redacted_thinking` blocks in the latest assistant message cannot be modified.';
  const result = classifyRetryableError(msg);
  assert.strictEqual(result.requiresFreshSession, true, 'redacted_thinking variant should also require a fresh session');
});

test('Detection is case-insensitive', () => {
  const result = classifyRetryableError(issueMessage.toUpperCase());
  assert.strictEqual(result.requiresFreshSession, true, 'Detection should be case-insensitive');
});

test('Accepts a structured error object (not just a string)', () => {
  const errObj = {
    error: {
      message: '`thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response.',
    },
  };
  const result = classifyRetryableError(errObj);
  assert.strictEqual(result.requiresFreshSession, true, 'Should normalize and detect structured error objects');
});

// ============================================================
// Section 2: No false positives
// ============================================================
console.log('\n=== 2. No false positives ===');

test('Plain mention of "thinking" is not flagged', () => {
  const result = classifyRetryableError('I am thinking about the solution.');
  assert(!result.requiresFreshSession, 'Casual mention of thinking must not trigger fresh-session recovery');
});

test('"cannot be modified" without thinking context is not flagged', () => {
  const result = classifyRetryableError('This file cannot be modified because it is read-only.');
  assert(!result.requiresFreshSession, 'Unrelated "cannot be modified" must not trigger fresh-session recovery');
});

test('Transient errors are unaffected (still isRetryable, no fresh session)', () => {
  const overloaded = classifyRetryableError('API Error: 500 {"type":"error","error":{"type":"api_error","message":"Overloaded"}}');
  assert.strictEqual(overloaded.isRetryable, true, 'Overloaded should remain retryable');
  assert(!overloaded.requiresFreshSession, 'Overloaded must not require a fresh session');

  const e503 = classifyRetryableError('API Error: 503 upstream connect error');
  assert.strictEqual(e503.isRetryable, true, '503 should remain retryable');
  assert(!e503.requiresFreshSession, '503 must not require a fresh session');
});

test('Unknown errors return the default (non-retryable, no fresh session)', () => {
  const result = classifyRetryableError('Some unrelated failure');
  assert.strictEqual(result.isRetryable, false, 'Unknown error should not be retryable');
  assert(!result.requiresFreshSession, 'Unknown error should not require a fresh session');
});

// ============================================================
// Section 3: Restart-cap configuration
// ============================================================
console.log('\n=== 3. Fresh-session restart cap (Issue #1834) ===');

test('retryLimits.maxThinkingBlockRestarts is defined', () => {
  assert(typeof retryLimits.maxThinkingBlockRestarts === 'number', `maxThinkingBlockRestarts should be a number, got: ${typeof retryLimits.maxThinkingBlockRestarts}`);
});

test('maxThinkingBlockRestarts defaults to 2', () => {
  // Default value (overridable via HIVE_MIND_MAX_THINKING_BLOCK_RESTARTS).
  assert.strictEqual(retryLimits.maxThinkingBlockRestarts, 2, `Expected default 2, got: ${retryLimits.maxThinkingBlockRestarts}`);
});

test('maxThinkingBlockRestarts is a small positive bound (prevents endless restart loop)', () => {
  assert(retryLimits.maxThinkingBlockRestarts > 0, 'Must allow at least one fresh-session restart');
  assert(retryLimits.maxThinkingBlockRestarts <= 5, 'Must remain a small cap to avoid endless restart loops');
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\nSome tests failed!');
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
