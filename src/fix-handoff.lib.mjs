/**
 * The `/fix` → `solve` handoff, as read back from a session log (issue #2803).
 *
 * `/fix` creates an issue and then runs `solve <new issue URL> ...` in the same
 * container. The bot only knows the session as `fix <repository URL> --ci-cd`,
 * so when the container OOM killer killed Claude in link-assistant/web-capture#178
 * the bot could neither resume the work ("not-resumable": only `solve` takes
 * `--resume`) nor find the pull request to report on (the `/fix` URL context
 * names a repository, not an issue). Both answers are in the log: `fix.mjs`
 * prints the exact solve command it starts. This module reads it back and
 * describes the session as the `solve` it became.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2803
 */

import fs from 'node:fs';

/** Machine-readable line printed by `fix.mjs` right before it starts solve. */
export const FIX_HANDOFF_MARKER = '🧭 [FIX-HANDOFF]';

/** The handoff is printed within the first lines of the session; never read further. */
export const FIX_HANDOFF_HEAD_BYTES = 1024 * 1024;

const ISSUE_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)$/;
const MARKER_LINE_RE = /🧭 \[FIX-HANDOFF\] (\{[^\n]*\})/;
// Logs written before the marker existed only have the human-readable line.
const LEGACY_LINE_RE = /🚀 Starting \/solve: solve (https:\/\/github\.com\/\S+\/issues\/\d+)([^\n]*)/;

/**
 * @param {string[]} solveArgs - Arguments `fix.mjs` passes to solve (issue URL first)
 * @returns {string} the log line
 */
export function formatFixHandoff(solveArgs) {
  return `${FIX_HANDOFF_MARKER} ${JSON.stringify({ command: 'solve', args: [...solveArgs] })}`;
}

function describeHandoff(args, source) {
  const issueUrl = args[0];
  const match = typeof issueUrl === 'string' ? issueUrl.match(ISSUE_URL_RE) : null;
  if (!match) return null;
  return { command: 'solve', issueUrl, args, source, urlContext: { type: 'issue', owner: match[1], repo: match[2], number: Number(match[3]), normalized: issueUrl } };
}

/**
 * @param {string} text - Head of a `/fix` session log
 * @returns {{command: 'solve', issueUrl: string, args: string[], source: 'marker'|'legacy', urlContext: Object}|null}
 */
export function parseFixHandoff(text) {
  if (!text) return null;
  const value = String(text);
  const marker = value.match(MARKER_LINE_RE);
  if (marker) {
    try {
      const parsed = JSON.parse(marker[1]);
      if (parsed?.command === 'solve' && Array.isArray(parsed.args) && parsed.args.every(arg => typeof arg === 'string')) {
        const handoff = describeHandoff(parsed.args, 'marker');
        if (handoff) return handoff;
      }
    } catch {
      // A truncated marker line falls through to the human-readable one.
    }
  }
  const legacy = value.match(LEGACY_LINE_RE);
  if (!legacy) return null;
  // fix.mjs joined the arguments with spaces; options never contain spaces.
  return describeHandoff([legacy[1], ...legacy[2].trim().split(/\s+/).filter(Boolean)], 'legacy');
}

/**
 * Read the handoff from the head of a session log. Never throws.
 *
 * @param {string|null} logPath
 * @param {Object} [options]
 * @param {Object} [options.fsImpl=fs] - Injectable fs (sync API)
 * @param {number} [options.maxBytes]
 * @param {boolean} [options.verbose]
 */
export function readFixHandoffFromLog(logPath, { fsImpl = fs, maxBytes = FIX_HANDOFF_HEAD_BYTES, verbose = false } = {}) {
  if (!logPath) return null;
  let fd = null;
  try {
    fd = fsImpl.openSync(logPath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fsImpl.readSync(fd, buffer, 0, maxBytes, 0);
    const handoff = parseFixHandoff(buffer.subarray(0, bytesRead).toString('utf8'));
    if (verbose) console.log(`[VERBOSE] fix-handoff: ${handoff ? `${logPath} hands off to solve ${handoff.issueUrl} (${handoff.source})` : `no solve handoff in the first ${bytesRead} bytes of ${logPath}`}`);
    return handoff;
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] fix-handoff: could not read ${logPath}: ${error?.message || error}`);
    return null;
  } finally {
    if (fd !== null) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        // already closed
      }
    }
  }
}

/**
 * The session as the bot can resume and report on it: a `solve` session as is,
 * a `/fix` session as the solve it handed off to, anything else `null`.
 *
 * @param {Object} sessionInfo
 * @param {Object} [options]
 * @param {string|null} [options.logPath]
 * @param {Function} [options.readHandoff] - Override for tests
 * @param {boolean} [options.verbose]
 * @returns {Object|null}
 */
export function resolveSolveSessionInfo(sessionInfo, { logPath = null, readHandoff = readFixHandoffFromLog, verbose = false } = {}) {
  const command = sessionInfo?.command || 'solve';
  if (command === 'solve') return sessionInfo || {};
  if (command !== 'fix') return null;
  const handoff = readHandoff(logPath || sessionInfo?.logPath || null, { verbose });
  if (!handoff) return null;
  return { ...sessionInfo, command: 'solve', commandAlias: null, url: handoff.issueUrl, args: [...handoff.args], urlContext: handoff.urlContext, fixHandoff: { issueUrl: handoff.issueUrl, source: handoff.source } };
}

export default { FIX_HANDOFF_MARKER, FIX_HANDOFF_HEAD_BYTES, formatFixHandoff, parseFixHandoff, readFixHandoffFromLog, resolveSolveSessionInfo };
