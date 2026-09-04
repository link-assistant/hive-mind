/**
 * Bot lifecycle helpers extracted from telegram-bot.mjs (issue #1927).
 *
 * These three concerns — a periodic liveness heartbeat, resuming tracked
 * sessions on launch, and an orderly shutdown that records a final timestamped
 * marker — were inline in the bot entrypoint, where they could not be unit
 * tested and pushed the file toward the 1500-line limit (see issue #1593). They
 * are pure factories here: every external dependency (logger, clock, process,
 * console, timer) is injected, so production wiring stays identical while the
 * behaviour is exercised directly by tests.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import { RESOURCE_PHASE_BOT_HEARTBEAT, captureResourceSnapshot, formatHeapUsage, isHeapUnderPressure, summarizeResourceSnapshot } from './solve.resource-diagnostics.lib.mjs';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 60 * 1000;

/**
 * Periodic timestamped heartbeat (requirements #3/#4).
 *
 * Writes a heartbeat line on a fixed interval so the "last time the bot was
 * alive" is always discoverable from the log, even when nothing else happens.
 * That marker is what a later restart uses to decide which sessions were running
 * when the bot was last alive. The beat is wrapped so a logging failure can never
 * crash the bot, and the interval is unref'd so it never keeps the process alive
 * on its own.
 *
 * @returns {{ start: () => void, stop: () => void, beat: () => void, get timer(): any }}
 */
