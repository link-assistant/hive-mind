/**
 * Error handling utilities for solve.mjs
 */

// Import exit handler
import { safeExit } from './exit-handler.lib.mjs';

// Import Sentry integration
import { reportError } from './sentry.lib.mjs';

// Import GitHub issue creator
import { handleErrorWithIssueCreation } from './github-issue-creator.lib.mjs';

/**
 * Handles log attachment and PR closing on failure
 */
export const handleFailure = async options => {
  const { error, errorType, shouldAttachLogs, argv, global, owner, repo, log, getLogFile, attachLogToGitHub, cleanErrorMessage, sanitizeLogContent, $ } = options;

  // Offer to create GitHub issue for the error
  try {
    await handleErrorWithIssueCreation({
      error,
      errorType,
      logFile: getLogFile(),
      context: {
        owner: global.owner || owner,
        repo: global.repo || repo,
        prNumber: global.createdPR?.number,
        errorType,
      },
      skipPrompt: !process.stdin.isTTY || argv.noIssueCreation,
    });
  } catch (issueError) {
    reportError(issueError, {
      context: 'automatic_issue_creation',
      operation: 'handle_error_with_issue_creation',
    });
    await log(`⚠️  Could not create issue: ${issueError.message}`, { level: 'warning' });
  }

  // If --attach-logs is enabled, try to attach failure logs
  if (shouldAttachLogs && getLogFile() && global.createdPR && global.createdPR.number) {
    await log('\n📄 Attempting to attach failure logs...');
    try {
      const logUploadSuccess = await attachLogToGitHub({
        logFile: getLogFile(),
        targetType: 'pr',
        targetNumber: global.createdPR.number,
        owner: global.owner || owner,
        repo: global.repo || repo,
        $,
        log,
        sanitizeLogContent,
        verbose: argv.verbose,
        errorMessage: cleanErrorMessage(error),
      });
      if (logUploadSuccess) {
        await log('📎 Failure log attached to Pull Request');
      }
    } catch (attachError) {
      reportError(attachError, {
        context: 'attach_failure_log',
        prNumber: global.createdPR?.number,
        errorType,
        operation: 'attach_log_to_pr',
      });
      await log(`⚠️  Could not attach failure log: ${attachError.message}`, { level: 'warning' });
    }
  }

  // If --auto-close-pull-request-on-fail is enabled, close the PR
  if (argv.autoClosePullRequestOnFail && global.createdPR && global.createdPR.number) {
    await log('\n🔒 Auto-closing pull request due to failure...');
    try {
      const closeMessage = errorType === 'uncaughtException' ? 'Auto-closed due to uncaught exception. Logs have been attached for debugging.' : errorType === 'unhandledRejection' ? 'Auto-closed due to unhandled rejection. Logs have been attached for debugging.' : 'Auto-closed due to execution failure. Logs have been attached for debugging.';

      const result = await $`gh pr close ${global.createdPR.number} --repo ${global.owner || owner}/${global.repo || repo} --comment ${closeMessage}`;
      if (result.exitCode === 0) {
        await log('✅ Pull request closed successfully');
      }
    } catch (closeError) {
      reportError(closeError, {
        context: 'close_pr_on_failure',
        prNumber: global.createdPR?.number,
        owner,
        repo,
        operation: 'close_pull_request',
      });
      await log(`⚠️  Could not close pull request: ${closeError.message}`, { level: 'warning' });
    }
  }
};

/**
 * Creates an uncaught exception handler
 */
export const createUncaughtExceptionHandler = options => {
  const { log, cleanErrorMessage, absoluteLogPath, shouldAttachLogs, argv, global, owner, repo, getLogFile, attachLogToGitHub, sanitizeLogContent, $ } = options;

  return async error => {
    await log(`\n❌ Uncaught Exception: ${cleanErrorMessage(error)}`, { level: 'error' });
    await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });

    await handleFailure({
      error,
      errorType: 'uncaughtException',
      shouldAttachLogs,
      argv,
      global,
      owner,
      repo,
      log,
      getLogFile,
      attachLogToGitHub,
      cleanErrorMessage,
      sanitizeLogContent,
      $,
    });

    await safeExit(1, 'Error occurred');
  };
};

