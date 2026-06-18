#!/usr/bin/env node
/**
 * Solve Queue Tool Tracking Tests
 *
 * Extracted from solve-queue.test.mjs to keep the original suite under the
 * repository file-size limit while preserving the existing test structure.
 *
 * Run with: node tests/solve-queue-tool-tracking.test.mjs
 */

import assert from 'node:assert/strict';
import { SolveQueue, resetSolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { resetLimitCache } from '../src/limits.lib.mjs';

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
// Tool-Specific Queue Tracking Tests (Issue #1159)
// ============================================================================

console.log('\n📋 Tool-Specific Queue Tracking Tests (Issue #1159)\n');

test('getProcessingCountByTool counts items correctly by tool type', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });
  assert.equal(queue.getProcessingCountByTool('claude'), 0);
  assert.equal(queue.getProcessingCountByTool('agent'), 0);
  queue.processing.set('item1', { id: 'item1', tool: 'claude' });
  queue.processing.set('item2', { id: 'item2', tool: 'claude' });
  queue.processing.set('item3', { id: 'item3', tool: 'agent' });
  assert.equal(queue.getProcessingCountByTool('claude'), 2);
  assert.equal(queue.getProcessingCountByTool('agent'), 1);
  queue.stop();
});

test('separate queues are independent', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'claude' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'agent' });
  assert.equal(queue.getToolQueue('claude').length, 1);
  assert.equal(queue.getToolQueue('agent').length, 1);
  queue.cancel(queue.getToolQueue('claude')[0].id);
  assert.equal(queue.getToolQueue('claude').length, 0);
  assert.equal(queue.getToolQueue('agent').length, 1);
  assert.equal(queue.lastStartTimeByTool.claude, null);
  queue.lastStartTimeByTool.claude = Date.now();
  assert.ok(queue.lastStartTimeByTool.claude !== null);
  assert.equal(queue.lastStartTimeByTool.agent, null);
  queue.stop();
});

await asyncTest('agent tasks can start when claude min interval is not reached', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });
  queue.lastStartTimeByTool.claude = Date.now();
  const claudeCheck = await queue.canStartCommand({ tool: 'claude' });
  const agentCheck = await queue.canStartCommand({ tool: 'agent' });
  assert.ok(claudeCheck.reasons.some(r => r.includes('Minimum interval')));
  assert.ok(!agentCheck.reasons.some(r => r.includes('Minimum interval')));
  queue.stop();
});

await asyncTest('getStats and getQueueSummary show per-tool breakdown', async () => {
  beforeEach();
  // autoStart:false keeps items in the pending queue; with the consumer running
  // it could shift() an item into processing before we snapshot the counts,
  // making the pending assertions flaky under CI load (#1941 CI follow-up).
  const queue = new SolveQueue({ verbose: false, autoStart: false });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'claude' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'agent' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/3', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'claude' });
  const stats = queue.getStats();
  assert.equal(stats.queued, 3);
  assert.equal(stats.queuedByTool.claude, 2);
  assert.equal(stats.queuedByTool.agent, 1);
  const summary = queue.getQueueSummary();
  assert.equal(summary.pending.length, 3);
  assert.ok(summary.pending.some(i => i.tool === 'claude'));
  assert.ok(summary.pending.some(i => i.tool === 'agent'));
  const status = await queue.formatStatus();
  assert.ok(status.includes('claude') && status.includes('pending: 2'), 'Should show claude queue with 2 pending');
  assert.ok(status.includes('agent') && status.includes('pending: 1'), 'Should show agent queue with 1 pending');
  assert.ok(status.includes('processing:'), 'Should include processing counts from pgrep');
  queue.stop();
});

await asyncTest('formatStatus includes codex queue', async () => {
  beforeEach();
  // autoStart:false so the consumer cannot drain a pending item before the
  // formatStatus() snapshot (#1941 CI follow-up).
  const queue = new SolveQueue({ verbose: false, autoStart: false });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'codex' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'qwen' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/3', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'gemini' });
  const status = await queue.formatStatus();
  assert.ok(status.includes('codex') && status.includes('pending: 1'), 'Should show codex queue with 1 pending');
  assert.ok(status.includes('qwen') && status.includes('pending: 1'), 'Should show qwen queue with 1 pending');
  assert.ok(status.includes('gemini') && status.includes('pending: 1'), 'Should show gemini queue with 1 pending');
  queue.stop();
});

await asyncTest('formatStatus includes gemini queue', async () => {
  beforeEach();
  // autoStart:false so the single enqueued item stays pending for the snapshot
  // instead of racing the consumer's shift() into processing (#1941 CI follow-up).
  const queue = new SolveQueue({ verbose: false, autoStart: false });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'gemini' });
  const status = await queue.formatStatus();
  assert.ok(status.includes('gemini') && status.includes('pending: 1'), 'Should show gemini queue with 1 pending');
  queue.stop();
});

await asyncTest('findStartableItem and findStartableItems work correctly', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false, autoStart: false });
  let result = await queue.findStartableItem();
  assert.equal(result.item, null);
  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'claude' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'agent' });
  result = await queue.findStartableItem();
  assert.ok(result.item === null || result.item.tool === 'claude' || result.item.tool === 'agent');
  const startableItems = await queue.findStartableItems();
  assert.ok(Array.isArray(startableItems));
  queue.stop();
});

test('new tool queues are created dynamically and mixed tools work', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'codex' });
  assert.equal(queue.getToolQueue('codex').length, 1);
  queue.enqueue({ url: 'https://github.com/test/repo/issues/4', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'gemini' });
  assert.equal(queue.getToolQueue('gemini').length, 1);
  queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'claude' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/3', args: '', requester: 'testuser', infoBlock: 'Test', tool: 'claude' });
  assert.equal(queue.getTotalQueueLength(), 4);
  assert.equal(queue.getToolQueue('claude').length, 2);
  queue.stop();
});

await asyncTest('canStartCommand returns claudeProcessingCount in result', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });
  const result = await queue.canStartCommand({ tool: 'claude' });
  assert.ok(result.claudeProcessingCount !== undefined);
  assert.equal(typeof result.claudeProcessingCount, 'number');
  queue.stop();
});

await asyncTest('checkApiLimits uses claudeProcessingCount correctly', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });
  const result1 = await queue.checkApiLimits(false, 0, 'claude');
  assert.ok(result1.ok);
  const result2 = await queue.checkApiLimits(false, 5, 'agent');
  assert.ok(result2 !== undefined);
  const result3 = await queue.checkApiLimits(false, 5, 'gemini');
  assert.ok(result3 !== undefined);
  assert.ok(result3.ok, 'Gemini should skip Claude-specific API limits');
  queue.stop();
});

test('default tool for queue item is claude', () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });
  const item = queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'testuser', infoBlock: 'Test' });
  assert.equal(item.tool, 'claude');
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
