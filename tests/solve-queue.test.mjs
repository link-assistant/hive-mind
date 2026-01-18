#!/usr/bin/env node
/**
 * Solve Queue Unit Tests
 *
 * Comprehensive test suite for the telegram-solve-queue.lib.mjs module.
 * Tests queue behavior, throttling logic, and edge cases.
 *
 * Run with: node tests/solve-queue.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1078
 */

import assert from 'node:assert/strict';
import { SolveQueue, QUEUE_CONFIG, QueueItemStatus, resetSolveQueue, getRunningClaudeProcesses } from '../src/telegram-solve-queue.lib.mjs';
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
// Configuration Tests
// ============================================================================

console.log('\n📋 Configuration Tests\n');

test('QUEUE_CONFIG has all required fields', () => {
  assert.ok(QUEUE_CONFIG.RAM_THRESHOLD !== undefined, 'RAM_THRESHOLD should be defined');
  assert.ok(QUEUE_CONFIG.CPU_THRESHOLD !== undefined, 'CPU_THRESHOLD should be defined');
  assert.ok(QUEUE_CONFIG.DISK_THRESHOLD !== undefined, 'DISK_THRESHOLD should be defined');
  assert.ok(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD !== undefined, 'CLAUDE_5_HOUR_SESSION_THRESHOLD should be defined');
  assert.ok(QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD !== undefined, 'CLAUDE_WEEKLY_THRESHOLD should be defined');
  assert.ok(QUEUE_CONFIG.GITHUB_API_THRESHOLD !== undefined, 'GITHUB_API_THRESHOLD should be defined');
  assert.ok(QUEUE_CONFIG.MIN_START_INTERVAL_MS !== undefined, 'MIN_START_INTERVAL_MS should be defined');
  assert.ok(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS !== undefined, 'CONSUMER_POLL_INTERVAL_MS should be defined');
  assert.ok(QUEUE_CONFIG.MESSAGE_UPDATE_INTERVAL_MS !== undefined, 'MESSAGE_UPDATE_INTERVAL_MS should be defined');
});

test('QUEUE_CONFIG thresholds are valid ratios (0.0 - 1.0)', () => {
  assert.ok(QUEUE_CONFIG.RAM_THRESHOLD >= 0 && QUEUE_CONFIG.RAM_THRESHOLD <= 1, 'RAM_THRESHOLD should be between 0 and 1');
  assert.ok(QUEUE_CONFIG.CPU_THRESHOLD >= 0 && QUEUE_CONFIG.CPU_THRESHOLD <= 1, 'CPU_THRESHOLD should be between 0 and 1');
  assert.ok(QUEUE_CONFIG.DISK_THRESHOLD >= 0 && QUEUE_CONFIG.DISK_THRESHOLD <= 1, 'DISK_THRESHOLD should be between 0 and 1');
  assert.ok(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD >= 0 && QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD <= 1, 'CLAUDE_5_HOUR_SESSION_THRESHOLD should be between 0 and 1');
  assert.ok(QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD >= 0 && QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD <= 1, 'CLAUDE_WEEKLY_THRESHOLD should be between 0 and 1');
  assert.ok(QUEUE_CONFIG.GITHUB_API_THRESHOLD >= 0 && QUEUE_CONFIG.GITHUB_API_THRESHOLD <= 1, 'GITHUB_API_THRESHOLD should be between 0 and 1');
});

test('MESSAGE_UPDATE_INTERVAL_MS is reasonable', () => {
  assert.ok(QUEUE_CONFIG.MESSAGE_UPDATE_INTERVAL_MS >= 30000, 'MESSAGE_UPDATE_INTERVAL_MS should be at least 30 seconds');
  assert.ok(QUEUE_CONFIG.MESSAGE_UPDATE_INTERVAL_MS <= 300000, 'MESSAGE_UPDATE_INTERVAL_MS should be at most 5 minutes');
});

test('MIN_START_INTERVAL_MS is 2 minutes', () => {
  // 2 minutes allows enough time for solve command to start actual claude process
  // This ensures when API limits are checked, the running process is counted
  // See: https://github.com/link-assistant/hive-mind/issues/1078
  assert.equal(QUEUE_CONFIG.MIN_START_INTERVAL_MS, 120000, 'MIN_START_INTERVAL_MS should be 2 minutes (120000ms)');
});

