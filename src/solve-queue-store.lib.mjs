/**
 * Issue #2890: durable solve queue.
 *
 * The solve queue lived only in the bot's memory, so a killed root container
 * lost every queued task. This store keeps the queue next to `sessions.json`
 * in `resolveBotStateDir()` (a host volume in the Docker deployment) in three
 * forms, each able to restore the queue alone:
 *
 * 1. `queue.json` — the primary snapshot, replaced atomically (tmp + rename);
 * 2. `queue.lino` — the same snapshot in Links Notation (lino-objects-codec),
 *    replaced atomically, readable and diffable;
 * 3. `queue.links` — a link-cli (`clink`) doublets database with one link per
 *    field, rebuilt in the background when the `clink` binary is installed.
 *
 * `load()` reads them in that order and, when none is usable, rebuilds the
 * queue from the bot log (`queue_item_*` events and the `Enqueued:` /
 * `Starting:` / `raw text:` lines).
 *
 * Writes are asynchronous and coalesced; `flushSync()` is for the exit handler.
 */

import fs from 'node:fs';
import path from 'node:path';

import { encode as encodeLino, decode as decodeLino } from 'lino-objects-codec';

import { resolveBotStateDir } from './session-store.lib.mjs';
import { createClinkMirror } from './solve-queue-clink.lib.mjs';
import { readQueueFromBotLogs } from './solve-queue-log-recovery.lib.mjs';

export const QUEUE_STORE_VERSION = 1;
export const QUEUE_STORE_FILES = { json: 'queue.json', lino: 'queue.lino', clinkDb: 'queue.links', clinkNames: 'queue.names.links' };
// Launched and failed items kept for `/queue` history and session-outcome matching.
export const QUEUE_HISTORY_LIMIT = 50;

// Everything a queue item needs to run again. `ctx` (the Telegraf context) is
// not data; the restore builds a stand-in from `chatId`/`messageThreadId`.
export const QUEUE_ITEM_FIELDS = ['id', 'url', 'args', 'requester', 'infoBlock', 'commandAlias', 'tool', 'perCommandIsolation', 'urlContext', 'requesterUserId', 'showLimits', 'limitsAtStart', 'locale', 'createdAt', 'startedAt', 'status', 'waitingReason', 'error', 'sessionName', 'sessionOutcome', 'messageInfo', 'lastMessageUpdateTime', 'chatId', 'messageThreadId'];
const DATE_FIELDS = ['createdAt', 'startedAt', 'lastMessageUpdateTime'];

function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Plain JSON data only: Dates become ISO strings, undefined disappears.
const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * The persistable record of a queue item.
 * @param {object} item - SolveQueueItem
 * @returns {object}
 */
export function serializeQueueItem(item = {}) {
  const source = { ...item, messageInfo: item.messageInfo, chatId: item.chatId ?? item.ctx?.chat?.id ?? item.messageInfo?.chatId ?? null, messageThreadId: item.messageThreadId ?? item.messageInfo?.messageThreadId ?? item.ctx?.message?.message_thread_id ?? null };
  const record = {};
  for (const field of QUEUE_ITEM_FIELDS) {
    const value = source[field];
    if (value === undefined) continue;
    record[field] = DATE_FIELDS.includes(field) ? toIso(value) : plain(value);
  }
  return record;
}

/**
 * Turn a stored record back into item fields (Dates restored).
 * @param {object} record
 * @returns {object}
 */
export function deserializeQueueRecord(record = {}) {
  const out = { ...record };
  for (const field of DATE_FIELDS) {
    if (!out[field]) continue;
    const date = new Date(out[field]);
    out[field] = Number.isNaN(date.getTime()) ? null : date;
  }
  return out;
}

/**
 * The persistable state of a SolveQueue: pending items per tool in order,
 * items that were starting, recent history, start-interval state and stats.
 * @param {object} queue - SolveQueue
 * @param {Function} [now]
 * @returns {object}
 */
