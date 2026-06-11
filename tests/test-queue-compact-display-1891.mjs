#!/usr/bin/env node

/**
 * Tests for issue #1891: reduce duplication in the /queue (/solve_queue) detailed
 * display.
 *
 * The old format repeated "(processing, time)" / "(waiting, time)" on every line
 * and printed the (usually identical) waiting reason once per pending item. The
 * new compact format:
 *   - executing items render as  `• owner/repo#number (▶️ <dur>)`
 *   - pending items render as    `• owner/repo#number (⏳ <dur>)`
 *   - the shared waiting reason is shown once per tool, not per item
 *   - empty queues are hidden entirely
 *
 * Run with: node tests/test-queue-compact-display-1891.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1891
 */

import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { SolveQueue, resetSolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { formatQueueExecutingItems, formatQueuePendingItems } from '../src/telegram-solve-queue.helpers.lib.mjs';
import { preloadAllLocales } from '../src/i18n.lib.mjs';

await preloadAllLocales();

console.log('='.repeat(60));
console.log('Tests: Issue #1891 - Compact /queue display');
console.log('='.repeat(60));

// ---------------------------------------------------------------------------
// Helper renderers in isolation
// ---------------------------------------------------------------------------

console.log('\n📋 formatQueueExecutingItems / formatQueuePendingItems\n');

{
  const out = formatQueueExecutingItems({
    items: [{ url: 'https://github.com/octo/repo/issues/7', waitMs: 8056000 }],
    locale: null,
  });
  assert(out.includes('•'), 'executing line starts with a bullet');
  assert(out.includes('▶️'), 'executing line uses the ▶️ marker');
  assert(out.includes('[octo/repo#7]'), 'executing line renders a compact clickable label');
  assert(out.includes('2h 14m 16s'), 'executing line shows a human-readable duration');
  assert(!/processing/i.test(out), 'executing line no longer prints the literal word "processing"');
}

{
  const out = formatQueuePendingItems({
    items: [{ url: 'https://github.com/octo/repo/issues/8', waitMs: 302000 }],
    locale: null,
  });
  assert(out.includes('•'), 'pending line starts with a bullet');
  assert(out.includes('⏳'), 'pending line uses the ⏳ marker');
  assert(out.includes('[octo/repo#8]'), 'pending line renders a compact clickable label');
  assert(out.includes('5m 2s'), 'pending line shows a human-readable duration');
  assert(!/waiting/i.test(out), 'pending line no longer prints the literal word "waiting"');
}

{
  assert(formatQueueExecutingItems({ items: [], locale: null }) === '', 'no executing items renders nothing');
  assert(formatQueuePendingItems({ items: [], locale: null }) === '', 'no pending items renders nothing');
}

// ---------------------------------------------------------------------------
// End-to-end formatDetailedStatus
// ---------------------------------------------------------------------------

console.log('\n📋 formatDetailedStatus compact rendering\n');

await (async () => {
  resetSolveQueue();
  const queue = new SolveQueue({ verbose: false, autoStart: false });

  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'u', infoBlock: 'i', tool: 'claude' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'u', infoBlock: 'i', tool: 'claude' });

  const reason = 'Claude 5 hour session limit is 95% (threshold: 90%)';
  for (const item of queue.getToolQueue('claude')) item.setWaiting(reason);

  const status = await queue.formatDetailedStatus();

  // Empty queues hidden.
  assert(status.includes('claude'), 'non-empty claude queue is shown');
  assert(!status.includes('*agent*'), 'empty agent queue is hidden');
  assert(!status.includes('*gemini*'), 'empty gemini queue is hidden');

  // Compact pending lines with the ⏳ marker, one per item.
  assert(status.includes('test/repo#1'), 'first pending item is listed');
  assert(status.includes('test/repo#2'), 'second pending item is listed');
  const pendingMarkers = (status.match(/•[^\n]*⏳/g) || []).length;
  assert(pendingMarkers === 2, 'each pending item gets exactly one ⏳ bullet line');

  // Shared waiting reason shown once (not once per item).
  assert(status.split(reason).length - 1 === 1, 'shared waiting reason appears exactly once');

  // Old verbose duplication gone.
  assert(!/\(waiting,/.test(status), 'old "(waiting, <time>)" format is gone');
  assert(!/\(processing,/.test(status), 'old "(processing, <time>)" format is gone');

  queue.stop();
})();

await (async () => {
  resetSolveQueue();
  // Inject stubs that report zero running processes/sessions so the empty-state
  // assertion is deterministic regardless of what is running on the test host
  // (a real `claude` process would otherwise make the section legitimately show).
  const queue = new SolveQueue({
    verbose: false,
    autoStart: false,
    getRunningProcesses: async () => ({ count: 0, processes: [] }),
    getRunningIsolatedSessions: async () => ({ count: 0, byTool: {} }),
    getRunningSessionItems: async () => [],
  });
  const status = await queue.formatDetailedStatus();

  // With nothing queued or processing, no tool section should appear.
  assert(!status.includes('*claude*'), 'empty queue hides the claude section too');
  assert(status.includes('📋'), 'status still renders its header when everything is empty');

  queue.stop();
})();

await (async () => {
  resetSolveQueue();
  const queue = new SolveQueue({ verbose: false, autoStart: false });

  // Two pending items with DIFFERENT reasons => shared-reason line is suppressed.
  queue.enqueue({ url: 'https://github.com/test/repo/issues/3', args: '', requester: 'u', infoBlock: 'i', tool: 'claude' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/4', args: '', requester: 'u', infoBlock: 'i', tool: 'claude' });
  const items = queue.getToolQueue('claude');
  items[0].setWaiting('RAM usage is 80% (threshold: 50%)');
  items[1].setWaiting('CPU usage is 90% (threshold: 50%)');

  const status = await queue.formatDetailedStatus();
  // When reasons differ we don't print a single shared reason (it would be wrong).
  assert(!status.includes('  ⏳ RAM usage'), 'divergent reasons are not collapsed into one shared line');
  // But the items themselves are still listed with their ⏳ duration markers.
  assert((status.match(/•[^\n]*⏳/g) || []).length === 2, 'both divergent-reason items still listed compactly');

  queue.stop();
})();

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