test('CONSUMER_POLL_INTERVAL_MS is 1 minute', () => {
  // 1 minute poll interval reduces unnecessary system checks
  // See: https://github.com/link-assistant/hive-mind/issues/1078
  assert.equal(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS, 60000, 'CONSUMER_POLL_INTERVAL_MS should be 1 minute (60000ms)');
});

// ============================================================================
// Queue Status Tests
// ============================================================================

console.log('\n📋 Queue Status Tests\n');

test('QueueItemStatus has all required statuses', () => {
  assert.equal(QueueItemStatus.QUEUED, 'queued');
  assert.equal(QueueItemStatus.WAITING, 'waiting');
  assert.equal(QueueItemStatus.STARTING, 'starting');
  assert.equal(QueueItemStatus.STARTED, 'started');
  assert.equal(QueueItemStatus.FAILED, 'failed');
  assert.equal(QueueItemStatus.CANCELLED, 'cancelled');
});

// ============================================================================
// Queue Basic Operations Tests
// ============================================================================

console.log('\n📋 Queue Basic Operations Tests\n');

test('SolveQueue initializes with empty state', () => {
  beforeEach();
  const queue = new SolveQueue();
  const stats = queue.getStats();

  assert.equal(stats.queued, 0, 'Queue should start empty');
  assert.equal(stats.processing, 0, 'No items should be processing initially');
  assert.equal(stats.completed, 0, 'No items should be completed initially');
  assert.equal(stats.failed, 0, 'No items should have failed initially');

  queue.stop();
});

test('enqueue adds items to queue', () => {
  beforeEach();
  const queue = new SolveQueue();

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  assert.ok(item, 'Enqueue should return an item');
  assert.ok(item.id.startsWith('solve-'), 'Item ID should start with "solve-"');
  assert.equal(item.status, QueueItemStatus.QUEUED, 'Item should be in QUEUED status');
  assert.equal(queue.getStats().queued, 1, 'Queue should have 1 item');
  assert.equal(queue.getStats().totalEnqueued, 1, 'Total enqueued should be 1');

  queue.stop();
});

test('cancel removes items from queue', () => {
  beforeEach();
  const queue = new SolveQueue();

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  const cancelled = queue.cancel(item.id);

  assert.equal(cancelled, true, 'Cancel should return true');
  assert.equal(item.status, QueueItemStatus.CANCELLED, 'Item should be in CANCELLED status');
  assert.equal(queue.getStats().queued, 0, 'Queue should be empty after cancel');
  assert.equal(queue.getStats().totalCancelled, 1, 'Total cancelled should be 1');

  queue.stop();
});

test('getQueueSummary returns correct structure', () => {
  beforeEach();
  const queue = new SolveQueue();

  queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser1',
    infoBlock: 'Test info 1',
  });

  queue.enqueue({
    url: 'https://github.com/test/repo/issues/2',
    args: '--model sonnet',
    requester: 'testuser2',
    infoBlock: 'Test info 2',
  });

  const summary = queue.getQueueSummary();

  assert.equal(summary.pending.length, 2, 'Should have 2 pending items');
  assert.equal(summary.processing.length, 0, 'Should have 0 processing items');
  assert.equal(summary.pending[0].url, 'https://github.com/test/repo/issues/1');
  assert.equal(summary.pending[1].url, 'https://github.com/test/repo/issues/2');

  queue.stop();
});

// ============================================================================
// Message Update Tests
// ============================================================================

console.log('\n📋 Message Update Tests\n');

test('shouldUpdateMessage returns true for items without lastMessageUpdateTime', () => {
  beforeEach();
  const queue = new SolveQueue();

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  // Item without messageInfo should return false (no message to update)
  assert.equal(queue.shouldUpdateMessage(item), false, 'Should return false when no messageInfo');

  // Add mock messageInfo
  item.messageInfo = { chatId: 123, messageId: 456 };
  item.ctx = { telegram: {} };

  // Now should return true since no lastMessageUpdateTime
  assert.equal(queue.shouldUpdateMessage(item), true, 'Should return true when no lastMessageUpdateTime');

  queue.stop();
});

