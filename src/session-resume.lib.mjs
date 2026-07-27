#!/usr/bin/env node

/**
 * Issue #1927 (review follow-up): resume planning for killed `/solve` sessions.
 *
 * When a detached `/solve` session is OOM/SIGKILL-ed, the surviving parent
 * (the Telegram bot, or `/hive`) can relaunch the work with the AI tool's
 * `--resume <sessionId>` flow instead of starting from scratch. Two facts make
 * that safe and correct, and this module encodes both so every call site agrees:
 *
 *   1. **Use the LAST session id.** A single `/solve` run can spin up *many*
 *      tool sessions — auto-continue across usage-limit resets, uncommitted-
 *      changes restarts (`solve.watch`), and manual `--resume` chains. Every one
 *      prints a `Session ID:` marker to the captured log in chronological order.
 *      The most advanced context lives in the *last* of these, so resuming must
 *      pick the last id — never the first. {@link selectLastSessionId} and
 *      {@link readLastSessionIdFromLog} enforce that rule.
 *
 *   2. **Never storm.** Auto-resuming a killed session must be bounded so a job
 *      that reliably OOMs cannot spawn an infinite relaunch loop (which would be
 *      worse than the silent hang #1927 set out to fix). {@link planKilledSessionResume}
 *      caps the number of automatic resumes per session (default 1) and only ever
 *      acts on a session that actually *can* be resumed.
 *
 * The module is pure and dependency-free apart from an injectable `fs`, so it is
 * trivially unit-testable and importable from the bot, the monitor, or `/hive`
 * without pulling in heavy transitive dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';

// A tool session id printed to the log. Claude/codex/gemini all emit a
// `Session ID: <id>` marker (sometimes prefixed with 📌 and/or wrapped in
// backticks for Markdown). We capture the first non-space, non-backtick token
// after the label, which covers UUIDs and the slug-style ids other tools use.
const SESSION_ID_MARKER_RE = /Session ID:\s*`?([^\s`]+)`?/gi;

// Canonical UUID v4-ish shape used by Claude Code session ids and by the
// `<sessionId>.log` files start-command writes. Used to validate directory
// scans so unrelated `*.log` files are never mistaken for a session.
const SESSION_LOG_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LOG_SCAN_CHUNK_BYTES = 262144;
const LOG_SCAN_OVERLAP_BYTES = 1024;

/**
 * Extract every tool session id printed to a log, in the order they appear.
 *
 * Consecutive duplicates are collapsed (a single tool run prints its id more
 * than once — startup, completion, verbose footer — and that is one session,
 * not three) while still preserving order across genuinely different sessions.
 *
 * @param {string} text - Log text
 * @returns {string[]} Ordered session ids (possibly empty)
 */
export function extractSessionIds(text) {
  if (!text || typeof text !== 'string') return [];
  const ids = [];
  let match;
  SESSION_ID_MARKER_RE.lastIndex = 0;
  while ((match = SESSION_ID_MARKER_RE.exec(text)) !== null) {
    const id = match[1];
    // Skip obvious non-ids that can follow the label in prose/log output.
    if (!id || id.toLowerCase() === 'unknown' || id.toLowerCase() === 'n/a') continue;
    if (ids[ids.length - 1] !== id) ids.push(id);
  }
  return ids;
}

/**
 * The session id to resume from a log: the LAST one printed (requirement:
 * "when we have multiple sessions in a single /solve call we use last of them").
 *
 * @param {string} text - Log text
 * @returns {string|null}
 */
export function selectLastSessionId(text) {
  const ids = extractSessionIds(text);
  return ids.length > 0 ? ids[ids.length - 1] : null;
}

/**
 * Read the LAST tool session id from a `/solve` execution log. The file is
 * scanned backwards in bounded chunks: this normally stops after the tail
 * chunk, while still finding a valid marker that precedes a long tool trace.
 * Adjacent chunks overlap so a marker split at a chunk boundary is not lost.
 * Never throws — a missing/unreadable log yields `null`.
 *
 * @param {string} logPath
 * @param {Object} [options]
 * @param {Object} [options.fsImpl=fs] - Injectable fs (for tests)
 * @param {number} [options.tailBytes=262144] - Bytes per backwards scan chunk
 * @param {boolean} [options.verbose]
 * @returns {string|null}
 */
