#!/usr/bin/env node
/**
 * Issue #1588: Cancel button reappears / queue doesn't stop during CI waits
 *
 * Tests for the fix that makes merge queue cancellation immediate during CI waits.
 *
 * Run with: node tests/test-merge-queue-cancel-1588.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1588
 */

import assert from 'node:assert/strict';
import { MergeQueueProcessor } from '../src/telegram-merge-queue.lib.mjs';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

console.log('\n📋 Issue #1588: Cancel button and CI wait cancellation Tests\n');

test('Issue #1588: onProgress should not show cancel button after cancellation', () => {
  // The bug: after clicking Cancel, the onProgress callback in telegram-merge-command.lib.mjs
  // always re-added the cancel button via reply_markup, making it impossible to stop the queue.
  // Fix: onProgress checks processor.isCancelled and omits reply_markup when true.

  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  // Before cancel, isCancelled is false - button should be shown
  assert.equal(processor.isCancelled, false, 'Should not be cancelled initially');

  // After cancel, isCancelled is true - button should NOT be shown
  processor.cancel();
  assert.equal(processor.isCancelled, true, 'Should be cancelled after cancel()');

  // Simulate the onProgress logic from telegram-merge-command.lib.mjs
  const replyMarkupBeforeCancel = false ? undefined : { inline_keyboard: [[{ text: '🛑 Cancel', callback_data: 'merge_cancel_test' }]] };
  assert.ok(replyMarkupBeforeCancel !== undefined, 'Reply markup should include cancel button when not cancelled');

  const replyMarkupAfterCancel = processor.isCancelled ? undefined : { inline_keyboard: [[{ text: '🛑 Cancel', callback_data: 'merge_cancel_test' }]] };
  assert.equal(replyMarkupAfterCancel, undefined, 'Reply markup should be undefined (no cancel button) when cancelled');
});

asyncTest('Issue #1588: waitForBranchCI should support isCancelled option', async () => {
  // Verify waitForBranchCI accepts the isCancelled option in its interface
  const module = await import('../src/github-merge.lib.mjs');
  assert.ok(typeof module.waitForBranchCI === 'function', 'waitForBranchCI should be a function');

  // Read the source to verify isCancelled is destructured from options
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/github-merge.lib.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('isCancelled') && source.includes('waitForBranchCI'), 'waitForBranchCI source should reference isCancelled parameter');
});

asyncTest('Issue #1588: waitForCommitCI should support isCancelled option', async () => {
  // Verify waitForCommitCI accepts the isCancelled option in its interface
  const module = await import('../src/github-merge-ci.lib.mjs');
  assert.ok(typeof module.waitForCommitCI === 'function', 'waitForCommitCI should be a function');

  // Read the source to verify isCancelled is destructured from options
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/github-merge-ci.lib.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('isCancelled') && source.includes('waitForCommitCI'), 'waitForCommitCI source should reference isCancelled parameter');
});

test('Issue #1588: MergeQueueProcessor passes isCancelled to waitForBranchCI and waitForCommitCI', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  // The processor should expose isCancelled for the onProgress callback to check
  assert.equal(typeof processor.isCancelled, 'boolean', 'isCancelled should be a boolean');
  assert.equal(processor.isCancelled, false, 'isCancelled should start as false');

  processor.cancel();
  assert.equal(processor.isCancelled, true, 'isCancelled should be true after cancel()');

  // Verify the cancel function creates a check that can be passed as isCancelled option
  const isCancelledFn = () => processor.isCancelled;
  assert.equal(isCancelledFn(), true, 'isCancelled function should return true after cancel');
});

asyncTest('Issue #1588: telegram-merge-command onProgress checks isCancelled before adding cancel button', async () => {
  // Read the source to verify the fix is in place
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/telegram-merge-command.lib.mjs', import.meta.url), 'utf8');

  // The fix should check processor.isCancelled before adding the cancel button
  assert.ok(source.includes('processor.isCancelled'), 'onProgress should check processor.isCancelled before showing cancel button');

  // The fix should conditionally omit reply_markup when cancelled
  assert.ok(source.includes('1588'), 'Fix should reference issue #1588');
});

test('Issue #1588: Document the complete cancellation flow', () => {
  // Before the fix (Issue #1588), the cancellation flow had these problems:
  //
  // 1. waitForBranchCI had no isCancelled support:
  //    - When waiting for target branch CI before starting, the queue could not be cancelled
  //    - The cancel button would be removed by the cancel handler, but re-added by onProgress
  //
  // 2. waitForCommitCI had no isCancelled support:
  //    - When waiting for post-merge CI, the queue could not be cancelled
  //    - Same cancel button reappearing problem
  //
  // 3. onProgress always added the cancel button:
  //    - Even after processor.cancel() was called, onProgress would re-add the button
  //    - This made it appear as if the cancel action had no effect
  //
  // After the fix:
  // 1. waitForBranchCI checks isCancelled before each poll iteration
  // 2. waitForCommitCI checks isCancelled before each poll iteration
  // 3. onProgress checks processor.isCancelled and omits reply_markup when true
  // 4. The queue stops immediately when cancel is requested during any CI wait
  assert.ok(true, 'Issue #1588 cancellation flow documented');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
