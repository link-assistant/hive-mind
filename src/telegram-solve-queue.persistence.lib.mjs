#!/usr/bin/env node
/**
 * Durable solve queue: snapshots of the queued and starting items, the start
 * interval timestamps and the statistics are kept in the links triple store
 * (link-cli store archive, `.lino` projection, link-cli database), so a killed
 * bot or container continues the queue after a restart.
 *
 * Document shape (one `.lino` line per link):
 *
 *   (solve-queue (version 1) (revision 12) (savedAt 2026-10-09T12:11:00.000Z) (pid 41) …)
 *   (solve-1791492539982-n8kgdbr: (tool codex) (status queued) (url https://…) (args https://… --model gpt-5.5) …)
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 */

import path from 'node:path';
import { createLinksTripleStore } from './solve-queue-store.lib.mjs';
import { canonicalizeGitHubUrl } from './github-url-parser.lib.mjs';

export const SOLVE_QUEUE_DOCUMENT_KIND = 'solve-queue';
export const SOLVE_QUEUE_DOCUMENT_VERSION = 1;
/** A task that crashed the bot on every restore is dropped after this many restores. */
export const DEFAULT_MAX_RESTORES = 3;

const P = (...values) => ({ id: null, values });
const L = (id, ...values) => ({ id, values });
const isLink = value => value !== null && typeof value === 'object' && Array.isArray(value.values);

// ---------------------------------------------------------------------------
// Generic JSON <-> links (for nested fields such as urlContext)
// ---------------------------------------------------------------------------

/**
 * Encode a JSON value as links: strings are leaves, everything else is tagged
 * so it reads back with its type: `(number 5)`, `(boolean true)`, `(null)`,
 * `(array …)` and `(object (key value) …)`.
 */
export function encodeJsonValue(value) {
  if (value === null || value === undefined) return P('null');
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? P('number', String(value)) : P('null');
  if (typeof value === 'boolean') return P('boolean', String(value));
  if (typeof value === 'bigint') return P('number', value.toString());
  if (Array.isArray(value)) return P('array', ...value.map(encodeJsonValue));
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? P('null') : value.toISOString();
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined && typeof v !== 'function');
    return P('object', ...entries.map(([k, v]) => P(k, encodeJsonValue(v))));
  }
  return String(value);
}

