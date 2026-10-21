/**
 * Issue #2890: keep the solve queue across a bot or root container restart.
 *
 * attachQueuePersistence() hooks a SolveQueue instance so every change
 * (enqueue, the message id the bot edits, cancel, start, launch result,
 * rejection, session outcome) is saved to the durable store and logged as an
 * `EVENT queue_item_*` line, the log being the last fallback.
 *
 * restoreSolveQueueOnLaunch() runs once the bot is up again: it loads the
 * stored queue, checks the items that were starting against `$ --list`, the
 * running task containers and the tracked sessions (so a task whose container
 * is already running is not started twice), puts every other item back in its
 * original order with a stand-in Telegram context, restores the start-interval
 * state and tells each chat what came back.
 *
 * Both work on the queue from the outside, so SolveQueue itself stays as it was.
 */

import { SolveQueueItem, QueueItemStatus } from './telegram-solve-queue.lib.mjs';
import { buildQueueSnapshot, deserializeQueueRecord, QUEUE_ITEM_FIELDS, serializeQueueItem } from './solve-queue-store.lib.mjs';
import { canonicalizeGitHubUrl } from './github-url-parser.lib.mjs';
import { RUNNING_SESSION_STATUSES } from './session-status.lib.mjs';
import { t } from './i18n.lib.mjs';

const PERSISTENCE = Symbol.for('hive-mind.solveQueue.persistence');
const RESTORED = Symbol.for('hive-mind.solveQueue.restored');
// Items listed by name in a restore notice; the rest are counted.
export const RESTORE_NOTICE_ITEM_LIMIT = 15;
// Fields that only describe the live item (the stand-in ctx carries the chat).
const NOT_ITEM_FIELDS = new Set(['chatId', 'messageThreadId']);

function safeCall(fn, ...args) {
  try {
    return fn?.(...args);
  } catch {
    return undefined;
  }
}

function persistenceOf(queue) {
  return queue?.[PERSISTENCE] || null;
}

/**
 * Save the queue and log its changes. Idempotent per queue.
 *
 * @param {object} queue - SolveQueue
 * @param {object} [options]
 * @param {object|null} [options.store] - From createSolveQueueStore(); null logs only.
 * @param {object|null} [options.logger] - Bot logger (`event(type, data)`).
 * @returns {object} The queue.
 */
export function attachQueuePersistence(queue, { store = null, logger = null } = {}) {
  if (!queue || persistenceOf(queue)) return queue;
  const emit = (type, data) => safeCall(() => logger?.event?.(type, data));
  const persist = () => safeCall(() => store?.save(() => buildQueueSnapshot(queue)));
  // The bot sets `messageInfo` right after enqueue(); without it a restored item could not edit its card.
  const watchItem = item => {
    if (!item || Object.getOwnPropertyDescriptor(item, 'messageInfo')?.get) return item;
    let value = item.messageInfo;
    Object.defineProperty(item, 'messageInfo', {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: next => {
        const changed = Boolean(next) && (!value || value.chatId !== next.chatId || value.messageId !== next.messageId);
        value = next;
        if (!changed) return;
        emit('queue_item_message', { id: item.id, chatId: next.chatId ?? null, messageInfo: next });
        persist();
      },
    });
    return item;
  };
  queue[PERSISTENCE] = { store, logger, emit, persist, watchItem };

  const { enqueue, cancel, executeItem, rejectAllItemsInQueue, recordSessionCompletion } = queue;
  queue.enqueue = function enqueueAndPersist(options) {
    const item = watchItem(enqueue.call(this, options));
    emit('queue_item_enqueued', serializeQueueItem(item));
    persist();
    return item;
  };
  queue.cancel = function cancelAndPersist(id) {
    const cancelled = cancel.call(this, id);
    if (cancelled) {
      emit('queue_item_cancelled', { id });
      persist();
    }
    return cancelled;
  };
  queue.executeItem = async function executeAndPersist(item) {
    emit('queue_item_starting', { id: item.id, url: item.url, tool: item.tool, status: item.status, startedAt: item.startedAt });
    persist();
    try {
      return await executeItem.call(this, item);
    } finally {
      emit('queue_item_finished', { id: item.id, status: item.status, sessionName: item.sessionName || null, error: item.error || null });
      persist();
    }
  };
  queue.rejectAllItemsInQueue = async function rejectAndPersist(tool, toolQueue, rejectReason) {
    const items = [...(toolQueue || [])];
    try {
      return await rejectAllItemsInQueue.call(this, tool, toolQueue, rejectReason);
    } finally {
      for (const item of items) if (item.status === QueueItemStatus.FAILED) emit('queue_item_finished', { id: item.id, status: item.status, sessionName: null, error: item.error || null });
      persist();
    }
  };
  queue.recordSessionCompletion = function recordAndPersist(event) {
    const item = recordSessionCompletion.call(this, event);
    if (item) persist();
    return item;
  };
  return queue;
}