export function readLastSessionIdFromLog(logPath, options = {}) {
  const { fsImpl = fs, tailBytes = DEFAULT_LOG_SCAN_CHUNK_BYTES, verbose = false } = options;
  if (!logPath) return null;
  try {
    const stat = fsImpl.statSync(logPath);
    const chunkBytes = Number.isFinite(tailBytes) && tailBytes > 0 ? Math.floor(tailBytes) : DEFAULT_LOG_SCAN_CHUNK_BYTES;
    const fd = fsImpl.openSync(logPath, 'r');
    try {
      let end = stat.size;
      let laterPrefix = Buffer.alloc(0);
      let chunksScanned = 0;
      while (end > 0) {
        const start = Math.max(0, end - chunkBytes);
        const length = end - start;
        const buffer = Buffer.alloc(length);
        const bytesRead = fsImpl.readSync(fd, buffer, 0, length, start);
        const current = bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
        const scanBuffer = laterPrefix.length > 0 ? Buffer.concat([current, laterPrefix]) : current;
        const id = selectLastSessionId(scanBuffer.toString('utf8'));
        chunksScanned += 1;
        if (id) {
          if (verbose) {
            console.log(`[VERBOSE] session-resume: last tool session id in ${logPath} is ${id} (scanned ${chunksScanned} chunk${chunksScanned === 1 ? '' : 's'})`);
          }
          return id;
        }
        laterPrefix = current.subarray(0, Math.min(current.length, LOG_SCAN_OVERLAP_BYTES));
        end = start;
      }
      if (verbose) {
        console.log(`[VERBOSE] session-resume: no tool session id found in ${logPath} after scanning ${chunksScanned} chunk${chunksScanned === 1 ? '' : 's'}`);
      }
      return null;
    } finally {
      fsImpl.closeSync(fd);
    }
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] session-resume: could not read session id from ${logPath}: ${error.message}`);
    }
    return null;
  }
}

/**
 * Find the id of the most-recently-modified `<sessionId>.log` in a directory.
 *
 * This helper is safe only when `dir` is already known to contain logs for one
 * task. A shared start-command directory cannot attribute its newest UUID log
 * to a particular `/solve` run, so completion notifications must not use this
 * as a fallback. Never throws.
 *
 * @param {Object} options
 * @param {string} options.dir - Directory holding `<sessionId>.log` files
 * @param {Object} [options.fsImpl=fs] - Injectable fs (for tests)
 * @param {boolean} [options.verbose]
 * @returns {string|null}
 */
export function findLatestSessionLogId({ dir, fsImpl = fs, verbose = false } = {}) {
  if (!dir) return null;
  try {
    const entries = fsImpl.readdirSync(dir);
    let bestId = null;
    let bestMtime = -Infinity;
    for (const entry of entries) {
      if (!entry.endsWith('.log')) continue;
      const id = entry.slice(0, -'.log'.length);
      if (!SESSION_LOG_UUID_RE.test(id)) continue;
      let mtime;
      try {
        mtime = fsImpl.statSync(path.join(dir, entry)).mtimeMs;
      } catch {
        continue;
      }
      if (mtime > bestMtime) {
        bestMtime = mtime;
        bestId = id;
      }
    }
    if (verbose && bestId) {
      console.log(`[VERBOSE] session-resume: latest <sessionId>.log in ${dir} is ${bestId}`);
    }
    return bestId;
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] session-resume: could not scan ${dir} for session logs: ${error.message}`);
    }
    return null;
  }
}

