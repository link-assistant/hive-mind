// Issue #2119: "after 5 we must actually stop (fail + auto-commit on fail
// recovery). So the result will be actually visible." Both auto-restart loops
// record their exhaustion in this shared module, so the run exits non-zero
// instead of reporting success with the blocker still unresolved.
import { getAutoRestartLimitFailure, hasAutoRestartLimitFailure } from './auto-restart-exhaustion.lib.mjs';

export async function finalizeSolveProcess({ tempDir, argv, limitReached, path, getLogFile, log, closeSentry, logActiveHandles, cleanupTempDirectory, safeExit }) {
  await cleanupTempDirectory(tempDir, argv, limitReached);

  // Show final log file reference so users always know where to find the complete log
  if (getLogFile()) {
    const finalLogPath = path.resolve(getLogFile());
    await log(`\n📁 Complete log file: ${finalLogPath}`);
  }

  // Issue #1346: Flush Sentry events before exit.
  // closeSentry() uses a hard Promise.race deadline so it cannot block indefinitely.
  await closeSentry();

  // Issue #1431: Log active handles before draining.
  // Always logged to file and console so future hangs are immediately visible in logs.
  // drainHandles() inside safeExit() will unref/close these before process.exit().
  await logActiveHandles(msg => log(msg));

  // Issue #2119: an exhausted auto-restart budget is a failure, not a completed run.
  if (hasAutoRestartLimitFailure()) {
    const failure = getAutoRestartLimitFailure();
    await log(`\n❌ Auto-restart limit reached after ${failure.iterationsUsed} iteration${failure.iterationsUsed !== 1 ? 's' : ''} - the blocker was never resolved.`, { level: 'error' });
    await log(failure.committed ? '   Uncommitted work was auto-committed before exit, so the partial result is visible.' : '   No uncommitted work was left to preserve.', { level: 'error' });
    await safeExit(1, 'Auto-restart limit reached');
    return;
  }

  // Issue #1431: safeExit() unrefs handles so the event loop exits naturally, then calls process.exit(0)
  await safeExit(0, 'Process completed');
}
