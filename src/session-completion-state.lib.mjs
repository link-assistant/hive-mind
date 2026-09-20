/**
 * Terminal, persisted "this session has been reported" state (issue #2189).
 *
 * The captured incident shows what happens without it. A `/solve` session was
 * killed at 14:07:49Z; the monitor detected the completion, ran the full
 * completion pipeline, and something late in that pipeline threw. The session
 * was therefore kept in memory "so the completion notification can be retried",
 * and every subsequent poll started the whole pipeline again — four
 * `Session … has finished. Sending notification` lines, three
 * `was killed; offering resume from last session` lines. Each of those cycles
 *
 *   - re-resolved the linked pull request over the network,
 *   - re-scanned a 134 MB working-session log for the last tool session id,
 *   - re-stat'ed a 27 GB docker writable layer,
 *   - and re-sent the notification the user had already received.
 *
 * The bot's RSS climbed from 1.78 GB to 1.84 GB against a ~2 GB heap cap while
 * it did so. The requirement from the issue is exact: "a killed session must
 * reach a terminal, persisted, handled state after its notification is delivered
 * once", and "per-cycle work must not be O(log size) — cache the recovered
 * session id in the session record".
 *
 * This module owns both halves of that:
 *
 *   1. {@link markCompletionHandled} / {@link isCompletionHandled} — the
 *      handled latch. It is written to the durable session snapshot, so it also
 *      survives a bot restart between "notification delivered" and "session
 *      untracked": a reloaded session that was already reported is finalized
 *      silently instead of notifying the user a second time.
 *   2. {@link resolveCachedLastToolSessionId} — a memoized, snapshot-backed
 *      read of the last `Session ID:` marker in the working-session log. The
 *      log is scanned at most once per session, and a scan that found nothing
 *      is remembered as such (an empty string) so a fruitless multi-gigabyte
 *      scan is never repeated either.
 *
 * Pure and dependency-light: the log reader and the clock are injectable, so
 * every branch is testable without a real log or a real bot.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { readLastSessionIdFromLog } from './session-resume.lib.mjs';

/**
 * Fields this module writes on a tracked session. They are persisted (see
 * `PERSISTABLE_FIELDS` in session-store.lib.mjs) precisely so the latch and the
 * cache survive the restart that would otherwise replay the whole pipeline.
 */
export const COMPLETION_STATE_FIELDS = ['completionNotifiedAt', 'completionExitCode', 'completionStatus', 'lastToolSessionId'];

/**
 * Whether this session's completion notification was already delivered.
 *
 * @param {Object|null} sessionInfo
 * @returns {boolean}
 */
export function isCompletionHandled(sessionInfo) {
  return typeof sessionInfo?.completionNotifiedAt === 'string' && sessionInfo.completionNotifiedAt.length > 0;
}

/**
 * Latch this session as reported, recording the outcome that was reported so a
 * later finalize does not have to re-derive it.
 *
 * Idempotent: a second call keeps the first timestamp, because the first
 * delivery is the one the user saw.
 *
 * @param {Object} sessionInfo - Tracked session info (mutated in place)
 * @param {Object} [options]
 * @param {number|null} [options.exitCode] - Exit code that was reported
 * @param {string|null} [options.status] - Terminal status that was reported
 * @param {Function} [options.now] - Injectable clock returning a Date
 * @returns {boolean} True when this call is the one that latched it
 */
export function markCompletionHandled(sessionInfo, { exitCode = null, status = null, now = () => new Date() } = {}) {
  if (!sessionInfo || typeof sessionInfo !== 'object') return false;
  if (isCompletionHandled(sessionInfo)) return false;
  sessionInfo.completionNotifiedAt = now().toISOString();
  sessionInfo.completionExitCode = Number.isFinite(exitCode) ? exitCode : null;
  sessionInfo.completionStatus = status || null;
  return true;
}

/**
 * The last tool session id for this session, scanning the working-session log at
 * most once.
 *
 * A session that has been scanned carries a string: the id, or `''` for "the log
 * has no usable marker". Both are answers, and neither is worth paying for
 * twice — the scan walks the log backwards in bounded chunks, but on a 134 MB
 * log with no marker in the tail that is still a full read of the file, per
 * poll, per session.
 *
 * @param {Object} options
 * @param {Object|null} options.sessionInfo - Tracked session info (mutated in place)
 * @param {string|null} [options.logPath] - Working-session log to scan
 * @param {boolean} [options.verbose]
 * @param {Function} [options.readLastSessionId] - Override for tests
 * @returns {{id: string|null, cached: boolean, scanned: boolean}}
 */
export function resolveCachedLastToolSessionId({ sessionInfo = null, logPath = null, verbose = false, readLastSessionId = readLastSessionIdFromLog } = {}) {
  const cached = sessionInfo?.lastToolSessionId;
  if (typeof cached === 'string') {
    if (verbose && cached) {
      console.log(`[VERBOSE] session-completion-state: reusing cached last tool session id ${cached} (log not re-scanned)`);
    }
    return { id: cached || null, cached: true, scanned: false };
  }
  let id;
  try {
    id = readLastSessionId(logPath, { verbose }) || null;
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] session-completion-state: could not read last tool session id from ${logPath}: ${error?.message || error}`);
    }
    // A read error is not an answer — leave the cache unset so a later poll,
    // once the log is readable again, can still find the id.
    return { id: null, cached: false, scanned: false };
  }
  if (sessionInfo && typeof sessionInfo === 'object') sessionInfo.lastToolSessionId = id || '';
  return { id, cached: false, scanned: true };
}

export default { COMPLETION_STATE_FIELDS, isCompletionHandled, markCompletionHandled, resolveCachedLastToolSessionId };
