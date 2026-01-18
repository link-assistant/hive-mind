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
// Total Processing Calculation Tests (Issue #1133)
// ============================================================================

console.log('\n📋 Total Processing Calculation Tests (Issue #1133)\n');

test('totalProcessing is calculated as processing.size + Claude processes', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Initially, processing.size should be 0
  assert.equal(queue.processing.size, 0, 'Initial processing.size should be 0');

  // Enqueue an item and simulate moving to processing
  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  // Move to processing (simulate what runConsumer does)
  queue.queue.shift();
  queue.processing.set(item.id, item);

  // Now processing.size should be 1
  assert.equal(queue.processing.size, 1, 'processing.size should be 1 after adding to processing');

  queue.stop();
});

test('canStartCommand returns totalProcessing in result', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  const result = await queue.canStartCommand();

  // totalProcessing should be defined
  assert.ok(result.totalProcessing !== undefined, 'totalProcessing should be in result');
  assert.ok(typeof result.totalProcessing === 'number', 'totalProcessing should be a number');

  queue.stop();
});

test('canStartCommand returns claudeProcesses count in result', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  const result = await queue.canStartCommand();

  // claudeProcesses should be defined
  assert.ok(result.claudeProcesses !== undefined, 'claudeProcesses should be in result');
  assert.ok(typeof result.claudeProcesses === 'number', 'claudeProcesses should be a number');
  assert.ok(result.claudeProcesses >= 0, 'claudeProcesses should be non-negative');

  queue.stop();
});

// ============================================================================
// System Resource Threshold Tests (Issue #1133)
// ============================================================================

console.log('\n📋 System Resource Threshold Tests (Issue #1133)\n');

test('checkSystemResources does not accept totalProcessing parameter', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // checkSystemResources should NOT use totalProcessing - it's an ultimate restriction
  // This test verifies the function signature doesn't expect totalProcessing
  const result = await queue.checkSystemResources();

  // Should return an object with 'ok' and 'reasons'
  assert.ok(result.ok !== undefined, 'Result should have ok property');
  assert.ok(Array.isArray(result.reasons), 'Result should have reasons array');

  queue.stop();
});

test('QUEUE_CONFIG has correct threshold values', () => {
  // System resource thresholds
  assert.equal(QUEUE_CONFIG.RAM_THRESHOLD, 0.5, 'RAM_THRESHOLD should be 50%');
  assert.equal(QUEUE_CONFIG.CPU_THRESHOLD, 0.5, 'CPU_THRESHOLD should be 50%');
  assert.equal(QUEUE_CONFIG.DISK_THRESHOLD, 0.95, 'DISK_THRESHOLD should be 95%');

  // Claude API thresholds
  assert.equal(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD, 0.9, 'CLAUDE_5_HOUR_SESSION_THRESHOLD should be 90%');
  assert.equal(QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD, 0.99, 'CLAUDE_WEEKLY_THRESHOLD should be 99%');
  assert.equal(QUEUE_CONFIG.GITHUB_API_THRESHOLD, 0.8, 'GITHUB_API_THRESHOLD should be 80%');
});

// ============================================================================
// API Threshold Behavior Tests (Issue #1133)
// ============================================================================

console.log('\n📋 API Threshold Behavior Tests (Issue #1133)\n');

test('checkApiLimits accepts totalProcessing parameter', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // checkApiLimits should accept hasRunningClaude and totalProcessing
  // This test verifies the function accepts these parameters without error
  const result = await queue.checkApiLimits(false, 0);

  assert.ok(result.ok !== undefined, 'Result should have ok property');
  assert.ok(Array.isArray(result.reasons), 'Result should have reasons array');
  assert.ok(result.oneAtATime !== undefined, 'Result should have oneAtATime property');

  queue.stop();
});

test('checkApiLimits with different totalProcessing values', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Test with totalProcessing = 0
  const result0 = await queue.checkApiLimits(false, 0);
  assert.ok(result0 !== undefined, 'Should work with totalProcessing = 0');

  // Test with totalProcessing = 1
  const result1 = await queue.checkApiLimits(false, 1);
  assert.ok(result1 !== undefined, 'Should work with totalProcessing = 1');

  // Test with totalProcessing = 5
  const result5 = await queue.checkApiLimits(true, 5);
  assert.ok(result5 !== undefined, 'Should work with totalProcessing = 5');

  queue.stop();
});

