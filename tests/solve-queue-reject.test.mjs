#!/usr/bin/env node
/**
 * Solve Queue Reject Tests
 *
 * Tests for immediate rejection of queued items when reject-strategy
 * threshold is exceeded (Issue #1555).
 *
 * Run with: node tests/solve-queue-reject.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1555
 */

import assert from 'node:assert/strict';
import { SolveQueue, QUEUE_CONFIG, QueueItemStatus, resetSolveQueue, getRunningClaudeProcesses, formatDuration } from '../src/telegram-solve-queue.lib.mjs';
import { resetLimitCache, getLimitCache, CACHE_TTL } from '../src/limits.lib.mjs';

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

function beforeEach() {
  resetSolveQueue();
  resetLimitCache();
}

// ============================================================================
// Issue #1555: Reject queued items when reject-strategy threshold exceeded
// ============================================================================

console.log('\n📋 Issue #1555: Queued Item Rejection Tests\n');

await asyncTest('rejectAllItemsInQueue rejects all items and updates stats', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Enqueue several items
  const item1 = queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'user1', infoBlock: 'Info 1', tool: 'claude' });
  const item2 = queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'user2', infoBlock: 'Info 2', tool: 'claude' });
  const item3 = queue.enqueue({ url: 'https://github.com/test/repo/issues/3', args: '', requester: 'user3', infoBlock: 'Info 3', tool: 'claude' });

  assert.equal(queue.getStats().queued, 3, 'Should have 3 queued items');

  const toolQueue = queue.getToolQueue('claude');
  await queue.rejectAllItemsInQueue('claude', toolQueue, 'Disk space critical (95% used)');

  assert.equal(queue.getStats().queued, 0, 'Queue should be empty after rejection');
  assert.equal(queue.getStats().totalFailed, 3, 'All 3 items should be counted as failed');
  assert.equal(item1.status, QueueItemStatus.FAILED, 'Item 1 should be FAILED');
  assert.equal(item2.status, QueueItemStatus.FAILED, 'Item 2 should be FAILED');
  assert.equal(item3.status, QueueItemStatus.FAILED, 'Item 3 should be FAILED');
  assert.ok(item1.error.includes('Disk space critical'), 'Item 1 error should contain rejection reason');

  queue.stop();
});

await asyncTest('rejectAllItemsInQueue handles empty queue gracefully', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  const toolQueue = queue.getToolQueue('claude');
  await queue.rejectAllItemsInQueue('claude', toolQueue, 'Test reason');

  assert.equal(queue.getStats().queued, 0, 'Queue should remain empty');
  assert.equal(queue.getStats().totalFailed, 0, 'No items should be failed');

  queue.stop();
});

await asyncTest('findStartableItems rejects queued items when canStartCommand returns rejected', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Enqueue items
  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'user1', infoBlock: 'Info 1', tool: 'claude' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'user2', infoBlock: 'Info 2', tool: 'claude' });

  assert.equal(queue.getStats().queued, 2, 'Should have 2 queued items');

  // Override checkSystemResources to simulate disk-full rejection
  const originalCheckSystemResources = queue.checkSystemResources.bind(queue);
  queue.checkSystemResources = async () => ({
    ok: false,
    reasons: [],
    oneAtATime: false,
    rejected: true,
    rejectReason: 'Disk space critical (95% used, threshold 90%)',
  });

  const startableItems = await queue.findStartableItems();

  assert.equal(startableItems.length, 0, 'No items should be startable');
  assert.equal(queue.getStats().queued, 0, 'Queue should be empty - items were rejected');
  assert.equal(queue.getStats().totalFailed, 2, 'Both items should be failed');

  // Restore original method
  queue.checkSystemResources = originalCheckSystemResources;
  queue.stop();
});

await asyncTest('findStartableItems only rejects tool queues affected by rejection', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Enqueue items for different tools
  const claudeItem = queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'user1', infoBlock: 'Info 1', tool: 'claude' });
  const agentItem = queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'user2', infoBlock: 'Info 2', tool: 'agent' });

  assert.equal(queue.getStats().queued, 2, 'Should have 2 queued items');

  // Override canStartCommand to reject claude but allow agent
  const originalCanStartCommand = queue.canStartCommand.bind(queue);
  queue.canStartCommand = async options => {
    if (options.tool === 'claude') {
      return {
        canStart: false,
        rejected: true,
        rejectReason: 'Claude API limit exceeded',
        reasons: [],
        oneAtATime: false,
      };
    }
    return originalCanStartCommand(options);
  };

  const startableItems = await queue.findStartableItems();

  // Claude queue should be rejected, agent should be startable (assuming resources ok)
  assert.equal(claudeItem.status, QueueItemStatus.FAILED, 'Claude item should be rejected');
  assert.equal(queue.getToolQueue('claude').length, 0, 'Claude queue should be empty');

  // Restore
  queue.canStartCommand = originalCanStartCommand;
  queue.stop();
});

await asyncTest('updateAllWaitingItems rejects items when tool threshold is reject strategy', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  const item1 = queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'user1', infoBlock: 'Info 1', tool: 'claude' });
  const item2 = queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'user2', infoBlock: 'Info 2', tool: 'claude' });

  // Override canStartCommand to simulate rejection
  const originalCanStartCommand = queue.canStartCommand.bind(queue);
  queue.canStartCommand = async () => ({
    canStart: false,
    rejected: true,
    rejectReason: 'Disk space critical',
    reason: undefined,
    reasons: [],
    oneAtATime: false,
  });

  await queue.updateAllWaitingItems();

  assert.equal(queue.getStats().queued, 0, 'Queue should be empty after rejection');
  assert.equal(item1.status, QueueItemStatus.FAILED, 'Item 1 should be FAILED');
  assert.equal(item2.status, QueueItemStatus.FAILED, 'Item 2 should be FAILED');

  queue.canStartCommand = originalCanStartCommand;
  queue.stop();
});

await asyncTest('updateAllWaitingItems updates waiting reason when not rejected', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  const item = queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'user1', infoBlock: 'Info 1', tool: 'claude' });

  // Override canStartCommand to simulate non-rejected waiting
  const originalCanStartCommand = queue.canStartCommand.bind(queue);
  queue.canStartCommand = async () => ({
    canStart: false,
    rejected: false,
    rejectReason: null,
    reason: 'RAM usage high (70%)',
    reasons: ['RAM usage high (70%)'],
    oneAtATime: false,
  });

  await queue.updateAllWaitingItems();

  assert.equal(item.status, QueueItemStatus.WAITING, 'Item should be in WAITING status');
  assert.equal(item.waitingReason, 'RAM usage high (70%)', 'Should show the waiting reason');
  assert.equal(queue.getStats().queued, 1, 'Item should still be in queue');

  queue.canStartCommand = originalCanStartCommand;
  queue.stop();
});

console.log('\n📊 Test Results\n');
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log(`Total tests: ${testsPassed + testsFailed}`);

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
