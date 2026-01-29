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

  it('should find items by URL', () => {
    const url = 'https://github.com/test/repo/issues/2';
    queue.enqueue({ url });

    const found = queue.findByUrl(url);
    assert.ok(found !== null);
    assert.strictEqual(found.url, url);

    const notFound = queue.findByUrl('https://github.com/test/repo/issues/999');
    assert.strictEqual(notFound, null);
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

  it('should return queue summary correctly', () => {
    queue.enqueue({ url: 'https://github.com/test/repo/issues/7' });

    const summary = queue.getQueueSummary();
    assert.ok(Array.isArray(summary.pending));
    assert.strictEqual(summary.pending.length, 1);
    assert.ok(Array.isArray(summary.processing));
    assert.ok(Array.isArray(summary.recentCompleted));
    assert.ok(Array.isArray(summary.recentFailed));
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