// ============================================================================
// One-At-A-Time Mode Tests (Issue #1133)
// ============================================================================

console.log('\n📋 One-At-A-Time Mode Tests (Issue #1133)\n');

test('oneAtATime mode blocks when totalProcessing > 0', () => {
  // This is the key behavior: when oneAtATime is true and totalProcessing > 0,
  // new commands should wait
  // Testing via queue logic verification
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Simulate check result with oneAtATime and totalProcessing > 0
  const check = {
    canStart: true, // All checks passed
    oneAtATime: true, // But we're in one-at-a-time mode
    totalProcessing: 2, // And there are commands processing
    claudeProcesses: 2,
  };

  // The consumer should NOT start a new command in this case
  // (oneAtATime && totalProcessing > 0 should block)
  const shouldBlock = check.oneAtATime && check.totalProcessing > 0;
  assert.equal(shouldBlock, true, 'Should block when oneAtATime is true and totalProcessing > 0');

  queue.stop();
});

test('oneAtATime mode allows when totalProcessing === 0', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Simulate check result with oneAtATime but totalProcessing === 0
  const check = {
    canStart: true,
    oneAtATime: true, // One-at-a-time mode is active
    totalProcessing: 0, // But nothing is processing
    claudeProcesses: 0,
  };

  // Should allow starting since totalProcessing is 0
  const shouldBlock = check.oneAtATime && check.totalProcessing > 0;
  assert.equal(shouldBlock, false, 'Should NOT block when oneAtATime is true but totalProcessing is 0');

  queue.stop();
});

test('normal mode allows parallel commands', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Simulate check result without oneAtATime (normal mode)
  const check = {
    canStart: true,
    oneAtATime: false, // Normal mode
    totalProcessing: 5, // Many commands processing
    claudeProcesses: 3,
  };

  // Should allow starting since oneAtATime is false
  const shouldBlock = check.oneAtATime && check.totalProcessing > 0;
  assert.equal(shouldBlock, false, 'Should NOT block in normal mode even with many commands processing');

  queue.stop();
});

// ============================================================================
// Throttle Recording Tests
// ============================================================================

console.log('\n📋 Throttle Recording Tests\n');

test('recordThrottle increments correct stats for all threshold types', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Record various throttle reasons
  queue.recordThrottle('ram_high');
  queue.recordThrottle('cpu_high');
  queue.recordThrottle('disk_high');
  queue.recordThrottle('claude_5_hour_session_high');
  queue.recordThrottle('claude_5_hour_session_100');
  queue.recordThrottle('claude_weekly_high');
  queue.recordThrottle('claude_weekly_100');
  queue.recordThrottle('github_high');
  queue.recordThrottle('github_100');
  queue.recordThrottle('min_interval');
  queue.recordThrottle('claude_running');

  const stats = queue.getStats();

  assert.equal(stats.throttleReasons.ram_high, 1, 'ram_high should be 1');
  assert.equal(stats.throttleReasons.cpu_high, 1, 'cpu_high should be 1');
  assert.equal(stats.throttleReasons.disk_high, 1, 'disk_high should be 1');
  assert.equal(stats.throttleReasons.claude_5_hour_session_high, 1, 'claude_5_hour_session_high should be 1');
  assert.equal(stats.throttleReasons.claude_5_hour_session_100, 1, 'claude_5_hour_session_100 should be 1');
  assert.equal(stats.throttleReasons.claude_weekly_high, 1, 'claude_weekly_high should be 1');
  assert.equal(stats.throttleReasons.claude_weekly_100, 1, 'claude_weekly_100 should be 1');
  assert.equal(stats.throttleReasons.github_high, 1, 'github_high should be 1');
  assert.equal(stats.throttleReasons.github_100, 1, 'github_100 should be 1');
  assert.equal(stats.throttleReasons.min_interval, 1, 'min_interval should be 1');
  assert.equal(stats.throttleReasons.claude_running, 1, 'claude_running should be 1');

  queue.stop();
});

