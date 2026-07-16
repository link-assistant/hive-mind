/**
 * Durable persistence for tracked Telegram work sessions.
 *
 * Issue #1927: the session monitor kept its registry purely in-memory
 * (`activeSessions` Map). When the bot process was killed/restarted that map was
 * lost, so a /solve running in a detached `$` session became an orphan the bot
 * could never report on — it just vanished. Requirement #2 asks the bot to
 * "detect restart … and if after bot start we have commands in `$`, try to
 * resume them, if they started before bot start time." Requirement #4 asks that
 * we never destroy previous data.
 *
 * This module persists the minimal, plain-data subset of each session's
 * metadata to disk so that after a restart the monitor can reload its registry
 * and keep watching detached sessions to completion. Two artifacts are written:
 *
 *   - `sessions.json`  — an atomically-rewritten snapshot of the *current* set
 *     of tracked sessions (the source of truth for resume).
 *   - `sessions-events.jsonl` — an append-only, timestamped audit log of every
 *     track/complete event. It is never truncated, so the full history of what
 *     ran (and when it ended) survives even total failures.
 *
 * The store is dependency-free and fully injectable for unit testing.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Only plain, serializable metadata is persisted. Runtime-only fields (the bot
// instance, cached limits snapshots, transient error strings) are deliberately
// excluded so the snapshot stays small and safe to reload.
// `args` (#1927 review follow-up) is persisted so a killed /solve can be resumed
// with its exact original invocation plus `--resume <lastSessionId>`.
const PERSISTABLE_FIELDS = ['chatId', 'messageId', 'startTime', 'url', 'command', 'isolationBackend', 'sessionId', 'containerFilesystemStartBytes', 'containerFilesystemLastBytes', 'containerFilesystemLastObservedAt', 'tool', 'infoBlock', 'urlContext', 'requesterUserId', 'showLimits', 'locale', 'logPath', 'args'];

/**
 * Resolve the directory durable bot state is written to. Honors
 * HIVE_MIND_STATE_DIR, then a stable per-user fallback. Never throws.
 *
 * @param {object} [env=process.env]
 * @param {Function} [homedir=os.homedir]
 * @returns {string} Absolute directory path
 */