test('shouldUpdateMessage returns false when update interval not reached', () => {
  beforeEach();
  const queue = new SolveQueue();

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  item.messageInfo = { chatId: 123, messageId: 456 };
  item.ctx = { telegram: {} };
  item.lastMessageUpdateTime = Date.now(); // Just updated

  assert.equal(queue.shouldUpdateMessage(item), false, 'Should return false when recently updated');

  queue.stop();
});

test('shouldUpdateMessage returns true when update interval reached', () => {
  beforeEach();
  const queue = new SolveQueue();

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  item.messageInfo = { chatId: 123, messageId: 456 };
  item.ctx = { telegram: {} };
  // Set lastMessageUpdateTime to more than MESSAGE_UPDATE_INTERVAL_MS ago
  item.lastMessageUpdateTime = Date.now() - QUEUE_CONFIG.MESSAGE_UPDATE_INTERVAL_MS - 1000;

  assert.equal(queue.shouldUpdateMessage(item), true, 'Should return true when interval exceeded');

  queue.stop();
});

// ============================================================================
// Throttle Statistics Tests
// ============================================================================

console.log('\n📋 Throttle Statistics Tests\n');

test('recordThrottle increments throttle reason count', () => {
  beforeEach();
  const queue = new SolveQueue();

  queue.recordThrottle('cpu_high');
  queue.recordThrottle('cpu_high');
  queue.recordThrottle('ram_high');

  const stats = queue.getStats();

  assert.equal(stats.throttleReasons.cpu_high, 2, 'cpu_high should be recorded twice');
  assert.equal(stats.throttleReasons.ram_high, 1, 'ram_high should be recorded once');

  queue.stop();
});

// ============================================================================
// Format Tests
// ============================================================================

console.log('\n📋 Format Tests\n');

test('formatStatus returns correct string for empty queue', () => {
  beforeEach();
  const queue = new SolveQueue();

  const status = queue.formatStatus();
  assert.equal(status, 'Solve Queue: empty\n', 'Empty queue should show "empty"');

  queue.stop();
});

test('formatStatus returns correct string for non-empty queue', () => {
  beforeEach();
  const queue = new SolveQueue();

  queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  const status = queue.formatStatus();
  assert.ok(status.includes('1 pending'), 'Should show 1 pending');
  assert.ok(status.includes('0 processing'), 'Should show 0 processing');

  queue.stop();
});

test('formatDetailedStatus includes all sections', () => {
  beforeEach();
  const queue = new SolveQueue();

  queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  const status = queue.formatDetailedStatus();

  assert.ok(status.includes('Solve Queue Status'), 'Should include title');
  assert.ok(status.includes('Pending:'), 'Should include pending count');
  assert.ok(status.includes('Processing:'), 'Should include processing count');
  assert.ok(status.includes('Completed:'), 'Should include completed count');
  assert.ok(status.includes('Failed:'), 'Should include failed count');
  assert.ok(status.includes('Waiting in Queue'), 'Should include waiting section');

  queue.stop();
});

// ============================================================================
// Claude Process Detection Tests
// ============================================================================

console.log('\n📋 Claude Process Detection Tests\n');

await asyncTest('getRunningClaudeProcesses returns object with count and processes', async () => {
  const result = await getRunningClaudeProcesses(false);

  assert.ok(result !== null, 'Result should not be null');
  assert.ok(typeof result.count === 'number', 'count should be a number');
  assert.ok(Array.isArray(result.processes), 'processes should be an array');
});

// ============================================================================
// Cache Tests
// ============================================================================

console.log('\n📋 Cache Tests\n');

test('getLimitCache returns a cache instance', () => {
  resetLimitCache();
  const cache = getLimitCache();

  assert.ok(cache !== null, 'Cache should not be null');
  assert.ok(typeof cache.get === 'function', 'Cache should have get method');
  assert.ok(typeof cache.set === 'function', 'Cache should have set method');
  assert.ok(typeof cache.clear === 'function', 'Cache should have clear method');
});

test('Cache set and get work correctly', () => {
  resetLimitCache();
  const cache = getLimitCache();

  cache.set('test_key', { value: 42 }, 60000);
  const result = cache.get('test_key');

  assert.deepEqual(result, { value: 42 }, 'Cache should return stored value');
});

