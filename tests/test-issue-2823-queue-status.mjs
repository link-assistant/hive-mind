#!/usr/bin/env node

/**
 * Tests for issue #2823: `/queue` output is wrong.
 *
 * The production log showed, in the same `/queue` reply:
 *
 *   *codex*
 *     *Processing* (4):
 *       • link-assistant/router#723 (▶️ 2h 1m 23s) …
 *     *Completed* (65):
 *       ✅ link-assistant/router#727 … ✅ link-assistant/router#723
 *   Completed: 72, Failed: 0
 *
 * while 4 sessions had ended with `exitCode 1` / `status failed`. Covered here:
 *   1. a task that is still executing is listed only under Processing;
 *   2. a session that fails after launch is listed (and counted) under Failed;
 *   3. a kill-recovery completion is attributed to the original queue item;
 *   4. the summary line counts what the lists show;
 *   5. the session monitor notifies completion listeners;
 *   6. a long status is split with its tool/list headers repeated;
 *   7. a bare repository URL renders as a compact `[owner/repo](url)` link.
 *
 * Run with: node tests/test-issue-2823-queue-status.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2823
 */

import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { SolveQueue, QueueItemStatus, resetSolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { formatQueueItemLink, formatQueueSessionFailure, partitionQueueHistory } from '../src/telegram-solve-queue.helpers.lib.mjs';
import { splitQueueStatusMessage } from '../src/telegram-solve-queue-status-split.lib.mjs';
import { addSessionCompletionListener, monitorSessions, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';
import { preloadAllLocales } from '../src/i18n.lib.mjs';

await preloadAllLocales();

console.log('='.repeat(60));
console.log('Tests: Issue #2823 - /queue lists running tasks as Completed');
console.log('='.repeat(60));

const ROUTER = n => `https://github.com/link-assistant/router/issues/${n}`;

function makeQueue(runningSessionItems = []) {
  resetSolveQueue();
  return new SolveQueue({
    verbose: false,
    autoStart: false,
    getRunningProcesses: async () => ({ count: 0, processes: [] }),
    getRunningIsolatedSessions: async () => ({ count: 0, byTool: {} }),
    getRunningSessionItems: async () => runningSessionItems,
  });
}

// Launch items through the real executeItem path, as the bot does.
async function launch(queue, url, sessionName, tool = 'codex') {
  queue.executeCallback = async () => ({ success: true, sessionId: sessionName, output: `session: ${sessionName}` });
  const item = queue.enqueue({ url, args: [url], tool });
  queue.getToolQueue(tool).splice(queue.getToolQueue(tool).indexOf(item), 1);
  queue.processing.set(item.id, item);
  item.setStarting();
  await queue.executeItem(item);
  return item;
}

function section(status, label) {
  const lines = status.split('\n');
  const start = lines.findIndex(line => line.trim().startsWith(`*${label}*`));
  if (start === -1) return '';
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('    ')) break;
    out.push(line);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
console.log('\n📋 1. Executing tasks are not listed as Completed\n');
{
  const running = [723, 724, 725, 727].map(n => ({ sessionName: `s-${n}`, url: ROUTER(n), tool: 'codex', startTime: new Date(Date.now() - 3600_000) }));
  const queue = makeQueue(running);
  for (const n of [722, 723, 724, 725, 726, 727]) await launch(queue, ROUTER(n), `s-${n}`);
  // #722 and #726 finished successfully.
  queue.recordSessionCompletion({ sessionName: 's-722', exitCode: 0, status: 'executed' });
  queue.recordSessionCompletion({ sessionName: 's-726', exitCode: 0, status: 'executed' });

  const status = await queue.formatDetailedStatus();
  const processing = section(status, 'Processing');
  const completed = section(status, 'Completed');
  for (const n of [723, 724, 725, 727]) {
    assert(processing.includes(`router#${n}]`), `router#${n} is listed under Processing`);
    assert(!completed.includes(`router#${n}]`), `running router#${n} is NOT listed under Completed`);
  }
  assert(completed.includes('router#722]') && completed.includes('router#726]'), 'finished router#722 and #726 are listed under Completed');
  assert(status.includes('*Completed* (2):'), 'Completed counts only finished tasks');
  assert(status.includes('Pending: 0, Processing: 4, Completed: 2, Failed: 0'), `summary counts what the lists show (got: ${status.trim().split('\n').pop()})`);
  queue.stop();
}

// ---------------------------------------------------------------------------
console.log('\n📋 2. A session that fails after launch is listed under Failed\n');
{
  const queue = makeQueue([]);
  await launch(queue, ROUTER(1), 'ok-session');
  await launch(queue, ROUTER(2), '33fb97ec-e994-42c7-97d2-ed2bec7504f5');
  await launch(queue, ROUTER(3), 'killed-session');
  queue.recordSessionCompletion({ sessionName: 'ok-session', exitCode: 0, status: 'executed' });
  queue.recordSessionCompletion({ sessionName: '33fb97ec-e994-42c7-97d2-ed2bec7504f5', exitCode: 1, status: 'failed' });
  queue.recordSessionCompletion({ sessionName: 'killed-session', exitCode: 137, status: 'failed' });

  const status = await queue.formatDetailedStatus();
  const completed = section(status, 'Completed');
  const failed = section(status, 'Failed');
  assert(completed.includes('router#1]') && !completed.includes('router#2]') && !completed.includes('router#3]'), 'only the successful session is under Completed');
  assert(failed.includes('router#2]') && failed.includes('exit code 1'), 'exit code 1 session is under Failed with its exit code');
  assert(failed.includes('router#3]') && failed.includes('SIGKILL (exit code 137)'), 'a killed session shows its signal');
  assert(status.includes('Completed: 1, Failed: 2'), 'the summary counts post-launch failures');
  assert(queue.stats.totalSessionFailed === 2 && queue.stats.totalSessionSucceeded === 1, 'session outcome statistics are kept');
  queue.stop();
}

// ---------------------------------------------------------------------------
console.log('\n📋 3. Kill recovery and URL fallback matching\n');
{
  const queue = makeQueue([]);
  const item = await launch(queue, ROUTER(10), 'root-session');
  assert(item.status === QueueItemStatus.STARTED && item.sessionName === 'root-session', 'launched item keeps its session name');
  // The original session was killed, but a recovery session took over.
  assert(queue.recordSessionCompletion({ sessionName: 'root-session', exitCode: 137, status: 'failed', supersededBy: 'recovery-1' }) === null, 'a completion superseded by a recovery session is ignored');
  assert(item.sessionOutcome === null, 'the item has no outcome while recovery continues');
  queue.recordSessionCompletion({ sessionName: 'recovery-1', rootSessionName: 'root-session', exitCode: 0, status: 'executed' });
  assert(item.sessionOutcome?.failed === false, 'the recovery outcome is attributed through rootSessionName');

  const byUrl = await launch(queue, ROUTER(11), 'unknown');
  queue.recordSessionCompletion({ sessionName: 'real-uuid', url: `${ROUTER(11)}/`, tool: 'codex', exitCode: 1, status: 'failed' });
  assert(byUrl.sessionOutcome?.failed === true, 'falls back to the URL when the session name is unknown');
  assert(queue.recordSessionCompletion({ sessionName: 'nobody', url: ROUTER(999), exitCode: 0 }) === null, 'unmatched completions are ignored');
  queue.stop();
}

// ---------------------------------------------------------------------------
console.log('\n📋 4. partitionQueueHistory keeps legacy plain history items\n');
{
  const plain = [
    { tool: 'claude', url: ROUTER(1) },
    { tool: 'claude', url: ROUTER(2) },
  ];
  const result = partitionQueueHistory({ completed: plain, failed: [{ url: ROUTER(3), error: 'boom' }], executing: [{ url: ROUTER(2) }] });
  assert(result.completed.length === 1 && result.completed[0].url === ROUTER(1), 'a plain item that is not executing stays Completed');
  assert(result.executingHidden.length === 1 && result.executingHidden[0].url === ROUTER(2), 'a plain item that is executing is hidden from Completed');
  assert(result.failed.length === 1 && result.failed[0].error === 'boom', 'launch failures stay Failed');
  assert(formatQueueSessionFailure({ exitCode: null, status: 'timeout' }) === 'timeout', 'falls back to the backend status');
}

// ---------------------------------------------------------------------------
console.log('\n📋 5. Session monitor notifies completion listeners\n');
{
  resetSessionMonitorForTests();
  const events = [];
  const unsubscribe = addSessionCompletionListener(event => events.push(event));
  const throwing = addSessionCompletionListener(() => {
    throw new Error('listener failure must not break monitoring');
  });
  // A session whose completion was already reported is finalized on the next tick.
  trackSession('uuid-failed', { url: ROUTER(5), tool: 'codex', command: 'solve', chatId: 1, startTime: new Date(), completionNotifiedAt: new Date().toISOString(), completionExitCode: 1, completionStatus: 'failed' });
  const originalError = console.error;
  console.error = () => {};
  try {
    await monitorSessions({ telegram: {} }, false);
  } finally {
    console.error = originalError;
  }
  assert(events.length === 1, 'listener was called once');
  assert(events[0]?.sessionName === 'uuid-failed' && events[0]?.exitCode === 1 && events[0]?.status === 'failed', 'event carries session name, exit code and status');
  assert(events[0]?.url === ROUTER(5) && events[0]?.tool === 'codex', 'event carries URL and tool');
  unsubscribe();
  throwing();
  resetSessionMonitorForTests();
}

// ---------------------------------------------------------------------------
console.log('\n📋 6. Long status is split with headers repeated\n');
{
  const queue = makeQueue([]);
  for (let n = 0; n < 80; n++) queue.enqueue({ url: `https://github.com/link-foundation/disk-space-saviour/issues/${n}`, args: [], tool: 'codex' });
  for (let n = 0; n < 40; n++) queue.enqueue({ url: `https://github.com/link-assistant/hive-mind/issues/${n}`, args: [], tool: 'claude' });
  const status = await queue.formatDetailedStatus();
  assert(status.length > 4096, `fixture exceeds the Telegram limit (${status.length} chars)`);
  const chunks = splitQueueStatusMessage(status);
  assert(chunks.length >= 2, `status is split (${chunks.length} messages)`);
  assert(
    chunks.every(chunk => chunk.length <= 4096),
    'every message fits the limit'
  );
  for (const [index, chunk] of chunks.slice(1).entries()) {
    const firstLine = chunk.split('\n')[0];
    assert(/^\*(codex|claude)\*/.test(firstLine), `continuation ${index + 2} starts with a tool header (got: ${firstLine})`);
    const secondLine = chunk.split('\n')[1] || '';
    assert(/^ {2}\*Pending\* \(\d+(, continued)?\):$/.test(secondLine), `continuation ${index + 2} names its list (got: ${secondLine})`);
  }
  const rejoined = chunks.join('\n').split('\n');
  const bullets = rejoined.filter(line => line.trim().startsWith('•')).length;
  assert(bullets === 120, `no item is lost or duplicated by the split (${bullets} items)`);
  assert(chunks[1].includes('continued'), 'continuation header carries the "continued" marker');
  const ru = splitQueueStatusMessage(status, { locale: 'ru' });
  assert(ru[1].includes('продолжение'), 'the marker is localized');
  assert(splitQueueStatusMessage('short').length === 1, 'a short status is not split');
  queue.stop();
}

// ---------------------------------------------------------------------------
console.log('\n📋 7. Bare repository URLs render as compact links\n');
{
  assert(formatQueueItemLink('https://github.com/link-foundation/browser-commander') === '[link-foundation/browser-commander](https://github.com/link-foundation/browser-commander)', 'repository URL becomes [owner/repo](url)');
  assert(formatQueueItemLink('https://github.com/owner/repo/') === '[owner/repo](https://github.com/owner/repo/)', 'trailing slash is accepted');
  assert(formatQueueItemLink(ROUTER(723)) === `[link-assistant/router#723](${ROUTER(723)})`, 'issue URLs are unchanged');
  assert(formatQueueItemLink('https://github.com/owner/repo/tree/main') === 'https://github.com/owner/repo/tree/main', 'deeper non-issue URLs keep the escaped fallback');
  assert(formatQueueItemLink('https://example.com/a_b') === 'https://example.com/a\\_b', 'non-GitHub URLs keep the escaped fallback');
}

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