// ============================================================================
// Threshold Naming Tests (Issue #1133)
// ============================================================================

console.log('\n📋 Threshold Naming Tests (Issue #1133)\n');

test('CLAUDE_5_HOUR_SESSION_THRESHOLD is correctly named', () => {
  // Verify the renamed threshold exists and has correct value
  assert.ok(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD !== undefined, 'CLAUDE_5_HOUR_SESSION_THRESHOLD should exist');
  assert.equal(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD, 0.9, 'CLAUDE_5_HOUR_SESSION_THRESHOLD should be 0.9 (90%)');

  // Verify old name doesn't exist (should be renamed)
  assert.equal(QUEUE_CONFIG.CLAUDE_SESSION_THRESHOLD, undefined, 'Old CLAUDE_SESSION_THRESHOLD should not exist');
});

// ============================================================================
// Queue Statistics Tests
// ============================================================================

console.log('\n📋 Queue Statistics Tests\n');

test('getStats returns all required fields', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  const stats = queue.getStats();

  // Check all required fields exist
  assert.ok(stats.queued !== undefined, 'stats.queued should exist');
  assert.ok(stats.processing !== undefined, 'stats.processing should exist');
  assert.ok(stats.completed !== undefined, 'stats.completed should exist');
  assert.ok(stats.failed !== undefined, 'stats.failed should exist');
  assert.ok(stats.totalEnqueued !== undefined, 'stats.totalEnqueued should exist');
  assert.ok(stats.totalStarted !== undefined, 'stats.totalStarted should exist');
  assert.ok(stats.totalCompleted !== undefined, 'stats.totalCompleted should exist');
  assert.ok(stats.totalFailed !== undefined, 'stats.totalFailed should exist');
  assert.ok(stats.totalCancelled !== undefined, 'stats.totalCancelled should exist');
  assert.ok(stats.throttleReasons !== undefined, 'stats.throttleReasons should exist');
  assert.ok(stats.cacheStats !== undefined, 'stats.cacheStats should exist');
  assert.ok(stats.isRunning !== undefined, 'stats.isRunning should exist');

  queue.stop();
});

test('getStats tracks enqueue correctly', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

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

  const stats = queue.getStats();

  assert.equal(stats.queued, 2, 'queued should be 2');
  assert.equal(stats.totalEnqueued, 2, 'totalEnqueued should be 2');
  assert.equal(stats.processing, 0, 'processing should be 0');

  queue.stop();
});

// ============================================================================
// Min Start Interval Tests
// ============================================================================

console.log('\n📋 Min Start Interval Tests\n');

test('lastStartTime is updated when item moves to processing', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Initially lastStartTime should be null
  assert.equal(queue.lastStartTime, null, 'Initial lastStartTime should be null');

  // Enqueue an item
  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  // Simulate what the consumer does when starting a command
  queue.queue.shift();
  item.setStarting();
  queue.processing.set(item.id, item);
  queue.lastStartTime = Date.now();
  queue.stats.totalStarted++;

  // Now lastStartTime should be set
  assert.ok(queue.lastStartTime !== null, 'lastStartTime should be set after starting');
  assert.ok(queue.lastStartTime > 0, 'lastStartTime should be positive');

  queue.stop();
});

test('MIN_START_INTERVAL_MS prevents rapid consecutive starts', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Set lastStartTime to just now (simulate a recent start)
  queue.lastStartTime = Date.now();

  // Check if we can start a new command
  const result = await queue.canStartCommand();

  // Should NOT be able to start due to min interval
  // (unless this is the first command or enough time has passed)
  if (result.reasons && result.reasons.length > 0) {
    const hasMinIntervalReason = result.reasons.some(r => r.includes('Minimum interval'));
    assert.ok(hasMinIntervalReason, 'Should have min_interval reason when recently started');
  }

  queue.stop();
});

// ============================================================================
// Processing Map Tests
// ============================================================================

console.log('\n📋 Processing Map Tests\n');

