/**
 * Launch observation for isolated sessions (issue #3209).
 *
 * An isolated session is tracked *before* its launch completes (issue #1946), so
 * it is addressable while a multi-gigabyte image is pulled or a Formal AI
 * sidecar starts. During that window neither `$ --status` nor `docker inspect`
 * knows the session, and "no record, not running" used to be read as "finished"
 * — with `exitCode: null`, which was then reported as "✅ finished successfully"
 * eleven seconds into a launch that later ran for 26 minutes and failed.
 *
 * Like the Formal AI sidecar lease (`containerSeen` in docker-sidecar.lib.mjs),
 * a tracked session therefore remembers whether its execution has ever been
 * observed:
 *
 *   - `launchPending`   — the launch call has not returned yet;
 *   - `launchedAt`      — when the launch call returned successfully;
 *   - `containerSeenAt` — first time the execution was observed (a `$` record,
 *                         a live backend, or a terminal exit code).
 *
 * A session that has never been observed is not finished: it is reported as
 * still running for a bounded launch grace, and once that grace expires it is
 * reported as "status unknown" with `launchUnobserved` set — never as a
 * success.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3209
 */

import { normalizeExitCode } from './session-status.lib.mjs';
import { sessionStartMs } from './session-monitor.stale-executing.lib.mjs';

/**
 * How long a launch that has not returned yet may go without its execution
 * being observed. Matches the sidecar lease's start grace: creating the task
 * container can wait for an image pull and a sidecar start.
 */
export const LAUNCH_PENDING_GRACE_MS = 60 * 60 * 1000;

/**
 * How long after a successful launch call the execution may still be missing
 * from `$ --status` and the backend before its status is declared unknown.
 */
export const LAUNCH_APPEAR_GRACE_MS = 2 * 60 * 1000;

/** Session-snapshot fields owned by this module (persisted by the session store). */
export const LAUNCH_STATE_FIELDS = ['launchPending', 'launchedAt', 'containerSeenAt'];

