/**
 * Shared session-status vocabulary and exit-code classification.
 *
 * Issue #1927: a detached `/solve` was OOM-killed (exit 137) but the Telegram
 * bot never reported the failure. Two gaps in the status vocabulary contributed:
 *
 *   1. start-command only emits `executing`/`executed`; it has no notion of a
 *      *killed* session, and a signal exit (137 = 128+SIGKILL) was treated the
 *      same as any other completion — or, worse, hidden entirely.
 *   2. The sets that decide "is this running / terminal / a failure" were
 *      duplicated across isolation-runner, session-monitor and work-session
 *      formatting, so a fix in one place silently disagreed with another.
 *
 * This module is the single source of truth for that vocabulary and for mapping
 * a process exit code to a signal/kill label. It is intentionally
 * dependency-free (pure JS, no Node built-ins) so every layer can import it
 * without pulling heavy transitive deps (command-stream, i18n, …).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

function norm(status) {
  return String(status || '')
    .trim()
    .toLowerCase();
}

/**
 * Normalize an exit code to a finite integer or null.
 * @param {*} value
 * @returns {number|null}
 */
export function normalizeExitCode(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

// A session that is still executing. start-command emits `executing`; hive-mind
// historically also accepted `running`.
export const RUNNING_SESSION_STATUSES = new Set(['executing', 'running']);

// Statuses that mean the process was killed (by a signal) rather than exiting on
// its own. Surfaced to the user as an explicit "killed" rather than a generic
// failure so an OOM/SIGKILL is recognizable. (Issue #1927 requirement #1.)
export const KILLED_SESSION_STATUSES = new Set(['killed', 'terminated', 'dead', 'oom', 'oom-killed', 'oomkilled', 'sigkill', 'sigterm', 'sigsegv']);

// Statuses that mean the session ended unsuccessfully (a non-zero/abnormal
// outcome). Kills are a subset of failures.
export const FAILURE_SESSION_STATUSES = new Set(['failed', 'cancelled', 'canceled', 'error', 'timeout', 'timedout', 'timed_out', ...KILLED_SESSION_STATUSES]);

// Statuses that mean the session is no longer executing (success or failure).
// A superset of the original {executed, completed, failed, cancelled, canceled,
// error} plus the kill/timeout vocabulary added for issue #1927.
export const TERMINAL_SESSION_STATUSES = new Set(['executed', 'completed', ...FAILURE_SESSION_STATUSES]);

/**
 * @param {string} status
 * @returns {boolean} True when the session is still executing.
 */
export function isExecutingSessionStatus(status) {
  return RUNNING_SESSION_STATUSES.has(norm(status));
}

/**
 * @param {string} status
 * @returns {boolean} True when the session is no longer executing.
 */
export function isTerminalSessionStatus(status) {
  return TERMINAL_SESSION_STATUSES.has(norm(status));
}

/**
 * @param {string} status
 * @returns {boolean} True when the session was killed by a signal.
 */
export function isKilledSessionStatus(status) {
  return KILLED_SESSION_STATUSES.has(norm(status));
}

/**
 * @param {string} status
 * @returns {boolean} True when the session ended unsuccessfully.
 */
export function isFailureSessionStatus(status) {
  return FAILURE_SESSION_STATUSES.has(norm(status));
}

// POSIX signals that commonly terminate a wrapped command, with the reason we
// surface to the user. Exit codes above 128 encode the signal as `128 + signum`
// (the shell/Node convention), so 137 → SIGKILL, 143 → SIGTERM, 139 → SIGSEGV.
const SIGNAL_DESCRIPTIONS = {
  1: { name: 'SIGHUP', reason: 'hung up (SIGHUP)' },
  2: { name: 'SIGINT', reason: 'interrupted (SIGINT)' },
  3: { name: 'SIGQUIT', reason: 'quit (SIGQUIT)' },
  6: { name: 'SIGABRT', reason: 'aborted (SIGABRT)' },
  9: { name: 'SIGKILL', reason: 'killed — out of memory or forced kill (SIGKILL)' },
  11: { name: 'SIGSEGV', reason: 'crashed — segmentation fault (SIGSEGV)' },
  15: { name: 'SIGTERM', reason: 'terminated (SIGTERM)' },
};

/**
 * Describe a signal-based exit code (anything above 128).
 *
 * @param {*} exitCode
 * @returns {{signal: string, signalNumber: number, reason: string}|null}
 *   Signal details, or null when the exit code is not a signal exit.
 */
export function describeExitSignal(exitCode) {
  const code = normalizeExitCode(exitCode);
  if (code === null || code <= 128) return null;
  const signalNumber = code - 128;
  const info = SIGNAL_DESCRIPTIONS[signalNumber] || { name: `SIG${signalNumber}`, reason: `killed by signal ${signalNumber}` };
  return { signal: info.name, signalNumber, reason: info.reason };
}

/**
 * Map an exit code to a canonical session status string.
 *
 *   - 0            → 'executed'  (success)
 *   - 137,139,…    → 'killed'    (SIGKILL/SIGSEGV/etc.)
 *   - 143,130      → 'terminated'(SIGTERM/SIGINT — orderly termination)
 *   - other != 0   → 'failed'
 *   - null         → null        (unknown)
 *
 * @param {*} exitCode
 * @returns {string|null}
 */
export function classifyExitStatus(exitCode) {
  const code = normalizeExitCode(exitCode);
  if (code === null) return null;
  if (code === 0) return 'executed';
  const signal = describeExitSignal(code);
  if (signal) {
    // SIGTERM/SIGINT are orderly terminations; everything else above 128 is a
    // hard kill/crash.
    if (signal.signalNumber === 15 || signal.signalNumber === 2) return 'terminated';
    return 'killed';
  }
  return 'failed';
}
