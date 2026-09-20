// Issue #2119: "after 5 we must actually stop (fail + auto-commit on fail
// recovery). So the result will be actually visible." Both auto-restart loops
// record their exhaustion in this shared module, so the run exits non-zero
// instead of reporting success with the blocker still unresolved.
import { getAutoRestartLimitFailure, hasAutoRestartLimitFailure } from './auto-restart-exhaustion.lib.mjs';
// Issue #2247 (H3): stopping because two consecutive sessions were identical is
// a failure for the same reason an exhausted budget is - the task is unfinished.
import { getNoProgressFailure, hasNoProgressFailure } from './session-progress.lib.mjs';

export async function finalizeSolveProcess({ tempDir, argv, limitReached, path, getLogFile, log, closeSentry, logActiveHandles, cleanupTempDirectory, safeExit }) {
  const runFinalizationStep = async (label, step) => {
    try {
      await step();
    } catch (error) {
      const message = error?.message || String(error);
      try {
        await log(`⚠️  Finalization step failed (${label}): ${message}`, { level: 'warning' });
      } catch {
        console.warn(`⚠️  Finalization step failed (${label}): ${message}`);
      }
    }
  };

  await runFinalizationStep('temporary directory cleanup', () => cleanupTempDirectory(tempDir, argv, limitReached));

  await runFinalizationStep('final log reference', async () => {
    // Show final log file reference so users always know where to find the complete log
    if (getLogFile()) {
      const finalLogPath = path.resolve(getLogFile());
      await log(`\n📁 Complete log file: ${finalLogPath}`);
    }
  });

  // Issue #1346: Flush Sentry events before exit.
  // closeSentry() uses a hard Promise.race deadline so it cannot block indefinitely.
  await runFinalizationStep('Sentry close', closeSentry);

  // Issue #1431: Log active handles before draining.
  // Always logged to file and console so future hangs are immediately visible in logs.
  // drainHandles() inside safeExit() will unref/close these before process.exit().
  await runFinalizationStep('active handle diagnostics', () => logActiveHandles(msg => log(msg)));

  // Issue #2119: an exhausted auto-restart budget is a failure, not a completed run.
  if (hasAutoRestartLimitFailure()) {
    const failure = getAutoRestartLimitFailure();
    await log(`\n❌ Auto-restart limit reached after ${failure.iterationsUsed} iteration${failure.iterationsUsed !== 1 ? 's' : ''} - the blocker was never resolved.`, { level: 'error' });
    await log(failure.committed ? '   Uncommitted work was auto-committed before exit, so the partial result is visible.' : '   No uncommitted work was left to preserve.', { level: 'error' });
    await safeExit(1, 'Auto-restart limit reached');
    return;
  }

  // Issue #2247 (H3): the run stopped early on purpose, with restart budget left
  // over, because repeating an identical session cannot finish the task either.
  if (hasNoProgressFailure()) {
    const failure = getNoProgressFailure();
    await log('\n❌ Stopped after two consecutive AI sessions produced identical results - no restart can make progress.', { level: 'error' });
    await log(failure.committed ? '   Uncommitted work was auto-committed before exit, so the partial result is visible.' : '   No uncommitted work was left to preserve.', { level: 'error' });
    await safeExit(1, 'No progress between sessions');
    return;
  }

  // Issue #1431: safeExit() unrefs handles so the event loop exits naturally, then calls process.exit(0)
  await safeExit(0, 'Process completed');
}
