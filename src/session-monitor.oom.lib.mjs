/**
 * Verified out-of-memory classification for tracked isolation sessions.
 *
 * Issue #2015 made `oomKilled: true` in a `$ --status` record terminal so an
 * OOM-killed session could not be polled forever. Issue #2134 showed the other
 * half of the problem: Docker's `State.OOMKilled` is a *container* flag, not a
 * statement about the container's main process. The kernel sets it when ANY
 * process in the container cgroup is OOM-killed, and it stays `true` afterwards
 * — so a container can be flagged, keep running, and exit 0 (moby sets it in
 * daemon/monitor.go on `EventOOM` and clears it only in
 * daemon/container/state.go `SetRunning`; see also
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
 *   3. Issue #2892: a SIGKILL is attributed before it is called an OOM kill — a
 *      Docker daemon restart, or start-command's verdict that no OOM hit the main
 *      process at exit, makes it a plain `killed` (see session-exit-attribution).
 *   4. Otherwise report `oom-killed`, exactly as issue #2015 requires.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2015
 * @see https://github.com/link-assistant/hive-mind/issues/2134
 */

import { classifyExitStatus, normalizeExitCode, RUNNING_SESSION_STATUSES } from './session-status.lib.mjs';
import { EXIT_ATTRIBUTION_DAEMON_RESTART, EXIT_ATTRIBUTION_MAIN_OOM, EXIT_ATTRIBUTION_NOT_MAIN_OOM, resolveExitAttribution } from './session-exit-attribution.lib.mjs';

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
 * Issue #2892: who sent the SIGKILL? start-command >= 0.36.0 says so in the
 * status record; otherwise (no journal access inside the DinD root container,
 * or an older `$`) ask Docker whether the daemon restarted around `FinishedAt`.
 */
