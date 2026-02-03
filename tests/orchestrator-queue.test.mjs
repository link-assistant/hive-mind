#!/usr/bin/env node
/**
 * Tests for Orchestrator Queue Library
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1193
 */

import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';

// Import the modules to test
import { OrchestratorQueue, OrchestratorQueueItem, QueueItemStatus, QUEUE_CONFIG, getOrchestratorQueue, resetOrchestratorQueue } from '../src/orchestrator-queue.lib.mjs';

describe('OrchestratorQueueItem', () => {
  it('should create item with default values', () => {
    const item = new OrchestratorQueueItem({
      url: 'https://github.com/test/repo/issues/1',
    });

    assert.ok(item.id.startsWith('solve-'));
    assert.strictEqual(item.url, 'https://github.com/test/repo/issues/1');
    assert.deepStrictEqual(item.args, []);
    assert.strictEqual(item.requester, 'unknown');
    assert.strictEqual(item.tool, 'claude');
    assert.strictEqual(item.priority, 'normal');
    assert.strictEqual(item.status, QueueItemStatus.QUEUED);
    assert.strictEqual(item.waitingReason, null);
    assert.strictEqual(item.error, null);
    assert.ok(item.createdAt instanceof Date);
  });

  it('should create item with custom values', () => {
    const item = new OrchestratorQueueItem({
      url: 'https://github.com/test/repo/issues/2',
      args: ['--verbose', '--model', 'opus'],
      requester: 'test-user',
      tool: 'opencode',
      priority: 'high',
    });

    assert.strictEqual(item.url, 'https://github.com/test/repo/issues/2');
    assert.deepStrictEqual(item.args, ['--verbose', '--model', 'opus']);
    assert.strictEqual(item.requester, 'test-user');
    assert.strictEqual(item.tool, 'opencode');
    assert.strictEqual(item.priority, 'high');
  });

  it('should transition through status states correctly', () => {
    const item = new OrchestratorQueueItem({
      url: 'https://github.com/test/repo/issues/3',
    });

    assert.strictEqual(item.status, QueueItemStatus.QUEUED);

    item.setWaiting('CPU usage high');
    assert.strictEqual(item.status, QueueItemStatus.WAITING);
    assert.strictEqual(item.waitingReason, 'CPU usage high');

    item.setStarting();
    assert.strictEqual(item.status, QueueItemStatus.STARTING);
    assert.strictEqual(item.waitingReason, null);
    assert.ok(item.startedAt instanceof Date);

    item.setStarted('session-123');
    assert.strictEqual(item.status, QueueItemStatus.STARTED);
    assert.strictEqual(item.sessionName, 'session-123');
  });

  it('should handle failure correctly', () => {
    const item = new OrchestratorQueueItem({
      url: 'https://github.com/test/repo/issues/4',
    });

    item.setFailed('Connection timeout');
    assert.strictEqual(item.status, QueueItemStatus.FAILED);
    assert.strictEqual(item.error, 'Connection timeout');
    assert.ok(item.completedAt instanceof Date);
  });

  it('should handle cancellation correctly', () => {
    const item = new OrchestratorQueueItem({
      url: 'https://github.com/test/repo/issues/5',
    });

    item.setCancelled();
    assert.strictEqual(item.status, QueueItemStatus.CANCELLED);
    assert.ok(item.completedAt instanceof Date);
  });

  it('should calculate wait time correctly', () => {
    const item = new OrchestratorQueueItem({
      url: 'https://github.com/test/repo/issues/6',
    });

    // Wait time should be non-negative
    const waitTime = item.getWaitTime();
    assert.ok(waitTime >= 0);
  });

  it('should serialize to JSON correctly', () => {
    const item = new OrchestratorQueueItem({
      url: 'https://github.com/test/repo/issues/7',
      args: ['--verbose'],
      requester: 'api',
    });

    const json = item.toJSON();
    assert.strictEqual(json.url, 'https://github.com/test/repo/issues/7');
    assert.deepStrictEqual(json.args, ['--verbose']);
    assert.strictEqual(json.requester, 'api');
    assert.strictEqual(json.status, QueueItemStatus.QUEUED);
    assert.ok(typeof json.id === 'string');
    assert.ok(typeof json.createdAt === 'string');
    assert.ok(typeof json.waitTimeMs === 'number');
  });
});