/**
 * Creates an unhandled rejection handler
 */
export const createUnhandledRejectionHandler = options => {
  const { log, cleanErrorMessage, absoluteLogPath, shouldAttachLogs, argv, global, owner, repo, getLogFile, attachLogToGitHub, sanitizeLogContent, $ } = options;

  return async reason => {
    await log(`\n❌ Unhandled Rejection: ${cleanErrorMessage(reason)}`, { level: 'error' });
    await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });

    await handleFailure({
      error: reason,
      errorType: 'unhandledRejection',
      shouldAttachLogs,
      argv,
      global,
      owner,
      repo,
      log,
      getLogFile,
      attachLogToGitHub,
      cleanErrorMessage,
      sanitizeLogContent,
      $,
    });

    await safeExit(1, 'Error occurred');
  };
};

/**
 * Handles the case where no PR is available when one is required
 */
export const handleNoPrAvailableError = async ({ isContinueMode, tempDir, issueNumber, issueUrl, log, formatAligned }) => {
  await log('');
  await log(formatAligned('❌', 'FATAL ERROR:', 'No pull request available'), { level: 'error' });
  await log('');
  await log('  🔍 What happened:');
  if (isContinueMode) {
    await log('     Continue mode is active but no PR number is available.');
    await log('     This usually means PR creation failed or was skipped incorrectly.');
  } else {
    await log('     Auto-PR creation is enabled but no PR was created.');
    await log('     PR creation may have failed without throwing an error.');
  }
  await log('');
  await log('  💡 Why this is critical:');
  await log('     The solve command requires a PR for:');
  await log('     • Tracking work progress');
  await log('     • Receiving and processing feedback');
  await log('     • Managing code changes');
  await log('     • Auto-merging when complete');
  await log('');
  await log('  🔧 How to fix:');
  await log('');
  await log('  Option 1: Create PR manually and use --continue');
  await log(`     cd ${tempDir}`);
  await log(`     gh pr create --draft --title "Fix issue #${issueNumber}" --body "Fixes #${issueNumber}"`);
  await log('     # Then use the PR URL with solve.mjs');
  await log('');
  await log('  Option 2: Start fresh without continue mode');
  await log(`     ./solve.mjs "${issueUrl}" --auto-pull-request-creation`);
  await log('');
  await log('  Option 3: Disable auto-PR creation (Claude will create it)');
  await log(`     ./solve.mjs "${issueUrl}" --no-auto-pull-request-creation`);
  await log('');
  await safeExit(1, 'No PR available');
};

/**
 * Handles execution errors in the main catch block
 */
export const handleMainExecutionError = async options => {
  const { error, log, cleanErrorMessage, absoluteLogPath, shouldAttachLogs, argv, global, owner, repo, getLogFile, attachLogToGitHub, sanitizeLogContent, $ } = options;

  // Special handling for authentication errors
  if (error.isAuthError) {
    await log('\n❌ AUTHENTICATION ERROR', { level: 'error' });
    await log('', { level: 'error' });
    await log('   The AI tool authentication has failed.', { level: 'error' });
    await log('   This error cannot be resolved by retrying.', { level: 'error' });
    await log('', { level: 'error' });
    await log(`   Error: ${cleanErrorMessage(error)}`, { level: 'error' });
    await log('', { level: 'error' });
    await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });

    // Don't try to attach logs or create issues for auth errors
    await safeExit(1, 'Authentication error');
    return;
  }

  await log('Error executing command:', cleanErrorMessage(error));
  await log(`Stack trace: ${error.stack}`, { verbose: true });
  await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });

  await handleFailure({
    error,
    errorType: 'execution',
    shouldAttachLogs,
    argv,
    global,
    owner,
    repo,
    log,
    getLogFile,
    attachLogToGitHub,
    cleanErrorMessage,
    sanitizeLogContent,
    $,
  });

  await safeExit(1, 'Error occurred');
};
