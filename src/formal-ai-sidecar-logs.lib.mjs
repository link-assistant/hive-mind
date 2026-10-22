/**
 * What the Formal AI sidecar prints, read before it is lost (issue #3583).
 *
 * Formal AI reports its own trouble on stdout as structured `formal-ai-log-v1`
 * records, and before issue #3583 Hive Mind never read them. A sidecar whose
 * memory volume it could not write logged `kind logging_failure` 381 times in
 * one life, kept neither dialogs nor memory, and nobody saw it; then `docker rm`
 * on stop, replace or the idle unload (issue #2305) took the stdout with it.
 *
 * This module owns both halves:
 *
 *   1. **Startup check.** Once `/health` answers, the sidecar's first lines are
 *      read. A `logging_failure` record there becomes a warning in the bot log
 *      and, through the lease, in the solve log of every task it serves.
 *   2. **Archive before removal.** `docker logs --timestamps` is copied to
 *      `formal-ai-sidecar-<start time>.log` in the bot log directory before any
 *      code path removes the container, and old copies are pruned.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3583
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { resolveBotLogDir } from './bot-logger.lib.mjs';
import { dockerExecFileAsync } from './docker-pull-detached.lib.mjs';
import { DEFAULT_DOCKER_TIMEOUT_MS, dockerErrorMessage, dockerText } from './docker-sidecar.lib.mjs';

const LOG_PREFIX = 'formal-ai-sidecar';

/** Formal AI's record kind for a log or memory file it could not write. */
export const FORMAL_AI_LOGGING_FAILURE_KIND = 'logging_failure';

/** File name prefix of an archived sidecar log, inside the bot log directory. */
export const FORMAL_AI_SIDECAR_LOG_PREFIX = 'formal-ai-sidecar-';

/** How many archived sidecar logs are kept by default (one per sidecar life). */
export const DEFAULT_FORMAL_AI_SIDECAR_LOG_KEEP = 50;

/** Lines read from a freshly started sidecar; the first `logging_failure` is at sequence 2. */
export const FORMAL_AI_STARTUP_LOG_LINES = 200;