export function decodeJsonValue(node) {
  if (typeof node === 'string') return node;
  if (!isLink(node)) return null;
  const [tag, ...rest] = node.values;
  switch (tag) {
    case 'null':
      return null;
    case 'number':
      return Number(rest[0]);
    case 'boolean':
      return rest[0] === 'true';
    case 'array':
      return rest.map(decodeJsonValue);
    case 'object': {
      const out = {};
      for (const entry of rest) if (isLink(entry) && typeof entry.values[0] === 'string') out[entry.values[0]] = decodeJsonValue(entry.values[1]);
      return out;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Queue item <-> plain record <-> link
// ---------------------------------------------------------------------------

const STRING_FIELDS = ['tool', 'status', 'url', 'command', 'commandAlias', 'requester', 'infoBlock', 'locale', 'waitingReason', 'error', 'sessionName', 'sessionId', 'isolationBackend'];
const NUMBER_FIELDS = ['requesterUserId', 'chatId', 'sourceMessageId', 'messageThreadId', 'restoreCount', 'interruptedStarts'];
const BOOLEAN_FIELDS = ['showLimits'];
const DATE_FIELDS = ['createdAt', 'startedAt'];
const JSON_FIELDS = ['urlContext', 'perCommandIsolation', 'limitsAtStart'];
const MESSAGE_INFO_FIELDS = ['chatId', 'messageId', 'messageThreadId'];

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Telegram ids are numbers, but `@channel` style chat ids are strings. */
function decodeId(value) {
  if (typeof value !== 'string') return null;
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

/**
 * Everything needed to run the item again, as plain JSON. The Telegram
 * context is reduced to the ids the bot needs to edit the item's card.
 */
export function queueItemToRecord(item) {
  const record = { id: item.id };
  for (const field of STRING_FIELDS) if (typeof item[field] === 'string' && item[field] !== '') record[field] = item[field];
  record.args = Array.isArray(item.args) ? item.args.map(String) : [];
  record.requesterUserId = item.requesterUserId ?? item.ctx?.from?.id ?? null;
  record.chatId = item.ctx?.chat?.id ?? item.messageInfo?.chatId ?? item.chatId ?? null;
  record.sourceMessageId = item.ctx?.message?.message_id ?? item.sourceMessageId ?? null;
  record.messageThreadId = item.ctx?.message?.message_thread_id ?? item.messageThreadId ?? null;
  record.restoreCount = Number.isSafeInteger(item.restoreCount) ? item.restoreCount : 0;
  record.interruptedStarts = Number.isSafeInteger(item.interruptedStarts) ? item.interruptedStarts : 0;
  if (item.showLimits === true) record.showLimits = true;
  for (const field of DATE_FIELDS) record[field] = toIso(item[field]);
  for (const field of JSON_FIELDS) record[field] = item[field] ?? null;
  record.messageInfo = item.messageInfo && item.messageInfo.messageId != null ? { chatId: item.messageInfo.chatId ?? null, messageId: item.messageInfo.messageId, messageThreadId: item.messageInfo.messageThreadId ?? null } : null;
  for (const key of Object.keys(record)) if (record[key] === null || record[key] === undefined) delete record[key];
  return record;
}

export function recordToLink(record) {
  if (!record?.id) throw new TypeError('queue record needs an id');
  const fields = [];
  for (const field of STRING_FIELDS) if (typeof record[field] === 'string' && record[field] !== '') fields.push(P(field, record[field]));
  fields.push(P('args', ...(record.args || []).map(String)));
  for (const field of NUMBER_FIELDS) if (record[field] !== null && record[field] !== undefined) fields.push(P(field, String(record[field])));
  for (const field of BOOLEAN_FIELDS) if (record[field] === true) fields.push(P(field, 'true'));
  for (const field of DATE_FIELDS) if (record[field]) fields.push(P(field, toIso(record[field])));
  for (const field of JSON_FIELDS) if (record[field] !== null && record[field] !== undefined) fields.push(P(field, encodeJsonValue(record[field])));
  if (record.messageInfo) {
    const info = MESSAGE_INFO_FIELDS.filter(key => record.messageInfo[key] !== null && record.messageInfo[key] !== undefined).map(key => P(key, String(record.messageInfo[key])));
    if (info.length) fields.push(P('messageInfo', ...info));
  }
  return L(record.id, ...fields);
}

export function linkToRecord(link) {
  if (!isLink(link) || typeof link.id !== 'string' || !link.id) throw new TypeError('queue item link needs an id');
  const record = { id: link.id, args: [] };
  for (const field of link.values) {
    if (!isLink(field) || typeof field.values[0] !== 'string') continue;
    const [key, ...rest] = field.values;
    const first = rest[0];
    if (key === 'args') record.args = rest.filter(value => typeof value === 'string');
    else if (STRING_FIELDS.includes(key) && typeof first === 'string') record[key] = first;
    else if (NUMBER_FIELDS.includes(key)) record[key] = key === 'restoreCount' || key === 'interruptedStarts' ? Number(first) || 0 : decodeId(first);
    else if (BOOLEAN_FIELDS.includes(key)) record[key] = first === 'true';
    else if (DATE_FIELDS.includes(key)) record[key] = toIso(first);
    else if (JSON_FIELDS.includes(key)) record[key] = decodeJsonValue(first);
    else if (key === 'messageInfo') {
      record.messageInfo = { chatId: null, messageId: null, messageThreadId: null };
      for (const entry of rest) if (isLink(entry) && MESSAGE_INFO_FIELDS.includes(entry.values[0])) record.messageInfo[entry.values[0]] = decodeId(entry.values[1]);
      if (record.messageInfo.messageId === null) delete record.messageInfo;
    }
  }
  return record;
}

// ---------------------------------------------------------------------------
// Queue <-> document
// ---------------------------------------------------------------------------

/**
 * The part of the queue that must survive a restart: the pending items of
 * every tool queue in order, the items being started, the start-interval
 * timestamps and the statistics. Started, failed and cancelled items live in
 * the session store or are history.
 */
export function snapshotSolveQueue(queue) {
  const items = [];
  for (const toolQueue of Object.values(queue.queues || {})) for (const item of toolQueue) items.push(queueItemToRecord(item));
  for (const item of queue.processing?.values?.() || []) items.push(queueItemToRecord(item));
  const lastStartTimeByTool = {};
  for (const [tool, time] of Object.entries(queue.lastStartTimeByTool || {})) if (time) lastStartTimeByTool[tool] = toIso(time);
  return { items, lastStartTime: toIso(queue.lastStartTime), lastStartTimeByTool, stats: { ...(queue.stats || {}) } };
}

export function buildSolveQueueDocument(snapshot, { revision = 0, savedAt = new Date(), pid = process.pid } = {}) {
  const header = [P('version', String(SOLVE_QUEUE_DOCUMENT_VERSION)), P('revision', String(revision)), P('savedAt', toIso(savedAt)), P('pid', String(pid))];
  if (snapshot.lastStartTime) header.push(P('lastStartTime', snapshot.lastStartTime));
  const byTool = Object.entries(snapshot.lastStartTimeByTool || {}).filter(([, time]) => time);
  if (byTool.length) header.push(P('lastStartTimeByTool', ...byTool.map(([tool, time]) => P(tool, time))));
  const stats = snapshot.stats || {};
  const counters = Object.entries(stats).filter(([key, value]) => key !== 'throttleReasons' && Number.isFinite(value));
  const reasons = Object.entries(stats.throttleReasons || {}).filter(([, count]) => Number.isFinite(count));
  if (counters.length || reasons.length) {
    const statLinks = counters.map(([key, value]) => P(key, String(value)));
    if (reasons.length) statLinks.push(P('throttleReasons', ...reasons.map(([reason, count]) => P(reason, String(count)))));
    header.push(P('stats', ...statLinks));
  }
  return [P(SOLVE_QUEUE_DOCUMENT_KIND, ...header), ...snapshot.items.map(recordToLink)];
}

export function parseSolveQueueDocument(doc) {
  if (!Array.isArray(doc) || !isLink(doc[0]) || doc[0].values[0] !== SOLVE_QUEUE_DOCUMENT_KIND) throw new TypeError('not a solve-queue document');
  const header = { version: null, revision: null, savedAt: null, pid: null, lastStartTime: null, lastStartTimeByTool: {}, stats: { throttleReasons: {} } };
  for (const field of doc[0].values.slice(1)) {
    if (!isLink(field)) continue;
    const [key, ...rest] = field.values;
    if (key === 'version' || key === 'revision' || key === 'pid') header[key] = Number(rest[0]);
    else if (key === 'savedAt' || key === 'lastStartTime') header[key] = toIso(rest[0]);
    else if (key === 'lastStartTimeByTool') for (const entry of rest) isLink(entry) && (header.lastStartTimeByTool[entry.values[0]] = toIso(entry.values[1]));
    else if (key === 'stats')
      for (const entry of rest) {
        if (!isLink(entry)) continue;
        if (entry.values[0] === 'throttleReasons') for (const reason of entry.values.slice(1)) isLink(reason) && (header.stats.throttleReasons[reason.values[0]] = Number(reason.values[1]) || 0);
        else header.stats[entry.values[0]] = Number(entry.values[1]) || 0;
      }
  }
  if (header.version > SOLVE_QUEUE_DOCUMENT_VERSION) throw new TypeError(`solve-queue document version ${header.version} is newer than ${SOLVE_QUEUE_DOCUMENT_VERSION}`);
  const items = [];
  for (const link of doc.slice(1)) {
    try {
      items.push(linkToRecord(link));
    } catch {
      // A damaged item must not cost the rest of the queue.
    }
  }
  return { header, items };
}

// ---------------------------------------------------------------------------
// Persistence: serialized, coalesced saves of the latest snapshot
// ---------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {string} options.dir - state directory (host volume), e.g. resolveBotStateDir()
 * @param {object} [options.store] - injected triple store (tests)
 * @param {object} [options.logger] - bot logger with `event(type, data)`
 * @param {object} [options.backup] - optional off-host copy with `save(text, meta)` (see telegram backup)
 */
export function createSolveQueuePersistence(options = {}) {
  const { dir, verbose = false, log = console.log, logger = null, backup = null, clinkPath, clinkDebounceMs, now = () => new Date() } = options;
  const store = options.store || createLinksTripleStore({ dir: dir && path.resolve(dir), clinkPath, clinkDebounceMs, verbose, log });
  const trace = message => {
    if (verbose) log(`[VERBOSE] /queue-persist: ${message}`);
  };
  let queue = null;
  let revision = 0;
  let chain = Promise.resolve();
  let scheduled = false;
  let reasons = [];
  let lastError = null;

  function attach(target) {
    queue = target;
    queue.onStateChange = (event, item) => {
      if (logger?.event && item) logger.event(`queue_item_${event}`, queueItemToRecord(item));
      persist(event, item);
    };
    trace(`attached to the solve queue, state in ${store.paths?.archive ? path.dirname(store.paths.archive) : 'memory'}`);
    return api;
  }

  /** Save the queue as it is when the save runs; bursts coalesce into one save. */
  function persist(reason = 'update', item = null) {
    if (!queue) return chain;
    reasons.push(item ? `${reason}:${item.id}` : reason);
    if (scheduled) return chain;
    scheduled = true;
    chain = chain.then(async () => {
      scheduled = false;
      const why = reasons;
      reasons = [];
      const snapshot = snapshotSolveQueue(queue);
      revision += 1;
      const doc = buildSolveQueueDocument(snapshot, { revision, savedAt: now() });
      try {
        await store.save(doc);
        lastError = null;
        trace(`revision ${revision} saved (${snapshot.items.length} item(s); ${why.join(', ')})`);
        if (backup?.save) backup.save(doc, { revision, items: snapshot.items.length });
      } catch (error) {
        lastError = error;
        log(`⚠️ /queue-persist: failed to save revision ${revision}: ${error.message}`);
      }
    });
    return chain;
  }

  /**
   * Load the newest stored queue. Continues the revision counter so later
   * saves always win over what is on disk.
   */
  async function load() {
    const loaded = await store.load();
    const known = (loaded.sources || []).map(entry => entry.revision).filter(Number.isFinite);
    revision = Math.max(revision, loaded.revision ?? 0, ...known);
    if (!loaded.doc) return { ...loaded, header: null, items: [] };
    const parsed = parseSolveQueueDocument(loaded.doc);
    trace(`loaded revision ${loaded.revision} from ${loaded.source}: ${parsed.items.length} item(s)`);
    return { ...loaded, ...parsed };
  }

  async function flush() {
    await chain;
    await store.flush?.();
    await backup?.flush?.();
  }

  async function close() {
    await flush();
    await store.close?.();
  }

  const api = {
    store,
    attach,
    persist,
    load,
    flush,
    close,
    get revision() {
      return revision;
    },
    get lastError() {
      return lastError;
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/** A Telegram context with just what the queue needs to edit the item's card. */
export function createRestoredContext(record, telegram) {
  const chatId = record.chatId ?? record.messageInfo?.chatId ?? null;
  return {
    telegram,
    chat: chatId === null ? undefined : { id: chatId },
    message: { message_id: record.sourceMessageId ?? null, message_thread_id: record.messageThreadId ?? record.messageInfo?.messageThreadId ?? undefined },
    from: record.requesterUserId === null || record.requesterUserId === undefined ? undefined : { id: record.requesterUserId },
    restored: true,
  };
}

/**
 * Put stored items back into the queue.
 *
 * - `queued`/`waiting` items are re-enqueued in their original order.
 * - `starting` items are checked against the running sessions: if the task
 *   is alive it is handed to the session monitor (`onRunning`), otherwise it
 *   is enqueued again.
 * - An item already in the queue (same URL) is skipped.
 * - An item whose start was interrupted more than `maxRestores` times is
 *   dropped, so a task that kills the bot cannot keep it in a restart loop.
 *
 * @returns {Promise<{requeued: object[], running: object[], skipped: object[], dropped: object[]}>}
 */
export async function restoreSolveQueue(queue, loaded, options = {}) {
  const { telegram = null, isSessionRunning = async () => false, isUrlRunning = async () => false, onRunning = null, maxRestores = DEFAULT_MAX_RESTORES, verbose = false, log = console.log } = options;
  const trace = message => {
    if (verbose) log(`[VERBOSE] /queue-restore: ${message}`);
  };
  const summary = { requeued: [], running: [], skipped: [], dropped: [], source: loaded?.source || null, revision: loaded?.revision ?? null };
  const header = loaded?.header;
  if (header) mergeQueueTiming(queue, header);
  const records = [...(loaded?.items || [])].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const seen = new Set();
  for (const record of records) {
    const key = canonicalizeGitHubUrl(record.url || '') || record.id;
    if (!record.url || seen.has(key) || queue.findByUrl(record.url)) {
      summary.skipped.push({ record, reason: record.url ? 'duplicate' : 'no-url' });
      trace(`skipped ${record.id} (${record.url ? 'already queued' : 'no url'})`);
      continue;
    }
    seen.add(key);
    if (record.status === 'starting') {
      let running = false;
      try {
        running = (record.sessionId && (await isSessionRunning(record))) || (await isUrlRunning(record));
      } catch (error) {
        trace(`could not check whether ${record.id} is running: ${error.message}`);
      }
      if (running) {
        summary.running.push({ record });
        trace(`${record.id} is still running (${record.sessionId || record.url}); handed to the session monitor`);
        if (onRunning) await onRunning(record);
        continue;
      }
    }
    // Only a restart while the item was starting counts toward the limit:
    // waiting through ordinary restarts must not cost a queued item its place.
    const interruptedStarts = (record.interruptedStarts || 0) + (record.status === 'starting' ? 1 : 0);
    if (interruptedStarts > maxRestores) {
      summary.dropped.push({ record, reason: 'restore-limit' });
      log(`⚠️ /queue-restore: dropped ${record.id} (${record.url}): the bot stopped ${interruptedStarts} times while starting it`);
      continue;
    }
    const item = queue.restoreItem({ ...record, restoreCount: (record.restoreCount || 0) + 1, interruptedStarts, ctx: createRestoredContext(record, telegram) });
    summary.requeued.push({ record, item });
    trace(`re-enqueued ${record.id} ${record.tool || 'claude'} ${record.url} (was ${record.status || 'queued'})`);
  }
  return summary;
}

/** Keep the newer of the stored and the in-memory start times, and add up the counters. */
export function mergeQueueTiming(queue, header) {
  const later = (a, b) => {
    const ta = a ? new Date(a).getTime() : NaN;
    const tb = b ? new Date(b).getTime() : NaN;
    if (Number.isNaN(ta)) return Number.isNaN(tb) ? a || null : tb;
    return Number.isNaN(tb) ? ta : Math.max(ta, tb);
  };
  queue.lastStartTime = later(queue.lastStartTime, header.lastStartTime);
  for (const [tool, time] of Object.entries(header.lastStartTimeByTool || {})) queue.lastStartTimeByTool[tool] = later(queue.lastStartTimeByTool[tool], time);
  for (const [key, value] of Object.entries(header.stats || {})) {
    if (key === 'throttleReasons') {
      for (const [reason, count] of Object.entries(value || {})) queue.stats.throttleReasons[reason] = (queue.stats.throttleReasons[reason] || 0) + count;
    } else if (Number.isFinite(value)) queue.stats[key] = (queue.stats[key] || 0) + value;
  }
}

export default {
  encodeJsonValue,
  decodeJsonValue,
  queueItemToRecord,
  recordToLink,
  linkToRecord,
  snapshotSolveQueue,
  buildSolveQueueDocument,
  parseSolveQueueDocument,
  createSolveQueuePersistence,
  createRestoredContext,
  restoreSolveQueue,
  mergeQueueTiming,
};