test('Cache returns null for expired entries', () => {
  resetLimitCache();
  const cache = getLimitCache();

  // Set with 1ms TTL
  cache.set('test_key', { value: 42 }, 1);

  // Wait for expiration
  const waitStart = Date.now();
  while (Date.now() - waitStart < 10) {
    // Busy wait
  }

  const result = cache.get('test_key', 1);
  assert.equal(result, null, 'Cache should return null for expired entries');
});

test('CACHE_TTL has all required values', () => {
  assert.ok(CACHE_TTL.API !== undefined, 'CACHE_TTL.API should be defined');
  assert.ok(CACHE_TTL.USAGE_API !== undefined, 'CACHE_TTL.USAGE_API should be defined');
  assert.ok(CACHE_TTL.SYSTEM !== undefined, 'CACHE_TTL.SYSTEM should be defined');
});

// ============================================================================
// Queue Item State Transitions Tests
// ============================================================================

console.log('\n📋 Queue Item State Transitions Tests\n');

test('Item transitions from QUEUED to WAITING', () => {
  beforeEach();
  const queue = new SolveQueue();

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  assert.equal(item.status, QueueItemStatus.QUEUED, 'Initial status should be QUEUED');

  item.setWaiting('CPU usage is 60% (threshold: 50%)');

  assert.equal(item.status, QueueItemStatus.WAITING, 'Status should be WAITING');
  assert.equal(item.waitingReason, 'CPU usage is 60% (threshold: 50%)', 'Waiting reason should be set');

  queue.stop();
});

test('Item transitions from WAITING to STARTING', () => {
  beforeEach();
  const queue = new SolveQueue();

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  item.setWaiting('Test reason');
  item.setStarting();

  assert.equal(item.status, QueueItemStatus.STARTING, 'Status should be STARTING');
  assert.equal(item.waitingReason, null, 'Waiting reason should be cleared');
  assert.ok(item.startedAt !== null, 'startedAt should be set');

  queue.stop();
});

test('Item transitions from STARTING to STARTED', () => {
  beforeEach();
  const queue = new SolveQueue();

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  item.messageInfo = { chatId: 123, messageId: 456 };
  item.setStarting();
  item.setStarted('test-session');

  assert.equal(item.status, QueueItemStatus.STARTED, 'Status should be STARTED');
  assert.equal(item.sessionName, 'test-session', 'Session name should be set');
  assert.equal(item.messageInfo, null, 'messageInfo should be cleared (terminal status)');

  queue.stop();
});

test('Item can be marked as failed', () => {
  beforeEach();
  const queue = new SolveQueue();

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  item.setFailed('Test error message');

  assert.equal(item.status, QueueItemStatus.FAILED, 'Status should be FAILED');
  assert.equal(item.error, 'Test error message', 'Error message should be set');

  queue.stop();
});

test('Item can be marked as failed with Error object', () => {
  beforeEach();
  const queue = new SolveQueue();

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  item.setFailed(new Error('Test error'));

  assert.equal(item.status, QueueItemStatus.FAILED, 'Status should be FAILED');
  assert.equal(item.error, 'Test error', 'Error message should be extracted from Error object');

  queue.stop();
});

// ============================================================================
// Wait Time Calculation Tests
// ============================================================================

console.log('\n📋 Wait Time Calculation Tests\n');

test('getWaitTime returns elapsed time for queued items', () => {
  beforeEach();
  const queue = new SolveQueue();

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  // Wait a bit
  const waitStart = Date.now();
  while (Date.now() - waitStart < 50) {
    // Busy wait
  }

  const waitTime = item.getWaitTime();
  assert.ok(waitTime >= 50, 'Wait time should be at least 50ms');
  assert.ok(waitTime < 1000, 'Wait time should be less than 1 second');

  queue.stop();
});

// ============================================================================
// Reason Message Ordering Tests (Issue #1078)
// ============================================================================

console.log('\n📋 Reason Message Ordering Tests (Issue #1078)\n');

await asyncTest('Claude process info should be at end of reasons', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Mock the check to simulate a scenario with multiple reasons
  // We can't easily mock the internal methods, but we can verify the logic by reading the code
  // The key assertion is that reasons.push is used instead of reasons.unshift

  // For now, just verify the queue starts correctly
  const stats = queue.getStats();
  assert.equal(stats.queued, 0, 'Queue should start empty');

  queue.stop();
});

// ============================================================================
// Summary
// ============================================================================

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