const sameUrl = (a, b) => Boolean(a && b) && canonicalizeGitHubUrl(String(a)).replace(/\/+$/, '').toLowerCase() === canonicalizeGitHubUrl(String(b)).replace(/\/+$/, '').toLowerCase();

function commandMentionsUrl(command, url) {
  if (!command || !url) return false;
  return String(command)
    .split(/[\s'"]+/)
    .some(token => /^https?:\/\//.test(token) && sameUrl(token, url));
}

function sessionMatches(session, record) {
  if (!session || !RUNNING_SESSION_STATUSES.has(String(session.status || '').toLowerCase())) return false;
  const names = [record.sessionName].filter(name => name && name !== 'unknown');
  if (names.some(name => name === session.uuid || name === session.sessionName)) return true;
  return commandMentionsUrl(session.command, record.url);
}

/**
 * Find what an item that was starting left running, if anything.
 * @returns {Promise<{source: string, sessionName: string|null}|null>}
 */
async function findRunningEvidence(record, { sessions, containers, hasActiveSessionForUrl }) {
  const session = sessions.find(candidate => sessionMatches(candidate, record));
  if (session) return { source: 'session-list', sessionName: session.sessionName || session.uuid || null };
  const container = containers.find(candidate => sameUrl(candidate?.url, record.url) && (!candidate.tool || candidate.tool === (record.tool || 'claude')));
  if (container) return { source: 'container', sessionName: container.trackedSessionName || container.scSession || container.session || container.name || null };
  if (hasActiveSessionForUrl) {
    try {
      if (await hasActiveSessionForUrl(record.url)) return { source: 'tracked-session', sessionName: record.sessionName || null };
    } catch {
      // An unknown answer is not proof that the task runs.
    }
  }
  return null;
}

/**
 * The stand-in Telegraf context a restored item edits its message through.
 * @param {object} record - Stored item.
 * @param {object|null} telegram - `bot.telegram` of the new process.
 */
export function buildRestoredContext(record, telegram) {
  const chatId = record.chatId ?? record.messageInfo?.chatId ?? null;
  const threadId = record.messageThreadId ?? record.messageInfo?.messageThreadId ?? null;
  return { telegram, chat: chatId === null ? null : { id: chatId }, from: record.requesterUserId === null || record.requesterUserId === undefined ? null : { id: record.requesterUserId }, message: { message_thread_id: threadId ?? undefined }, restored: true };
}

/**
 * Rebuild a SolveQueueItem from its stored record, keeping its id and timestamps.
 * @param {object} record
 * @param {object|null} telegram
 * @returns {SolveQueueItem}
 */
export function restoreQueueItem(record, telegram) {
  const fields = deserializeQueueRecord(record);
  const ctx = buildRestoredContext(record, telegram);
  const item = new SolveQueueItem({ ...fields, ctx });
  for (const field of QUEUE_ITEM_FIELDS) {
    if (NOT_ITEM_FIELDS.has(field) || fields[field] === undefined) continue;
    item[field] = fields[field];
  }
  item.ctx = ctx;
  return item;
}

function collectKnownIds(queue) {
  const ids = new Set();
  for (const items of Object.values(queue.queues || {})) for (const item of items) ids.add(item.id);
  for (const id of queue.processing?.keys?.() || []) ids.add(id);
  for (const item of [...(queue.completed || []), ...(queue.failed || [])]) ids.add(item.id);
  return ids;
}

function formatRestoreNotice(entries, { source, locale }) {
  const queued = entries.filter(entry => entry.kind === 'queued');
  const running = entries.filter(entry => entry.kind === 'running');
  const line = entry => `• ${entry.item.url} (${entry.item.tool})`;
  const list = items => {
    const shown = items.slice(0, RESTORE_NOTICE_ITEM_LIMIT).map(line);
    if (items.length > RESTORE_NOTICE_ITEM_LIMIT) shown.push(t('telegram.queue_restored_more', { count: items.length - RESTORE_NOTICE_ITEM_LIMIT }, { locale }));
    return shown.join('\n');
  };
  const parts = [];
  if (queued.length > 0) parts.push(`${t('telegram.queue_restored_title', { count: queued.length, source }, { locale })}\n${list(queued)}`);
  if (running.length > 0) parts.push(`${t('telegram.queue_restored_running', { count: running.length }, { locale })}\n${list(running)}`);
  return parts.join('\n\n');
}

async function notifyChats(entries, { telegram, source, log }) {
  const byChat = new Map();
  for (const entry of entries) {
    const chatId = entry.item.ctx?.chat?.id ?? entry.item.messageInfo?.chatId ?? null;
    if (chatId === null || chatId === undefined) continue;
    if (!byChat.has(chatId)) byChat.set(chatId, []);
    byChat.get(chatId).push(entry);
  }
  const sent = [];
  for (const [chatId, chatEntries] of byChat) {
    const locale = chatEntries.find(entry => entry.item.locale)?.item.locale || null;
    const text = formatRestoreNotice(chatEntries, { source, locale });
    const threadId = chatEntries.find(entry => entry.item.ctx?.message?.message_thread_id)?.item.ctx.message.message_thread_id;
    try {
      // Plain text: URLs and tool names must not be parsed as Markdown.
      await telegram.sendMessage(chatId, text, threadId ? { message_thread_id: threadId } : {});
      sent.push(chatId);
    } catch (error) {
      log('warn', `Could not tell chat ${chatId} that the solve queue was restored: ${error.message}`, { chatId, text });
    }
  }
  return sent;
}

/**
 * Restore the stored solve queue into a fresh SolveQueue (bot launch).
 *
 * @param {object} options
 * @param {object} options.queue - SolveQueue of this process.
 * @param {object|null} options.store - From createSolveQueueStore().
 * @param {object|null} [options.telegram] - `bot.telegram` (edits and notices).
 * @param {Function|null} [options.ensureExecuteCallback] - Sets `queue.executeCallback` before items can start.
 * @param {Function|null} [options.listSessions] - `$ --list` records.
 * @param {Function|null} [options.getContainerSnapshot] - Running task containers ({containers}).
 * @param {Function|null} [options.hasActiveSessionForUrl] - Tracked session lookup.
 * @param {boolean} [options.notify=true] - Tell each chat what came back.
 * @param {object|null} [options.logger] - Bot logger.
 * @returns {Promise<{source: string|null, restored: object[], alreadyRunning: object[], skipped: string[], notified: Array, errors: string[]}>}
 */
export async function restoreSolveQueueOnLaunch({ queue, store, telegram = null, ensureExecuteCallback = null, listSessions = null, getContainerSnapshot = null, hasActiveSessionForUrl = null, notify = true, logger = null, verbose = false } = {}) {
  const log = (level, message, meta) => {
    if (logger && typeof logger[level] === 'function') logger[level](message, meta);
    else if (verbose) console.log(`[VERBOSE] /queue restore: ${message}`);
  };
  const result = { source: null, restored: [], alreadyRunning: [], skipped: [], notified: [], errors: [] };
  if (!queue || !store) return result;
  let loaded;
  try {
    loaded = await store.load();
  } catch (error) {
    result.errors.push(error.message);
    log('error', `Could not load the stored solve queue: ${error.message}`);
    return result;
  }
  result.source = loaded?.source || null;
  result.errors.push(...(loaded?.errors || []));
  const snapshot = loaded?.snapshot;
  if (!snapshot) return result;
  if (ensureExecuteCallback) {
    try {
      await ensureExecuteCallback(queue);
    } catch (error) {
      log('error', `Could not prepare the queue launcher: ${error.message}`);
    }
  }

  const known = collectKnownIds(queue);
  const fresh = record => {
    if (!record?.id || !record.url || known.has(record.id)) {
      if (record?.id) result.skipped.push(record.id);
      return false;
    }
    known.add(record.id);
    return true;
  };
  const watchItem = persistenceOf(queue)?.watchItem || (item => item);
  const processing = (snapshot.processing || []).filter(fresh);
  let sessions = [];
  let containers = [];
  if (processing.length > 0) {
    try {
      sessions = (await listSessions?.()) || [];
    } catch (error) {
      log('warn', `$ --list failed during queue restore: ${error.message}`);
    }
    try {
      containers = (await getContainerSnapshot?.())?.containers || [];
    } catch (error) {
      log('warn', `Task container listing failed during queue restore: ${error.message}`);
    }
  }

  // History and start pacing only from the first restore into this queue.
  if (!queue[RESTORED]) {
    queue[RESTORED] = true;
    for (const [list, records] of [
      [queue.completed, snapshot.completed],
      [queue.failed, snapshot.failed],
    ]) {
      for (const record of (records || []).filter(fresh)) list.push(restoreQueueItem(record, telegram));
    }
    const latest = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? Math.max(a, b) : Number.isFinite(a) ? a : Number.isFinite(b) ? b : null);
    queue.lastStartTime = latest(queue.lastStartTime, snapshot.lastStartTime);
    for (const [tool, value] of Object.entries(snapshot.lastStartTimeByTool || {})) queue.lastStartTimeByTool[tool] = latest(queue.lastStartTimeByTool[tool], value);
    if (snapshot.stats && typeof snapshot.stats === 'object') {
      for (const [key, value] of Object.entries(snapshot.stats)) {
        if (typeof value === 'number') queue.stats[key] = (queue.stats[key] || 0) + value;
        else if (key === 'throttleReasons' && value && typeof value === 'object') for (const [reason, count] of Object.entries(value)) queue.stats.throttleReasons[reason] = (queue.stats.throttleReasons[reason] || 0) + (Number(count) || 0);
      }
    }
  }

  const entries = [];
  const headByTool = {};
  for (const record of [...processing].sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))) {
    const evidence = await findRunningEvidence(record, { sessions: Array.isArray(sessions) ? sessions : [], containers, hasActiveSessionForUrl });
    const item = watchItem(restoreQueueItem(record, telegram));
    if (evidence) {
      // Already running: list it as launched so its completion is matched, never start it again.
      item.status = QueueItemStatus.STARTED;
      item.sessionName = evidence.sessionName || item.sessionName || null;
      item.messageInfo = null;
      queue.completed.push(item);
      result.alreadyRunning.push({ id: item.id, url: item.url, tool: item.tool, evidence: evidence.source, sessionName: item.sessionName });
      entries.push({ kind: 'running', item });
      log('info', `Queue restore: ${item.toString()} is already running (${evidence.source}), not starting it again`);
      continue;
    }
    // The launch died with the old process: back to the head of its queue.
    item.status = QueueItemStatus.QUEUED;
    item.startedAt = null;
    (headByTool[item.tool] ||= []).push(item);
  }
  const pendingByTool = {};
  for (const [tool, records] of Object.entries(snapshot.queues || {})) {
    for (const record of records.filter(fresh)) {
      const item = watchItem(restoreQueueItem(record, telegram));
      if (item.status !== QueueItemStatus.WAITING) item.status = QueueItemStatus.QUEUED;
      (pendingByTool[item.tool || tool] ||= []).push(item);
    }
  }
  for (const tool of new Set([...Object.keys(headByTool), ...Object.keys(pendingByTool)])) {
    const items = [...(headByTool[tool] || []), ...(pendingByTool[tool] || [])];
    queue.getToolQueue(tool).push(...items);
    for (const item of items) {
      result.restored.push({ id: item.id, url: item.url, tool: item.tool });
      entries.push({ kind: 'queued', item });
    }
  }

  safeCall(() => logger?.event?.('queue_restored', { source: result.source, restored: result.restored.length, alreadyRunning: result.alreadyRunning.length, skipped: result.skipped.length }));
  if (entries.length > 0) {
    log('info', `Solve queue restored from ${result.source}: ${result.restored.length} queued, ${result.alreadyRunning.length} already running`);
    if (notify && telegram?.sendMessage) result.notified = await notifyChats(entries, { telegram, source: result.source, log });
    try {
      store.save(() => buildQueueSnapshot(queue));
      await store.flush?.();
    } catch (error) {
      log('warn', `Could not save the restored solve queue: ${error.message}`);
    }
    if (queue.autoStart && result.restored.length > 0) queue.ensureConsumerRunning();
  }
  return result;
}
