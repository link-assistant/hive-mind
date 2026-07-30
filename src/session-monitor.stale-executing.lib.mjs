/**
 * Terminal-state reconciliation helpers for tracked isolation sessions.
 *
 * These live next to session-monitor.lib.mjs (which is at its `max-lines`
 * budget) and cover two independent defects:
 *
 *   - issue #1927: `$ --status` can stay stuck on `executing` after the process
 *     was killed, so the monitor has to cross-check the log footer and the
 *     backing screen/tmux/docker session.
 *   - issue #2015: a docker session reported with `oomKilled=true` is terminal
 *     and must be surfaced as such instead of being polled forever.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 * @see https://github.com/link-assistant/hive-mind/issues/2015
 */

import { classifyExitStatus, normalizeExitCode } from './session-status.lib.mjs';

/**
 * Issue #1927: minimum age before a session that `$ --status` still reports as
 * `executing` is allowed to be declared dead purely on a backend-liveness probe
 * (the screen/tmux/docker session is gone). This avoids a race where a session
 * that has just been launched — but whose backend has not registered yet — is
 * falsely reported as killed. The authoritative log-footer check is NOT gated by
 * this, because a written "Exit Code:" footer is proof the command terminated.
 */
export const STALE_EXECUTING_MIN_AGE_MS = 90 * 1000;
export const DOCKER_BACKEND_GONE_GRACE_MS = 2 * 60 * 1000;
const DOCKER_BACKEND_GONE_FIRST_SEEN_FIELD = 'dockerBackendGoneFirstSeenAt';

export function sessionStartMs(sessionInfo) {
  const start = sessionInfo?.startTime;
  if (!start) return null;
  const date = start instanceof Date ? start : new Date(start);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function isDockerIsolation(sessionInfo, statusResult) {
  return sessionInfo?.isolationBackend === 'docker' || statusResult?.isolation === 'docker';
}

function getDockerBackendGoneFirstSeenMs(sessionInfo) {
  const raw = sessionInfo?.[DOCKER_BACKEND_GONE_FIRST_SEEN_FIELD];
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function clearDockerBackendGoneMarker(sessionInfo, persistSnapshot) {
  if (!sessionInfo?.[DOCKER_BACKEND_GONE_FIRST_SEEN_FIELD]) return;
  delete sessionInfo[DOCKER_BACKEND_GONE_FIRST_SEEN_FIELD];
  persistSnapshot();
}

/**
 * Cross-check whether a session that `$ --status` still reports as `executing`
 * has actually terminated. Issue #1927: start-command's status can get stuck on
 * `executing` after the process was killed (a lingering shell keeps the screen
 * session alive, flipping executed→executing), so a SIGKILLed /solve was never
 * reported. Two independent signals are consulted, strongest first:
 *
 *   1. The execution log FOOTER. When start-command wrote "Exit Code: N" the
 *      command terminated, full stop — regardless of what `--status` claims.
 *      This is authoritative and catches the dominant lingering-shell case.
 *   2. Backend LIVENESS. If no footer was written (e.g. the wrapper itself was
 *      hard-killed) but the backing screen/tmux/docker session is gone, the
 *      process cannot still be executing. Gated by STALE_EXECUTING_MIN_AGE_MS to
 *      avoid a just-launched-not-yet-registered race.
 *
 * @returns {Promise<{exitCode: number|null, status: string, reason: string}|null>}
 *   Terminal details when the session is actually dead, else null (still running).
 */
export async function resolveStaleExecutingState(sessionName, sessionInfo, statusResult, { verbose, runner, exitFromLog, backendAlive, persistSnapshot }) {
  // 1. Authoritative: the log footer.
  const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
  if (logPath) {
    const readFooter = exitFromLog || runner.readSessionExitFromLog;
    const footer = readFooter ? readFooter(logPath, { verbose }) : null;
    if (footer?.finished) {
      const status = classifyExitStatus(footer.exitCode) || (footer.exitCode === 0 ? 'executed' : 'failed');
      return { exitCode: footer.exitCode, status, reason: `log-footer(exit ${footer.exitCode})` };
    }
  }

  // 2. Liveness probe, only once the session is old enough to have registered.
  const startMs = sessionStartMs(sessionInfo);
  const ageMs = startMs != null ? Date.now() - startMs : Infinity;
  if (ageMs >= STALE_EXECUTING_MIN_AGE_MS && sessionInfo?.isolationBackend) {
    const probe = backendAlive || runner.checkBackendSessionAlive;
    const alive = probe ? await probe(sessionInfo.sessionId || sessionName, sessionInfo.isolationBackend, verbose) : null;
    // Only `false` (definitively gone) counts as killed; `null` (unknown backend)
    // is treated as "no signal" so we don't kill on an indeterminate probe.
    if (alive === false) {
      if (isDockerIsolation(sessionInfo, statusResult)) {
        const nowMs = Date.now();
        const firstSeenMs = getDockerBackendGoneFirstSeenMs(sessionInfo);
        if (firstSeenMs === null) {
          sessionInfo[DOCKER_BACKEND_GONE_FIRST_SEEN_FIELD] = new Date(nowMs).toISOString();
          persistSnapshot();
          if (verbose) {
            console.log(`[VERBOSE] Session ${sessionName} docker backend is gone but no terminal status/footer is available yet; deferring killed classification for ${DOCKER_BACKEND_GONE_GRACE_MS}ms`);
          }
          return null;
        }
        if (nowMs - firstSeenMs < DOCKER_BACKEND_GONE_GRACE_MS) {
          if (verbose) {
            console.log(`[VERBOSE] Session ${sessionName} docker backend is still gone; waiting for terminal status/footer before reporting killed`);
          }
          return null;
        }
      }
      return { exitCode: null, status: 'killed', reason: 'backend-gone' };
    }
    if (alive === true) {
      clearDockerBackendGoneMarker(sessionInfo, persistSnapshot);
    }
  }

  return null;
}

/**
 * Issue #2015: `oomKilled` is terminal — the container was killed by the kernel,
 * so no further polling can change the outcome.
 */
export function resolveOomKilledState(sessionName, sessionInfo, statusResult, { verbose, runner, exitFromLog }) {
  const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
  let footer = null;
  if (logPath) {
    const readFooter = exitFromLog || runner.readSessionExitFromLog;
    footer = readFooter ? readFooter(logPath, { verbose }) : null;
  }

  const statusExitCode = normalizeExitCode(statusResult?.exitCode);
  const footerExitCode = footer?.finished ? normalizeExitCode(footer.exitCode) : null;
  let exitCode = 137;
  if (statusExitCode !== null && statusExitCode > 0) {
    exitCode = statusExitCode;
  } else if (footerExitCode !== null && footerExitCode > 0) {
    exitCode = footerExitCode;
  }
  const endTime = statusResult?.endTime || footer?.endTime || statusResult?.currentTime || null;
  const corrected = { ...statusResult, status: 'oom-killed', exitCode, endTime };

  if (verbose) {
    console.log(`[VERBOSE] Session ${sessionName} status includes oomKilled=true; treating it as terminal oom-killed (exit ${exitCode})`);
  }

  return { running: false, exitCode, status: 'oom-killed', statusResult: corrected, stale: true };
}
