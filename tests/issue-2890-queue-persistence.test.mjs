#!/usr/bin/env node
/**
 * Issue #2890: the solve queue survives a bot or root container restart.
 *
 * Covers:
 * - queue items serialize without the Telegram context and keep their chat
 * - a kill simulation: queue A persists, the process dies without a final
 *   flush, queue B loads the store, keeps the original order and starts every
 *   task once (a task that was starting and is already running is not started again)
 * - the triple storage: `queue.json`, the `queue.lino` projection and the
 *   link-cli (`clink`) doublets store, each able to restore the queue alone
 * - the bot log fallback (`queue_item_*` events and `Enqueued:`/`Starting:`/`raw text:` lines)
 * - the chat is told what was restored
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SolveQueue, QueueItemStatus } from '../src/telegram-solve-queue.lib.mjs';
import { buildQueueSnapshot, createSolveQueueStore, deserializeQueueRecord, QUEUE_STORE_FILES, serializeQueueItem } from '../src/solve-queue-store.lib.mjs';
import { decodeClinkProjection, encodeClinkProjection, encodeClinkValue, findClinkBinary } from '../src/solve-queue-clink.lib.mjs';
import { parseQueueLogText } from '../src/solve-queue-log-recovery.lib.mjs';
import { attachQueuePersistence, restoreSolveQueueOnLaunch } from '../src/solve-queue-restore.lib.mjs';
import { setupSolveQueueDurability } from '../src/solve-queue-bot-wiring.lib.mjs';

const CHAT = -1001234567890;
const OTHER_CHAT = -1009876543210;
const url = n => `https://github.com/link-assistant/hive-mind/issues/${n}`;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hive-2890-'));
}

function fakeCtx(chatId = CHAT, userId = 42, threadId = null) {
  return { telegram: { tag: 'old-process' }, chat: { id: chatId }, from: { id: userId }, message: { message_id: 1, message_thread_id: threadId } };
}

function newQueue(extra = {}) {
  return new SolveQueue({ autoStart: false, verbose: false, getRunningProcesses: async () => ({ count: 0 }), getRunningIsolatedSessions: async () => ({ count: 0, sessions: [], byTool: {} }), getTaskContainerSnapshot: async () => null, ...extra });
}

function quietLogger() {
  const events = [];
  return { events, event: (type, data) => events.push({ type, data }), info() {}, warn() {}, error() {}, debug() {} };
}

function enqueue(queue, n, { tool = 'claude', chatId = CHAT, messageId = 100 + n, createdAt } = {}) {
  const item = queue.enqueue({ url: url(n), args: [url(n), '--model', 'opus'], ctx: fakeCtx(chatId), requester: `@user${n}`, infoBlock: `Requested by: @user${n}\nURL: ${url(n)}`, tool, locale: 'en', commandAlias: tool === 'codex' ? 'codex' : 'solve' });
  if (createdAt) item.createdAt = new Date(createdAt);
  item.messageInfo = { chatId, messageId, messageThreadId: null };
  return item;
}

/** Move the head of a tool queue to STARTING the way runConsumer does, with a launch that never returns. */
function startHead(queue, tool) {
  const item = queue.getToolQueue(tool).shift();
  item.setStarting();
  queue.processing.set(item.id, item);
  queue.recordStart(tool);
  queue.stats.totalStarted++;
  queue.executeItem(item).catch(() => {});
  return item;
}

test('queue items serialize without the Telegram context and keep their chat', () => {
  const queue = newQueue();
  const item = enqueue(queue, 1, { tool: 'codex' });
  const record = serializeQueueItem(item);
  assert.equal(record.ctx, undefined);
  assert.equal(record.id, item.id);
  assert.equal(record.url, url(1));
  assert.deepEqual(record.args, [url(1), '--model', 'opus']);
  assert.equal(record.tool, 'codex');
  assert.equal(record.requester, '@user1');
  assert.equal(record.chatId, CHAT);
  assert.equal(record.requesterUserId, 42);
  assert.deepEqual(record.messageInfo, { chatId: CHAT, messageId: 101, messageThreadId: null });
  assert.equal(record.status, QueueItemStatus.QUEUED);
  assert.equal(typeof record.createdAt, 'string');
  const options = deserializeQueueRecord(record);
  assert.equal(options.createdAt.getTime(), item.createdAt.getTime());
  assert.equal(options.url, url(1));
});

