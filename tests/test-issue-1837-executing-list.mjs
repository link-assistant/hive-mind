#!/usr/bin/env node
/**
 * Tests for issue #1837: list executing tasks in /solve_queue (/queue) status.
 *
 * The detailed status previously showed only a processing count but never
 * listed the tasks themselves, because the count was derived from external
 * sources (pgrep + tracked detached sessions) while the list iterated the
 * queue's own in-memory `processing` Map — which is emptied once a task is
 * dispatched to a detached screen/isolation session.
 *
 * `getRunningSessionItems()` exposes the tracked detached sessions (with their
 * GitHub URLs) so the executing tasks can be listed as clickable links.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1837
 */

import { trackSession, resetSessionMonitorForTests, getRunningSessionItems, NON_ISOLATION_SESSION_TIMEOUT_MS } from '../src/session-monitor.lib.mjs';
import { SolveQueue, resetSolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { collectExecutingItems } from '../src/telegram-solve-queue.helpers.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1837: executing-task list');
console.log('='.repeat(60));

console.log('\n  getRunningSessionItems — isolation sessions:');
resetSessionMonitorForTests();
trackSession(
  'issue-1837-iso-running',
  {
    chatId: 1,
    messageId: 2,
    startTime: new Date('2026-05-30T10:00:00.000Z'),
    url: 'https://github.com/link-assistant/hive-mind/issues/1837',
    command: 'solve',
    isolationBackend: 'screen',
    sessionId: 'issue-1837-iso-running',
    tool: 'claude',
  },
  false
);
trackSession(
  'issue-1837-iso-done',
  {
    chatId: 1,
    messageId: 3,
    startTime: new Date('2026-05-30T09:00:00.000Z'),
    url: 'https://github.com/link-assistant/hive-mind/pull/1840',
    command: 'solve',
    isolationBackend: 'screen',
    sessionId: 'issue-1837-iso-done',
    tool: 'codex',
  },
  false
);

const isoItems = await getRunningSessionItems(false, {
  statusProvider: async sessionId => ({
    exists: true,
    status: sessionId === 'issue-1837-iso-running' ? 'executing' : 'executed',
    exitCode: sessionId === 'issue-1837-iso-running' ? null : 0,
    raw: '',
  }),
  // These sessions' startTimes are days old, so the #1927 stale-`executing`
  // reconciliation (gated by STALE_EXECUTING_MIN_AGE_MS) cross-checks backend
  // liveness before listing a session as running. A genuinely-executing session
  // is alive at its backend; inject that here so the probe doesn't fall through
  // to a real `screen -ls` (which would have no such session and exclude it).
  backendAlive: async sessionId => sessionId === 'issue-1837-iso-running',
});
assert(isoItems.length === 1, 'Only executing isolation sessions are listed');
assert(isoItems[0].sessionName === 'issue-1837-iso-running', 'Listed item is the executing session');
assert(isoItems[0].url === 'https://github.com/link-assistant/hive-mind/issues/1837', 'Listed item carries its GitHub URL');
assert(isoItems[0].tool === 'claude', 'Listed item carries its tool');
assert(isoItems[0].status === 'executing', 'Listed item carries its status');

console.log('\n  getRunningSessionItems — non-isolation screen sessions:');
resetSessionMonitorForTests();
trackSession(
  'issue-1837-screen-running',
  {
    chatId: 1,
    startTime: new Date(),
    url: 'https://github.com/link-assistant/hive-mind/issues/146',
    command: 'solve',
    tool: 'claude',
  },
  false
);
const screenItems = await getRunningSessionItems(false, {
  screenChecker: async () => true,
});
assert(screenItems.length === 1, 'Live non-isolation screen session is listed');
assert(screenItems[0].url === 'https://github.com/link-assistant/hive-mind/issues/146', 'Non-isolation item carries its URL');
assert(screenItems[0].isolationBackend === null, 'Non-isolation item reports no isolation backend');

const goneItems = await getRunningSessionItems(false, {
  screenChecker: async () => false,
});
assert(goneItems.length === 0, 'Non-isolation session whose screen is gone is excluded');