export function createHeartbeat({ logger, getActiveSessionCount, intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, processImpl = process, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval, captureResources = captureResourceSnapshot, resourceDiskPath = '/' } = {}) {
  let timer = null;

  const beat = () => {
    try {
      let resources = null;
      try {
        if (typeof captureResources === 'function') {
          resources = summarizeResourceSnapshot(
            captureResources({
              phase: RESOURCE_PHASE_BOT_HEARTBEAT,
              diskPath: resourceDiskPath,
            })
          );
        }
      } catch {
        resources = null;
      }
      logger.heartbeat({
        activeSessions: typeof getActiveSessionCount === 'function' ? getActiveSessionCount(false) : undefined,
        uptimeSec: Math.floor(processImpl.uptime()),
        resources,
      });
      // Issue #2189: the bot walked from 1.78 GB to 1.84 GB of RSS against its
      // own ~2 GB heap cap while re-reporting one dead session, and nothing in
      // the log said so until it died (#733). The heartbeat is the one place
      // that samples the bot itself, so it is where the warning belongs.
      if (isHeapUnderPressure(resources?.memory) && typeof logger.warn === 'function') {
        logger.warn(`Bot V8 heap is under pressure: ${formatHeapUsage(resources.memory)} — the process will abort with "JavaScript heap out of memory" if it keeps growing`, { heap: resources.memory });
      }
    } catch {
      /* heartbeat must never crash the bot */
    }
  };

  return {
    start() {
      if (timer) return;
      timer = setIntervalImpl(beat, intervalMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
      beat();
    },
    stop() {
      if (timer) {
        clearIntervalImpl(timer);
        timer = null;
      }
    },
    beat,
    get timer() {
      return timer;
    },
  };
}

/**
 * Reconcile the isolation backend's own view of still-running executions.
 *
 * Issue #2189: the detached-docker completion watchers are children of the
 * process that launched them, so a bot restart leaves every running container
 * unsupervised — its exit is never written to the log footer, which is one of
 * the ways the reported session stayed in limbo. `$ --resume-all`
 * (start-command >= 0.33.0) re-attaches a watcher to what is still alive and
 * finalizes what died meanwhile; it starts no work on its own.
 *
 * Run *before* the durable store is replayed so the first monitor tick reads
 * settled state rather than racing upstream's reconciliation. An older `$`
 * without the verb, or no isolation at all, is a no-op — never an error.
 *
 * @returns {Promise<{attempted: boolean, reconciled: number, reattached: number, running: number, unsupported: boolean, error: string|null}>}
 */
async function reconcileIsolationExecutions({ reconcileIsolationSessions, verbose, logger, consoleImpl }) {
  const idle = { attempted: false, reconciled: 0, reattached: 0, running: 0, unsupported: false, error: null };
  if (typeof reconcileIsolationSessions !== 'function') return idle;
  try {
    const result = await reconcileIsolationSessions({ verbose });
    const executions = Array.isArray(result?.executions) ? result.executions : [];
    const count = action => executions.filter(entry => entry?.action === action).length;
    const summary = {
      attempted: true,
      reconciled: count('reconciled'),
      reattached: count('reattached'),
      running: count('running'),
      unsupported: result?.unsupported === true,
      error: result?.success === false && result?.unsupported !== true ? result?.error || 'unknown error' : null,
    };
    if (summary.reconciled > 0 || summary.reattached > 0) {
      consoleImpl.log(`♻️  Reconciled ${executions.length} isolated execution(s) with the isolation backend (${summary.reattached} re-attached, ${summary.reconciled} finalized after running unsupervised)`);
    } else if (verbose) {
      consoleImpl.log(`[VERBOSE] resume-all: ${summary.unsupported ? 'this `$` build has no --resume-all; skipped' : `${executions.length} execution(s), nothing to re-attach`}`);
    }
    logger?.event?.('isolation_executions_reconciled', summary);
    return summary;
  } catch (error) {
    // Startup reconciliation is best effort by construction: it must never be
    // able to stop the bot from coming up.
    consoleImpl.error(`[telegram-bot] Could not reconcile isolated executions: ${error?.message || error}`);
    return { ...idle, attempted: true, error: error?.message || String(error) };
  }
}

/**
 * Resume sessions left tracked by a previous run (requirements #2/#4).
 *
 * After a restart, reload sessions that were still being tracked when the
 * previous process died and re-register them so the monitor resumes watching —
 * and finally reports any that were killed while the bot was down. Logs a
 * `sessions_resumed` event either way and never throws: a resume failure must
 * not stop the bot from coming up.
 *
 * Issue #2189 added the step before it: `reconcileIsolationSessions`
 * (`$ --resume-all`) settles the isolation backend's own record of what is
 * still running, so the replayed sessions are matched against the truth.
 *
 * @returns {Promise<{ resumed: any[], skipped: any[], reconciliation: object, error?: Error }>}
 */
export async function resumeSessionsOnLaunch({ resumeTrackedSessions, reconcileIsolationSessions = null, botStartTime, verbose = false, logger, consoleImpl = console } = {}) {
  const reconciliation = await reconcileIsolationExecutions({ reconcileIsolationSessions, verbose, logger, consoleImpl });
  try {
    const { resumed, skipped } = await resumeTrackedSessions({ botStartTime, verbose });
    if (resumed.length > 0) {
      consoleImpl.log(`♻️  Resumed ${resumed.length} session(s) from previous run`);
    }
    logger.event('sessions_resumed', {
      resumed: resumed.length,
      skipped: skipped.length,
      sessions: resumed.map(r => r.sessionName),
    });
    return { resumed, skipped, reconciliation };
  } catch (error) {
    consoleImpl.error(`[telegram-bot] Failed to resume tracked sessions: ${error.message}`);
    logger.error('Failed to resume tracked sessions', { error: error.message });
    return { resumed: [], skipped: [], reconciliation, error };
  }
}

/**
 * Build the shutdown signal handler (requirement #3).
 *
 * Records a `bot_shutdown` event (with a timestamp) so the log shows the bot
 * stopped cleanly — the ABSENCE of this line before the next startup is exactly
 * how a later analysis tells an orderly stop apart from a hard kill. The
 * mutation of module state (the `isShuttingDown` flag, aborting the launch
 * controller, clearing timers, stopping the queue) stays with the caller via the
 * injected `onShutdown` / `cleanup` closures, so the timer references live where
 * they are created. Neither logging nor cleanup is allowed to block `bot.stop`.
 *
 * @returns {(signal: string) => void}
 */
export function createShutdownHandler({ logger, getActiveSessionCount, verbose = false, onShutdown, cleanup, bot, processImpl = process, consoleImpl = console } = {}) {
  return function handleShutdownSignal(signal) {
    if (typeof onShutdown === 'function') onShutdown();
    try {
      logger.event('bot_shutdown', {
        signal,
        pid: processImpl.pid,
        ppid: processImpl.ppid,
        activeSessions: typeof getActiveSessionCount === 'function' ? getActiveSessionCount(false) : undefined,
        uptimeSec: Math.floor(processImpl.uptime()),
      });
    } catch {
      /* a logging failure must never block shutdown */
    }
    if (verbose) consoleImpl.log(`[VERBOSE] Signal: ${signal}, PID: ${processImpl.pid}, PPID: ${processImpl.ppid}`);
    try {
      if (typeof cleanup === 'function') cleanup();
    } catch {
      /* cleanup is best-effort during shutdown */
    }
    if (bot && typeof bot.stop === 'function') bot.stop(signal);
  };
}
