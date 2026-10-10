#!/usr/bin/env node
/**
 * Issue #2890: the solve queue survives a restart. Items are saved to the
 * links triple store on every change and are put back in their original order
 * on startup, with their Telegram cards, start-interval state and statistics.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { buildSolveQueueDocument, createSolveQueuePersistence, decodeJsonValue, encodeJsonValue, linkToRecord, parseSolveQueueDocument, queueItemToRecord, recordToLink, restoreSolveQueue, snapshotSolveQueue } from '../src/telegram-solve-queue.persistence.lib.mjs';
import { documentToLino, linoToDocument } from '../src/solve-queue-store.lib.mjs';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hm-2890-persist-'));
const telegram = { edits: [], editMessageText: async (...args) => telegram.edits.push(args) };
const ctxFor = (chatId, messageId, userId, threadId) => ({ telegram, chat: { id: chatId }, message: { message_id: messageId, message_thread_id: threadId }, from: { id: userId } });
const sorted = value =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(key => [key, sorted(value[key])])
        )
      : value;
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const newQueue = () => new SolveQueue({ autoStart: false, verbose: false });
const enqueue = (queue, n, tool = 'codex', extra = {}) =>
  queue.enqueue({
    url: `https://github.com/link-assistant/router/issues/${n}`,
    args: [`https://github.com/link-assistant/router/issues/${n}`, '--model', 'gpt-5.5', '--think', 'high'],
    ctx: ctxFor(-1001234567890, 100 + n, 42, 7),
    requester: '@konard',
    infoBlock: `Requested by: @konard\nURL: https://github.com/link-assistant/router/issues/${n}`,
    commandAlias: tool,
    tool,
    urlContext: { owner: 'link-assistant', repo: 'router', number: n, type: 'issue' },
    perCommandIsolation: 'docker',
    locale: 'en',
    ...extra,
  });

console.log('\n=== JSON values as links ===');
{
  const value = { owner: 'a', number: 5, open: true, missing: null, list: ['x', 2, false, []], nested: { empty: {} } };
  assert(JSON.stringify(decodeJsonValue(encodeJsonValue(value))) === JSON.stringify(value), 'nested JSON keeps its types');
  const lino = await documentToLino([{ id: null, values: ['x', encodeJsonValue(value)] }]);
  assert(JSON.stringify(decodeJsonValue((await linoToDocument(lino))[0].values[1])) === JSON.stringify(value), 'nested JSON survives the .lino projection');
}

console.log('\n=== Queue item <-> record <-> link ===');
{
  const queue = newQueue();
  const item = enqueue(queue, 724, 'codex', { showLimits: true, limitsAtStart: { claude: { used: 12 } } });
  item.messageInfo = { chatId: -1001234567890, messageId: 555, messageThreadId: 7 };
  item.assignSessionId('2b9c-uuid');
  const record = queueItemToRecord(item);
  assert(record.id === item.id && record.chatId === -1001234567890 && record.requesterUserId === 42 && record.sourceMessageId === 824, 'record keeps ids of the chat, the requester and the command message');
  assert(record.messageInfo.messageId === 555 && record.sessionId === '2b9c-uuid' && record.showLimits === true, 'record keeps the edited card and the session id');
  const back = linkToRecord(recordToLink(record));
  assert(same(back, record), 'record round-trips through a link');
  const lino = await documentToLino([recordToLink(record)]);
  assert(lino.startsWith(`(${item.id}: (tool codex) (status queued)`), '.lino line starts with id, tool and status');
}

console.log('\n=== Every change is persisted (coalesced) ===');
{
  const dir = tmpDir();
  const queue = newQueue();
  const events = [];
  const persistence = createSolveQueuePersistence({ dir, clinkPath: false, logger: { event: (type, data) => events.push([type, data]) } });
  await persistence.load();
  persistence.attach(queue);
  const a = enqueue(queue, 1);
  enqueue(queue, 2);
  enqueue(queue, 3, 'claude');
  await persistence.flush();
  let loaded = await persistence.load();
  assert(loaded.items.length === 3 && loaded.source === 'archive', 'three enqueued items are on disk');
  assert(loaded.revision === 1, 'a burst of changes is written as one revision');
  assert(events.filter(([type]) => type === 'queue_item_enqueued').length === 3, 'each change is logged as a structured event');
  queue.cancel(a.id);
  await persistence.flush();
  loaded = await persistence.load();
  assert(loaded.items.length === 2 && !loaded.items.some(r => r.id === a.id), 'cancelled items are removed from the store');
  assert(loaded.revision === 2, 'revision increases with every save');
  const text = fs.readFileSync(path.join(dir, 'solve-queue.lino'), 'utf8');
  assert(text.includes('(solve-queue (version 1) (revision 2)') && text.includes('router/issues/2'), 'the .lino projection is readable');
}

console.log('\n=== Restore: original order, cards, timing and stats ===');
{
  const dir = tmpDir();
  const before = newQueue();
  const persistence = createSolveQueuePersistence({ dir, clinkPath: false });
  persistence.attach(before);
  const items = [enqueue(before, 10), enqueue(before, 11), enqueue(before, 12), enqueue(before, 13, 'claude')];
  items.forEach((item, i) => (item.messageInfo = { chatId: -1001234567890, messageId: 900 + i, messageThreadId: 7 }));
  before.notifyStateChange('message', items[0]);
  before.recordStart('codex', Date.parse('2026-10-09T12:11:00.000Z'));
  await persistence.flush();

  // Process killed: a new bot process starts with an empty queue.
  const after = newQueue();
  const restartPersistence = createSolveQueuePersistence({ dir, clinkPath: false });
  const loaded = await restartPersistence.load();
  const summary = await restoreSolveQueue(after, loaded, { telegram });
  assert(summary.requeued.length === 4, 'all four pending items are back');
  assert(
    after.queues.codex.map(i => i.id).join() ===
      items
        .slice(0, 3)
        .map(i => i.id)
        .join(),
    'codex items keep their original order'
  );
  assert(after.queues.claude[0].id === items[3].id, 'claude item is back in the claude queue');
  const restored = after.queues.codex[0];
  assert(restored.createdAt.getTime() === items[0].createdAt.getTime() && restored.restoreCount === 1, 'creation time is kept and the restore is counted');
  assert(restored.messageInfo.messageId === 900 && restored.ctx.telegram === telegram && restored.ctx.chat.id === -1001234567890, 'the restored item can edit its old card');
  assert(restored.requesterUserId === 42 && restored.args.join(' ').includes('--model gpt-5.5'), 'requester and full args are restored');
  assert(after.lastStartTimeByTool.codex === Date.parse('2026-10-09T12:11:00.000Z'), 'start-interval state is restored');
  assert(after.stats.totalEnqueued === 4, 'statistics are restored');

  restartPersistence.attach(after);
  restartPersistence.persist('restored');
  await restartPersistence.flush();
  assert((await restartPersistence.load()).revision > loaded.revision, 'saves after a restart win over the old revision');

  // Restoring into a queue that already has the URL (e.g. the user re-sent it).
  const third = newQueue();
  enqueue(third, 10);
  const again = await restoreSolveQueue(third, loaded, { telegram });
  assert(again.skipped.length === 1 && again.requeued.length === 3, 'items already in the queue are not duplicated');
}

console.log('\n=== Restore: starting items are reconciled with running sessions ===');
{
  const queue = newQueue();
  const alive = enqueue(queue, 20);
  const lost = enqueue(queue, 21);
  const screen = enqueue(queue, 22, 'claude');
  for (const item of [alive, lost, screen]) {
    queue.getToolQueue(item.tool).splice(queue.getToolQueue(item.tool).indexOf(item), 1);
    item.setStarting();
    queue.processing.set(item.id, item);
  }
  alive.assignSessionId('alive-session');
  lost.assignSessionId('lost-session');
  const snapshot = snapshotSolveQueue(queue);
  const loaded = parseSolveQueueDocument(buildSolveQueueDocument(snapshot, { revision: 3 }));
  const tracked = [];
  const after = newQueue();
  const summary = await restoreSolveQueue(after, loaded, {
    telegram,
    isSessionRunning: async record => record.sessionId === 'alive-session',
    isUrlRunning: async record => record.url.endsWith('/22'),
    onRunning: async record => tracked.push(record.id),
  });
  assert(summary.running.length === 2 && tracked.join() === [alive.id, screen.id].join(), 'running tasks are handed to the session monitor, not started twice');
  assert(summary.requeued.length === 1 && after.queues.codex[0].id === lost.id && after.queues.codex[0].status === 'queued', 'a start that never reached a container is queued again');
}

console.log('\n=== Restore limit protects against restart loops ===');
{
  const queue = newQueue();
  const waiting = enqueue(queue, 30);
  waiting.restoreCount = 10;
  const crashing = enqueue(queue, 31);
  queue.getToolQueue('codex').splice(queue.getToolQueue('codex').indexOf(crashing), 1);
  crashing.setStarting();
  crashing.interruptedStarts = 3;
  queue.processing.set(crashing.id, crashing);
  const loaded = parseSolveQueueDocument(buildSolveQueueDocument(snapshotSolveQueue(queue), { revision: 1 }));
  const summary = await restoreSolveQueue(newQueue(), loaded, { telegram, log: () => {} });
  assert(summary.dropped.length === 1 && summary.dropped[0].record.id === crashing.id, 'an item whose start was interrupted a fourth time is dropped');
  assert(summary.requeued.length === 1 && summary.requeued[0].item.restoreCount === 11, 'a queued item survives any number of ordinary restarts');

  const once = newQueue();
  const lost = enqueue(once, 32);
  once.getToolQueue('codex').splice(0, 1);
  lost.setStarting();
  once.processing.set(lost.id, lost);
  const again = await restoreSolveQueue(newQueue(), parseSolveQueueDocument(buildSolveQueueDocument(snapshotSolveQueue(once), { revision: 1 })), { telegram });
  assert(again.requeued[0].item.interruptedStarts === 1, 'an interrupted start is counted');
}

console.log('\n=== Damaged items do not cost the rest of the queue ===');
{
  const queue = newQueue();
  enqueue(queue, 40);
  const doc = buildSolveQueueDocument(snapshotSolveQueue(queue), { revision: 1 });
  doc.push({ id: null, values: ['broken', 'item'] });
  assert(parseSolveQueueDocument(doc).items.length === 1, 'a broken item link is skipped');
}

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