console.log('\n  getRunningSessionItems — expired non-isolation sessions:');
resetSessionMonitorForTests();
trackSession(
  'issue-1837-screen-expired',
  {
    chatId: 1,
    startTime: new Date(Date.now() - NON_ISOLATION_SESSION_TIMEOUT_MS - 1000),
    url: 'https://github.com/link-assistant/hive-mind/issues/999',
    command: 'solve',
    tool: 'claude',
  },
  false
);
const expiredItems = await getRunningSessionItems(false, {
  screenChecker: async () => true,
});
assert(expiredItems.length === 0, 'Expired non-isolation session is excluded even if screen check passes');

resetSessionMonitorForTests();

console.log('\n  collectExecutingItems — merge + dedupe:');
// Merges the in-memory processing Map with tracked running sessions, deduped by
// URL, so the same task is never listed twice and other tools are excluded.
{
  const url = 'https://github.com/test/repo/issues/42';
  const processingItems = [{ tool: 'claude', url, status: 'starting', getWaitTime: () => 1000 }];
  const sessionItems = [
    { sessionName: 's-dup', url: `${url}#partial`, tool: 'claude', startTime: Date.now() - 2000 },
    { sessionName: 's-new', url: 'https://github.com/test/repo/pull/99', tool: 'claude', startTime: Date.now() - 3000 },
    { sessionName: 's-other', url: 'https://github.com/test/repo/issues/7', tool: 'codex', startTime: Date.now() - 1000 },
  ];

  const claude = collectExecutingItems({ processingItems, sessionItems, tool: 'claude', now: Date.now() });
  const claudeUrls = claude.map(i => i.url).sort();
  assert(claudeUrls.length === 2 && claudeUrls[0] === 'https://github.com/test/repo/issues/42' && claudeUrls[1] === 'https://github.com/test/repo/pull/99', 'duplicate URL collapses to one entry; the distinct session is kept; other-tool session is excluded');

  const codex = collectExecutingItems({ processingItems, sessionItems, tool: 'codex', now: Date.now() });
  assert(codex.length === 1, 'codex tool lists only its own session');
  assert(codex[0].url === 'https://github.com/test/repo/issues/7', 'codex session carries its own URL');

  const noUrl = collectExecutingItems({ processingItems: [], sessionItems: [{ sessionName: 's', url: null, tool: 'claude', startTime: Date.now() }], tool: 'claude' });
  assert(noUrl.length === 0, 'a session without a URL cannot be rendered as a clickable link and is skipped');
}

console.log('\n  formatDetailedStatus — lists executing detached sessions:');
// Once a task is dispatched to a detached screen/isolation session the queue's
// in-memory `processing` Map is emptied, so the executing task was counted
// in the header but never listed. The detailed status must list executing
// tasks from the tracked running sessions.
{
  resetSolveQueue();
  const queue = new SolveQueue({
    // No in-memory processing items, but pgrep + a tracked running session say
    // one claude task is executing — exactly the screenshot in the issue.
    getRunningProcesses: async tool => ({ count: tool === 'claude' ? 1 : 0, processes: [] }),
    getRunningIsolatedSessions: async () => ({ count: 1, sessions: ['s1'], byTool: { claude: 1 } }),
    getRunningSessionItems: async () => [{ sessionName: 's1', url: 'https://github.com/test/repo/issues/146', tool: 'claude', status: 'executing', startTime: new Date(Date.now() - 5000), isolationBackend: 'screen' }],
  });

  assert(queue.processing.size === 0, 'precondition: queue has no in-memory processing items');

  const status = await queue.formatDetailedStatus();
  assert(status.includes('*Processing* (1):'), 'claude should report one processing task on the Processing list label');
  assert(!status.includes('processing: 1'), 'claude should not duplicate processing count in the tool header');
  assert(status.includes('▶️'), 'executing task should be rendered with the executing marker');
  assert(status.includes('[test/repo#146](https://github.com/test/repo/issues/146)'), 'executing task should be a clickable link even though it is a detached session');

  queue.stop();
  resetSolveQueue();
}

resetSessionMonitorForTests();
printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