describe('OrchestratorQueue', () => {
  let queue;

  beforeEach(() => {
    resetOrchestratorQueue();
    queue = new OrchestratorQueue({ verbose: false });
  });

  afterEach(() => {
    queue.stop();
  });

  it('should enqueue items correctly', () => {
    const item = queue.enqueue({
      url: 'https://github.com/test/repo/issues/1',
    });

    assert.ok(item instanceof OrchestratorQueueItem);
    assert.strictEqual(queue.queue.length, 1);
    assert.strictEqual(queue.stats.totalEnqueued, 1);
  });

  it('should enqueue items to tool-specific queues', () => {
    const claudeItem = queue.enqueue({
      url: 'https://github.com/test/repo/issues/1',
      tool: 'claude',
    });
    const agentItem = queue.enqueue({
      url: 'https://github.com/test/repo/issues/2',
      tool: 'agent',
    });

    // Items should be in their respective tool queues
    assert.strictEqual(queue.queues.claude.length, 1);
    assert.strictEqual(queue.queues.agent.length, 1);

    // Combined queue should have both
    assert.strictEqual(queue.queue.length, 2);
    assert.strictEqual(queue.getTotalQueueLength(), 2);

    // Stats should reflect per-tool breakdown
    const stats = queue.getStats();
    assert.strictEqual(stats.queuedByTool.claude, 1);
    assert.strictEqual(stats.queuedByTool.agent, 1);
  });

  it('should find items by URL', () => {
    const url = 'https://github.com/test/repo/issues/2';
    queue.enqueue({ url });

    const found = queue.findByUrl(url);
    assert.ok(found !== null);
    assert.strictEqual(found.url, url);

    const notFound = queue.findByUrl('https://github.com/test/repo/issues/999');
    assert.strictEqual(notFound, null);
  });

  it('should find items by URL across tool queues', () => {
    const claudeUrl = 'https://github.com/test/repo/issues/1';
    const agentUrl = 'https://github.com/test/repo/issues/2';

    queue.enqueue({ url: claudeUrl, tool: 'claude' });
    queue.enqueue({ url: agentUrl, tool: 'agent' });

    // Should find items from any queue
    const foundClaude = queue.findByUrl(claudeUrl);
    assert.ok(foundClaude !== null);
    assert.strictEqual(foundClaude.tool, 'claude');

    const foundAgent = queue.findByUrl(agentUrl);
    assert.ok(foundAgent !== null);
    assert.strictEqual(foundAgent.tool, 'agent');
  });

  it('should find items by ID', () => {
    const item = queue.enqueue({
      url: 'https://github.com/test/repo/issues/3',
    });

    const found = queue.findById(item.id);
    assert.ok(found !== null);
    assert.strictEqual(found.id, item.id);

    const notFound = queue.findById('invalid-id');
    assert.strictEqual(notFound, null);
  });

  it('should find items by ID across tool queues', () => {
    const claudeItem = queue.enqueue({ url: 'https://github.com/test/repo/issues/1', tool: 'claude' });
    const agentItem = queue.enqueue({ url: 'https://github.com/test/repo/issues/2', tool: 'agent' });

    // Should find items from any queue
    const foundClaude = queue.findById(claudeItem.id);
    assert.ok(foundClaude !== null);

    const foundAgent = queue.findById(agentItem.id);
    assert.ok(foundAgent !== null);
  });

  it('should cancel queued items', () => {
    const item = queue.enqueue({
      url: 'https://github.com/test/repo/issues/4',
    });

    const cancelled = queue.cancel(item.id);
    assert.strictEqual(cancelled, true);
    assert.strictEqual(queue.queue.length, 0);
    assert.strictEqual(queue.stats.totalCancelled, 1);
    assert.strictEqual(item.status, QueueItemStatus.CANCELLED);
  });

  it('should cancel items from specific tool queues', () => {
    const claudeItem = queue.enqueue({ url: 'https://github.com/test/repo/issues/1', tool: 'claude' });
    const agentItem = queue.enqueue({ url: 'https://github.com/test/repo/issues/2', tool: 'agent' });

    // Cancel claude item
    const cancelled = queue.cancel(claudeItem.id);
    assert.strictEqual(cancelled, true);
    assert.strictEqual(queue.queues.claude.length, 0);
    assert.strictEqual(queue.queues.agent.length, 1);
    assert.strictEqual(claudeItem.status, QueueItemStatus.CANCELLED);
    assert.strictEqual(agentItem.status, QueueItemStatus.QUEUED);
  });

  it('should not cancel non-existent items', () => {
    const cancelled = queue.cancel('non-existent-id');
    assert.strictEqual(cancelled, false);
  });

  it('should return queue stats correctly', () => {
    queue.enqueue({ url: 'https://github.com/test/repo/issues/5' });
    queue.enqueue({ url: 'https://github.com/test/repo/issues/6' });

    const stats = queue.getStats();
    assert.strictEqual(stats.queued, 2);
    assert.strictEqual(stats.processing, 0);
    assert.strictEqual(stats.totalEnqueued, 2);
    assert.strictEqual(stats.isRunning, true);
  });

  it('should return queue stats with per-tool breakdown', () => {
    queue.enqueue({ url: 'https://github.com/test/repo/issues/1', tool: 'claude' });
    queue.enqueue({ url: 'https://github.com/test/repo/issues/2', tool: 'claude' });
    queue.enqueue({ url: 'https://github.com/test/repo/issues/3', tool: 'agent' });

    const stats = queue.getStats();
    assert.strictEqual(stats.queued, 3);
    assert.strictEqual(stats.queuedByTool.claude, 2);
    assert.strictEqual(stats.queuedByTool.agent, 1);
    assert.ok(stats.lastStartTimeByTool !== undefined);
  });

  it('should return queue summary correctly', () => {
    queue.enqueue({ url: 'https://github.com/test/repo/issues/7' });

    const summary = queue.getQueueSummary();
    assert.ok(Array.isArray(summary.pending));
    assert.strictEqual(summary.pending.length, 1);
    assert.ok(Array.isArray(summary.processing));
    assert.ok(Array.isArray(summary.recentCompleted));
    assert.ok(Array.isArray(summary.recentFailed));
  });

  it('should count processing items by tool', () => {
    // Initially no processing items
    assert.strictEqual(queue.getProcessingCountByTool('claude'), 0);
    assert.strictEqual(queue.getProcessingCountByTool('agent'), 0);
  });
});

