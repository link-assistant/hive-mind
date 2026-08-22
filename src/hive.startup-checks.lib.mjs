/**
 * Pre-flight checks the hive runs before it starts monitoring.
 *
 * Extracted from src/hive.mjs (issue #2175) so the entry point stays under the
 * 1350-line early-warning threshold that protects concurrent merges (#1593).
 * Behaviour is unchanged; the collaborators that used to be closure bindings in
 * hive.mjs are parameters, which also makes the sequence unit-testable
 * (see tests/hive-startup-checks-2175.test.mjs).
 */

/**
 * Run the startup checks, exiting through `safeExit` when one fails.
 *
 * @param {object} deps
 * @param {object} deps.argv parsed CLI arguments
 * @param {Function} deps.log
 * @param {Function} deps.safeExit
 * @param {Function} deps.ensureDiskSpaceForWorker
 * @param {Function} deps.checkSystem
 * @param {Function} deps.validateToolConnection
 * @param {Function} deps.validateClaudeConnection
 * @param {number} deps.EXIT_CODE_INSUFFICIENT_DISK_SPACE
 * @returns {Promise<{skipped: boolean}>}
 */
export async function runStartupChecks({ argv, log, safeExit, ensureDiskSpaceForWorker, checkSystem, validateToolConnection, validateClaudeConnection, EXIT_CODE_INSUFFICIENT_DISK_SPACE }) {
  if (argv.dryRun || argv.skipToolConnectionCheck || argv.toolConnectionCheck === false) {
    await log('⏩ Skipping system resource check (dry-run mode or skip-tool-connection-check enabled)', { verbose: true });
    await log('⏩ Skipping AI tool connection check (dry-run mode or skip-tool-connection-check enabled)', { verbose: true });
    return { skipped: true };
  }

  // Issue #2160: reclaim idle solver workspaces left behind by earlier runs before refusing to
  // start, and report an exhausted disk as the environment condition it is (exit 75) instead of
  // a generic error. `exitOnFailure` is deliberately not used: it calls process.exit(1)
  // directly, which skips the log-flushing safeExit path and printed no actionable reason.
  const startupRequiredDiskSpaceMB = argv.minDiskSpace || 10240;
  const startupDiskGuard = await ensureDiskSpaceForWorker({ requiredMB: startupRequiredDiskSpaceMB, log });
  if (!startupDiskGuard.ok) {
    await log(`❌ Insufficient disk space to start: ${startupDiskGuard.freeMB}MB available, ${startupRequiredDiskSpaceMB}MB required`, { level: 'error' });
    await log('   Free space on this host, or run with --auto-cleanup so workspaces are removed after each task.', { level: 'error' });
    await safeExit(EXIT_CODE_INSUFFICIENT_DISK_SPACE, `Insufficient disk space (${startupDiskGuard.freeMB}MB available, ${startupRequiredDiskSpaceMB}MB required)`);
  }

  const systemCheck = await checkSystem({ minDiskSpaceMB: startupRequiredDiskSpaceMB, minMemoryMB: 256 }, { log });
  if (!systemCheck.success) {
    await safeExit(1, 'System resource check failed');
  }

  // Validate the selected AI tool connection before starting monitoring with the same model that will be used
  const isToolConnected = await validateToolConnection({ tool: argv.tool, model: argv.model, verbose: argv.verbose, validateClaudeConnection });
  if (!isToolConnected) {
    await log(`❌ Cannot start monitoring without ${argv.tool || 'claude'} connection`, { level: 'error' });
    await safeExit(1, 'Error occurred');
  }

  return { skipped: false };
}
