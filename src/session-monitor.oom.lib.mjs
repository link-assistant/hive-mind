/**
 * Verified out-of-memory classification for tracked isolation sessions.
 *
 * Issue #2015 made `oomKilled: true` in a `$ --status` record terminal so an
 * OOM-killed session could not be polled forever. Issue #2134 showed the other
 * half of the problem: Docker's `State.OOMKilled` is a *container* flag, not a
 * statement about the container's main process. The kernel sets it when ANY
 * process in the container cgroup is OOM-killed, and it stays `true` afterwards
 * — so a container can be flagged, keep running, and exit 0 (see
 * https://github.com/moby/moby/issues/47618).
 *
 * That is exactly what happened in #2134: the host ran out of memory, the OOM
 * killer terminated a child process, `$ --status` flipped to
 * `executed / exitCode 137`, and Hive Mind announced
 * "Work session killed — out of memory or forced kill (SIGKILL)" while
 * `docker inspect` still reported the container **running**. The session went on
 * for another 3.5 hours and auto-merged its pull request, unmonitored.
 *
 * This module keeps #2015's guarantee (a truly OOM-killed session is terminal)
 * while refusing to declare a kill that is contradicted by stronger evidence,
 * following the same ladder the rest of the monitor already uses:
 *
 *   1. The log FOOTER wins. A written `Exit Code: N` is proof of how the command
 *      actually ended — including `Exit Code: 0`, which means the session merely
 *      *survived* an OOM event.
 *   2. LIVENESS beats the status record. No footer + the backing container is
 *      still alive → the session is still running; keep polling and remember the
 *      OOM event so the eventual completion can report the recovery.
 *   3. Otherwise report `oom-killed`, exactly as issue #2015 requires.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2015
 * @see https://github.com/link-assistant/hive-mind/issues/2134
 */

import { classifyExitStatus, normalizeExitCode } from './session-status.lib.mjs';

/**
 * Field written on the persisted session snapshot the first time an OOM event is
 * observed for a session that is still alive. It survives a bot restart, so the
 * completion message can still say "recovered from out of memory" hours later.
 */
export const OOM_EVENT_OBSERVED_FIELD = 'oomEventObservedAt';

/**
 * Remember that the kernel OOM killer fired inside this session's container.
 * Idempotent: only the FIRST observation timestamp is kept.
 *
 * @param {Object} sessionInfo - Mutable persisted session info
 * @param {Function} [persistSnapshot] - Callback that mirrors sessionInfo to disk
 * @returns {boolean} True when this call recorded a new observation
 */
export function markOomEventObserved(sessionInfo, persistSnapshot) {
  if (!sessionInfo || sessionInfo[OOM_EVENT_OBSERVED_FIELD]) return false;
  sessionInfo[OOM_EVENT_OBSERVED_FIELD] = new Date().toISOString();
  if (typeof persistSnapshot === 'function') persistSnapshot();
  return true;
}

/**
 * Whether an OOM event was observed for this session while it was running.
 *
 * @param {Object} sessionInfo
 * @returns {string|null} ISO timestamp of the first observation, or null
 */
export function getOomEventObservedAt(sessionInfo) {
  return sessionInfo?.[OOM_EVENT_OBSERVED_FIELD] || null;
}

async function probeBackendAlive(sessionName, sessionInfo, { verbose, runner, backendAlive }) {
  if (!sessionInfo?.isolationBackend) return null;
  const probe = backendAlive || runner?.checkBackendSessionAlive;
  if (!probe) return null;
  try {
    return await probe(sessionInfo.sessionId || sessionName, sessionInfo.isolationBackend, verbose);
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] Session ${sessionName} OOM liveness probe failed: ${error?.message || error}`);
    }
    return null;
  }
}

/**
 * Resolve the real state of a session whose status record carries
 * `oomKilled: true`.
 *
 * @param {string} sessionName
 * @param {Object} sessionInfo
 * @param {Object} statusResult - Parsed `$ --status` payload
 * @param {Object} deps
 * @param {boolean} [deps.verbose]
 * @param {Object} deps.runner - Isolation runner (for its default probes)
 * @param {Function} [deps.exitFromLog] - Injectable footer reader
 * @param {Function} [deps.backendAlive] - Injectable liveness probe
 * @param {Function} [deps.persistSnapshot] - Persist the session snapshot
 * @returns {Promise<Object>} Monitor state object
 */
export async function resolveOomKilledState(sessionName, sessionInfo, statusResult, { verbose, runner, exitFromLog, backendAlive, persistSnapshot } = {}) {
  const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
  let footer = null;
  if (logPath) {
    const readFooter = exitFromLog || runner?.readSessionExitFromLog;
    footer = readFooter ? readFooter(logPath, { verbose }) : null;
  }

  // 1. The authoritative log footer.
  if (footer?.finished) {
    const footerExitCode = normalizeExitCode(footer.exitCode);
    const correctedStatus = classifyExitStatus(footerExitCode) || (footerExitCode === 0 ? 'executed' : 'failed');
    const survivedOom = footerExitCode === 0;
    if (survivedOom) markOomEventObserved(sessionInfo, persistSnapshot);
    if (verbose) {
      console.log(`[VERBOSE] Session ${sessionName} reported oomKilled=true, but its log footer says exit ${footerExitCode} (${correctedStatus}) and wins${survivedOom ? ' — the session SURVIVED the out-of-memory event (issue #2134)' : ''}`);
    }
    return {
      running: false,
      exitCode: footerExitCode,
      status: correctedStatus,
      statusResult: { ...statusResult, status: correctedStatus, exitCode: footerExitCode, endTime: statusResult?.endTime || footer.endTime || null },
      oomEventObserved: true,
    };
  }

  // 2. Liveness: an alive container cannot have had its command killed.
  const alive = await probeBackendAlive(sessionName, sessionInfo, { verbose, runner, backendAlive });
  if (alive === true) {
    markOomEventObserved(sessionInfo, persistSnapshot);
    if (verbose) {
      console.log(`[VERBOSE] Session ${sessionName} reported oomKilled=true but its ${sessionInfo.isolationBackend} backend is still alive; an OOM event hit the container, not the command — keeping the session tracked (issue #2134)`);
    }
    return { running: true, exitCode: null, status: statusResult?.status || 'executing', statusResult, deferred: true, oomEventObserved: true };
  }

  // 3. Nothing contradicts the status record: this really is an OOM kill (#2015).
  const statusExitCode = normalizeExitCode(statusResult?.exitCode);
  let exitCode = 137;
  if (statusExitCode !== null && statusExitCode > 0) {
    exitCode = statusExitCode;
  }
  const endTime = statusResult?.endTime || footer?.endTime || statusResult?.currentTime || null;
  const corrected = { ...statusResult, status: 'oom-killed', exitCode, endTime };

  if (verbose) {
    console.log(`[VERBOSE] Session ${sessionName} status includes oomKilled=true (backend alive: ${alive === null ? 'unknown' : alive}); treating it as terminal oom-killed (exit ${exitCode})`);
  }

  return { running: false, exitCode, status: 'oom-killed', statusResult: corrected, stale: true, oomEventObserved: true };
}
