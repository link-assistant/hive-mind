/**
 * Issue #4091: every wait after the final solution log has a name, a start
 * time, a deadline and a heartbeat.
 *
 * A `solve` run sanitized and uploaded a 113 MB log for 34 minutes with a
 * single progress line, then polled a pull request for 5 hours. Nothing in its
 * output told whether it was working or hung, and nothing ever decided to stop
 * waiting. Two helpers close that gap:
 *
 *  - `startHeartbeat` prints `💓 <ISO> <name>: running for 2m 30s (<detail>) —
 *    deadline <ISO>` every `intervalMs` (default 30 s) until stopped;
 *  - `withWatchdog` runs an async operation with a heartbeat and a deadline. If
 *    the operation has not settled by the deadline, the watchdog logs the
 *    pending operation (name, start, elapsed, last detail) and returns the
 *    caller's `onTimeout` decision instead of waiting forever. The operation
 *    itself is abandoned, not killed: the caller decides what that means
 *    (skip one check, give up an upload, stop monitoring).
 *
 * Timers and the clock are injectable so tests drive them with a fake clock.
 */

import { formatDuration } from './github-ci-stuck-runs.lib.mjs';

/** Heartbeat period for waits after the final log; well under the 60 s the issue asks for. */
export const DEFAULT_HEARTBEAT_MS = 30 * 1000;

const realTimers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: handle => clearInterval(handle), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle) };

const iso = ms => new Date(ms).toISOString();

/** Elapsed time with seconds below one hour: heartbeats come every 30 s, so whole minutes would hide progress. */
export const formatElapsed = ms => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return formatDuration(ms);
};

const callLog = async (log, line) => {
  try {
    await log(line);
  } catch {
    // A failing log must not break the wait it reports on.
  }
};

/**
 * Print a heartbeat line every `intervalMs` until `stop()` is called.
 *
 * @param {Object} options
 * @param {string} options.name - what is being waited for ("log upload", "check #12")
 * @param {Function} options.log - async (line) => void
 * @param {number} [options.intervalMs]
 * @param {number|null} [options.deadlineAt] - ms since epoch, shown on every line
 * @param {Function} [options.describe] - async () => string, current progress ("41 MB of 114 MB")
 * @param {Function} [options.now]
 * @param {Object} [options.timers] - { setInterval, clearInterval }
 * @returns {{ stop: Function, beat: Function, startedAt: number, lastDetail: Function }}
 */
export const startHeartbeat = ({ name, log, intervalMs = DEFAULT_HEARTBEAT_MS, deadlineAt = null, describe = null, now = Date.now, timers = realTimers } = {}) => {
  const startedAt = now();
  let detail = '';
  let stopped = false;
  const beat = async () => {
    if (stopped) return;
    if (typeof describe === 'function') {
      try {
        detail = (await describe()) || detail;
      } catch {
        // keep the previous detail
      }
    }
    if (stopped) return;
    const at = now();
    const suffix = [detail ? ` (${detail})` : '', deadlineAt ? ` — deadline ${iso(deadlineAt)}` : ''].join('');
    await callLog(log, `  💓 ${iso(at)} ${name}: running for ${formatElapsed(at - startedAt)}${suffix}`);
  };
  // The beat never rejects; returning its promise lets fake timers in tests await it.
  const handle = timers.setInterval(() => beat(), intervalMs);
  handle?.unref?.();
  return {
    startedAt,
    beat,
    lastDetail: () => detail,
    stop: () => {
      stopped = true;
      timers.clearInterval(handle);
    },
  };
};

/**
 * Run `operation()` with a heartbeat and a deadline.
 *
 * @param {string} name
 * @param {Function} operation - async () => value
 * @param {Object} options
 * @param {Function} options.log
 * @param {number} options.deadlineMs - how long the operation may take
 * @param {Function} [options.onTimeout] - async ({ name, startedAt, elapsedMs, detail }) => { decision, value }
 * @param {number} [options.heartbeatMs]
 * @param {Function} [options.describe]
 * @param {Function} [options.now]
 * @param {Object} [options.timers]
 * @returns {Promise<{ timedOut: boolean, value?: any, decision?: string }>}
 */
export const withWatchdog = async (name, operation, { log, deadlineMs, onTimeout = async () => ({ decision: 'give up waiting' }), heartbeatMs = DEFAULT_HEARTBEAT_MS, describe = null, now = Date.now, timers = realTimers } = {}) => {
  const startedAt = now();
  const deadlineAt = deadlineMs > 0 ? startedAt + deadlineMs : null;
  const heartbeat = startHeartbeat({ name, log, intervalMs: heartbeatMs, deadlineAt, describe, now, timers });
  let timeoutHandle = null;
  const timeout = new Promise(resolve => {
    if (!deadlineAt) return;
    timeoutHandle = timers.setTimeout(() => resolve({ timeout: true }), deadlineMs);
    timeoutHandle?.unref?.();
  });
  try {
    const outcome = await Promise.race([
      Promise.resolve()
        .then(operation)
        .then(value => ({ value })),
      timeout,
    ]);
    if (!outcome.timeout) return { timedOut: false, value: outcome.value };
    heartbeat.stop();
    const elapsedMs = now() - startedAt;
    const detail = heartbeat.lastDetail();
    await callLog(log, `  ⏱️ ${iso(now())} Watchdog: "${name}" is still pending after ${formatElapsed(elapsedMs)} (started ${iso(startedAt)}, deadline ${iso(deadlineAt)}${detail ? `, last progress: ${detail}` : ''})`);
    const result = (await onTimeout({ name, startedAt, elapsedMs, detail })) || {};
    await callLog(log, `  ⏱️ Watchdog decision for "${name}": ${result.decision || 'give up waiting'}`);
    return { timedOut: true, decision: result.decision, value: result.value };
  } finally {
    heartbeat.stop();
    if (timeoutHandle) timers.clearTimeout(timeoutHandle);
  }
};

export default { DEFAULT_HEARTBEAT_MS, formatElapsed, startHeartbeat, withWatchdog };
