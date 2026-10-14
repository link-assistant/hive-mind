/* eslint-disable no-await-in-loop -- log lines reach the file in order, one append at a time */
/**
 * Durable, timestamped logger for the Telegram bot.
 *
 * Issue #1927: when a detached /solve session was OOM-killed (exit 137) the bot
 * stayed alive but never reported the failure, and there was NO bot log file to
 * reconstruct what happened — only ephemeral console output that scrolled away.
 * Requirements #3 and #4 of that issue ask for:
 *
 *   - Every log line carries a timestamp, so the exact moment of a total failure
 *     (process killed mid-write) can be located afterwards.
 *   - Previous bot logs are never destroyed. A restart must not overwrite the
 *     log of the run that was killed — that log is the only evidence of when the
 *     bot was last alive, which gates which sessions we try to resume.
 *
 * This module mirrors every line to the console (so existing behaviour and
 * `journalctl`/screen capture are unchanged) AND appends it to a rotating log
 * file. File writes are asynchronous so logging never blocks the bot's event
 * loop; `flush()` waits for them and `flushSync()` writes what is left when the
 * process exits. On startup the previous active log is preserved under a timestamped
 * backup name instead of being overwritten, and oversized logs rotate the same
 * way mid-run. Backups are pruned only down to a generous configurable cap.
 *
 * The logger is intentionally dependency-free (node:fs/node:path only) and fully
 * injectable so it can be unit-tested without touching the real filesystem.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB per active file before rotating
const DEFAULT_MAX_BACKUPS = 100; // keep up to 100 rotated logs (newest wins on prune)

/**
 * Resolve the directory bot logs are written to. Honors HIVE_MIND_LOG_DIR, then
 * the start-command log root, then a stable per-user fallback. Never throws.
 *
 * @param {object} [env=process.env]
 * @param {Function} [homedir=os.homedir]
 * @returns {string} Absolute directory path
 */
export function resolveBotLogDir(env = process.env, homedir = os.homedir) {
  const explicit = String(env.HIVE_MIND_LOG_DIR || '').trim();
  if (explicit) return explicit;
  const home = (() => {
    try {
      return homedir();
    } catch {
      return '/tmp';
    }
  })();
  return path.join(home, '.hive-mind', 'logs');
}

/**
 * Build the timestamp prefix used on every line: ISO 8601 with milliseconds.
 * @param {Date} date
 * @returns {string}
 */