function toMs(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Record that the launch call for this session has started and not returned.
 *
 * @param {object} sessionInfo - Tracked session info (mutated in place)
 * @returns {object} The same session info
 */
export function markLaunchPending(sessionInfo) {
  if (sessionInfo && typeof sessionInfo === 'object') sessionInfo.launchPending = true;
  return sessionInfo;
}

/**
 * Record that the launch call returned successfully.
 *
 * @param {object} sessionInfo - Tracked session info (mutated in place)
 * @param {object} [options]
 * @param {number} [options.now] - Epoch milliseconds
 * @returns {object} The same session info
 */
export function markLaunchCompleted(sessionInfo, { now = Date.now() } = {}) {
  if (!sessionInfo || typeof sessionInfo !== 'object') return sessionInfo;
  delete sessionInfo.launchPending;
  sessionInfo.launchedAt = new Date(now).toISOString();
  return sessionInfo;
}

/**
 * Whether the polled state proves the execution exists or existed.
 *
 * @param {object} state - Result of getIsolationSessionState
 * @returns {boolean}
 */
export function isExecutionObserved(state) {
  if (!state) return false;
  // Issue #2303: kept tracked only because the status query failed is no observation.
  if (state.running === true && !state.awaitingLaunch && !state.unverifiedRunning) return true;
  if (state.statusResult?.exists === true && state.statusResult?.status) return true;
  return normalizeExitCode(state.exitCode) !== null;
}

/**
 * Whether the session's launch is still inside its grace window, and which one.
 *
 * Sessions that carry no launch bookkeeping at all (tracked after their launch
 * returned by an older bot, or by a path that does not record it) get no grace:
 * they are judged as before, except that an unobserved end is reported as
 * unknown instead of as a success.
 *
 * @param {object} sessionInfo
 * @param {number} now - Epoch milliseconds
 * @returns {{waiting: boolean, graceMs: number|null, elapsedMs: number|null, phase: string}}
 */
export function launchGraceStatus(sessionInfo, now = Date.now()) {
  if (sessionInfo?.launchPending === true) {
    const startMs = sessionStartMs(sessionInfo);
    const elapsedMs = startMs === null ? null : now - startMs;
    return { waiting: elapsedMs === null || elapsedMs < LAUNCH_PENDING_GRACE_MS, graceMs: LAUNCH_PENDING_GRACE_MS, elapsedMs, phase: 'launching' };
  }
  const launchedMs = toMs(sessionInfo?.launchedAt);
  if (launchedMs !== null) {
    const elapsedMs = now - launchedMs;
    return { waiting: elapsedMs < LAUNCH_APPEAR_GRACE_MS, graceMs: LAUNCH_APPEAR_GRACE_MS, elapsedMs, phase: 'launched' };
  }
  return { waiting: false, graceMs: null, elapsedMs: null, phase: 'untracked-launch' };
}

/**
 * Reconcile a polled isolation state with the session's launch history.
 *
 * - Observed now: remember it (`containerSeenAt`) and return the state as is.
 * - Observed before: the state is returned as is — the session really ended.
 * - Never observed, inside the launch grace: reported as still running
 *   (`awaitingLaunch: true`), so it is neither announced nor untracked.
 * - Never observed, grace expired: reported as ended with an unknown exit
 *   (`exitCode: null`, `launchUnobserved: true`).
 *
 * @param {string} sessionName
 * @param {object} sessionInfo - Tracked session info (mutated in place)
 * @param {object} state - Result of getIsolationSessionState
 * @param {object} [options]
 * @param {number} [options.now] - Epoch milliseconds
 * @param {boolean} [options.verbose]
 * @param {Function} [options.persistSnapshot]
 * @returns {object} The reconciled state
 */
export function reconcileLaunchObservation(sessionName, sessionInfo, state, { now = Date.now(), verbose = false, persistSnapshot = () => {} } = {}) {
  if (!sessionInfo || !state) return state;
  if (isExecutionObserved(state)) {
    if (!sessionInfo.containerSeenAt) {
      sessionInfo.containerSeenAt = new Date(now).toISOString();
      persistSnapshot();
      if (verbose) console.log(`[VERBOSE] Session ${sessionName}: execution observed for the first time`);
    }
    return state;
  }
  if (sessionInfo.containerSeenAt) return state;
  const grace = launchGraceStatus(sessionInfo, now);
  if (grace.waiting) {
    if (verbose) {
      const elapsed = grace.elapsedMs === null ? 'unknown time' : `${Math.round(grace.elapsedMs / 1000)}s`;
      console.log(`[VERBOSE] Session ${sessionName}: execution not observed yet (${grace.phase}, ${elapsed} into the ${Math.round(grace.graceMs / 1000)}s launch grace); keeping it tracked`);
    }
    return { ...state, running: true, exitCode: null, awaitingLaunch: true };
  }
  if (verbose) {
    console.log(`[VERBOSE] Session ${sessionName}: execution was never observed (${grace.phase}); its outcome is unknown`);
  }
  return { ...state, running: false, exitCode: null, launchUnobserved: true };
}

/**
 * Whether a latched completion (issue #2189) recorded no exit code for an
 * isolated session — the only kind of latch that may have been set before the
 * session's execution even started, so it is re-checked before finalizing.
 *
 * @param {object} sessionInfo
 * @returns {boolean}
 */
export function hasUnknownExitLatch(sessionInfo) {
  return Boolean(sessionInfo?.completionNotifiedAt && sessionInfo.isolationBackend && sessionInfo.sessionId) && normalizeExitCode(sessionInfo.completionExitCode) === null;
}

/**
 * Clear a latched completion because the session turned out to be running, so
 * its real end is reported with its real exit code.
 *
 * @param {string} sessionName
 * @param {object} sessionInfo - Tracked session info (mutated in place)
 * @param {object} [options]
 * @param {boolean} [options.verbose]
 * @param {Function} [options.persistSnapshot]
 * @param {Function} [options.logEvent]
 */
export function releaseCompletionLatch(sessionName, sessionInfo, { verbose = false, persistSnapshot = () => {}, logEvent = () => {} } = {}) {
  const notifiedAt = sessionInfo.completionNotifiedAt;
  delete sessionInfo.completionNotifiedAt;
  delete sessionInfo.completionExitCode;
  delete sessionInfo.completionStatus;
  persistSnapshot();
  logEvent('session_completion_unlatched', { sessionName, notifiedAt, reason: 'running-after-unknown-exit' });
  console.log(`Session ${sessionName} was reported as ended at ${notifiedAt} with an unknown exit code, but it is running; its real end will be reported`);
  if (verbose) console.log(`[VERBOSE] Session ${sessionName}: completion latch cleared`);
}
