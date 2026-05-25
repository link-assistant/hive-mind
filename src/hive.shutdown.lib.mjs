/**
 * Issue #1823: Graceful-shutdown manager for the hive command.
 *
 * Extracted from hive.mjs so the shutdown logic stays focused and independently testable
 * (and to keep hive.mjs within the repo's max-lines lint budget).
 *
 * Behavior contract (see issue #1823):
 *   - On the FIRST interrupt (SIGINT/SIGTERM, or the \003 that `$ --stop`/screen injects),
 *     hive stops accepting new work and waits — without any time cap — for every in-flight
 *     `/solve` worker to finish NATURALLY, then exits 0. Because each solve runs in its own
 *     detached process group, the terminal's signal never reached it, so it keeps running.
 *   - On a SECOND interrupt (operator insists on stopping now), hive force-kills the in-flight
 *     solve process group(s) — negative PID, so codex and any grandchildren die too — and
 *     exits 130 immediately.
 *
 * @param {object} deps - Injected hive-scope dependencies.
 * @param {Function} deps.log - Async logger (matches hive's log()).
 * @param {Function} deps.safeExit - Async exit helper from exit-handler.lib.mjs.
 * @param {Function} deps.reportError - Sentry error reporter.
 * @param {Function} deps.cleanErrorMessage - Formats an error for logging.
 * @param {Function} deps.cleanupTempDirectories - Cleans temp dirs after successful runs.
 * @param {object}   deps.issueQueue - The producer/consumer queue (stop/getStats/workers).
 * @param {object}   deps.argv - Parsed CLI args (passed through to cleanup).
 * @param {string}   deps.absoluteLogPath - Resolved log file path (for the final log line).
 * @param {Set}      deps.activeSolveChildren - Live set of in-flight solve child processes.
 * @returns {{ gracefulShutdown: Function, forceKillActiveSolveChildren: Function }}
 */
export const createShutdownManager = ({ log, safeExit, reportError, cleanErrorMessage, cleanupTempDirectories, issueQueue, argv, absoluteLogPath, activeSolveChildren }) => {
  // Global shutdown state to prevent duplicate shutdown messages / re-entrancy.
  let isShuttingDown = false;

  // Issue #1823: Force-kill all in-flight detached solve children (and their codex
  // descendants) by signalling their process groups. Used only when the operator insists on
  // an immediate exit (a SECOND interrupt). A negative PID targets the whole process group,
  // so this also terminates codex and any grandchildren spawned by solve.
  async function forceKillActiveSolveChildren(signalName = 'SIGTERM') {
    for (const child of activeSolveChildren) {
      if (!child || child.pid == null) {
        continue;
      }
      try {
        process.kill(-child.pid, signalName); // negative pid → whole process group
      } catch (killError) {
        // The group may already be gone; fall back to signalling just the child.
        try {
          child.kill(signalName);
        } catch {
          // Child already exited — nothing to do.
        }
        await log(`   ⚠️  Could not signal solve process group (pid ${child.pid}): ${killError.message}`, {
          verbose: true,
        });
      }
    }
  }

  // Graceful shutdown handler.
  async function gracefulShutdown(signal) {
    if (isShuttingDown) {
      // Issue #1823: A second interrupt while already shutting down means the operator wants
      // to stop NOW. Force-kill the in-flight solve process group(s) and exit immediately,
      // overriding the default "wait for solve to finish" behavior.
      await log(`\n\n⚠️  Received second ${signal} signal — force-stopping ${activeSolveChildren.size} in-flight solve worker(s) and exiting now.`, {
        level: 'warning',
      });
      await forceKillActiveSolveChildren('SIGTERM');
      await safeExit(130, 'Force interrupted by repeated signal');
      return;
    }
    isShuttingDown = true;

    try {
      await log(`\n\n🛑 Received ${signal} signal, shutting down gracefully...`);
      await log('   ℹ️  Waiting for in-progress solve worker(s) to finish naturally. Press CTRL+C again to force-stop.');

      // Stop the queue so each worker exits its loop after its current solve completes.
      issueQueue.stop();

      // Issue #1823: Wait for in-flight solve commands to FINISH NATURALLY. We intentionally
      // do NOT cap this wait — the issue requires that CTRL+C / `$ --stop` fully waits for each
      // running /solve to complete before shutting down. Because solve runs in its own detached
      // process group, the interrupt did not reach it, so it keeps running until done.
      // Promise.all(issueQueue.workers) is the authoritative wait; a periodic progress line
      // makes it clear hive is still waiting (and is unref'd so it never blocks exit itself).
      const stats = issueQueue.getStats();
      let progressTimer = null;
      if (stats.processing > 0) {
        const waitStart = Date.now();
        await log(`   ⏳ Waiting for ${stats.processing} worker(s) to finish current tasks...`);
        progressTimer = setInterval(() => {
          const current = issueQueue.getStats();
          if (current.processing > 0) {
            const elapsed = Math.round((Date.now() - waitStart) / 1000);
            log(`   ⏳ Still waiting for ${current.processing} solve worker(s) to finish (${elapsed}s elapsed)...`).catch(() => {});
          }
        }, 15000);
        if (typeof progressTimer.unref === 'function') {
          progressTimer.unref();
        }
      }

      await Promise.all(issueQueue.workers);
      if (progressTimer) {
        clearInterval(progressTimer);
      }

      // Perform cleanup if enabled and there were successful completions
      const finalStats = issueQueue.getStats();
      if (finalStats.completed > 0) {
        await cleanupTempDirectories(argv);
      }

      await log('   ✅ Shutdown complete');
      await log(`   📁 Full log file: ${absoluteLogPath}`);
    } catch (error) {
      reportError(error, {
        context: 'monitor_issues_shutdown',
        operation: 'cleanup_and_exit',
      });
      await log(`   ⚠️  Error during shutdown: ${cleanErrorMessage(error)}`, { level: 'error' });
      await log(`   📁 Full log file: ${absoluteLogPath}`);
    }

    await safeExit(0, 'Process completed');
  }

  return { gracefulShutdown, forceKillActiveSolveChildren };
};
