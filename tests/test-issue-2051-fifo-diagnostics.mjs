#!/usr/bin/env node
/**
 * Regression coverage for issue #2051: global FIFO ordering across tool queues
 * plus dequeue-decision observability.
 *
 * Verifies:
 * - The oldest startable head wins the global startup slot (FIFO across tools).
 * - When the globally-oldest queued head is blocked and a younger head from
 *   another tool starts, a "FIFO queue-jump" diagnostic is recorded (with the
 *   reason the older task is blocked) so long waits can be root-caused.
 * - A strictly-honored FIFO decision records no queue-jump.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2051
 */

import assert from 'node:assert/strict';

import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { resetLimitCache } from '../src/limits.lib.mjs';

let assertions = 0;

function assertEqual(actual, expected, message) {
  assertions++;
  assert.equal(actual, expected, message);
}

function assertTrue(value, message) {
  assertions++;
  assert.equal(Boolean(value), true, message);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function createQueue() {
  resetLimitCache();
  const queue = new SolveQueue({
    verbose: false,
    autoStart: false,
    getRunningProcesses: async () => ({ count: 0 }),
    getRunningIsolatedSessions: async () => ({ count: 0, byTool: {} }),
  });
  // Default: everything startable. Individual tests override per tool.
  queue.checkSystemResources = async () => ({ ok: true, reasons: [], oneAtATime: false, rejected: false, rejectReason: null });
  queue.checkApiLimits = async () => ({ ok: true, reasons: [], oneAtATime: false, rejected: false, rejectReason: null });
  return queue;
}

function enqueueAt(queue, tool, urlSuffix, isoTime) {
  const item = queue.enqueue({ url: `https://github.com/test/repo/issues/${urlSuffix}`, args: '', requester: 'tester', infoBlock: urlSuffix, tool });
  item.createdAt = new Date(isoTime);
  return item;
}

await test('oldest startable head wins the global startup slot', async () => {
  const queue = createQueue();
  const claude = enqueueAt(queue, 'claude', 'claude-1', '2026-07-05T00:00:00.000Z');
  enqueueAt(queue, 'codex', 'codex-1', '2026-07-05T00:00:05.000Z');

  const startable = await queue.findStartableItems();
  assertEqual(startable.length, 1, 'only one task starts per cycle');
  assertEqual(startable[0].item.id, claude.id, 'oldest task (claude) wins');
  assertTrue(!queue.getStats().lastQueueJump, 'strict FIFO records no queue-jump');
  queue.stop();
});

await test('queue-jump is recorded when the older head is blocked', async () => {
  const queue = createQueue();
  const claude = enqueueAt(queue, 'claude', 'claude-1', '2026-07-05T00:00:00.000Z');
  enqueueAt(queue, 'codex', 'codex-1', '2026-07-05T00:00:05.000Z');

  // Block only the claude tool via its API limits (the older head).
  const originalCheckApiLimits = queue.checkApiLimits;
  queue.checkApiLimits = async (hasRunning, count, tool, opts) => {
    if (tool === 'claude') {
      return { ok: false, reasons: ['Claude 5-hour session limit reached'], oneAtATime: false, rejected: false, rejectReason: null };
    }
    return originalCheckApiLimits(hasRunning, count, tool, opts);
  };

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  let startable;
  try {
    startable = await queue.findStartableItems();
  } finally {
    console.log = originalLog;
  }

  assertEqual(startable.length, 1, 'the younger startable task still starts');
  assertTrue(startable[0].tool === 'codex', 'younger codex task is selected because claude is blocked');
  assertTrue(claude.id !== startable[0].item.id, 'blocked claude task is not selected');

  const jump = queue.getStats().lastQueueJump;
  assertTrue(jump, 'a FIFO queue-jump is recorded');
  assertEqual(jump.skippedTool, 'claude', 'skipped tool is claude');
  assertEqual(jump.startedTool, 'codex', 'started tool is codex');
  assertTrue(
    jump.blockedBy.some(r => r.includes('5-hour')),
    'block reason is preserved for root-cause'
  );
  assertTrue(
    logs.some(l => l.includes('FIFO queue-jump') && l.includes('blocked by')),
    'a concise always-on queue-jump line is emitted with the block reason'
  );
  queue.stop();
});

await test('queue-jump notice is deduplicated across repeated cycles', async () => {
  const queue = createQueue();
  enqueueAt(queue, 'claude', 'claude-1', '2026-07-05T00:00:00.000Z');
  enqueueAt(queue, 'codex', 'codex-1', '2026-07-05T00:00:05.000Z');
  const originalCheckApiLimits = queue.checkApiLimits;
  queue.checkApiLimits = async (hasRunning, count, tool, opts) => {
    if (tool === 'claude') return { ok: false, reasons: ['Claude 5-hour session limit reached'], oneAtATime: false, rejected: false, rejectReason: null };
    return originalCheckApiLimits(hasRunning, count, tool, opts);
  };

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    await queue.findStartableItems();
    await queue.findStartableItems();
    await queue.findStartableItems();
  } finally {
    console.log = originalLog;
  }
  const jumpLines = logs.filter(l => l.includes('FIFO queue-jump'));
  assertEqual(jumpLines.length, 1, 'the same unchanged block reason is only reported once');
  queue.stop();
});

if (process.exitCode) {
  console.error(`Failed after ${assertions} assertions`);
  process.exit(process.exitCode);
}

console.log(`Issue #2051 FIFO diagnostics tests passed (${assertions} assertions)`);