export function resolveBotStateDir(env = process.env, homedir = os.homedir) {
  const explicit = String(env.HIVE_MIND_STATE_DIR || '').trim();
  if (explicit) return explicit;
  const home = (() => {
    try {
      return homedir();
    } catch {
      return '/tmp';
    }
  })();
  return path.join(home, '.hive-mind', 'state');
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Reduce a sessionInfo object to its persistable subset, normalizing the
 * startTime to an ISO string.
 * @param {object} sessionInfo
 * @returns {object}
 */
export function serializeSessionInfo(sessionInfo = {}) {
  const out = {};
  for (const field of PERSISTABLE_FIELDS) {
    if (sessionInfo[field] === undefined) continue;
    if (field === 'startTime') {
      const iso = toIso(sessionInfo.startTime);
      if (iso) out.startTime = iso;
      continue;
    }
    out[field] = sessionInfo[field];
  }
  return out;
}

/**
 * Rehydrate a persisted session record, converting startTime back to a Date.
 * @param {object} record
 * @returns {object}
 */
export function deserializeSessionInfo(record = {}) {
  const out = { ...record };
  if (out.startTime) {
    const date = new Date(out.startTime);
    if (!Number.isNaN(date.getTime())) out.startTime = date;
  }
  return out;
}

/**
 * Create a durable session store bound to a directory.
 *
 * @param {object} [options]
 * @param {string} [options.dir] - State directory (default: resolveBotStateDir()).
 * @param {object} [options.fsImpl=fs] - Injectable fs (for tests).
 * @param {Function} [options.now] - Injectable clock returning a Date.
 * @param {boolean} [options.verbose=false]
 * @param {object} [options.logger] - Optional bot logger for structured events.
 * @returns {object} Session store instance.
 */
export function createSessionStore(options = {}) {
  const { dir = resolveBotStateDir(), fsImpl = fs, now = () => new Date(), verbose = false, logger = null } = options;

  const snapshotPath = path.join(dir, 'sessions.json');
  const eventsPath = path.join(dir, 'sessions-events.jsonl');
  let disabled = false;

  function log(level, message, meta) {
    if (logger && typeof logger[level] === 'function') logger[level](message, meta);
    else if (verbose) console.log(`[session-store] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
  }

  function ensureDir() {
    if (disabled) return false;
    try {
      fsImpl.mkdirSync(dir, { recursive: true });
      return true;
    } catch (error) {
      disabled = true;
      log('error', `Could not create state dir ${dir}: ${error.message} — persistence disabled`);
      return false;
    }
  }

  function readSnapshotMap() {
    try {
      const raw = fsImpl.readFileSync(snapshotPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') {
        return parsed.sessions;
      }
      return {};
    } catch {
      // Missing or corrupt snapshot is non-fatal — start from empty.
      return {};
    }
  }

  function writeSnapshotMap(sessions) {
    if (!ensureDir()) return;
    const payload = JSON.stringify({ version: 1, updatedAt: toIso(now()), sessions }, null, 2);
    const tmpPath = `${snapshotPath}.tmp`;
    try {
      // Atomic replace: write tmp then rename so a crash mid-write never leaves
      // a half-written snapshot.
      fsImpl.writeFileSync(tmpPath, payload);
      fsImpl.renameSync(tmpPath, snapshotPath);
    } catch (error) {
      log('error', `Could not write session snapshot: ${error.message}`);
    }
  }

  function appendEvent(type, sessionName, data) {
    if (!ensureDir()) return;
    const entry = { ts: toIso(now()), type, sessionName, ...data };
    try {
      fsImpl.appendFileSync(eventsPath, JSON.stringify(entry) + '\n');
    } catch (error) {
      log('error', `Could not append session event: ${error.message}`);
    }
  }

  return {
    get snapshotPath() {
      return snapshotPath;
    },
    get eventsPath() {
      return eventsPath;
    },
    get disabled() {
      return disabled;
    },

    /**
     * Persist (upsert) a tracked session and append a `track` audit event.
     * @param {string} sessionName
     * @param {object} sessionInfo
     */
    persist(sessionName, sessionInfo) {
      if (!sessionName) return;
      const sessions = readSnapshotMap();
      const serialized = serializeSessionInfo(sessionInfo);
      serialized.persistedAt = toIso(now());
      sessions[sessionName] = serialized;
      writeSnapshotMap(sessions);
      appendEvent('track', sessionName, { sessionInfo: serialized });
      log('debug', `Persisted session ${sessionName}`, { command: serialized.command, url: serialized.url });
    },

    /**
     * Remove a session from the snapshot and append a `complete` audit event.
     * The event records the terminal status/exit code so the history survives
     * even though the live snapshot no longer lists the session.
     * @param {string} sessionName
     * @param {object} [meta] - { status, exitCode }
     */
    remove(sessionName, meta = {}) {
      if (!sessionName) return;
      const sessions = readSnapshotMap();
      if (sessionName in sessions) {
        delete sessions[sessionName];
        writeSnapshotMap(sessions);
      }
      appendEvent('complete', sessionName, { status: meta.status ?? null, exitCode: meta.exitCode ?? null });
      log('debug', `Removed session ${sessionName} from snapshot`, meta);
    },

    /**
     * Load all persisted sessions as `{ sessionName, sessionInfo }` records with
     * startTime rehydrated to a Date.
     * @returns {Array<{sessionName: string, sessionInfo: object}>}
     */
    load() {
      const sessions = readSnapshotMap();
      const out = [];
      for (const [sessionName, record] of Object.entries(sessions)) {
        out.push({ sessionName, sessionInfo: deserializeSessionInfo(record) });
      }
      return out;
    },
  };
}