export function formatLogTimestamp(date) {
  try {
    return date.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/**
 * Turn an ISO timestamp into a filesystem-safe token (no colons) so it can be
 * embedded in a backup filename on every platform.
 * @param {Date} date
 * @returns {string}
 */
function fileStamp(date) {
  return formatLogTimestamp(date).replace(/[:.]/g, '-');
}

function serializeMeta(meta) {
  if (meta === undefined || meta === null) return '';
  if (typeof meta === 'string') return meta ? ` ${meta}` : '';
  try {
    const json = JSON.stringify(meta, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
    return json && json !== '{}' ? ` ${json}` : '';
  } catch {
    return ` ${String(meta)}`;
  }
}

/**
 * Format a single structured log line (without trailing newline).
 * Shape: `<ISO> <LEVEL> <message> <json-meta?>`
 *
 * @param {string} level
 * @param {string} message
 * @param {*} [meta]
 * @param {Date} [date]
 * @returns {string}
 */
export function formatLogLine(level, message, meta, date = new Date()) {
  const lvl = String(level || 'info')
    .toUpperCase()
    .padEnd(5);
  return `${formatLogTimestamp(date)} ${lvl} ${message}${serializeMeta(meta)}`;
}

/**
 * Create a durable bot logger.
 *
 * @param {object} [options]
 * @param {string} [options.dir] - Directory for log files (default: resolveBotLogDir()).
 * @param {string} [options.baseName='telegram-bot'] - Base file name (without extension).
 * @param {number} [options.maxBytes] - Rotate the active file once it exceeds this size.
 * @param {number} [options.maxBackups] - Keep at most this many rotated backups.
 * @param {boolean} [options.mirrorConsole=true] - Also write each line to console.
 * @param {boolean} [options.verbose=false] - Emit debug-level lines (otherwise suppressed).
 * @param {boolean} [options.rotateOnStart=true] - Preserve a previous active log on startup.
 * @param {object} [options.fsImpl=fs] - Injectable fs (for tests).
 * @param {Function} [options.now] - Injectable clock returning a Date (for tests).
 * @param {object} [options.consoleImpl=console] - Injectable console (for tests).
 * @returns {object} Logger instance.
 */
export function createBotLogger(options = {}) {
  const { dir = resolveBotLogDir(), baseName = 'telegram-bot', maxBytes = DEFAULT_MAX_BYTES, maxBackups = DEFAULT_MAX_BACKUPS, mirrorConsole = true, verbose = false, rotateOnStart = true, fsImpl = fs, now = () => new Date(), consoleImpl = console } = options;
  const fsp = fsImpl.promises || fs.promises;

  const activePath = path.join(dir, `${baseName}.log`);
  let fileDisabled = false; // set if the filesystem is unusable; console still works

  function disableFile(message) {
    if (!fileDisabled) consoleImpl.error(message);
    fileDisabled = true;
    pending.length = 0;
  }

  // Startup only: runs once while the bot is being created, before it polls.
  function ensureDir() {
    try {
      fsImpl.mkdirSync(dir, { recursive: true }); // hive-sync-ok: one-time startup setup before polling
      return true;
    } catch (error) {
      disableFile(`[bot-logger] Could not create log dir ${dir}: ${error.message} — file logging disabled, console only`);
      return false;
    }
  }

  function backupName(date, suffix = 0) {
    return path.join(dir, `${baseName}-${fileStamp(date)}${suffix ? `-${suffix}` : ''}.log`);
  }

  // Preserve the previous run's log instead of overwriting it (requirement #4).
  function rotateOnStartup() {
    // Runs once, before polling starts, so the synchronous calls below block nothing.
    try {
      if (!fsImpl.existsSync(activePath)) return; // hive-sync-ok: one-time startup rotation
      const stat = fsImpl.statSync(activePath); // hive-sync-ok: one-time startup rotation
      if (!stat || stat.size === 0) return;
      let target = backupName(now());
      // Avoid clobbering an existing backup created within the same millisecond.
      for (let suffix = 1; fsImpl.existsSync(target); suffix += 1) target = backupName(now(), suffix); // hive-sync-ok: one-time startup rotation
      fsImpl.renameSync(activePath, target); // hive-sync-ok: one-time startup rotation
      if (verbose) consoleImpl.log(`[bot-logger] Rotated previous log to ${target} (startup)`);
      const entries = fsImpl.readdirSync(dir); // hive-sync-ok: one-time startup rotation
      for (const name of backupsToPrune(entries)) {
        try {
          fsImpl.unlinkSync(path.join(dir, name)); // hive-sync-ok: one-time startup rotation
        } catch {
          /* best effort */
        }
      }
    } catch (error) {
      consoleImpl.error(`[bot-logger] Log rotation failed (startup): ${error.message}`);
    }
  }

  function backupsToPrune(entries) {
    if (!Number.isFinite(maxBackups) || maxBackups < 0) return []; // unbounded: never destroy
    const backups = entries.filter(name => name.startsWith(`${baseName}-`) && name.endsWith('.log')).sort(); // timestamped names sort chronologically
    return backups.slice(0, Math.max(0, backups.length - maxBackups));
  }

  async function pathExists(target) {
    try {
      await fsp.access(target);
      return true;
    } catch {
      return false;
    }
  }

  // Mid-run rotation: the oversized file becomes a timestamped backup.
  async function rotateForSize() {
    try {
      let target = backupName(now());
      for (let suffix = 1; await pathExists(target); suffix += 1) target = backupName(now(), suffix);
      await fsp.rename(activePath, target);
      if (verbose) consoleImpl.log(`[bot-logger] Rotated previous log to ${target} (size)`);
      for (const name of backupsToPrune(await fsp.readdir(dir))) {
        await fsp.unlink(path.join(dir, name)).catch(() => {});
      }
    } catch (error) {
      consoleImpl.error(`[bot-logger] Log rotation failed (size): ${error.message}`);
    }
  }

  // Lines waiting for the file. Writes run one batch at a time off the event
  // loop; the size of the active file is tracked here instead of stat'ing it
  // for every line.
  const pending = [];
  let draining = null;
  let size = 0;

  if (ensureDir()) {
    if (rotateOnStart) rotateOnStartup();
    try {
      size = fsImpl.statSync(activePath).size; // hive-sync-ok: one-time startup read before polling
    } catch {
      size = 0;
    }
  }

  // Lines stay in `pending` until their write completes, so `flushSync()` at
  // exit still sees a batch whose asynchronous write never finished.
  let exiting = false;

  async function drain() {
    while (pending.length > 0 && !fileDisabled && !exiting) {
      if (size > 0 && size + Buffer.byteLength(pending[0]) > maxBytes) {
        await rotateForSize();
        size = 0;
      }
      // Take as many lines as fit before the next rotation (at least one).
      let count = 0;
      let chunkBytes = 0;
      while (count < pending.length) {
        const bytes = Buffer.byteLength(pending[count]);
        if (count > 0 && size + chunkBytes + bytes > maxBytes) break;
        count += 1;
        chunkBytes += bytes;
      }
      try {
        await fsp.appendFile(activePath, pending.slice(0, count).join(''));
        if (exiting) return;
        pending.splice(0, count);
        size += chunkBytes;
      } catch (error) {
        disableFile(`[bot-logger] Could not write log line: ${error.message} — file logging disabled`);
      }
    }
  }

  function appendLine(line) {
    if (fileDisabled) return;
    pending.push(`${line}\n`);
    if (exiting) {
      flushSync(); // hive-sync-ok: only after the exit handler ran
      return;
    }
    if (!draining) {
      draining = drain().finally(() => {
        draining = null;
      });
    }
  }

  /** Resolves once every line logged so far has reached the file. */
  async function flush() {
    while (draining) await draining;
  }

  /**
   * Write whatever is still queued, synchronously, and keep writing
   * synchronously from then on. Only for `process.on('exit')`, where no further
   * event-loop turn will run the asynchronous writer. A batch whose write was
   * in flight is written again rather than risk losing it.
   */
  function flushSync() {
    exiting = true;
    if (fileDisabled || pending.length === 0) return;
    try {
      fsImpl.appendFileSync(activePath, pending.splice(0, pending.length).join('')); // hive-sync-ok: exit handler, the event loop is gone
    } catch {
      /* the process is exiting; nothing else can be done */
    }
  }

  function emit(level, message, meta) {
    if (level === 'debug' && !verbose) return;
    const date = now();
    const line = formatLogLine(level, message, meta, date);
    appendLine(line);
    if (mirrorConsole) {
      const sink = level === 'error' ? consoleImpl.error : level === 'warn' ? consoleImpl.warn : consoleImpl.log;
      sink(line);
    }
  }

  return {
    /** Absolute path of the active log file. */
    get filePath() {
      return activePath;
    },
    /** Absolute directory holding the active + backup logs. */
    get dir() {
      return dir;
    },
    /** True when file writes have been disabled (console still works). */
    get fileDisabled() {
      return fileDisabled;
    },
    debug: (message, meta) => emit('debug', message, meta),
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta),
    /**
     * Record a structured lifecycle/session event. `type` is uppercased into the
     * message so events are greppable (e.g. `grep ' EVENT session_killed '`).
     */
    event: (type, data) => emit('info', `EVENT ${type}`, data),
    /** Record a heartbeat marker so the last-active time is always discoverable. */
    heartbeat: data => emit('info', 'EVENT heartbeat', { pid: process.pid, ...data }),
    flush,
    flushSync,
    /** Re-export of the formatter for callers that need raw lines. */
    formatLine: formatLogLine,
  };
}
