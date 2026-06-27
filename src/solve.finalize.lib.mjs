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

  // Issue #1431: safeExit() unrefs handles so the event loop exits naturally, then calls process.exit(0)
  await safeExit(0, 'Process completed');
}
