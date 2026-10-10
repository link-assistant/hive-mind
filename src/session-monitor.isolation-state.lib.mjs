/** Isolation-state reconciliation; terminal evidence is scoped to each attempt. */
import { scopeRecoveryFooter } from './session-recovery-footer.lib.mjs';
import { classifyExitStatus, normalizeExitCode } from './session-status.lib.mjs';
import { isDockerIsolation, resolveOomKilledState, resolveStaleExecutingState } from './session-monitor.stale-executing.lib.mjs';
import { clearUnverifiedDockerTerminalMarker, shouldDeferUnverifiedDockerTerminal } from './session-monitor.docker-terminal.lib.mjs';

export async function getIsolationSessionState(sessionName, sessionInfo, options = {}) {
  const { verbose = false, statusProvider = null, exitFromLog: providedExitFromLog = null, backendAlive = null, sessionRunning = null } = options;
  const sessionId = sessionInfo.sessionId || sessionName;
  try {
    const runner = options.runnerProvider ? await options.runnerProvider() : await import('./isolation-runner.lib.mjs');
    const persistSnapshot = options.persistSnapshot || (() => {});
    const exitFromLog = scopeRecoveryFooter(providedExitFromLog || runner.readSessionExitFromLog, sessionInfo);
    const statusResult = statusProvider ? await statusProvider(sessionId, sessionInfo) : await runner.querySessionStatus(sessionId, verbose);
    if (statusResult?.exists && statusResult.status) {
      if (statusResult.oomKilled === true || statusResult.cgroupMemory?.oomKills > 0) {
        // Issue #2134: `oomKilled` is a *container* flag — the kernel sets it when any process in the cgroup is OOM-killed — so it is verified against the log footer and container liveness before a kill is announced.
        return await resolveOomKilledState(sessionName, sessionInfo, statusResult, {
          verbose,
          runner,
          exitFromLog,
          backendAlive,
          persistSnapshot,
          daemonRestartProbe: options.daemonRestartProbe || null,
        });
      }
      if (runner.isExecutingSessionStatus(statusResult.status)) {
        // Issue #1927: an `executing` status is not trusted blindly — verify the process is really alive. start-command can keep reporting `executing` after a kill, which is exactly how an OOM-killed /solve went unreported.
        const stale = await resolveStaleExecutingState(sessionName, sessionInfo, statusResult, { verbose, runner, exitFromLog, backendAlive, persistSnapshot });
        if (stale) {
          if (verbose) {
            console.log(`[VERBOSE] Session ${sessionName} reported '${statusResult.status}' but is actually terminated (${stale.reason}); treating as ${stale.status} (exit ${stale.exitCode})`);
          }
          // Rewrite the status payload so downstream completion formatting sees the real terminal status/exit code instead of the stale `executing`.
          const correctedStatus = stale.status || 'killed';
          const corrected = { ...statusResult, status: correctedStatus, exitCode: stale.exitCode, endTime: statusResult.endTime || stale.endTime || null };
          return { running: false, exitCode: stale.exitCode, status: correctedStatus, statusResult: corrected, stale: true };
        }
        // Back to a plain `executing` report: any earlier unverified terminal failure was provisional and is now moot (issue #2117).
        clearUnverifiedDockerTerminalMarker(sessionInfo, persistSnapshot);
        return { running: true, exitCode: null, status: statusResult.status, statusResult };
      }
      if (runner.isTerminalSessionStatus(statusResult.status)) {
        const exitCode = statusResult.exitCode !== undefined ? statusResult.exitCode : null;
        const logPath = statusResult.logPath || sessionInfo?.logPath || null;
        // The log FOOTER is the authoritative terminal result. It is anchored on the `=====` separator (see parseSessionExitFooter), so — unlike the exit code `$ --status` derives from an unanchored full-log scan — it cannot be forged by output the wrapped command printed (issue #2117). Prefer it whenever it exists: that both recovers a real code from a missing/sentinel status (issue #1927) and overrides a fabricated one.
        const readFooter = exitFromLog || runner.readSessionExitFromLog;
        const footer = logPath && readFooter ? readFooter(logPath, { verbose }) : null;
        if (footer?.finished) {
          const footerExitCode = footer.exitCode;
          const correctedStatus = classifyExitStatus(footerExitCode) || statusResult.status;
          if (verbose && normalizeExitCode(footerExitCode) !== normalizeExitCode(exitCode)) {
            console.log(`[VERBOSE] Session ${sessionName} reported terminal '${statusResult.status}' with exit ${exitCode}; the log footer says exit ${footerExitCode} (${correctedStatus}) and wins (issues #1927/#2117)`);
          }
          clearUnverifiedDockerTerminalMarker(sessionInfo, persistSnapshot);
          return { running: false, exitCode: footerExitCode, status: correctedStatus, statusResult: { ...statusResult, status: correctedStatus, exitCode: footerExitCode } };
        }
        // Issue #1939: a native docker session can report a terminal status ("executed") with the unknown exit-code sentinel (-1) while the container is still running. When the log footer above did not recover a real terminal exit, such a status is provisional — fall through to isSessionRunning() below, which cross-checks the live container via `docker inspect` before we notify the user the work finished.
        const dockerSession = isDockerIsolation(sessionInfo, statusResult);
        const ambiguousDockerTerminal = dockerSession && typeof runner.isUnknownDockerExitCode === 'function' && runner.isUnknownDockerExitCode(exitCode);
        // Issue #2117: a docker terminal FAILURE with no corroborating footer is provisional too — start-command can fabricate that exit code from the command's own output. Give the real footer a moment to appear instead of announcing a failure the run never had. Only a *freshly* reported end time can still be in that race, so an older terminal record is still reported without delay.
        const normalizedExitCode = normalizeExitCode(exitCode);
        const unverifiedDockerFailure = dockerSession && !ambiguousDockerTerminal && normalizedExitCode !== null && normalizedExitCode !== 0;
        if (unverifiedDockerFailure && shouldDeferUnverifiedDockerTerminal(sessionName, sessionInfo, { exitCode, endTime: statusResult.endTime || null, verbose, persistSnapshot })) {
          return { running: true, exitCode: null, status: statusResult.status, statusResult, deferred: true };
        }
        // Issue #2134: even after the grace window, a container that is verifiably still alive cannot have produced a terminal failure — the same liveness ladder used for `oomKilled` applies here, so no kill is announced while the working session keeps running (that is exactly what #2134 reported).
        if (unverifiedDockerFailure) {
          const probe = backendAlive || runner.checkBackendSessionAlive;
          let alive = null;
          if (probe && sessionInfo?.isolationBackend) {
            try {
              alive = await probe(sessionId, sessionInfo.isolationBackend, verbose);
            } catch {
              alive = null;
            }
          }
          if (alive === true) {
            if (verbose) {
              console.log(`[VERBOSE] Session ${sessionName} reported terminal '${statusResult.status}' with exit ${exitCode}, but its docker backend is still alive; keeping the session tracked (issue #2134)`);
            }
            return { running: true, exitCode: null, status: statusResult.status, statusResult, deferred: true };
          }
        }
        if (!ambiguousDockerTerminal) {
          clearUnverifiedDockerTerminalMarker(sessionInfo, persistSnapshot);
          return { running: false, exitCode, status: statusResult.status, statusResult };
        }
      }
    }
    // The status record is unavailable (no `exists`/`status`). Fall back to a direct backend liveness check. `sessionRunning` is injectable purely so
    // this path is testable without the real `$`/`screen` binaries; production
    // always uses the runner's real check.
    const checkRunning = sessionRunning || runner.isSessionRunning;
    const running = await checkRunning(sessionId, {
      backend: sessionInfo.isolationBackend,
      verbose,
    });
    if (!running) {
      // Issue #1927: the `$ --status` record is unavailable (e.g. garbage-
      // collected while the bot was down) and the backend reports not-running.
      // Before declaring a bare null exit — which classifies as success — try
      // the log footer so a session that was killed while we were offline is
      // reported as the kill it was, not a silent success.
      const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
      if (logPath) {
        const readFooter = exitFromLog || runner.readSessionExitFromLog;
        const footer = readFooter ? readFooter(logPath, { verbose }) : null;
        if (footer?.finished) {
          const correctedStatus = classifyExitStatus(footer.exitCode) || (footer.exitCode === 0 ? 'executed' : 'failed');
          if (verbose) {
            console.log(`[VERBOSE] Session ${sessionName} has no live status record; recovered exit ${footer.exitCode} (${correctedStatus}) from log footer`);
          }
          return { running: false, exitCode: footer.exitCode, status: correctedStatus, statusResult: { ...(statusResult || {}), status: correctedStatus, exitCode: footer.exitCode, endTime: statusResult?.endTime || footer.endTime || null } };
        }
      }
    }
    return {
      running,
      exitCode: running ? null : (statusResult?.exitCode ?? null),
      status: statusResult?.status || null,
      statusResult,
    };
  } catch (error) {
    if (verbose) {
      console.error(`[VERBOSE] Error refreshing isolated session ${sessionId}: ${error.message}`);
    }
    return { running: false, exitCode: null, status: null, statusResult: null };
  }
}