function quoteArg(value) {
  const str = String(value);
  // Quote only when needed; keep already-safe tokens (URLs, flags) readable.
  if (/^[A-Za-z0-9_./:@=-]+$/.test(str)) return str;
  return `"${str.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/**
 * Drop any pre-existing `--resume`/`-r <id>` pair from an args array so a fresh
 * resume id can be appended without conflict. Pure; returns a new array.
 *
 * @param {string[]} args
 * @returns {string[]}
 */
export function stripResumeFlag(args) {
  if (!Array.isArray(args)) return [];
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--resume' || a === '-r') {
      i += 1; // skip the value too
      continue;
    }
    if (typeof a === 'string' && (a.startsWith('--resume=') || a.startsWith('-r='))) continue;
    out.push(a);
  }
  return out;
}

/**
 * Build the command that resumes a killed `/solve` session with its LAST tool
 * session id. Only `/solve` sessions are resumable this way — `/hive` and other
 * commands return `null` (the caller surfaces nothing rather than a bogus
 * command). When the original args were persisted they are reused verbatim
 * (minus any stale `--resume`); otherwise a minimal `<url> [--tool]` command is
 * reconstructed from the persisted session info.
 *
 * @param {Object} options
 * @param {Object} options.sessionInfo - Persisted session info (command/url/tool/args)
 * @param {string} options.lastSessionId - The session id to resume from
 * @param {string} [options.binary] - Override the invoked binary (default: the command)
 * @returns {{ binary: string, args: string[], display: string }|null}
 */
export function buildResumeCommand({ sessionInfo = {}, lastSessionId = null, binary = null } = {}) {
  if (!lastSessionId) return null;
  const command = sessionInfo.command || 'solve';
  if (command !== 'solve') return null; // only /solve is resumable via --resume
  const url = sessionInfo.url || (Array.isArray(sessionInfo.args) ? sessionInfo.args[0] : null);
  if (!url) return null;

  const commandAlias = typeof sessionInfo.commandAlias === 'string' && /^[a-z0-9_-]+$/i.test(sessionInfo.commandAlias) ? sessionInfo.commandAlias : null;
  const bin = binary || (commandAlias ? `/${commandAlias}` : command);
  let args;
  if (Array.isArray(sessionInfo.args) && sessionInfo.args.length > 0) {
    args = stripResumeFlag(sessionInfo.args);
  } else {
    args = [url];
    if (sessionInfo.tool && sessionInfo.tool !== 'claude') args.push('--tool', sessionInfo.tool);
  }
  args = [...args, '--resume', lastSessionId];
  return { binary: bin, args, display: `${bin} ${args.map(quoteArg).join(' ')}` };
}

/**
 * Decide whether — and how — a killed `/solve` session should be auto-resumed by
 * a surviving parent, bounding the number of automatic attempts so a reliably
 * crashing job can never storm.
 *
 * @param {Object} options
 * @param {Object} options.sessionInfo - Persisted session info
 * @param {string|null} [options.lastSessionId] - LAST tool session id (from the log)
 * @param {number} [options.attempts=0] - Resume attempts already made for this session
 * @param {number} [options.maxAttempts=1] - Hard cap on automatic resumes
 * @returns {{ resumable: boolean, reason: string, command: object|null, attempt: number }}
 */
export function planKilledSessionResume({ sessionInfo = {}, lastSessionId = null, attempts = 0, maxAttempts = 1 } = {}) {
  if (!lastSessionId) {
    return { resumable: false, reason: 'no-session-id', command: null, attempt: attempts };
  }
  const command = buildResumeCommand({ sessionInfo, lastSessionId });
  if (!command) {
    return { resumable: false, reason: 'not-resumable', command: null, attempt: attempts };
  }
  if (attempts >= maxAttempts) {
    return { resumable: false, reason: 'max-attempts-reached', command, attempt: attempts };
  }
  return { resumable: true, reason: 'ready', command, attempt: attempts + 1 };
}

/**
 * Markdown section surfaced under a killed-session completion message so an
 * operator (or an automation) can resume the work with one copy-paste. Purely
 * additive — returns `''` when there is nothing to resume.
 *
 * @param {Object} options
 * @param {string|null} options.lastSessionId
 * @param {{ display: string }|null} options.command
 * @returns {string}
 */
export function formatResumeSection({ lastSessionId = null, command = null } = {}) {
  if (!lastSessionId || !command) return '';
  return `♻️ *Resume from last session* \`${lastSessionId}\`:\n\`\`\`\n${command.display}\n\`\`\``;
}