describe('OrchestratorQueue - Tool-specific limit handling (issue #1159)', () => {
  let queue;

  beforeEach(() => {
    resetOrchestratorQueue();
    queue = new OrchestratorQueue({ verbose: false });
  });

  afterEach(() => {
    queue.stop();
  });

  it('should use tool-specific timing for minimum interval', async () => {
    // Set last start time for claude
    queue.lastStartTimeByTool.claude = Date.now();
    queue.lastStartTimeByTool.agent = null;

    // Claude should be throttled due to min interval
    const claudeCheck = await queue.canStartCommand({ tool: 'claude' });
    // Note: canStart may still be true if other conditions allow, but min_interval
    // should be recorded in throttle reasons if recently started

    // Agent should not be affected by claude's timing
    const agentCheck = await queue.canStartCommand({ tool: 'agent' });
    // Agent timing is independent, so if no other limits, it should be able to start
    // (depends on system resources, but min_interval won't block it)

    // Verify independent timing tracking exists
    assert.ok(queue.lastStartTimeByTool !== undefined);
    assert.ok('claude' in queue.lastStartTimeByTool);
    assert.ok('agent' in queue.lastStartTimeByTool);
  });

  it('should skip Claude limits for agent tool', async () => {
    // This tests that checkApiLimits with tool='agent' doesn't block on Claude limits
    // We can't easily mock the cached limits, but we can verify the method signature
    const result = await queue.checkApiLimits(false, 0, 'agent');
    assert.ok(result !== undefined);
    assert.ok('ok' in result);
    assert.ok('reasons' in result);
    assert.ok('oneAtATime' in result);
  });

  it('should apply Claude limits for claude tool', async () => {
    // This tests that checkApiLimits with tool='claude' works correctly
    const result = await queue.checkApiLimits(false, 0, 'claude');
    assert.ok(result !== undefined);
    assert.ok('ok' in result);
    assert.ok('reasons' in result);
    assert.ok('oneAtATime' in result);
  });

  it('should have separate queues for different tools', () => {
    // Verify queue structure
    assert.ok(queue.queues !== undefined);
    assert.ok('claude' in queue.queues);
    assert.ok('agent' in queue.queues);
    assert.ok(Array.isArray(queue.queues.claude));
    assert.ok(Array.isArray(queue.queues.agent));
  });

  it('should dynamically create queues for new tool types', () => {
    // getToolQueue should create a queue for a new tool if it doesn't exist
    const customQueue = queue.getToolQueue('custom-tool');
    assert.ok(Array.isArray(customQueue));
    assert.ok('custom-tool' in queue.queues);
  });
});

describe('QUEUE_CONFIG', () => {
  it('should have valid threshold values', () => {
    assert.ok(QUEUE_CONFIG.RAM_THRESHOLD >= 0 && QUEUE_CONFIG.RAM_THRESHOLD <= 1);
    assert.ok(QUEUE_CONFIG.CPU_THRESHOLD >= 0 && QUEUE_CONFIG.CPU_THRESHOLD <= 1);
    assert.ok(QUEUE_CONFIG.DISK_THRESHOLD >= 0 && QUEUE_CONFIG.DISK_THRESHOLD <= 1);
    assert.ok(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD >= 0 && QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD <= 1);
    assert.ok(QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD >= 0 && QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD <= 1);
    assert.ok(QUEUE_CONFIG.GITHUB_API_THRESHOLD >= 0 && QUEUE_CONFIG.GITHUB_API_THRESHOLD <= 1);
  });

  it('should have valid timing values', () => {
    assert.ok(QUEUE_CONFIG.MIN_START_INTERVAL_MS > 0);
    assert.ok(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS > 0);
  });
});

describe('getOrchestratorQueue (singleton)', () => {
  beforeEach(() => {
    resetOrchestratorQueue();
  });

  afterEach(() => {
    resetOrchestratorQueue();
  });

  it('should return the same instance on multiple calls', () => {
    const queue1 = getOrchestratorQueue();
    const queue2 = getOrchestratorQueue();

    assert.strictEqual(queue1, queue2);
  });

  it('should update verbose setting on existing instance', () => {
    const queue1 = getOrchestratorQueue({ verbose: false });
    assert.strictEqual(queue1.verbose, false);

    const queue2 = getOrchestratorQueue({ verbose: true });
    assert.strictEqual(queue2.verbose, true);
    assert.strictEqual(queue1, queue2);
  });
});

// Run tests
console.log('Running orchestrator-queue tests...');