test('kill simulation: a new queue restores the order and starts every task once', async () => {
  const dir = tempDir();
  const logger = quietLogger();
  const storeA = createSolveQueueStore({ dir, clink: false, logger, debounceMs: 1 });
  const queueA = newQueue({ executeCallback: () => new Promise(() => {}) });
  attachQueuePersistence(queueA, { store: storeA, logger });
  const base = Date.parse('2026-10-09T12:00:00Z');
  const a = enqueue(queueA, 1, { createdAt: base });
  const b = enqueue(queueA, 2, { createdAt: base + 1000 });
  const c = enqueue(queueA, 3, { tool: 'codex', createdAt: base + 2000 });
  const d = enqueue(queueA, 4, { createdAt: base + 3000, chatId: OTHER_CHAT });
  const e = enqueue(queueA, 5, { tool: 'codex', createdAt: base + 4000 });
  const running = startHead(queueA, 'claude'); // a: STARTING, its container came up before the crash
  const lost = startHead(queueA, 'codex'); // c: STARTING, the launch died with the bot
  assert.equal(running.id, a.id);
  assert.equal(lost.id, c.id);
  await storeA.flush();
  // SIGKILL: no exit handler, no final flushSync; only what the async writes put on disk survives.
  assert.ok(fs.existsSync(path.join(dir, QUEUE_STORE_FILES.json)));
  assert.ok(fs.existsSync(path.join(dir, QUEUE_STORE_FILES.lino)));
  assert.ok(logger.events.some(event => event.type === 'queue_item_enqueued' && event.data.id === b.id));
  assert.ok(logger.events.some(event => event.type === 'queue_item_starting' && event.data.id === c.id));

  const started = [];
  const notices = [];
  const queueB = newQueue();
  queueB.canStartCommand = async () => ({ canStart: true, reasons: [] });
  const telegram = { tag: 'new-process', sendMessage: async (chatId, text, options) => notices.push({ chatId, text, options }), editMessageText: async () => true };
  const storeB = createSolveQueueStore({ dir, clink: false, logger: quietLogger(), debounceMs: 1 });
  const result = await restoreSolveQueueOnLaunch({
    queue: queueB,
    store: storeB,
    telegram,
    ensureExecuteCallback: queue => {
      queue.executeCallback = async item => {
        started.push(item.url);
        return { success: true, sessionId: `session-${item.id}` };
      };
      return queue;
    },
    listSessions: async () => [{ uuid: 'abc', status: 'executing', command: `solve ${url(1)} --model opus` }],
    getContainerSnapshot: async () => null,
    hasActiveSessionForUrl: async () => false,
    logger: quietLogger(),
  });
  assert.equal(result.source, 'json');
  assert.deepEqual(
    queueB.getToolQueue('claude').map(item => item.id),
    [b.id, d.id]
  );
  assert.deepEqual(
    queueB.getToolQueue('codex').map(item => item.id),
    [c.id, e.id],
    'the interrupted launch goes back to the head of its queue'
  );
  assert.equal(result.alreadyRunning.length, 1);
  assert.equal(result.alreadyRunning[0].id, a.id);
  assert.equal(queueB.completed.length >= 1, true, 'the running task is listed as launched');
  const restoredB = queueB.getToolQueue('claude')[0];
  assert.equal(restoredB.createdAt.getTime(), base + 1000);
  assert.equal(restoredB.ctx.telegram, telegram);
  assert.equal(restoredB.ctx.chat.id, CHAT);
  assert.equal(restoredB.ctx.from.id, 42);
  assert.deepEqual(restoredB.messageInfo, { chatId: CHAT, messageId: 102, messageThreadId: null });
  assert.equal(queueB.lastStartTimeByTool.codex, queueA.lastStartTimeByTool.codex, 'the start-interval state survives');

  // Both chats hear what came back.
  assert.deepEqual(notices.map(notice => notice.chatId).sort(), [CHAT, OTHER_CHAT].sort());
  const mainNotice = notices.find(notice => notice.chatId === CHAT).text;
  assert.match(mainNotice, /issues\/2/);
  assert.match(mainNotice, /issues\/1/);

  // Restoring again (a second launch hook) adds nothing.
  const again = await restoreSolveQueueOnLaunch({ queue: queueB, store: storeB, telegram, ensureExecuteCallback: q => q, listSessions: async () => [], logger: quietLogger() });
  assert.equal(again.restored.length, 0);
  assert.equal(queueB.getTotalQueueLength(), 4);

  // Run the consumer until the queue drains: every task starts exactly once, the running one never.
  queueB.autoStart = true;
  queueB.sleep = () => new Promise(resolve => setTimeout(resolve, 5)); // the 60 s poll would keep the test alive
  queueB.ensureConsumerRunning();
  for (let i = 0; i < 400 && started.length < 4; i++) await new Promise(resolve => setTimeout(resolve, 25));
  queueB.stop();
  assert.deepEqual([...started].sort(), [url(2), url(3), url(4), url(5)].sort());
  assert.equal(new Set(started).size, started.length);
  assert.ok(!started.includes(url(1)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a starting task found by its container or a tracked session is not started again', async () => {
  const dir = tempDir();
  const storeA = createSolveQueueStore({ dir, clink: false, debounceMs: 1 });
  const queueA = newQueue({ executeCallback: () => new Promise(() => {}) });
  attachQueuePersistence(queueA, { store: storeA });
  enqueue(queueA, 7);
  enqueue(queueA, 8, { tool: 'codex' });
  startHead(queueA, 'claude');
  startHead(queueA, 'codex');
  storeA.flushSync();
  const queueB = newQueue();
  const result = await restoreSolveQueueOnLaunch({
    queue: queueB,
    store: createSolveQueueStore({ dir, clink: false }),
    telegram: { sendMessage: async () => {} },
    ensureExecuteCallback: q => q,
    listSessions: async () => [],
    getContainerSnapshot: async () => ({ containers: [{ name: 'c1', url: url(7), tool: 'claude' }] }),
    hasActiveSessionForUrl: async target => target === url(8),
  });
  assert.equal(result.alreadyRunning.length, 2);
  assert.equal(queueB.getTotalQueueLength(), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the .lino projection restores the queue when queue.json is corrupt', async () => {
  const dir = tempDir();
  const store = createSolveQueueStore({ dir, clink: false, debounceMs: 1 });
  const queue = newQueue();
  attachQueuePersistence(queue, { store });
  const first = enqueue(queue, 11);
  const second = enqueue(queue, 12, { tool: 'codex' });
  first.infoBlock = `multi-line\n*markdown* "quotes" it's \\ backslash`;
  store.flushSync();
  const lino = fs.readFileSync(path.join(dir, QUEUE_STORE_FILES.lino), 'utf8');
  assert.match(lino, /issues\/11/);
  fs.writeFileSync(path.join(dir, QUEUE_STORE_FILES.json), '{"version":1,"queues":');
  const loaded = await createSolveQueueStore({ dir, clink: false }).load();
  assert.equal(loaded.source, 'lino');
  assert.equal(loaded.snapshot.queues.claude[0].id, first.id);
  assert.equal(loaded.snapshot.queues.claude[0].infoBlock, first.infoBlock);
  assert.equal(loaded.snapshot.queues.codex[0].id, second.id);
  assert.ok(loaded.errors.some(error => /json/i.test(error)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the writes are atomic and leave no temporary files', async () => {
  const dir = tempDir();
  const store = createSolveQueueStore({ dir, clink: false, debounceMs: 1 });
  const queue = newQueue();
  attachQueuePersistence(queue, { store });
  for (let n = 20; n < 30; n++) enqueue(queue, n);
  await store.flush();
  const names = fs.readdirSync(dir);
  assert.deepEqual(
    names.filter(name => name.includes('.tmp')),
    []
  );
  const json = JSON.parse(fs.readFileSync(path.join(dir, QUEUE_STORE_FILES.json), 'utf8'));
  assert.equal(json.version, 1);
  assert.equal(json.queues.claude.length, 10);
  assert.equal(json.queues.claude[9].url, url(29));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cancel and launch outcomes reach the store', async () => {
  const dir = tempDir();
  const store = createSolveQueueStore({ dir, clink: false, debounceMs: 1 });
  const queue = newQueue({ executeCallback: async () => ({ success: true, sessionId: 'session-x' }) });
  attachQueuePersistence(queue, { store });
  const keep = enqueue(queue, 31);
  const drop = enqueue(queue, 32);
  assert.equal(queue.cancel(drop.id), true);
  const item = queue.getToolQueue('claude').shift();
  item.setStarting();
  queue.processing.set(item.id, item);
  await queue.executeItem(item);
  await store.flush();
  const json = JSON.parse(fs.readFileSync(path.join(dir, QUEUE_STORE_FILES.json), 'utf8'));
  assert.equal(json.queues.claude.length, 0);
  assert.equal(json.processing.length, 0);
  assert.equal(json.completed.at(-1).id, keep.id);
  assert.equal(json.completed.at(-1).sessionName, 'session-x');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the clink doublet projection round-trips a snapshot', () => {
  const queue = newQueue();
  const first = enqueue(queue, 41);
  first.infoBlock = `line 1\nline 2 with 'single' and "double" quotes and a \\ backslash`;
  enqueue(queue, 42, { tool: 'codex' });
  const snapshot = buildQueueSnapshot(queue, () => new Date('2026-10-09T12:00:00Z'));
  const projection = encodeClinkProjection(snapshot);
  assert.match(projection, /\(pending_0\.url: pending_0 'https:\/\/github\.com\/link-assistant\/hive-mind\/issues\/41'\)/);
  assert.match(projection, /\(pending_1\.tool: pending_1 'codex'\)/);
  assert.doesNotMatch(projection, /\\/, 'clink treats a backslash as an escape, so none is written');
  // `clink --export` lists every value as a self-referencing point link too.
  const exported = projection + "\n('codex': 'codex' 'codex')\n(pending_0: pending_0 pending_0)\n";
  const decoded = decodeClinkProjection(exported);
  assert.deepEqual(decoded, JSON.parse(JSON.stringify(snapshot)));
  assert.equal(encodeClinkValue('plain'), "'plain'");
  assert.equal(encodeClinkValue("it's"), `"it's"`);
  assert.match(encodeClinkValue('a\\b'), /^'b64:/);
});

test('the link-cli database restores the queue when both text stores are gone', { skip: findClinkBinary() ? false : 'clink is not installed' }, async () => {
  const dir = tempDir();
  const store = createSolveQueueStore({ dir, clink: true, debounceMs: 1, clinkIntervalMs: 0 });
  const queue = newQueue();
  attachQueuePersistence(queue, { store });
  const first = enqueue(queue, 51);
  enqueue(queue, 52, { tool: 'codex' });
  await store.flush();
  await store.flushClink();
  assert.ok(fs.existsSync(path.join(dir, QUEUE_STORE_FILES.clinkDb)));
  fs.rmSync(path.join(dir, QUEUE_STORE_FILES.json));
  fs.rmSync(path.join(dir, QUEUE_STORE_FILES.lino));
  const loaded = await createSolveQueueStore({ dir, clink: true }).load();
  assert.equal(loaded.source, 'clink');
  assert.equal(loaded.snapshot.queues.claude[0].id, first.id);
  assert.equal(loaded.snapshot.queues.codex[0].url, url(52));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the bot log rebuilds the queue when every store is missing', async () => {
  const queue = newQueue();
  const logger = quietLogger();
  attachQueuePersistence(queue, { store: null, logger });
  const kept = enqueue(queue, 61);
  const launched = enqueue(queue, 62);
  enqueue(queue, 63, { tool: 'codex' });
  queue.cancel(queue.getToolQueue('codex')[0].id);
  const item = queue.getToolQueue('claude').splice(1, 1)[0];
  item.setStarting();
  queue.processing.set(item.id, item);
  queue.executeCallback = async () => ({ success: true, sessionId: 'session-62' });
  await queue.executeItem(item);
  const eventLines = logger.events.map((event, index) => `2026-10-09T12:00:${String(index).padStart(2, '0')}.000Z INFO  EVENT ${event.type} ${JSON.stringify(event.data)}`);
  const legacy = ['[VERBOSE] /codex raw text: /codex https://github.com/link-foundation/use-m/issues/78 --model gpt-5', '[VERBOSE] /queue: Enqueued: [solve-1791495099045-rka7oj6] https://github.com/link-foundation/use-m/issues/78 (queued) to codex queue, queue length: 1', '[VERBOSE] /queue: Enqueued: [solve-1791495106313-ol333y5] https://github.com/link-foundation/use-m/issues/79 (queued) to codex queue, queue length: 2', '[VERBOSE] /queue: Starting: [solve-1791495106313-ol333y5] https://github.com/link-foundation/use-m/issues/79 (starting) from codex queue'];
  const snapshot = parseQueueLogText([...eventLines, ...legacy].join('\n'));
  assert.deepEqual(
    snapshot.queues.claude.map(record => record.id),
    [kept.id]
  );
  assert.equal(snapshot.queues.claude[0].chatId, CHAT);
  assert.deepEqual(snapshot.queues.claude[0].messageInfo, { chatId: CHAT, messageId: 161, messageThreadId: null });
  assert.ok(!JSON.stringify(snapshot).includes(launched.id) || snapshot.completed.some(record => record.id === launched.id));
  assert.equal(snapshot.queues.codex.length, 1);
  assert.equal(snapshot.queues.codex[0].id, 'solve-1791495099045-rka7oj6');
  assert.deepEqual(snapshot.queues.codex[0].args, ['https://github.com/link-foundation/use-m/issues/78', '--model', 'gpt-5', '--tool', 'codex']);
  assert.equal(snapshot.processing.length, 1);
  assert.equal(snapshot.processing[0].url, 'https://github.com/link-foundation/use-m/issues/79');

  // Wired through the store: no json, no lino, no clink, a log file on disk.
  const dir = tempDir();
  const logDir = tempDir();
  fs.writeFileSync(path.join(logDir, 'telegram-bot-2026-10-09T12-30-00-000Z.log'), eventLines.join('\n') + '\n');
  fs.writeFileSync(path.join(logDir, 'telegram-bot.log'), '2026-10-09T13:31:00.000Z INFO  EVENT bot_starting {}\n');
  const loaded = await createSolveQueueStore({ dir, clink: false, logDir }).load();
  assert.equal(loaded.source, 'log');
  assert.deepEqual(
    loaded.snapshot.queues.claude.map(record => record.id),
    [kept.id]
  );
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(logDir, { recursive: true, force: true });
});

test('an empty saved queue is trusted and the log is not replayed', async () => {
  const dir = tempDir();
  const logDir = tempDir();
  const store = createSolveQueueStore({ dir, clink: false, logDir });
  store.save(buildQueueSnapshot(newQueue()));
  await store.flush();
  fs.writeFileSync(path.join(logDir, 'telegram-bot.log'), `2026-10-09T12:00:00.000Z INFO  EVENT queue_item_enqueued ${JSON.stringify({ id: 'solve-1-a', url: url(70), tool: 'claude', args: [url(70)] })}\n`);
  const loaded = await createSolveQueueStore({ dir, clink: false, logDir }).load();
  assert.equal(loaded.source, 'json');
  assert.equal(loaded.snapshot.queues.claude?.length || 0, 0);
  const nothing = await createSolveQueueStore({ dir: tempDir(), clink: false, logDir: tempDir() }).load();
  assert.equal(nothing.source, null);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(logDir, { recursive: true, force: true });
});

test('the bot wiring persists the queue, restores it once and never throws on launch', async () => {
  const dir = tempDir();
  const store = createSolveQueueStore({ dir, clink: false, debounceMs: 1 });
  const queueA = newQueue();
  let built = 0;
  const wiring = setupSolveQueueDurability({ getSolveQueue: () => queueA, createExecuteCallback: () => (built++, async () => ({ success: true })), isolationBackend: 'screen', store, logger: quietLogger() });
  assert.equal(wiring.queue, queueA);
  const callback = wiring.ensureExecuteCallback(queueA);
  assert.equal(typeof callback, 'function');
  assert.equal(wiring.ensureExecuteCallback(queueA), callback, 'the callback is built once');
  assert.equal(built, 1);
  assert.equal(wiring.startAdoption(), null, 'container adoption runs only under docker isolation');
  enqueue(queueA, 80);
  await store.flush();
  wiring.flushSync();

  const queueB = newQueue();
  const wiringB = setupSolveQueueDurability({ getSolveQueue: () => queueB, createExecuteCallback: () => async () => ({ success: true }), isolationBackend: 'screen', store: createSolveQueueStore({ dir, clink: false, debounceMs: 1 }), logger: quietLogger() });
  const result = await wiringB.restoreOnLaunch(null);
  assert.deepEqual(
    queueB.getToolQueue('claude').map(item => item.url),
    [url(80)]
  );
  assert.equal(typeof queueB.executeCallback, 'function');
  assert.equal(result.restored.length, 1);

  const failing = setupSolveQueueDurability({ getSolveQueue: () => newQueue(), isolationBackend: 'screen', store: { load: async () => Promise.reject(new Error('disk gone')), save() {}, flush: async () => {}, flushSync() {} }, logger: quietLogger() });
  const failed = await failing.restoreOnLaunch(null);
  assert.deepEqual(failed?.errors || [], ['disk gone'], 'a broken store is reported, the launch goes on');
  wiringB.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});