async function attributeSigkill(sessionName, sessionInfo, statusResult, statusExitCode, { verbose, runner, daemonRestartProbe }) {
  const reported = resolveExitAttribution({ exitReason: statusResult?.exitReason, exitEvidence: statusResult?.exitEvidence });
  if (reported.kind === EXIT_ATTRIBUTION_DAEMON_RESTART || reported.kind === EXIT_ATTRIBUTION_MAIN_OOM) return { ...reported, probe: null };
  const docker = sessionInfo?.isolationBackend === 'docker' || statusResult?.isolation === 'docker';
  const probe = daemonRestartProbe || runner?.detectDockerDaemonRestart;
  if (!docker || typeof probe !== 'function' || (statusExitCode !== null && statusExitCode !== 137)) return { ...reported, probe: null };
  let result = null;
  try {
    result = await probe(sessionInfo?.sessionId || sessionName, { verbose });
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Session ${sessionName} daemon-restart probe failed: ${error?.message || error}`);
  }
  if (result?.detected === true) return { kind: EXIT_ATTRIBUTION_DAEMON_RESTART, source: 'Hive Mind docker probe', probe: result };
  return { ...reported, probe: result };
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
 * @param {Function} [deps.daemonRestartProbe] - Injectable detectDockerDaemonRestart (issue #2892)
 * @returns {Promise<Object>} Monitor state object
 */
export async function resolveOomKilledState(sessionName, sessionInfo, statusResult, { verbose, runner, exitFromLog, backendAlive, persistSnapshot, daemonRestartProbe } = {}) {
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
    // Any ordinary exit proves the main work process outlived the cgroup OOM
    // event, even when the lost child later caused it to fail (issue #2301).
    const survivedOom = footerExitCode !== null && footerExitCode < 128;
    markOomEventObserved(sessionInfo, persistSnapshot);
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
    // Issue #2408: this branch runs on every 30 s poll for as long as the
    // container lives on (1,800 identical lines in one 15-hour session), so
    // say it once — when the event is first recorded.
    const firstObservation = markOomEventObserved(sessionInfo, persistSnapshot);
    if (verbose && firstObservation) {
      console.log(`[VERBOSE] Session ${sessionName} reported oomKilled=true but its ${sessionInfo.isolationBackend} backend is still alive; an OOM event hit the container, not the command — keeping the session tracked (issue #2134)`);
    }
    return { running: true, exitCode: null, status: statusResult?.status || 'executing', statusResult, deferred: true, oomEventObserved: true };
  }

  const statusExitCode = normalizeExitCode(statusResult?.exitCode);
  // The kernel OOM killer sends SIGKILL. A sticky observation cannot explain
  // SIGTERM, SIGABRT or SIGSEGV; retain the event and classify that exit as-is.
  if (statusExitCode !== null && statusExitCode >= 128 && statusExitCode !== 137) {
    markOomEventObserved(sessionInfo, persistSnapshot);
    const status = classifyExitStatus(statusExitCode) || 'failed';
    return { running: false, exitCode: statusExitCode, status, statusResult: { ...statusResult, status }, oomEventObserved: true };
  }
  // 3. Issue #2408: the status record already carries an ordinary exit code
  //    (1-127) — the main process exited by itself, it was not killed. This is
  //    the footer case of step 1 arriving before the footer is flushed: the
  //    first poll after exit used to announce "killed: out of memory", and the
  //    next poll, reading the footer, "failed" — two verdicts for one session.
  //    Exit 0 counts too once the record is terminal: a finished run must not
  //    be read as an OOM kill (exit 137) and restarted.
  const terminalRecord = !RUNNING_SESSION_STATUSES.has(String(statusResult?.status || '').toLowerCase());
  if (statusExitCode !== null && statusExitCode < 128 && (statusExitCode > 0 || (statusExitCode === 0 && terminalRecord))) {
    markOomEventObserved(sessionInfo, persistSnapshot);
    const correctedStatus = classifyExitStatus(statusExitCode) || 'failed';
    if (verbose) {
      console.log(`[VERBOSE] Session ${sessionName} reported oomKilled=true with an ordinary exit ${statusExitCode} and no log footer yet; the main process exited by itself, so it SURVIVED the OOM event (${correctedStatus}, issue #2408)`);
    }
    const endTime = statusResult?.endTime || footer?.endTime || statusResult?.currentTime || null;
    return { running: false, exitCode: statusExitCode, status: correctedStatus, statusResult: { ...statusResult, status: correctedStatus, exitCode: statusExitCode, endTime }, oomEventObserved: true };
  }

  let exitCode = 137;
  if (statusExitCode !== null && statusExitCode > 0) {
    exitCode = statusExitCode;
  }
  const endTime = statusResult?.endTime || footer?.endTime || statusResult?.currentTime || null;

  // 4. Issue #2892: the sticky flag next to a SIGKILL is not proof of an OOM
  //    kill. A daemon restart force-kills every container (exit 137) and the
  //    flag may date from a child OOM hours earlier; start-command 0.36.0 can
  //    also tell us that no OOM hit the main process at exit.
  const attribution = await attributeSigkill(sessionName, sessionInfo, statusResult, statusExitCode, { verbose, runner, daemonRestartProbe });
  if (attribution.kind === EXIT_ATTRIBUTION_DAEMON_RESTART || attribution.kind === EXIT_ATTRIBUTION_NOT_MAIN_OOM) {
    markOomEventObserved(sessionInfo, persistSnapshot);
    const killed = { ...statusResult, status: 'killed', exitCode, endTime, killAttribution: attribution.kind };
    if (attribution.probe) killed.dockerDaemonRestart = attribution.probe;
    if (verbose) {
      console.log(`[VERBOSE] Session ${sessionName} status includes oomKilled=true with exit ${exitCode}, but ${attribution.source} attributes the kill as ${attribution.kind}; the OOM flag is an earlier event, treating it as killed (issue #2892)`);
    }
    return { running: false, exitCode, status: 'killed', statusResult: killed, stale: true, oomEventObserved: true };
  }

  // 5. Nothing contradicts the status record: this really is an OOM kill (#2015).
  const corrected = { ...statusResult, status: 'oom-killed', exitCode, endTime };
  markOomEventObserved(sessionInfo, persistSnapshot);

  if (verbose) {
    console.log(`[VERBOSE] Session ${sessionName} status includes oomKilled=true (backend alive: ${alive === null ? 'unknown' : alive}); treating it as terminal oom-killed (exit ${exitCode}; attribution: ${attribution.kind || 'none'}${attribution.probe ? `, daemon-restart probe: ${attribution.probe.detected ? 'detected' : 'not detected'}` : ''})`);
  }

  return { running: false, exitCode, status: 'oom-killed', statusResult: corrected, stale: true, oomEventObserved: true };
}
