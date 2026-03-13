/**
 * Interrupt wrapper factory for CTRL+C handling in solve sessions.
 *
 * On SIGINT, auto-commits uncommitted changes and uploads session logs if --attach-logs is enabled.
 */

/**
 * Creates an interrupt wrapper function that auto-commits and uploads logs on CTRL+C.
 * @param {object} deps - Dependencies
 * @param {object} deps.cleanupContext - Mutable context object with tempDir, argv, branchName, prNumber, owner, repo
 * @param {Function} deps.checkForUncommittedChanges - Tool-specific function to check and commit changes
 * @param {boolean} deps.shouldAttachLogs - Whether --attach-logs is enabled
 * @param {Function} deps.attachLogToGitHub - Function to upload log to GitHub PR
 * @param {Function} deps.getLogFile - Function that returns the current log file path
 * @param {Function} deps.sanitizeLogContent - Function to sanitize log content before upload
 * @param {object} deps.$ - Shell command runner
 * @param {Function} deps.log - Logging function
 * @returns {Function} Async interrupt wrapper
 */
export const createInterruptWrapper = ({ cleanupContext, checkForUncommittedChanges, shouldAttachLogs, attachLogToGitHub, getLogFile, sanitizeLogContent, $, log }) => {
  return async () => {
    const ctx = cleanupContext;
    if (!ctx.tempDir || !ctx.argv) return;

    await log('\n⚠️  Session interrupted by user (CTRL+C)');

    // Always auto-commit uncommitted changes on CTRL+C to preserve work
    if (ctx.branchName) {
      try {
        await checkForUncommittedChanges(
          ctx.tempDir,
          ctx.owner,
          ctx.repo,
          ctx.branchName,
          $,
          log,
          true, // always autoCommit on CTRL+C to preserve work
          false // no autoRestart
        );
      } catch (commitError) {
        await log(`⚠️  Could not auto-commit changes on interrupt: ${commitError.message}`, {
          level: 'warning',
        });
      }
    }

    // Upload logs if --attach-logs is enabled and we have a PR
    if (shouldAttachLogs && ctx.prNumber && ctx.owner && ctx.repo) {
      await log('📎 Uploading interrupted session logs to Pull Request...');
      try {
        await attachLogToGitHub({
          logFile: getLogFile(),
          targetType: 'pr',
          targetNumber: ctx.prNumber,
          owner: ctx.owner,
          repo: ctx.repo,
          $,
          log,
          sanitizeLogContent,
          verbose: ctx.argv.verbose || false,
          errorMessage: 'Session interrupted by user (CTRL+C)',
        });
      } catch (uploadError) {
        await log(`⚠️  Could not upload logs on interrupt: ${uploadError.message}`, {
          level: 'warning',
        });
      }
    }
  };
};
