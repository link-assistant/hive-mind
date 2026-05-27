/**
 * Issue #1823: "AI working session" guard for solve's graceful shutdown.
 *
 * An *AI working session* is the window during which the AI tool child
 * (claude/codex/gemini/opencode/qwen/agent) is actively running and streaming. When the
 * experimental flag `--do-not-shutdown-in-the-middle-of-working-session` is enabled:
 *
 *   - An interrupt (CTRL+C / SIGINT, or SIGTERM) received DURING a protected session is
 *     *deferred*: solve lets the AI session finish, auto-commits any uncommitted changes, then
 *     shuts down gracefully. It does NOT abort the AI tool mid-run.
 *   - An interrupt received OUTSIDE a protected session (e.g. solve is only idle-waiting for
 *     CI/CD) stops solve immediately.
 *   - A SECOND interrupt force-stops now: the active AI child is killed and solve exits.
 *
 * Background (validated empirically — see experiments/command-stream-signals.mjs):
 *   command-stream installs only a SIGINT handler that forwards SIGINT to the active AI child's
 *   process group (killing it); it has NO SIGTERM handler. hive therefore forwards the operator's
 *   CTRL+C to each /solve worker as SIGTERM, which command-stream ignores — so the AI child is
 *   never collaterally killed by the library and this module + exit-handler decide what to do.
 *   For the force path (a second interrupt) we *reuse* command-stream's own SIGINT handler to
 *   kill the active child's process group, guarding against its embedded process.exit(130) so we
 *   can still auto-commit before exiting.
 *
 * This module holds module-level state on purpose: it is a per-process singleton, mirroring how
 * exit-handler.lib.mjs and command-stream manage global signal state.
 */

let flagEnabled = false;
let logFn = null;
let protectedSessionActive = false;
let shutdownRequested = false;
let shutdownSignal = null;
let forceRequested = false;

/**
 * Heuristic to recognise command-stream's SIGINT listener among process SIGINT listeners.
 * Matches the same internal helper names command-stream itself uses for self-detection
 * (see node_modules/command-stream .../$.state.mjs isOurHandlerInstalled()).
 * @param {Function} listener
 * @returns {boolean}
 */
const isCommandStreamSigintListener = listener => {
  const s = listener.toString();
  return s.includes('findActiveRunners') || s.includes('forwardSigintToRunners') || s.includes('handleSigintExit') || s.includes('activeProcessRunners');
};

/**
 * Internal verbose tracer for issue #1823 shutdown diagnostics. No-op unless a logger was
 * provided via configureWorkingSession(). Fire-and-forget: logging must never break shutdown.
 * @param {string} message
 */
const trace = message => {
  if (typeof logFn !== 'function') {
    return;
  }
  try {
    const result = logFn(message, { verbose: true });
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch {
    // Diagnostics must never interfere with the shutdown path.
  }
};

/**
 * Configure the working-session guard. Call once at solve startup.
 * @param {object} opts
 * @param {boolean} opts.enabled - Whether --do-not-shutdown-in-the-middle-of-working-session is set.
 * @param {Function} [opts.log] - Optional async logger.
 */
export const configureWorkingSession = ({ enabled = false, log = null } = {}) => {
  flagEnabled = !!enabled;
  logFn = log;
};

export const isFlagEnabled = () => flagEnabled;
export const isWorkingSessionActive = () => protectedSessionActive;
export const isShutdownRequested = () => shutdownRequested;
export const getShutdownSignal = () => shutdownSignal;
export const isForceRequested = () => forceRequested;

/** Mark the start of a protected AI working session. */
export const beginWorkingSession = () => {
  protectedSessionActive = true;
};

/**
 * Mark the end of a protected AI working session.
 * @returns {{shutdownRequested: boolean, shutdownSignal: string|null, forceRequested: boolean}}
 */
export const endWorkingSession = () => {
  protectedSessionActive = false;
  return { shutdownRequested, shutdownSignal, forceRequested };
};

/**
 * Record a graceful-shutdown request received during a protected session.
 * @param {string} signal - 'SIGINT' | 'SIGTERM'
 * @returns {{first: boolean}} first=true the first time; false on a repeat (operator insists → force).
 */
export const requestShutdown = signal => {
  if (shutdownRequested) {
    forceRequested = true;
    trace(`[working-session] repeat ${signal} during protected session → force requested`);
    return { first: false };
  }
  shutdownRequested = true;
  shutdownSignal = signal || shutdownSignal;
  trace(`[working-session] ${shutdownSignal} deferred until the AI working session finishes`);
  return { first: true };
};

/**
 * Force-kill the active AI child process group(s) by reusing command-stream's own SIGINT handler,
 * which forwards SIGINT to every active runner's process group. We temporarily install a no-op
 * SIGINT listener first so command-stream sees "other handlers present" and does NOT call
 * process.exit(130) itself — leaving us in control to auto-commit and exit afterward.
 * @returns {number} Count of command-stream listeners invoked (0 if none / no active child).
 */
export const forceKillActiveChildren = () => {
  const live = process.listeners('SIGINT').filter(isCommandStreamSigintListener);
  if (live.length === 0) {
    trace('[working-session] force-kill requested but no active command-stream child found');
    return 0;
  }
  trace(`[working-session] force-killing ${live.length} active AI child process group(s)`);
  const noop = () => {};
  process.on('SIGINT', noop); // guarantee listeners.length > 1 → command-stream won't process.exit
  try {
    for (const listener of live) {
      try {
        listener();
      } catch {
        // ignore — child group may already be gone
      }
    }
  } finally {
    process.removeListener('SIGINT', noop);
  }
  return live.length;
};

/** Reset all module state (used by tests). */
export const resetWorkingSession = () => {
  flagEnabled = false;
  logFn = null;
  protectedSessionActive = false;
  shutdownRequested = false;
  shutdownSignal = null;
  forceRequested = false;
};

export default {
  configureWorkingSession,
  isFlagEnabled,
  isWorkingSessionActive,
  isShutdownRequested,
  getShutdownSignal,
  isForceRequested,
  beginWorkingSession,
  endWorkingSession,
  requestShutdown,
  forceKillActiveChildren,
  resetWorkingSession,
};
