#!/usr/bin/env node
/**
 * Issue #2072: /merge was not cancelled immediately on Cancel button click
 *
 * The #1588 tests assert only that the sources mention `isCancelled`, which stayed
 * true even while the bug was live: cancellation was checked at the top of each poll
 * iteration, but the poll delay itself was an uninterruptible setTimeout. A cancel
 * therefore took up to a full poll interval to land — 30s for target-branch CI (the
 * 0m38s stall in the issue screenshot), up to 5 minutes in waitForPRReady.
 *
 * These tests measure elapsed wall-clock time instead, so they fail if any wait
 * stops honouring cancellation.
 *
 * Run with: node tests/test-merge-cancel-latency-2072.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2072
 */

import assert from 'node:assert/strict';
import { cancellableSleep } from '../src/interruptible-sleep.lib.mjs';
import { MergeQueueProcessor } from '../src/telegram-merge-queue.lib.mjs';
import { waitForPRReady } from '../src/telegram-merge-wait.lib.mjs';

// A delay long enough that sleeping it out is unmistakable in the timings below.
const LONG_DELAY_MS = 30_000;
// Cancellation is polled every 100ms; allow generous headroom for slow CI machines.
const MAX_CANCEL_LATENCY_MS = 2_000;

let testsPassed = 0;
let testsFailed = 0;

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

console.log('\n📋 Issue #2072: /merge cancellation latency Tests\n');

await asyncTest('cancellableSleep returns as soon as isCancelled flips mid-sleep', async () => {
  let cancelled = false;
  setTimeout(() => {
    cancelled = true;
  }, 150);

  const startedAt = Date.now();
  const result = await cancellableSleep(LONG_DELAY_MS, () => cancelled);
  const elapsed = Date.now() - startedAt;

  assert.equal(result.cancelled, true, 'Should report cancelled');
  assert.ok(elapsed < MAX_CANCEL_LATENCY_MS, `Should abort the sleep promptly, took ${elapsed}ms of ${LONG_DELAY_MS}ms`);
});

await asyncTest('cancellableSleep returns immediately when already cancelled', async () => {
  const startedAt = Date.now();
  const result = await cancellableSleep(LONG_DELAY_MS, () => true);
  const elapsed = Date.now() - startedAt;

  assert.equal(result.cancelled, true, 'Should report cancelled');
  assert.ok(elapsed < 100, `Should not sleep at all when cancelled up front, took ${elapsed}ms`);
});

await asyncTest('cancellableSleep still sleeps the full delay when not cancelled', async () => {
  const startedAt = Date.now();
  const result = await cancellableSleep(300, () => false);
  const elapsed = Date.now() - startedAt;

  assert.equal(result.cancelled, false, 'Should not report cancelled');
  assert.ok(elapsed >= 250, `Should sleep the requested delay, took only ${elapsed}ms`);
});

await asyncTest('MergeQueueProcessor.sleep aborts when cancel() is called', async () => {
  // sleep() is the single cancellable primitive for the queue: every wait routes
  // through it, so this covers all stages of /merge at once.
  const processor = new MergeQueueProcessor({ owner: 'test-owner', repo: 'test-repo' });
  setTimeout(() => processor.cancel(), 150);

  const startedAt = Date.now();
  await processor.sleep(LONG_DELAY_MS);
  const elapsed = Date.now() - startedAt;

  assert.ok(elapsed < MAX_CANCEL_LATENCY_MS, `sleep() should return on cancel, took ${elapsed}ms of ${LONG_DELAY_MS}ms`);
});

await asyncTest('waitForPRReady stops within ~100ms of cancel despite a 5-minute poll interval', async () => {
  // Reproduces the reported scenario: /merge parked on a long poll delay keeps
  // running after Cancel. Uses the real sleep so the delay is genuinely waited on.
  const processor = new MergeQueueProcessor({ owner: 'test-owner', repo: 'test-repo' });
  processor.log = () => {};
  processor.checkPRMergeable = async () => ({ mergeable: false, reason: 'Waiting on checks' });

  const item = { pr: { number: 123 }, status: null, error: null };
  setTimeout(() => processor.cancel(), 150);

  const startedAt = Date.now();
  const result = await waitForPRReady(
    processor,
    item,
    { mergeable: false, reason: 'Waiting on checks' },
    {
      MergeItemStatus: { CHECKING_CI: 'checking_ci', WAITING_READY: 'waiting_ready' },
      conflictSkipReason: 'Merge conflict',
      timeoutMs: 60 * 60 * 1000,
      pollIntervalMs: 5 * 60 * 1000,
    }
  );
  const elapsed = Date.now() - startedAt;

  assert.equal(result.status, 'cancelled', 'Should report a cancelled status');
  assert.ok(elapsed < MAX_CANCEL_LATENCY_MS, `Should not sleep out the poll interval, took ${elapsed}ms`);
});

await asyncTest('a PR cancelled during the mergeability check is skipped, not failed', async () => {
  // checkPRMergeable reports `cancelled` when the UNKNOWN-mergeability retry delay
  // is aborted; that must not be misread as "this PR is unmergeable".
  const processor = new MergeQueueProcessor({ owner: 'test-owner', repo: 'test-repo' });
  processor.log = () => {};
  processor.cancel();

  const startedAt = Date.now();
  const result = await processor.checkPRMergeable('test-owner', 'test-repo', 123, false, {
    isCancelled: () => processor.isCancelled,
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.cancelled, true, 'Should report cancelled rather than unmergeable');
  assert.ok(elapsed < MAX_CANCEL_LATENCY_MS, `Should return promptly when cancelled, took ${elapsed}ms`);
});

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
