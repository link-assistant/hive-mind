/**
 * Issue #2303: a docker "exit 0" that docker itself never observed.
 *
 * start-command's detached docker watcher (0.34.0) runs
 *
 *   docker logs -f C >> LOG; state=$(docker inspect C); if exit==0 → docker rm -f C
 *
 * When the host disk fills up, `docker logs -f >> LOG` fails with ENOSPC and
 * returns while the container is STILL RUNNING. `docker inspect` on a running
 * container reports `ExitCode 0`, `OOMKilled false` and the zero `FinishedAt`
 * (`0001-01-01T00:00:00Z`), so the watcher mistakes the live session for a
 * clean exit: it removes the container — which is what actually kills the
 * work — writes an `Exit Code: 0` footer from the same bogus value, and
 * finalizes the record as `executed` / `0`. Hive Mind then reported
 * "✅ Work session finished successfully" for a session that was killed.
 *
 * The one fact start-command gets right is that docker never produced a finish
 * time: the record says `endTimeSource: 'observed-at'` instead of
 * `'docker-finished-at'`, which every container that really exited has. A
 * docker "success" without a docker finish time is therefore not a success we
 * observed, and it is reported as a kill so the diagnosis and the automatic
 * `--on-session-kill=resume` recovery run.
 *
 * The footer does not help here: it is written by the same watcher from the same
 * inspect result, so it is not independent evidence.
 *
 * start-command 0.34.1 fixed the watcher (link-foundation/start#174): it now
 * waits for the real exit and never removes a running container. A container
 * whose exit docker still never observed (e.g. removed from under the watcher)
 * is recorded as `exitCode -1` with `exitReason: 'watcher-lost-container'`.
 * That is still a kill, not an ordinary failure, so it is reclassified the same
 * way — both shapes are handled so older hosts keep working.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2303
 */

import { normalizeExitCode } from './session-status.lib.mjs';
import { isDockerIsolation } from './session-monitor.stale-executing.lib.mjs';

/** start-command's `endTimeSource` for "we noticed it ended", not "it ended". */
export const END_TIME_SOURCE_OBSERVED_AT = 'observed-at';

/** start-command >= 0.34.1 `exitReason` for a container exit docker never observed. */
export const EXIT_REASON_WATCHER_LOST_CONTAINER = 'watcher-lost-container';

/** Status the reclassified session is reported with. */
export const UNOBSERVED_EXIT_STATUS = 'killed';

const SUCCESS_STATUSES = new Set(['executed', 'completed']);

/**
 * Decide whether a terminal docker session's success was never observed by
 * docker.
 *
 * @param {Object} params
 * @param {Object|null} params.sessionInfo
 * @param {Object|null} params.statusResult - `$ --status` payload
 * @param {number|string|null} params.exitCode - Resolved exit code
 * @param {string|null} params.status - Resolved status
 * @param {boolean} [params.running] - The session is still running
 * @returns {string|null} Human-readable reason, or null when the exit is trustworthy
 */
export function detectUnobservedDockerExit({ sessionInfo = null, statusResult = null, exitCode = null, status = null, running = false } = {}) {
  if (running) return null;
  if (!isDockerIsolation(sessionInfo, statusResult)) return null;
  const code = normalizeExitCode(exitCode);
  const observedAt = statusResult?.observedAt || statusResult?.endTime || null;
  if (statusResult?.exitReason === EXIT_REASON_WATCHER_LOST_CONTAINER) {
    return `start-command lost the container: docker never reported a finish time for it (exitReason=${EXIT_REASON_WATCHER_LOST_CONTAINER}, exit ${code ?? 'unknown'}${observedAt ? `, noticed at ${observedAt}` : ''}) — it was removed or stopped from under the session`;
  }
  if (statusResult?.endTimeSource !== END_TIME_SOURCE_OBSERVED_AT) return null;
  const normalizedStatus = String(status || '')
    .trim()
    .toLowerCase();
  const reportedSuccess = code === 0 || (code === null && SUCCESS_STATUSES.has(normalizedStatus));
  if (!reportedSuccess) return null;
  return `start-command reported exit ${code ?? 0}, but docker never reported a finish time for the container (endTimeSource=observed-at${observedAt ? ` at ${observedAt}` : ''}): its completion watcher stopped following a container that was still running — e.g. \`docker logs -f\` failed writing the log on a full disk — and removed it`;
}

/**
 * Rewrite a terminal isolation state whose docker success was never observed
 * into a kill. Returns the input object untouched when nothing is wrong, so the
 * caller can wrap every return path unconditionally.
 *
 * @param {string} sessionName
 * @param {Object} sessionInfo
 * @param {{running: boolean, exitCode: number|null, status: string|null, statusResult: Object|null}} state
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 * @returns {Object} The (possibly corrected) state
 */
export function reclassifyUnobservedDockerExit(sessionName, sessionInfo, state, { verbose = false } = {}) {
  if (!state || state.running) return state;
  const statusResult = state.statusResult || null;
  const reason = detectUnobservedDockerExit({ sessionInfo, statusResult, exitCode: state.exitCode, status: state.status });
  if (!reason) return state;
  if (verbose) {
    console.log(`[VERBOSE] Session ${sessionName}: not trusting the reported success — ${reason}; reporting it as ${UNOBSERVED_EXIT_STATUS} (issue #2303)`);
  }
  const reportedExitCode = normalizeExitCode(state.exitCode ?? statusResult?.exitCode);
  return {
    ...state,
    running: false,
    exitCode: null,
    status: UNOBSERVED_EXIT_STATUS,
    unobservedExit: reason,
    statusResult: { ...statusResult, status: UNOBSERVED_EXIT_STATUS, exitCode: null, reportedExitCode, reportedStatus: statusResult?.status ?? state.status ?? null, unobservedExit: reason },
  };
}
