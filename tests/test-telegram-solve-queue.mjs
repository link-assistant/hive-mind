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
const { SolveQueue, getSolveQueue, resetSolveQueue, getRunningClaudeProcesses, QUEUE_CONFIG } = await import(queueLibPath);

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    const result = testFn();
    // Handle async tests
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

// Test 1: QUEUE_CONFIG has required properties
runTest('QUEUE_CONFIG has required properties', () => {
  const requiredProps = ['RAM_THRESHOLD_PERCENT', 'CPU_THRESHOLD_PERCENT', 'DISK_FREE_THRESHOLD_PERCENT', 'CLAUDE_SESSION_THRESHOLD_PERCENT', 'CLAUDE_WEEKLY_THRESHOLD_PERCENT', 'GITHUB_API_THRESHOLD_PERCENT', 'MIN_START_INTERVAL_MS', 'LIMIT_CACHE_TTL_MS', 'CONSUMER_POLL_INTERVAL_MS'];

  for (const prop of requiredProps) {
    if (!(prop in QUEUE_CONFIG)) {
      throw new Error(`Missing property: ${prop}`);
    }
    if (typeof QUEUE_CONFIG[prop] !== 'number') {
      throw new Error(`Property ${prop} should be a number`);
    }
  }
});

// Test 2: Check default thresholds match requirements
runTest('Default thresholds match requirements', () => {
  // From issue #1041:
  // - RAM: 50%
  // - CPU: 50%
  // - Disk free: 5%
  // - Claude session: 90%
  // - Claude weekly: 99%
  // - GitHub API: 80%
  // - Min interval: 1 minute
  // - Cache TTL: 5 minutes

  if (QUEUE_CONFIG.RAM_THRESHOLD_PERCENT !== 50) {
    throw new Error(`RAM threshold should be 50%, got ${QUEUE_CONFIG.RAM_THRESHOLD_PERCENT}`);
  }
  if (QUEUE_CONFIG.CPU_THRESHOLD_PERCENT !== 50) {
    throw new Error(`CPU threshold should be 50%, got ${QUEUE_CONFIG.CPU_THRESHOLD_PERCENT}`);
  }
  if (QUEUE_CONFIG.DISK_FREE_THRESHOLD_PERCENT !== 5) {
    throw new Error(`Disk free threshold should be 5%, got ${QUEUE_CONFIG.DISK_FREE_THRESHOLD_PERCENT}`);
  }
  if (QUEUE_CONFIG.CLAUDE_SESSION_THRESHOLD_PERCENT !== 90) {
    throw new Error(`Claude session threshold should be 90%, got ${QUEUE_CONFIG.CLAUDE_SESSION_THRESHOLD_PERCENT}`);
  }
  if (QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD_PERCENT !== 99) {
    throw new Error(`Claude weekly threshold should be 99%, got ${QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD_PERCENT}`);
  }
  if (QUEUE_CONFIG.GITHUB_API_THRESHOLD_PERCENT !== 80) {
    throw new Error(`GitHub API threshold should be 80%, got ${QUEUE_CONFIG.GITHUB_API_THRESHOLD_PERCENT}`);
  }
  if (QUEUE_CONFIG.MIN_START_INTERVAL_MS !== 60000) {
    throw new Error(`Min interval should be 60000ms, got ${QUEUE_CONFIG.MIN_START_INTERVAL_MS}`);
  }
  if (QUEUE_CONFIG.LIMIT_CACHE_TTL_MS !== 300000) {
    throw new Error(`Cache TTL should be 300000ms, got ${QUEUE_CONFIG.LIMIT_CACHE_TTL_MS}`);
  }
});

// Test 3: SolveQueue can be instantiated
runTest('SolveQueue can be instantiated', () => {
  const queue = new SolveQueue();
  if (!queue) {
    throw new Error('Failed to create SolveQueue');
  }
  queue.stop();
});

// Test 4: getSolveQueue returns singleton
runTest('getSolveQueue returns singleton', () => {
  resetSolveQueue();
  const queue1 = getSolveQueue();
  const queue2 = getSolveQueue();

  if (queue1 !== queue2) {
    throw new Error('getSolveQueue should return the same instance');
  }

  queue1.stop();
  resetSolveQueue();
});

// Test 5: Queue enqueue and getStats
runTest('Queue enqueue and getStats', () => {
  resetSolveQueue();
  const queue = new SolveQueue();

  const stats1 = queue.getStats();
  if (stats1.queued !== 0) {
    throw new Error('Initial queue should be empty');
  }

  // Mock context
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

// Test 6: Queue cancel
runTest('Queue cancel', () => {
  resetSolveQueue();
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

// Test 7: getRunningClaudeProcesses returns object with count
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

// Test 8: Queue getQueueSummary
runTest('Queue getQueueSummary', () => {
  resetSolveQueue();
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

// Test 9: Queue formatStatus
runTest('Queue formatStatus', () => {
  resetSolveQueue();
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

// Test 10: Queue clearCache
runTest('Queue clearCache', () => {
  resetSolveQueue();
  const queue = new SolveQueue();

  // Add something to cache
  queue.limitCache.set('test', { value: 123 });

  const stats1 = queue.limitCache.getStats();
  if (stats1.validEntries !== 1) {
    throw new Error('Cache should have 1 entry');
  }

  queue.clearCache();

  const stats2 = queue.limitCache.getStats();
  if (stats2.validEntries !== 0) {
    throw new Error('Cache should be empty after clear');
  }

  queue.stop();
});

// Test 11: LimitCache TTL expiration
runTest('LimitCache TTL expiration', () => {
  resetSolveQueue();
  // Create queue with very short cache TTL
  const queue = new SolveQueue({ limitCacheTtlMs: 10 });

  queue.limitCache.set('test', { value: 123 });

  // Immediate read should work
  const val1 = queue.limitCache.get('test');
  if (!val1) {
    throw new Error('Cache should return value immediately');
  }

  // Wait for expiration (use blocking wait for test)
  const start = Date.now();
  while (Date.now() - start < 20) {
    // busy wait
  }

  // After TTL, should return null
  const val2 = queue.limitCache.get('test');
  if (val2 !== null) {
    throw new Error('Cache should return null after TTL');
  }

  queue.stop();
});

// Test 12: canStartCommand returns proper structure
await runTestAsync('canStartCommand returns proper structure', async () => {
  resetSolveQueue();
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

// Test 13: Queue stops correctly
runTest('Queue stops correctly', () => {
  resetSolveQueue();
  const queue = new SolveQueue();

  if (!queue.isRunning) {
    throw new Error('Queue should be running initially');
  }

  queue.stop();

  if (queue.isRunning) {
    throw new Error('Queue should not be running after stop');
  }
});

// Test 14: Multiple enqueues maintain order
runTest('Multiple enqueues maintain order', () => {
  resetSolveQueue();
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

// Test 15: SolveQueueItem has correct properties
runTest('SolveQueueItem has correct properties', () => {
  resetSolveQueue();
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
  if (item.status !== 'pending') {
    throw new Error('Item status should be pending');
  }
  if (!(item.createdAt instanceof Date)) {
    throw new Error('Item should have createdAt date');
  }
  if (item.tool !== 'claude') {
    throw new Error('Item should have correct tool');
  }

  queue.stop();
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

// Restore CI if it was set
if (originalCI !== undefined) {
  process.env.CI = originalCI;
}

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