// Archiving can copy hours of debug output, so it gets more time than a plain
// docker call, but never so much that a stuck daemon holds the sidecar lock.
const ARCHIVE_TIMEOUT_MS = 5 * 60_000;
// Only for a caller-supplied runner; the shared runner streams to disk instead.
const ARCHIVE_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/** `(field <name> (string <value>))` → the URL-decoded value, or null. */
const readStringField = (line, name) => {
  const match = line.match(new RegExp(`\\(field ${name} \\(string ([^()\\s]*)\\)\\)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

/** The per-exchange error the dialog log prints when it cannot write (Formal AI 0.354.1). */
const DIALOG_LOG_FAILURE_PREFIX = '[dialog-log] failed to record exchange';

/**
 * Find Formal AI's logging failures in its stdout.
 *
 * The record (Formal AI 0.354.1) is one Links Notation line per event:
 * `(formal-ai-log-v1 (object … (field kind (string logging_failure)) …
 * (field message (string logging_failed_check_…)) … (field reason (string
 * file_write_failed)) …))`, optionally behind a `docker logs --timestamps` stamp.
 * The dialog log reports its own failures as `native_diagnostic` errors whose
 * message starts with `[dialog-log] failed to record exchange`; both count.
 *
 * @returns {{count: number, reasons: string[], messages: string[], firstLine: string|null}}
 */
export const parseFormalAiLoggingFailures = text => {
  const reasons = new Set();
  const messages = new Set();
  let count = 0;
  let firstLine = null;
  for (const line of String(text ?? '').split('\n')) {
    if (!line.includes('formal-ai-log-v1')) continue;
    const message = readStringField(line, 'message');
    if (readStringField(line, 'kind') !== FORMAL_AI_LOGGING_FAILURE_KIND && !message?.startsWith(DIALOG_LOG_FAILURE_PREFIX)) continue;
    count += 1;
    if (firstLine === null) firstLine = line.trim();
    const reason = readStringField(line, 'reason');
    if (reason) reasons.add(reason);
    if (message) messages.add(message.trim());
  }
  return { count, reasons: [...reasons], messages: [...messages], firstLine };
};

/** The warning issue #3583 asks for, or null when there was no logging failure. */
export const describeFormalAiLoggingFailure = (failures, { memoryVolume = null, memoryMount = null } = {}) => {
  if (!failures?.count) return null;
  const details = [[...failures.reasons, ...failures.messages].join(', ') || FORMAL_AI_LOGGING_FAILURE_KIND, `${failures.count} failure record(s) at startup`];
  if (memoryVolume) details.push(`check that volume '${memoryVolume}'${memoryMount ? ` at ${memoryMount}` : ''} is writable by box`);
  return `Formal AI cannot write its logs or memory (${details.join('; ')}): dialogs of this session will not be kept`;
};

/**
 * Read a freshly started sidecar's first lines and report a logging failure.
 *
 * Never throws: a sidecar whose logs cannot be read is still a healthy sidecar.
 *
 * @returns {Promise<{warning: string|null, failures: object|null, error: string|null}>}
 */
export const checkFormalAiSidecarLogging = async ({ containerName, memoryVolume = null, memoryMount = null, run = dockerExecFileAsync, timeoutMs, lines = FORMAL_AI_STARTUP_LOG_LINES } = {}) => {
  try {
    // `--tail` bounds what is read from a sidecar adopted after a bot restart;
    // a fresh one has printed far fewer lines than this.
    const result = await run('docker', ['logs', '--tail', String(lines), containerName], { encoding: 'utf8', timeout: timeoutMs ?? DEFAULT_DOCKER_TIMEOUT_MS });
    const failures = parseFormalAiLoggingFailures(`${result?.stdout ?? ''}\n${result?.stderr ?? ''}`);
    return { warning: describeFormalAiLoggingFailure(failures, { memoryVolume, memoryMount }), failures, error: null };
  } catch (error) {
    return { warning: null, failures: null, error: dockerErrorMessage(error) };
  }
};

/** Where archived sidecar logs go: the bot log directory (HIVE_MIND_LOG_DIR or ~/.hive-mind/logs). */
export const resolveFormalAiSidecarLogDir = (env = process.env) => resolveBotLogDir(env);

/** `HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP`: archived logs to keep; 0 turns archiving off. */
export const resolveFormalAiSidecarLogKeep = (env = process.env) => {
  const raw = String(env.HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP ?? '').trim();
  if (!raw) return DEFAULT_FORMAL_AI_SIDECAR_LOG_KEEP;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_FORMAL_AI_SIDECAR_LOG_KEEP;
};

/** `2026-10-20T08:27:40.061753117Z` → `2026-10-20T08-27-40-061Z`, safe on every filesystem and sortable. */
export const formatFormalAiSidecarLogStamp = startedAt => {
  const parsed = new Date(startedAt);
  const iso = Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
  return iso.replace(/[:.]/g, '-');
};

/** Archive path for a sidecar that started at `startedAt`. */
export const resolveFormalAiSidecarLogPath = ({ startedAt, env = process.env } = {}) => path.join(resolveFormalAiSidecarLogDir(env), `${FORMAL_AI_SIDECAR_LOG_PREFIX}${formatFormalAiSidecarLogStamp(startedAt)}.log`);

/** Delete all but the newest `keep` archives; names embed the start time, so they sort chronologically. */
export const pruneFormalAiSidecarLogs = async ({ dir, keep, fsImpl = fs } = {}) => {
  let entries;
  try {
    entries = await fsImpl.promises.readdir(dir);
  } catch {
    return [];
  }
  const archives = entries.filter(name => name.startsWith(FORMAL_AI_SIDECAR_LOG_PREFIX) && name.endsWith('.log')).sort();
  const pruned = archives.slice(0, Math.max(0, archives.length - keep));
  for (const name of pruned) await fsImpl.promises.rm(path.join(dir, name), { force: true });
  return pruned;
};

/**
 * Stream `docker logs` into a file instead of buffering it: a sidecar that ran
 * for hours at debug level prints far more than `execFile`'s 1 MiB default.
 */
const streamDockerLogsToFile = async (args, filePath, { spawnImpl = spawn, timeoutMs, fsImpl = fs }) => {
  const handle = await fsImpl.promises.open(filePath, 'w');
  try {
    await new Promise((resolve, reject) => {
      const child = spawnImpl('docker', args, { stdio: ['ignore', handle.fd, handle.fd] });
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(Object.assign(new Error(`docker ${args.join(' ')} exited with ${signal ? `signal ${signal}` : `code ${code}`}`), { code }));
      });
    });
  } finally {
    await handle.close();
  }
};

/** When Docker says the container started; null when it cannot be read. */
const readContainerStartedAt = async (containerName, { run, timeoutMs }) => {
  try {
    const startedAt = await dockerText(run, ['inspect', containerName, '--format', '{{.State.StartedAt}}'], { timeoutMs });
    return startedAt && !startedAt.startsWith('0001-') ? startedAt : null;
  } catch {
    return null;
  }
};

/**
 * Copy a sidecar's stdout to the bot log directory before it is removed.
 *
 * Must be called by every code path that runs `docker rm` on a sidecar. Never
 * throws: failing to keep the log must not keep a broken sidecar alive.
 *
 * @returns {Promise<{archived: boolean, path: string|null, bytes: number, pruned: string[], error: string|null}>}
 */
export const archiveFormalAiSidecarLogs = async ({ containerName, env = process.env, fsImpl = fs, run = dockerExecFileAsync, spawnImpl, timeoutMs, startedAt = null, log = null, verbose = false, now = () => new Date() } = {}) => {
  const keep = resolveFormalAiSidecarLogKeep(env);
  if (keep === 0) return { archived: false, path: null, bytes: 0, pruned: [], error: 'HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP is 0' };

  const archiveTimeoutMs = Math.max(Number(timeoutMs) || 0, ARCHIVE_TIMEOUT_MS);
  const started = (await readContainerStartedAt(containerName, { run, timeoutMs })) || startedAt || now().toISOString();
  const filePath = resolveFormalAiSidecarLogPath({ startedAt: started, env });
  const args = ['logs', '--timestamps', containerName];
  try {
    await fsImpl.promises.mkdir(path.dirname(filePath), { recursive: true });
    if (run === dockerExecFileAsync) {
      await streamDockerLogsToFile(args, filePath, { spawnImpl, timeoutMs: archiveTimeoutMs, fsImpl });
    } else {
      const result = await run('docker', args, { encoding: 'utf8', timeout: archiveTimeoutMs, maxBuffer: ARCHIVE_MAX_BUFFER_BYTES });
      await fsImpl.promises.writeFile(filePath, `${result?.stdout ?? ''}${result?.stderr ?? ''}`);
    }
    const { size } = await fsImpl.promises.stat(filePath);
    const pruned = await pruneFormalAiSidecarLogs({ dir: path.dirname(filePath), keep, fsImpl });
    if (log) await log(`📝 Formal AI sidecar log saved to ${filePath} (${size} bytes)`);
    if (verbose && log && pruned.length > 0) await log(`[VERBOSE] ${LOG_PREFIX}: pruned ${pruned.length} old sidecar log(s), keeping ${keep}`);
    return { archived: true, path: filePath, bytes: size, pruned, error: null };
  } catch (error) {
    const message = dockerErrorMessage(error);
    if (log) await log(`⚠️ Could not save the Formal AI sidecar log of '${containerName}' to ${filePath}: ${message}`);
    return { archived: false, path: filePath, bytes: 0, pruned: [], error: message };
  }
};

export default { archiveFormalAiSidecarLogs, checkFormalAiSidecarLogging, describeFormalAiLoggingFailure, parseFormalAiLoggingFailures, pruneFormalAiSidecarLogs, resolveFormalAiSidecarLogDir, resolveFormalAiSidecarLogKeep, resolveFormalAiSidecarLogPath };