export function buildQueueSnapshot(queue, now = () => new Date()) {
  const queues = {};
  for (const [tool, items] of Object.entries(queue.queues || {})) queues[tool] = items.map(serializeQueueItem);
  return plain({
    version: QUEUE_STORE_VERSION,
    updatedAt: toIso(now()),
    queues,
    processing: Array.from(queue.processing?.values?.() || []).map(serializeQueueItem),
    completed: (queue.completed || []).slice(-QUEUE_HISTORY_LIMIT).map(serializeQueueItem),
    failed: (queue.failed || []).slice(-QUEUE_HISTORY_LIMIT).map(serializeQueueItem),
    lastStartTime: queue.lastStartTime ?? null,
    lastStartTimeByTool: queue.lastStartTimeByTool || {},
    stats: queue.stats || {},
  });
}

/**
 * A usable snapshot: the version this code writes and a queue per tool.
 * @param {*} snapshot
 * @returns {boolean}
 */
export function isValidQueueSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== QUEUE_STORE_VERSION) return false;
  if (!snapshot.queues || typeof snapshot.queues !== 'object') return false;
  return Object.values(snapshot.queues).every(Array.isArray);
}

/**
 * Create the durable queue store.
 *
 * @param {object} [options]
 * @param {string} [options.dir] - State directory (default: resolveBotStateDir()).
 * @param {string|null} [options.logDir] - Bot log directory for the last-resort fallback.
 * @param {boolean|object} [options.clink] - false to skip link-cli; true or options for createClinkMirror.
 * @param {number} [options.debounceMs=100] - Coalesce writes that come in a burst.
 * @param {number} [options.clinkIntervalMs=5000] - Minimum time between link-cli rebuilds.
 * @param {object} [options.fsImpl=fs]
 * @param {object|null} [options.logger] - Bot logger.
 * @param {boolean} [options.verbose=false]
 */