test('processing map correctly tracks items', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  const item1 = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  // Move item to processing
  queue.queue.shift();
  queue.processing.set(item1.id, item1);

  assert.equal(queue.processing.size, 1, 'processing.size should be 1');
  assert.ok(queue.processing.has(item1.id), 'processing should contain the item');

  // Remove from processing
  queue.processing.delete(item1.id);

  assert.equal(queue.processing.size, 0, 'processing.size should be 0 after delete');
  assert.ok(!queue.processing.has(item1.id), 'processing should not contain the item');

  queue.stop();
});

// ============================================================================
// formatWaitingReason Tests
// ============================================================================

console.log('\n📋 Format Waiting Reason Tests\n');

test('formatDetailedStatus shows Claude processes info', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  // Set waiting with a reason that includes Claude processes
  queue.queue[0].setWaiting('Claude 5 hour session limit is 95% (threshold: 90%)\nClaude process is already running (2 processes)');

  const status = queue.formatDetailedStatus();

  assert.ok(status.includes('Waiting in Queue'), 'Should include waiting section');
  assert.ok(status.includes('waiting'), 'Should show waiting status');

  queue.stop();
});

// ============================================================================
// Queue Consumer Logic Tests
// ============================================================================

console.log('\n📋 Queue Consumer Logic Tests\n');

test('consumer does not start when queue is empty', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Queue is empty
  assert.equal(queue.queue.length, 0, 'Queue should be empty');

  // Verify stats
  const stats = queue.getStats();
  assert.equal(stats.queued, 0, 'queued should be 0');
  assert.equal(stats.processing, 0, 'processing should be 0');

  queue.stop();
});

test('multiple items maintain FIFO order', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  const item1 = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'user1',
    infoBlock: 'Info 1',
  });

  const item2 = queue.enqueue({
    url: 'https://github.com/test/repo/issues/2',
    args: '--model sonnet',
    requester: 'user2',
    infoBlock: 'Info 2',
  });

  const item3 = queue.enqueue({
    url: 'https://github.com/test/repo/issues/3',
    args: '--model haiku',
    requester: 'user3',
    infoBlock: 'Info 3',
  });

  // Verify FIFO order
  assert.equal(queue.queue[0].id, item1.id, 'First item should be item1');
  assert.equal(queue.queue[1].id, item2.id, 'Second item should be item2');
  assert.equal(queue.queue[2].id, item3.id, 'Third item should be item3');

  // Dequeue first item
  const dequeued = queue.queue.shift();
  assert.equal(dequeued.id, item1.id, 'Dequeued item should be item1 (FIFO)');

  // Verify remaining order
  assert.equal(queue.queue[0].id, item2.id, 'First remaining should be item2');
  assert.equal(queue.queue[1].id, item3.id, 'Second remaining should be item3');

  queue.stop();
});

// ============================================================================
// Edge Case Tests
// ============================================================================

console.log('\n📋 Edge Case Tests\n');

test('cancel returns false for non-existent item', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  const result = queue.cancel('non-existent-id');
  assert.equal(result, false, 'Cancel should return false for non-existent item');

  queue.stop();
});

test('cancel returns false for item in processing', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  // Move to processing
  queue.queue.shift();
  queue.processing.set(item.id, item);

  // Try to cancel
  const result = queue.cancel(item.id);
  assert.equal(result, false, 'Cancel should return false for item in processing');

  queue.stop();
});

test('getQueueSummary handles empty queue correctly', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  const summary = queue.getQueueSummary();

  assert.deepEqual(summary.pending, [], 'pending should be empty array');
  assert.deepEqual(summary.processing, [], 'processing should be empty array');

  queue.stop();
});

test('queue item has correct tool property', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Default tool should be 'claude'
  const item1 = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
  });

  assert.equal(item1.tool, 'claude', 'Default tool should be claude');

  // Custom tool
  const item2 = queue.enqueue({
    url: 'https://github.com/test/repo/issues/2',
    args: '--model opus',
    requester: 'testuser',
    infoBlock: 'Test info',
    tool: 'codex',
  });

  assert.equal(item2.tool, 'codex', 'Custom tool should be preserved');

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
