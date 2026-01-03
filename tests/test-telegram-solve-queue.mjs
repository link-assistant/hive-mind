#!/usr/bin/env node

/**
 * Test suite for telegram-solve-queue.lib.mjs
 * Tests the producer/consumer queue for /solve commands
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1041
 */

// Temporarily unset CI to avoid command-stream trace logs in tests
const originalCI = process.env.CI;
delete process.env.CI;

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the queue library
const queueLibPath = join(__dirname, '..', 'src', 'telegram-solve-queue.lib.mjs');
const { SolveQueue, getSolveQueue, resetSolveQueue, getRunningClaudeProcesses, QUEUE_CONFIG, QueueItemStatus } = await import(queueLibPath);

// Import the limits library
const limitsLibPath = join(__dirname, '..', 'src', 'limits.lib.mjs');
const { CACHE_TTL, getLimitCache, resetLimitCache } = await import(limitsLibPath);

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    const result = testFn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          console.log('✅ PASSED');
          testsPassed++;
        })
        .catch(error => {
          console.log(`❌ FAILED: ${error.message}`);
          testsFailed++;
        });
    }
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

async function runTestAsync(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

// Test 1: QUEUE_CONFIG has required properties with ratio format
runTest('QUEUE_CONFIG has required properties (ratio format)', () => {
  const requiredProps = ['RAM_THRESHOLD', 'CPU_THRESHOLD', 'DISK_THRESHOLD', 'CLAUDE_SESSION_THRESHOLD', 'CLAUDE_WEEKLY_THRESHOLD', 'GITHUB_API_THRESHOLD', 'MIN_START_INTERVAL_MS', 'CONSUMER_POLL_INTERVAL_MS'];

  for (const prop of requiredProps) {
    if (!(prop in QUEUE_CONFIG)) {
      throw new Error(`Missing property: ${prop}`);
    }
    if (typeof QUEUE_CONFIG[prop] !== 'number') {
      throw new Error(`Property ${prop} should be a number`);
    }
  }
});

// Test 2: Check default thresholds match requirements (ratio format)
runTest('Default thresholds match requirements (ratio format)', () => {
  // From issue #1041 (converted to ratios):
  // - RAM: 0.5 (50%)
  // - CPU: 0.5 (50%)
  // - Disk: 0.95 (95% usage, i.e., 5% free)
  // - Claude session: 0.9 (90%)
  // - Claude weekly: 0.99 (99%)
  // - GitHub API: 0.8 (80%)
  // - Min interval: 1 minute

  if (QUEUE_CONFIG.RAM_THRESHOLD !== 0.5) {
    throw new Error(`RAM threshold should be 0.5, got ${QUEUE_CONFIG.RAM_THRESHOLD}`);
  }
  if (QUEUE_CONFIG.CPU_THRESHOLD !== 0.5) {
    throw new Error(`CPU threshold should be 0.5, got ${QUEUE_CONFIG.CPU_THRESHOLD}`);
  }
  if (QUEUE_CONFIG.DISK_THRESHOLD !== 0.95) {
    throw new Error(`Disk threshold should be 0.95, got ${QUEUE_CONFIG.DISK_THRESHOLD}`);
  }
  if (QUEUE_CONFIG.CLAUDE_SESSION_THRESHOLD !== 0.9) {
    throw new Error(`Claude session threshold should be 0.9, got ${QUEUE_CONFIG.CLAUDE_SESSION_THRESHOLD}`);
  }
  if (QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD !== 0.99) {
    throw new Error(`Claude weekly threshold should be 0.99, got ${QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD}`);
  }
  if (QUEUE_CONFIG.GITHUB_API_THRESHOLD !== 0.8) {
    throw new Error(`GitHub API threshold should be 0.8, got ${QUEUE_CONFIG.GITHUB_API_THRESHOLD}`);
  }
  if (QUEUE_CONFIG.MIN_START_INTERVAL_MS !== 60000) {
    throw new Error(`Min interval should be 60000ms, got ${QUEUE_CONFIG.MIN_START_INTERVAL_MS}`);
  }
});

// Test 3: CACHE_TTL has correct values (3min API, 2min system)
runTest('CACHE_TTL has correct values', () => {
  if (CACHE_TTL.API !== 180000) {
    throw new Error(`API cache TTL should be 180000ms (3 minutes), got ${CACHE_TTL.API}`);
  }
  if (CACHE_TTL.SYSTEM !== 120000) {
    throw new Error(`System cache TTL should be 120000ms (2 minutes), got ${CACHE_TTL.SYSTEM}`);
  }
});

// Test 4: SolveQueue can be instantiated
runTest('SolveQueue can be instantiated', () => {
  const queue = new SolveQueue();
  if (!queue) {
    throw new Error('Failed to create SolveQueue');
  }
  queue.stop();
});

// Test 5: getSolveQueue returns singleton
runTest('getSolveQueue returns singleton', () => {
  resetSolveQueue();
  resetLimitCache();
  const queue1 = getSolveQueue();
  const queue2 = getSolveQueue();

  if (queue1 !== queue2) {
    throw new Error('getSolveQueue should return the same instance');
  }

  queue1.stop();
  resetSolveQueue();
});

// Test 6: Queue enqueue and getStats
runTest('Queue enqueue and getStats', () => {
  resetSolveQueue();
  resetLimitCache();
  const queue = new SolveQueue();

  const stats1 = queue.getStats();
  if (stats1.queued !== 0) {
    throw new Error('Initial queue should be empty');
  }

  const mockCtx = { telegram: {}, from: { id: 123 } };

  queue.enqueue({
    url: 'https://github.com/owner/repo/issues/1',
    args: ['https://github.com/owner/repo/issues/1'],
    ctx: mockCtx,
    requester: 'User123',
    infoBlock: 'Test info',
    tool: 'claude',
  });

  const stats2 = queue.getStats();
  if (stats2.queued !== 1) {
    throw new Error(`Queue should have 1 item, got ${stats2.queued}`);
  }
  if (stats2.totalEnqueued !== 1) {
    throw new Error(`Total enqueued should be 1, got ${stats2.totalEnqueued}`);
  }

  queue.stop();
});

// Test 7: Queue cancel
runTest('Queue cancel', () => {
  resetSolveQueue();
  resetLimitCache();
  const queue = new SolveQueue();

  const mockCtx = { telegram: {}, from: { id: 123 } };

  const item = queue.enqueue({
    url: 'https://github.com/owner/repo/issues/1',
    args: ['https://github.com/owner/repo/issues/1'],
    ctx: mockCtx,
    requester: 'User123',
    infoBlock: 'Test info',
    tool: 'claude',
  });

  const stats1 = queue.getStats();
  if (stats1.queued !== 1) {
    throw new Error('Queue should have 1 item');
  }

  const cancelled = queue.cancel(item.id);
  if (!cancelled) {
    throw new Error('Cancel should return true');
  }

  const stats2 = queue.getStats();
  if (stats2.queued !== 0) {
    throw new Error('Queue should be empty after cancel');
  }
  if (stats2.totalCancelled !== 1) {
    throw new Error('Total cancelled should be 1');
  }

  queue.stop();
});

// Test 8: getRunningClaudeProcesses returns object with count
await runTestAsync('getRunningClaudeProcesses returns object with count', async () => {
  const result = await getRunningClaudeProcesses(false);

  if (typeof result !== 'object') {
    throw new Error('Should return an object');
  }
  if (typeof result.count !== 'number') {
    throw new Error('Should have count property as number');
  }
  if (!Array.isArray(result.processes)) {
    throw new Error('Should have processes property as array');
  }
  if (result.count < 0) {
    throw new Error('Count should be >= 0');
  }
});

// Test 9: Queue getQueueSummary
runTest('Queue getQueueSummary', () => {
  resetSolveQueue();
  resetLimitCache();
  const queue = new SolveQueue();

  const mockCtx = { telegram: {}, from: { id: 123 } };

  queue.enqueue({
    url: 'https://github.com/owner/repo/issues/1',
    args: ['https://github.com/owner/repo/issues/1'],
    ctx: mockCtx,
    requester: 'User123',
    infoBlock: 'Test info',
    tool: 'claude',
  });

  const summary = queue.getQueueSummary();

  if (!Array.isArray(summary.pending)) {
    throw new Error('Summary should have pending array');
  }
  if (!Array.isArray(summary.processing)) {
    throw new Error('Summary should have processing array');
  }
  if (summary.pending.length !== 1) {
    throw new Error('Summary should have 1 pending item');
  }
  if (summary.pending[0].url !== 'https://github.com/owner/repo/issues/1') {
    throw new Error('Pending item should have correct URL');
  }

  queue.stop();
});

// Test 10: Queue formatStatus
runTest('Queue formatStatus', () => {
  resetSolveQueue();
  resetLimitCache();
  const queue = new SolveQueue();

  const status1 = queue.formatStatus();
  if (!status1.includes('empty')) {
    throw new Error('Empty queue should show "empty"');
  }

  const mockCtx = { telegram: {}, from: { id: 123 } };

  queue.enqueue({
    url: 'https://github.com/owner/repo/issues/1',
    args: ['https://github.com/owner/repo/issues/1'],
    ctx: mockCtx,
    requester: 'User123',
    infoBlock: 'Test info',
    tool: 'claude',
  });

  const status2 = queue.formatStatus();
  if (!status2.includes('pending')) {
    throw new Error('Non-empty queue should show pending count');
  }

  queue.stop();
});

// Test 11: Queue clearCache
runTest('Queue clearCache', () => {
  resetSolveQueue();
  resetLimitCache();
  const queue = new SolveQueue();

  // Add something to cache
  const cache = getLimitCache();
  cache.set('test', { value: 123 });

  const stats1 = cache.getStats();
  if (stats1.validEntries !== 1) {
    throw new Error('Cache should have 1 entry');
  }

  queue.clearCache();

  const stats2 = cache.getStats();
  if (stats2.validEntries !== 0) {
    throw new Error('Cache should be empty after clear');
  }

  queue.stop();
});

// Test 12: LimitCache TTL expiration
runTest('LimitCache TTL expiration', () => {
  resetSolveQueue();
  resetLimitCache();

  // Create cache with very short TTL for testing
  const cache = getLimitCache();
  cache.set('test', { value: 123 }, 10); // 10ms TTL

  // Immediate read should work
  const val1 = cache.get('test', 10);
  if (!val1) {
    throw new Error('Cache should return value immediately');
  }

  // Wait for expiration
  const start = Date.now();
  while (Date.now() - start < 20) {
    // busy wait
  }

  // After TTL, should return null
  const val2 = cache.get('test', 10);
  if (val2 !== null) {
    throw new Error('Cache should return null after TTL');
  }
});

// Test 13: canStartCommand returns proper structure
await runTestAsync('canStartCommand returns proper structure', async () => {
  resetSolveQueue();
  resetLimitCache();
  const queue = new SolveQueue();

  const result = await queue.canStartCommand();

  if (typeof result !== 'object') {
    throw new Error('Should return an object');
  }
  if (typeof result.canStart !== 'boolean') {
    throw new Error('Should have canStart boolean');
  }
  if (result.canStart === false && typeof result.reason !== 'string') {
    throw new Error('When canStart is false, should have reason string');
  }

  queue.stop();
});

// Test 14: Queue stops correctly
runTest('Queue stops correctly', () => {
  resetSolveQueue();
  resetLimitCache();
  const queue = new SolveQueue();

  if (!queue.isRunning) {
    throw new Error('Queue should be running initially');
  }

  queue.stop();

  if (queue.isRunning) {
    throw new Error('Queue should not be running after stop');
  }
});

// Test 15: Multiple enqueues maintain order
runTest('Multiple enqueues maintain order', () => {
  resetSolveQueue();
  resetLimitCache();
  const queue = new SolveQueue();

  const mockCtx = { telegram: {}, from: { id: 123 } };

  for (let i = 1; i <= 5; i++) {
    queue.enqueue({
      url: `https://github.com/owner/repo/issues/${i}`,
      args: [`https://github.com/owner/repo/issues/${i}`],
      ctx: mockCtx,
      requester: 'User123',
      infoBlock: `Test info ${i}`,
      tool: 'claude',
    });
  }

  const stats = queue.getStats();
  if (stats.queued !== 5) {
    throw new Error(`Queue should have 5 items, got ${stats.queued}`);
  }

  const summary = queue.getQueueSummary();
  for (let i = 0; i < 5; i++) {
    const expectedUrl = `https://github.com/owner/repo/issues/${i + 1}`;
    if (summary.pending[i].url !== expectedUrl) {
      throw new Error(`Item ${i} should have URL ${expectedUrl}`);
    }
  }

  queue.stop();
});

// Test 16: SolveQueueItem has correct properties with new status system
runTest('SolveQueueItem has correct properties', () => {
  resetSolveQueue();
  resetLimitCache();
  const queue = new SolveQueue();

  const mockCtx = { telegram: {}, from: { id: 123 } };

  const item = queue.enqueue({
    url: 'https://github.com/owner/repo/issues/1',
    args: ['https://github.com/owner/repo/issues/1', '--model', 'sonnet'],
    ctx: mockCtx,
    requester: 'User123',
    infoBlock: 'Test info',
    tool: 'claude',
  });

  if (!item.id || typeof item.id !== 'string') {
    throw new Error('Item should have string id');
  }
  if (item.url !== 'https://github.com/owner/repo/issues/1') {
    throw new Error('Item should have correct URL');
  }
  if (!Array.isArray(item.args) || item.args.length !== 3) {
    throw new Error('Item should have args array');
  }
  if (item.status !== QueueItemStatus.QUEUED) {
    throw new Error(`Item status should be ${QueueItemStatus.QUEUED}, got ${item.status}`);
  }
  if (!(item.createdAt instanceof Date)) {
    throw new Error('Item should have createdAt date');
  }
  if (item.tool !== 'claude') {
    throw new Error('Item should have correct tool');
  }

  queue.stop();
});

// Test 17: QueueItemStatus enum values
runTest('QueueItemStatus has correct values', () => {
  if (QueueItemStatus.QUEUED !== 'queued') {
    throw new Error('QUEUED should be "queued"');
  }
  if (QueueItemStatus.WAITING !== 'waiting') {
    throw new Error('WAITING should be "waiting"');
  }
  if (QueueItemStatus.STARTING !== 'starting') {
    throw new Error('STARTING should be "starting"');
  }
  if (QueueItemStatus.STARTED !== 'started') {
    throw new Error('STARTED should be "started"');
  }
  if (QueueItemStatus.FAILED !== 'failed') {
    throw new Error('FAILED should be "failed"');
  }
  if (QueueItemStatus.CANCELLED !== 'cancelled') {
    throw new Error('CANCELLED should be "cancelled"');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for telegram-solve-queue.lib.mjs:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log(`  Platform: ${process.platform}`);
console.log('='.repeat(50));

// Cleanup
resetSolveQueue();
resetLimitCache();

// Restore CI if it was set
if (originalCI !== undefined) {
  process.env.CI = originalCI;
}

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
