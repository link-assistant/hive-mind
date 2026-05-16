// Parent-side inactivity watchdog for spawned hive workers.
//
// Issue #1811: hive workers can stall silently (most notoriously inside
// solve.results.lib.mjs:verifyResults when `gh api user` hangs because `gh`
// has no default network timeout). The hive parent process needs visibility
// into "child is alive but quiet" and the ability to escalate to SIGTERM /
// SIGKILL after configurable thresholds.
//
// This module exists as a standalone helper so it can be unit-tested without
// pulling in the full hive.mjs bootstrap surface.

/**
 * Attach an inactivity watchdog to a spawned child process.
 *
 * @param {object} params
 * @param {import('child_process').ChildProcess} params.child - the spawned worker.
 * @param {number} [params.warnMs=0] - emit a warning when no stdout/stderr
 *        activity is observed for this many milliseconds (0 disables warnings).
 * @param {number} [params.killMs=0] - SIGTERM the child after this many
 *        milliseconds of silence (0 disables kill escalation).
 * @param {number} [params.verboseHeartbeatMs=0] - in verbose mode, emit an
 *        earlier "still alive but quiet" heartbeat at this threshold; must be
 *        less than warnMs to have any effect.
 * @param {number} [params.killGraceMs=10_000] - wait this long after SIGTERM
 *        before escalating to SIGKILL.
 * @param {number} [params.tickMs=1_000] - watchdog check interval.
 * @param {() => number} [params.now] - injectable clock (for tests).
 * @param {(msg: string, meta: {level: 'info'|'warn'|'error', kind: string, silentMs: number, lastLogLine: string}) => void} [params.onEvent]
 *        - invoked whenever the watchdog logs (warning, heartbeat, sigterm,
 *        sigkill). `kind` is one of 'warn'|'heartbeat'|'sigterm'|'sigkill'.
 * @returns {{markActivity: (line?: string) => void, stop: () => void, getState: () => {lastActivityAt: number, lastLogLine: string, killed: boolean}}}
 */
export const createWorkerInactivityWatchdog = ({ child, warnMs = 0, killMs = 0, verboseHeartbeatMs = 0, killGraceMs = 10_000, tickMs = 1_000, now = () => Date.now(), onEvent = () => {} } = {}) => {
  let lastActivityAt = now();
  let lastWarnAt = 0;
  let lastLogLine = '';
  let killed = false;
  let watchdogTimer = null;
  let killTimer = null;

  const safeOnEvent = (msg, meta) => {
    try {
      onEvent(msg, meta);
    } catch {
      // Swallow listener errors so they cannot kill the watchdog loop.
    }
  };

  const markActivity = line => {
    lastActivityAt = now();
    if (typeof line === 'string' && line.trim()) {
      lastLogLine = line.trim();
    }
  };

  const stop = () => {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }
  };

  const escalateToSigkill = () => {
    try {
      safeOnEvent(`worker did not exit after SIGTERM + ${Math.round(killGraceMs / 1000)}s; sending SIGKILL.`, { level: 'error', kind: 'sigkill', silentMs: now() - lastActivityAt, lastLogLine });
      child.kill('SIGKILL');
    } catch {
      // Already dead.
    }
  };

  const checkActivity = () => {
    const silentMs = now() - lastActivityAt;
    if (warnMs > 0 && silentMs >= warnMs && now() - lastWarnAt >= warnMs) {
      safeOnEvent(`worker silent for ${Math.round(silentMs / 1000)}s (warn threshold ${Math.round(warnMs / 1000)}s).`, { level: 'warn', kind: 'warn', silentMs, lastLogLine });
      lastWarnAt = now();
    } else if (verboseHeartbeatMs > 0 && warnMs > 0 && silentMs >= verboseHeartbeatMs && silentMs < warnMs && now() - lastWarnAt >= verboseHeartbeatMs) {
      safeOnEvent(`worker silent for ${Math.round(silentMs / 1000)}s (verbose heartbeat).`, { level: 'info', kind: 'heartbeat', silentMs, lastLogLine });
      lastWarnAt = now();
    }
    if (killMs > 0 && silentMs >= killMs && !killTimer && !killed) {
      killed = true;
      safeOnEvent(`worker silent for ${Math.round(silentMs / 1000)}s > kill threshold ${Math.round(killMs / 1000)}s; sending SIGTERM.`, { level: 'error', kind: 'sigterm', silentMs, lastLogLine });
      try {
        child.kill('SIGTERM');
      } catch {
        // Child may already be dead; ignore.
      }
      killTimer = setTimeout(escalateToSigkill, killGraceMs);
    }
  };

  if (warnMs > 0 || killMs > 0 || verboseHeartbeatMs > 0) {
    watchdogTimer = setInterval(checkActivity, tickMs);
  }

  return {
    markActivity,
    stop,
    getState: () => ({ lastActivityAt, lastLogLine, killed }),
  };
};

export default { createWorkerInactivityWatchdog };
