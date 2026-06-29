#!/usr/bin/env node

/**
 * Tests for issue #1891: reduce duplication in the /queue detailed
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
  assert(status.includes('*Pending* (2):'), 'pending count is shown on the Pending list label');
  assert(!status.includes('*claude* ('), 'tool header does not repeat pending/processing counts');

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

// ---------------------------------------------------------------------------
// Separate labeled lists per queue (issue #1891 PR follow-up):
// each tool queue splits into its own Processing / Pending / Completed / Failed
// lists instead of one merged bullet list.
// ---------------------------------------------------------------------------

console.log('\n📋 separate labeled lists per queue\n');

{
  // The item helpers render a `*Label* (count):` header when given a label.
  const exec = formatQueueExecutingItems({
    items: [{ url: 'https://github.com/octo/repo/issues/7', waitMs: 8056000 }],
    locale: null,
    label: 'Processing',
  });
  assert(exec.includes('*Processing* (1):'), 'executing list renders a labeled header with its count');
  assert(/\*Processing\* \(1\):\n\s+•/.test(exec), 'executing items are nested under their label');

  const pend = formatQueuePendingItems({
    items: [{ url: 'https://github.com/octo/repo/issues/8', waitMs: 302000 }],
    locale: null,
    label: 'Pending',
  });
  assert(pend.includes('*Pending* (1):'), 'pending list renders a labeled header with its count');
}

await (async () => {
  resetSolveQueue();
  const queue = new SolveQueue({
    verbose: false,
    autoStart: false,
    getRunningProcesses: async () => ({ count: 0, processes: [] }),
    getRunningIsolatedSessions: async () => ({ count: 0, byTool: {} }),
    getRunningSessionItems: async () => [],
  });

  // One executing, one pending, plus completed/failed history for the same tool.
  queue.processing.set('p1', { id: 'p1', tool: 'claude', url: 'https://github.com/test/repo/issues/10', status: 'started', getWaitTime: () => 8056000 });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/11', args: '', requester: 'u', infoBlock: 'i', tool: 'claude' });
  queue.getToolQueue('claude')[0].setWaiting('RAM usage is 80% (threshold: 50%)');
  queue.completed.push({ tool: 'claude', url: 'https://github.com/test/repo/issues/12' });
  queue.failed.push({ tool: 'claude', url: 'https://github.com/test/repo/issues/13', error: 'boom' });

  const status = await queue.formatDetailedStatus();

  // All four lists appear as separately-labeled headers.
  assert(status.includes('*Processing* (1):'), 'Processing list is labeled');
  assert(status.includes('*Pending* (1):'), 'Pending list is labeled');
  assert(status.includes('*Completed* (1):'), 'Completed list is labeled per tool');
  assert(status.includes('*Failed* (1):'), 'Failed list is labeled per tool');
  assert(!status.includes('*claude* ('), 'tool header does not duplicate the per-list counts');

  // Lists appear in a sensible order: Processing before Pending before Completed before Failed.
  const iProc = status.indexOf('*Processing*');
  const iPend = status.indexOf('*Pending*');
  const iComp = status.indexOf('*Completed* (');
  const iFail = status.indexOf('*Failed* (');
  assert(iProc < iPend && iPend < iComp && iComp < iFail, 'lists render in Processing→Pending→Completed→Failed order');

  // Items are present and clickable, the failed item keeps its error.
  assert(status.includes('test/repo#10'), 'executing item listed');
  assert(status.includes('test/repo#11'), 'pending item listed');
  assert(status.includes('test/repo#12'), 'completed item listed');
  assert(status.includes('test/repo#13'), 'failed item listed');
  assert(/test\/repo#13[^\n]*— boom/.test(status), 'failed item keeps its error message');

  // The merged single list of the previous iteration is gone: pending and
  // executing items live under different labeled headers, not interleaved.
  assert(status.indexOf('test/repo#10') < status.indexOf('*Pending*'), 'executing item is under Processing, before the Pending label');
  assert(status.indexOf('test/repo#11') > status.indexOf('*Pending*'), 'pending item is under the Pending label');

  queue.stop();
})();

await (async () => {
  // A tool whose live queue has fully drained but still has history should show
  // its Completed/Failed lists (per-queue history) rather than disappearing.
  resetSolveQueue();
  const queue = new SolveQueue({
    verbose: false,
    autoStart: false,
    getRunningProcesses: async () => ({ count: 0, processes: [] }),
    getRunningIsolatedSessions: async () => ({ count: 0, byTool: {} }),
    getRunningSessionItems: async () => [],
  });
  queue.completed.push({ tool: 'codex', url: 'https://github.com/test/repo/issues/20' });

  const status = await queue.formatDetailedStatus();
  assert(status.includes('*codex*'), 'tool with only history is still shown');
  assert(status.includes('*Completed* (1):'), 'its Completed list is shown');
  assert(!status.includes('*agent*'), 'a tool with no activity at all stays hidden');

  queue.stop();
})();

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
