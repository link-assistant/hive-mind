#!/usr/bin/env node
/**
 * Issue #2890: when the links stores on the state volume are gone, the solve
 * queue comes back from the pinned Telegram copy, then from the bot logs; on
 * launch the bot restores it, hands running tasks to the session monitor and
 * tells each chat what was restored.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { loadTranslations } from '../src/i18n.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { createBotLogger } from '../src/bot-logger.lib.mjs';
import { createSolveQueuePersistence, buildSolveQueueDocument, snapshotSolveQueue } from '../src/telegram-solve-queue.persistence.lib.mjs';
import { argsFromCommandText, foldQueueLog, loadQueueFromLogs, queueFromLogState, timeFromItemId } from '../src/telegram-solve-queue.log-recovery.lib.mjs';
import { createTelegramQueueBackup, QUEUE_BACKUP_FILE_NAME } from '../src/telegram-solve-queue.telegram-backup.lib.mjs';
import { buildRestoreNotices, createSessionReconciler, createSolveQueueDurability } from '../src/telegram-solve-queue.durability.lib.mjs';
import { documentToLino } from '../src/solve-queue-store.lib.mjs';

for (const locale of ['en', 'ru', 'zh', 'hi']) await loadTranslations(locale);

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hm-2890-recovery-'));
const quiet = () => {};
const newQueue = () => new SolveQueue({ autoStart: false, verbose: false });
const fakeTelegram = () => {
  const api = { sent: [], edits: [], documents: [], pins: [], deleted: [], pinned: null, files: new Map() };
  api.sendMessage = async (chatId, text, extra) => {
    api.sent.push({ chatId, text, extra });
    return { message_id: 1000 + api.sent.length, chat: { id: chatId } };
  };
  api.editMessageText = async (...args) => api.edits.push(args);
  api.sendDocument = async (chatId, file, extra) => {
    const messageId = 5000 + api.documents.length;
    api.files.set(`file-${messageId}`, file.source.toString('utf8'));
    api.documents.push({ chatId, file, extra, messageId });
    return { message_id: messageId, document: { file_id: `file-${messageId}`, file_name: file.filename } };
  };
  api.pinChatMessage = async (chatId, messageId) => {
    api.pins.push(messageId);
    const doc = api.documents.find(d => d.messageId === messageId);
    api.pinned = { message_id: messageId, document: { file_id: `file-${messageId}`, file_name: doc.file.filename } };
  };
  api.deleteMessage = async (chatId, messageId) => api.deleted.push(messageId);
  api.getChat = async () => ({ pinned_message: api.pinned });
  api.getFileLink = async fileId => new URL(`https://api.telegram.org/file/bot/${fileId}`);
  api.fetch = async url => {
    const text = api.files.get(String(url).split('/').at(-1));
    return { ok: text !== undefined, status: text === undefined ? 404 : 200, text: async () => text };
  };
  return api;
};
const enqueue = (queue, n, telegram, extra = {}) => {
  const url = `https://github.com/link-assistant/router/issues/${n}`;
  const item = queue.enqueue({ url, args: [url, '--tool', 'codex', '--model', 'gpt-5.5'], ctx: { telegram, chat: { id: -100777 }, message: { message_id: 10 + n }, from: { id: 42 } }, requester: '@konard', infoBlock: `URL: ${url}`, tool: 'codex', commandAlias: 'codex', locale: 'en', ...extra });
  item.messageInfo = { chatId: -100777, messageId: 20 + n, messageThreadId: null };
  queue.notifyStateChange('message', item);
  return item;
};

console.log('\n=== Legacy log lines (the incident) ===');
{
  // Shape of the lines the root container still had in `docker logs` on 2026-10-09.
  const text = [
    '[VERBOSE] /codex raw text: /codex https://github.com/link-foundation/browser-commander --model gpt-5.5',
    '[VERBOSE] /queue: Enqueued: [solve-1791492539982-n8kgdbr] https://github.com/link-foundation/browser-commander (queued) to codex queue, queue length: 1',
    '[VERBOSE] /solve raw text: /solve https://github.com/link-assistant/hive-mind/issues/2699 --isolation docker',
    '[VERBOSE] /queue: Enqueued: [solve-1791526466113-41nl0e9] https://github.com/link-assistant/hive-mind/issues/2699 (queued) to claude queue, queue length: 1',
    '[VERBOSE] /queue: Enqueued: [solve-1791494095851-qjpmzhb] https://github.com/linksplatform/doublets-rs/issues/64 (queued) to codex queue, queue length: 2',
    '[VERBOSE] /queue: Enqueued: [solve-1791494108332-ac6u3ni] https://github.com/linksplatform/doublets-rs/issues/65 (queued) to codex queue, queue length: 3',
    '[VERBOSE] /queue: Starting: [solve-1791494108332-ac6u3ni] https://github.com/linksplatform/doublets-rs/issues/65 (starting) from codex queue',
    '[VERBOSE] /queue: Finished: [solve-1791494108332-ac6u3ni] https://github.com/linksplatform/doublets-rs/issues/65 (started)',
    '[VERBOSE] /queue: Starting: [solve-1791494095851-qjpmzhb] https://github.com/linksplatform/doublets-rs/issues/64 (starting) from codex queue',
    '[VERBOSE] /queue: Cancelled queued item: [solve-1791494114726-xtfo3d8] https://github.com/linksplatform/doublets-rs/issues/66 (queued) from codex queue',
    '[VERBOSE] /queue: Enqueued: [solve-1791494114726-xtfo3d8] https://github.com/linksplatform/doublets-rs/issues/66 (queued) to codex queue, queue length: 4',
  ].join('\n');
  const loaded = queueFromLogState(foldQueueLog(text), { now: new Date('2026-10-09T13:31:00Z') });
  const ids = loaded.items.map(r => r.id);
  assert(ids.join() === 'solve-1791492539982-n8kgdbr,solve-1791494095851-qjpmzhb,solve-1791526466113-41nl0e9', 'pending items are recovered in creation order; finished and cancelled ones are not');
  const commander = loaded.items[0];
  assert(commander.args.join(' ') === 'https://github.com/link-foundation/browser-commander --model gpt-5.5 --tool codex', 'the original command text gives back the full args');
  assert(loaded.items[1].status === 'starting' && loaded.items[1].args.join(' ').endsWith('--tool codex'), 'an item that was starting is recovered as starting (args from the queue line)');
  assert(loaded.items[2].tool === 'claude' && loaded.items[2].perCommandIsolation === 'docker', 'per-command isolation is taken out of the args');
  assert(commander.createdAt === timeFromItemId(commander.id) && commander.createdAt === '2026-10-08T20:48:59.982Z', 'creation time comes from the item id');
  assert(loaded.header.lastStartTimeByTool.codex, 'start-interval state is rebuilt from Starting lines');
  const old = queueFromLogState(foldQueueLog(text), { now: new Date('2026-10-30T00:00:00Z') });
  assert(old.items.length === 0, 'items older than a week are not restored');
  assert(argsFromCommandText('/solve https://github.com/a/b/issues/1', 'https://github.com/a/b/issues/1', 'claude').args.join(' ') === 'https://github.com/a/b/issues/1', 'claude items get no --tool flag');
}

console.log('\n=== Structured events in the bot log ===');
{
  const logDir = tmpDir();
  const stateDir = tmpDir();
  const telegram = fakeTelegram();
  const logger = createBotLogger({ dir: logDir, mirrorConsole: false });
  const queue = newQueue();
  const persistence = createSolveQueuePersistence({ dir: stateDir, clinkPath: false, logger });
  persistence.attach(queue);
  const a = enqueue(queue, 1, telegram);
  const b = enqueue(queue, 2, telegram);
  enqueue(queue, 3, telegram);
  queue.cancel(b.id);
  a.assignSessionId('uuid-a', 'docker');
  await persistence.flush();
  fs.appendFileSync(logger.filePath, '2026-10-09T12:11:39.000Z INFO  EVENT queue_item_enqueued {"id":"solve-cut-off","url":"https://github.com/x/y/iss'); // killed mid-write
  // Next process: the active log is rotated to a backup on startup.
  createBotLogger({ dir: logDir, mirrorConsole: false });
  const loaded = await loadQueueFromLogs({ logDir });
  assert(loaded.items.map(r => r.url.split('/').at(-1)).join() === '1,3', 'cancelled items are folded away and a cut-off line is ignored');
  const first = loaded.items[0];
  assert(first.chatId === -100777 && first.messageInfo.messageId === 21 && first.requesterUserId === 42 && first.sessionId === 'uuid-a' && first.isolationBackend === 'docker', 'events carry chat, card, requester and session ids');
  assert(first.args.join(' ').includes('--model gpt-5.5') && first.infoBlock === 'URL: https://github.com/link-assistant/router/issues/1', 'events carry full args and the info block');
}

console.log('\n=== Telegram backup: pinned .lino copy ===');
{
  const telegram = fakeTelegram();
  const timers = [];
  let clock = 0;
  const backup = createTelegramQueueBackup({ telegram, chatId: -100999, fetchImpl: telegram.fetch, minIntervalMs: 60000, now: () => clock, setTimer: fn => (timers.push(fn), { unref() {} }), clearTimer: () => timers.pop(), log: quiet });
  const queue = newQueue();
  enqueue(queue, 5, telegram);
  const doc1 = buildSolveQueueDocument(snapshotSolveQueue(queue), { revision: 1 });
  enqueue(queue, 6, telegram);
  const doc2 = buildSolveQueueDocument(snapshotSolveQueue(queue), { revision: 2 });
  backup.save(doc1);
  backup.save(doc2);
  assert(timers.length === 1, 'a burst of saves schedules one upload');
  await timers.shift()();
  assert(telegram.documents.length === 1 && telegram.documents[0].file.filename === QUEUE_BACKUP_FILE_NAME && telegram.documents[0].extra.caption.includes('revision 2'), 'only the newest revision is uploaded');
  assert(telegram.pins.join() === '5000' && telegram.documents[0].extra.disable_notification, 'the copy is pinned silently');
  clock = 1000;
  backup.save(doc1);
  await backup.flush();
  assert(telegram.documents.length === 2 && telegram.deleted.join() === '5000', 'flush uploads now and the previous copy is deleted');
  const restored = await createTelegramQueueBackup({ telegram, chatId: -100999, fetchImpl: telegram.fetch, log: quiet }).load();
  assert(restored.source === 'telegram' && restored.revision === 1 && JSON.stringify(restored.doc) === JSON.stringify(doc1), 'the pinned copy is read back');
  telegram.pinned = null;
  assert((await createTelegramQueueBackup({ telegram, chatId: -100999, fetchImpl: telegram.fetch, log: quiet }).load()).doc === null, 'no pinned copy loads nothing');
}

console.log('\n=== Bot launch: restore from the state volume, notify the chat ===');
{
  const stateDir = tmpDir();
  const telegram = fakeTelegram();
  const before = newQueue();
  const persistence = createSolveQueuePersistence({ dir: stateDir, clinkPath: false });
  persistence.attach(before);
  const [alive, lost, queued] = [enqueue(before, 11, telegram), enqueue(before, 12, telegram), enqueue(before, 10, telegram)];
  // The consumer starts the head of the queue: #11 is starting in a container
  // that is still alive, #12 never reached `$`, #10 is still queued.
  for (const item of [alive, lost]) {
    before.getToolQueue('codex').shift();
    item.setStarting();
    before.processing.set(item.id, item);
  }
  alive.assignSessionId('uuid-alive', 'docker');
  lost.assignSessionId('uuid-lost', 'docker');
  await persistence.flush();

  const after = newQueue();
  const tracked = [];
  let executorSet = false;
  const durability = createSolveQueueDurability({
    queue: after,
    telegram,
    stateDir,
    logDir: tmpDir(),
    env: {},
    clinkPath: false,
    log: quiet,
    ensureExecuteCallback: () => (executorSet = after.queues.codex.length === 0),
    reconciler: createSessionReconciler({ getTrackedSessionInfo: () => null, querySessionStatus: async id => ({ exists: id === 'uuid-alive', isolation: 'docker', status: 'executing' }), hasActiveSessionForUrlAsync: async () => ({ isActive: false }), trackSession: (name, info) => tracked.push([name, info]) }),
  });
  const summary = await durability.start();
  assert(executorSet, 'the executor is set before restored items can run');
  assert(summary.source === 'archive' && summary.requeued.length === 2 && summary.running.length === 1, 'two items are queued again and one is still running');
  assert(after.queues.codex.map(i => i.id).join() === [lost.id, queued.id].join(), 'restored items keep their order, the interrupted start first');
  assert(tracked.length === 1 && tracked[0][0] === 'uuid-alive' && tracked[0][1].chatId === -100777 && tracked[0][1].messageId === 31 && tracked[0][1].isolationBackend === 'docker', 'the running task is handed to the session monitor with its chat and card');
  assert(telegram.sent.length === 1 && telegram.sent[0].chatId === -100777, 'the chat is told once');
  const notice = telegram.sent[0].text;
  assert(notice.includes('restored') && notice.includes('Back in the queue: 2') && notice.includes('Still running: 1') && notice.includes('router/issues/12'), 'the notice lists what was restored');
  assert(telegram.sent[0].extra.parse_mode === undefined, 'the notice is plain text (URLs with underscores are safe)');
  assert((await durability.start()) === summary, 'restore runs once');
  await durability.flush();
  const saved = await createSolveQueuePersistence({ dir: stateDir, clinkPath: false }).load();
  assert(saved.items.length === 2 && saved.revision > 1, 'the restored queue is saved right away');
}

console.log('\n=== Bot launch: both stores lost, Telegram copy, then logs ===');
{
  const telegram = fakeTelegram();
  const queue = newQueue();
  enqueue(queue, 20, telegram);
  const doc = buildSolveQueueDocument(snapshotSolveQueue(queue), { revision: 9 });
  telegram.files.set('file-pinned', await documentToLino(doc));
  telegram.pinned = { message_id: 77, document: { file_id: 'file-pinned', file_name: QUEUE_BACKUP_FILE_NAME } };
  const stateDir = tmpDir();
  fs.writeFileSync(path.join(stateDir, 'solve-queue.links'), 'corrupt');
  fs.writeFileSync(path.join(stateDir, 'solve-queue.lino'), '(((');
  const backup = createTelegramQueueBackup({ telegram, chatId: -100999, fetchImpl: telegram.fetch, log: quiet });
  const fromTelegram = await createSolveQueueDurability({ queue: newQueue(), telegram, stateDir, backup, env: {}, clinkPath: false, notify: false, log: quiet }).start();
  assert(fromTelegram.source === 'telegram' && fromTelegram.requeued.length === 1, 'the pinned Telegram copy is used when the stores are unreadable');

  const logDir = tmpDir();
  const legacyLog = path.join(tmpDir(), 'docker-logs.txt');
  fs.writeFileSync(legacyLog, '[VERBOSE] /queue: Enqueued: [solve-1791539139024-ej3vmmv] https://github.com/yukakust/GPU/issues/3 (queued) to codex queue, queue length: 1\n');
  const fromLogs = await createSolveQueueDurability({ queue: newQueue(), telegram, stateDir: tmpDir(), logDir, env: { HIVE_MIND_QUEUE_RECOVERY_LOG: legacyLog }, clinkPath: false, notify: false, log: quiet, now: () => new Date('2026-10-09T13:31:00Z') }).start();
  assert(fromLogs.source === 'log' && fromLogs.requeued[0].record.url === 'https://github.com/yukakust/GPU/issues/3', 'a saved docker log (HIVE_MIND_QUEUE_RECOVERY_LOG) is the last resort');
}

console.log('\n=== Notices are grouped per chat and topic, in the item locale ===');
{
  const record = (id, chatId, threadId, locale) => ({ id, url: `https://github.com/a/b/issues/${id}`, tool: 'codex', chatId, messageInfo: { chatId, messageId: 1, messageThreadId: threadId }, locale });
  const notices = buildRestoreNotices({ source: 'archive', requeued: [{ record: record(1, -1, 5, 'ru') }, { record: record(2, -1, 5, 'ru') }, { record: record(3, -2, null, 'en') }], running: [], dropped: [{ record: record(4, -2, null, 'en') }] });
  assert(notices.length === 2 && notices[0].threadId === 5 && notices[0].text.includes('Возвращено в очередь: 2'), 'one Russian notice for the topic');
  assert(notices[1].text.includes('Not restored') && notices[1].text.includes('resend'), 'dropped items ask the user to resend');
  assert(buildRestoreNotices({ requeued: [{ record: { id: 'x', url: 'u' } }], running: [], dropped: [] }).length === 0, 'items without a chat are restored silently');
}

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