export function createSolveQueueStore(options = {}) {
  const { dir = resolveBotStateDir(), logDir = null, clink = 'auto', debounceMs = 100, clinkIntervalMs = 5000, fsImpl = fs, logger = null, verbose = false } = options;
  const fsp = fsImpl.promises || fs.promises;
  const jsonPath = path.join(dir, QUEUE_STORE_FILES.json);
  const linoPath = path.join(dir, QUEUE_STORE_FILES.lino);
  const mirror = clink === false ? null : createClinkMirror({ dir, ...(typeof clink === 'object' ? clink : {}), required: clink === true, fsImpl, logger, verbose });

  let latest = null; // snapshot or a function that builds one
  let dirty = false;
  let timer = null;
  let writing = null;
  let exiting = false;
  let lastClinkAt = 0;
  let clinkTimer = null;
  let clinkWriting = null;
  let clinkPending = null;

  function log(level, message, meta) {
    if (logger && typeof logger[level] === 'function') logger[level](message, meta);
    else if (verbose) console.log(`[queue-store] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
  }

  const resolveSnapshot = () => (typeof latest === 'function' ? latest() : latest);
  const payloads = snapshot => ({ json: JSON.stringify(snapshot, null, 2), lino: `${encodeLino({ obj: snapshot })}\n` });

  async function writeAtomic(target, text) {
    const tmp = `${target}.tmp`;
    await fsp.writeFile(tmp, text);
    await fsp.rename(tmp, target);
  }

  async function writeSnapshot(snapshot) {
    try {
      await fsp.mkdir(dir, { recursive: true });
      const { json, lino } = payloads(snapshot);
      await writeAtomic(jsonPath, json);
      await writeAtomic(linoPath, lino);
    } catch (error) {
      log('error', `Could not write the solve queue store: ${error.message}`);
    }
    scheduleClink(snapshot);
  }

  async function drain() {
    timer = null;
    while (dirty && !exiting) {
      dirty = false;
      let snapshot = null;
      try {
        snapshot = resolveSnapshot();
      } catch (error) {
        log('error', `Could not build the solve queue snapshot: ${error.message}`);
      }
      if (snapshot) await writeSnapshot(snapshot);
    }
  }

  function startDrain() {
    if (writing) return;
    writing = drain().finally(() => {
      writing = null;
      if (dirty && !exiting) startDrain();
    });
  }

  function scheduleClink(snapshot) {
    if (!mirror) return;
    clinkPending = snapshot;
    if (clinkTimer || clinkWriting) return;
    const wait = Math.max(0, lastClinkAt + clinkIntervalMs - Date.now());
    clinkTimer = setTimeout(runClink, wait);
    clinkTimer.unref?.();
  }

  function runClink() {
    clinkTimer = null;
    if (!clinkPending || exiting) return;
    const snapshot = clinkPending;
    clinkPending = null;
    lastClinkAt = Date.now();
    clinkWriting = mirror
      .write(snapshot)
      .catch(error => log('warn', `link-cli queue mirror failed: ${error.message}`))
      .finally(() => {
        clinkWriting = null;
        if (clinkPending) scheduleClink(clinkPending);
      });
  }

  return {
    dir,
    jsonPath,
    linoPath,
    /** Persist a snapshot (or a function building one at write time). */
    save(snapshot) {
      latest = snapshot;
      dirty = true;
      if (exiting) return this.flushSync(); // hive-sync-ok: only after the exit handler ran
      if (timer || writing) return undefined;
      timer = setTimeout(startDrain, debounceMs);
      timer.unref?.();
      return undefined;
    },
    /** Wait for every pending json/lino write. */
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        startDrain();
      }
      while (writing) await writing;
    },
    /** Rebuild the link-cli database now (tests, shutdown). */
    async flushClink() {
      if (clinkTimer) {
        clearTimeout(clinkTimer);
        runClink();
      }
      while (clinkWriting) await clinkWriting;
    },
    /** Exit handler: write the latest snapshot synchronously. */
    flushSync() {
      exiting = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (!dirty || latest === null) return;
      dirty = false;
      try {
        const { json, lino } = payloads(resolveSnapshot());
        fsImpl.mkdirSync(dir, { recursive: true }); // hive-sync-ok: exit handler, the event loop is gone
        fsImpl.writeFileSync(`${jsonPath}.tmp`, json); // hive-sync-ok: exit handler, the event loop is gone
        fsImpl.renameSync(`${jsonPath}.tmp`, jsonPath); // hive-sync-ok: exit handler, the event loop is gone
        fsImpl.writeFileSync(`${linoPath}.tmp`, lino); // hive-sync-ok: exit handler, the event loop is gone
        fsImpl.renameSync(`${linoPath}.tmp`, linoPath); // hive-sync-ok: exit handler, the event loop is gone
      } catch (error) {
        log('error', `Could not write the solve queue store at exit: ${error.message}`);
      }
    },
    /**
     * Read the stored queue: json, then lino, then link-cli, then the bot log.
     * @returns {Promise<{source: string|null, snapshot: object|null, errors: string[]}>}
     */
    async load() {
      const errors = [];
      const readers = [
        ['json', async () => JSON.parse(await fsp.readFile(jsonPath, 'utf8'))],
        ['lino', async () => decodeLino({ notation: await fsp.readFile(linoPath, 'utf8') })],
        ['clink', async () => (mirror ? mirror.read() : null)],
        ['log', async () => (logDir ? readQueueFromBotLogs({ logDir, fsImpl }) : null)],
      ];
      for (const [source, read] of readers) {
        try {
          const snapshot = await read();
          if (snapshot === null || snapshot === undefined) continue;
          if (isValidQueueSnapshot(snapshot)) return { source, snapshot, errors };
          errors.push(`${source}: not a solve queue snapshot`);
        } catch (error) {
          if (error?.code !== 'ENOENT') errors.push(`${source}: ${error.message}`);
        }
      }
      return { source: null, snapshot: null, errors };
    },
  };
}
