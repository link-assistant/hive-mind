#!/usr/bin/env node

/**
 * Watch mode module for solve.mjs
 * Monitors for feedback continuously and restarts when changes are detected
 *
 * Uses shared utilities from solve.restart-shared.lib.mjs for common functions.
 */

// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Import shared library functions
const lib = await import('./lib.mjs');
const { log, cleanErrorMessage, formatAligned, getLogFile } = lib;

// Import feedback detection functions
const feedbackLib = await import('./solve.feedback.lib.mjs');
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

// Import GitHub functions for log attachment
const githubLib = await import('./github.lib.mjs');
const { sanitizeLogContent, attachLogToGitHub } = githubLib;

const { detectAndCountFeedback } = feedbackLib;

// Import shared utilities from the restart-shared module
const restartShared = await import('./solve.restart-shared.lib.mjs');
const { checkPRMerged, checkForUncommittedChanges, getUncommittedChangesDetails, executeToolIteration, buildUncommittedChangesFeedback, isApiError } = restartShared;

/**
 * Monitor for feedback in a loop and trigger restart when detected
 */
export const watchForFeedback = async params => {
  const { issueUrl, owner, repo, issueNumber, prNumber, prBranch, branchName, tempDir, argv } = params;

  const watchInterval = argv.watchInterval || 60; // seconds
  const isTemporaryWatch = argv.temporaryWatch || false;
  const maxAutoRestartIterations = argv.autoRestartMaxIterations || 3;

  // Track latest session data across all iterations for accurate pricing
  let latestSessionId = null;
  let latestAnthropicCost = null;

  // Issue #1290: Track whether auto-restart iterations actually ran and whether logs were uploaded
  // This helps solve.mjs decide whether to upload final logs
  let autoRestartIterationsRan = false;
  let lastIterationLogUploaded = false;

  // Track consecutive API errors for retry limit
  const MAX_API_ERROR_RETRIES = 3;
  let consecutiveApiErrors = 0;
  let currentBackoffSeconds = watchInterval;

  await log('');
  if (isTemporaryWatch) {
    await log(formatAligned('🔄', 'AUTO-RESTART MODE ACTIVE', ''));
    await log(formatAligned('', 'Purpose:', 'Complete unfinished work from previous run', 2));
    await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
    await log(formatAligned('', 'Mode:', 'Auto-restart (NOT --watch mode)', 2));
    await log(formatAligned('', 'Stop conditions:', 'All changes committed OR PR merged OR max iterations reached', 2));
    await log(formatAligned('', 'Max iterations:', `${maxAutoRestartIterations}`, 2));
    await log(formatAligned('', 'Note:', 'No wait time between iterations in auto-restart mode', 2));
  } else {
    await log(formatAligned('👁️', 'WATCH MODE ACTIVATED', ''));
    await log(formatAligned('', 'Checking interval:', `${watchInterval} seconds`, 2));
    await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
    await log(formatAligned('', 'Stop condition:', 'PR merged by maintainer', 2));
  }
  await log('');
  await log('Press Ctrl+C to stop watching manually');
  await log('');

  let iteration = 0;
  let autoRestartCount = 0;
  let firstIterationInTemporaryMode = isTemporaryWatch;

  while (true) {
    iteration++;
    const currentTime = new Date();

    // Check if PR is merged
    const isMerged = await checkPRMerged(owner, repo, prNumber);
    if (isMerged) {
      await log('');
      await log(formatAligned('🎉', 'PR MERGED!', 'Stopping watch mode'));
      await log(formatAligned('', 'Pull request:', `#${prNumber} has been merged`, 2));
      await log('');
      break;
    }

    // In temporary watch mode, check if all changes have been committed
    if (isTemporaryWatch && !firstIterationInTemporaryMode) {
      const hasUncommitted = await checkForUncommittedChanges(tempDir, argv);
      if (!hasUncommitted) {
        await log('');
        await log(formatAligned('✅', 'CHANGES COMMITTED!', 'Exiting auto-restart mode'));
        await log(formatAligned('', 'All uncommitted changes have been resolved', '', 2));
        await log('');
        break;
      }

      // Check if we've reached max iterations
      if (autoRestartCount >= maxAutoRestartIterations) {
        await log('');
        await log(formatAligned('⚠️', 'MAX ITERATIONS REACHED', `Exiting auto-restart mode after ${autoRestartCount} attempts`));
        await log(formatAligned('', 'Some uncommitted changes may remain', '', 2));
        await log(formatAligned('', 'Please review and commit manually if needed', '', 2));
        await log('');
        break;
      }
    }

    // Check for feedback or handle initial uncommitted changes
    if (firstIterationInTemporaryMode) {
      await log(formatAligned('🔄', 'Initial restart:', 'Handling uncommitted changes...'));
    } else {
      await log(formatAligned('🔍', `Check #${iteration}:`, currentTime.toLocaleTimeString()));
    }

    try {
      // Get PR merge state status
      const prStateResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.mergeStateStatus'`;
      const mergeStateStatus = prStateResult.code === 0 ? prStateResult.stdout.toString().trim() : null;

      // Detect feedback using existing function
      let { feedbackLines } = await detectAndCountFeedback({
        prNumber,
        branchName: prBranch || branchName,
        owner,
        repo,
        issueNumber,
        isContinueMode: true,
        argv: { ...argv, verbose: false }, // Reduce verbosity in watch mode
        mergeStateStatus,
        workStartTime: null, // In watch mode, we want to count all comments as potential feedback
        log,
        formatAligned,
        cleanErrorMessage,
        $,
      });

      // Check if there's any feedback or if it's the first iteration in temporary mode
      const hasFeedback = feedbackLines && feedbackLines.length > 0;

      // In temporary watch mode, also check for uncommitted changes as a restart trigger
      let hasUncommittedInTempMode = false;
      if (isTemporaryWatch && !firstIterationInTemporaryMode) {
        hasUncommittedInTempMode = await checkForUncommittedChanges(tempDir, argv);
      }

      const shouldRestart = hasFeedback || firstIterationInTemporaryMode || hasUncommittedInTempMode;

      if (shouldRestart) {
        // Handle uncommitted changes in temporary watch mode (first iteration or subsequent)
        if (firstIterationInTemporaryMode || hasUncommittedInTempMode) {
          await log(formatAligned('📝', 'UNCOMMITTED CHANGES:', '', 2));
          // Get uncommitted changes for display using shared utility
          const changes = await getUncommittedChangesDetails(tempDir);
          for (const line of changes) {
            await log(formatAligned('', `• ${line}`, '', 4));
          }
          await log('');

          // Increment auto-restart counter and log restart number
          autoRestartCount++;
          autoRestartIterationsRan = true; // Issue #1290: Mark that auto-restart iterations ran
          lastIterationLogUploaded = false; // Reset log upload tracking for new iteration
          const restartLabel = firstIterationInTemporaryMode ? 'Initial restart' : `Restart ${autoRestartCount}/${maxAutoRestartIterations}`;
          await log(formatAligned('🔄', `${restartLabel}:`, `Running ${argv.tool.toUpperCase()} to handle uncommitted changes...`));

          // Post a comment to PR about auto-restart
          if (prNumber) {
            try {
              const remainingIterations = maxAutoRestartIterations - autoRestartCount;

              // Get uncommitted files list for the comment
              let uncommittedFilesList = '';
              if (changes.length > 0) {
                uncommittedFilesList = '\n\n**Uncommitted files:**\n```\n' + changes.join('\n') + '\n```';
              }

              const commentBody = `## 🔄 Auto-restart ${autoRestartCount}/${maxAutoRestartIterations}\n\nDetected uncommitted changes from previous run. Starting new session to review and commit them.${uncommittedFilesList}\n\n---\n*Auto-restart will stop after changes are committed or after ${remainingIterations} more iteration${remainingIterations !== 1 ? 's' : ''}. Please wait until working session will end and give your feedback.*`;
              await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
              await log(formatAligned('', '💬 Posted auto-restart notification to PR', '', 2));
            } catch (commentError) {
              reportError(commentError, {
                context: 'post_auto_restart_comment',
                owner,
                repo,
                prNumber,
                operation: 'comment_on_pr',
              });
              // Don't fail if comment posting fails
              await log(formatAligned('', '⚠️  Could not post comment to PR', '', 2));
            }
          }

          // Add uncommitted changes info to feedbackLines using shared utility
          if (!feedbackLines) {
            feedbackLines = [];
          }
          const uncommittedFeedback = buildUncommittedChangesFeedback(changes, autoRestartCount, maxAutoRestartIterations);
          feedbackLines.push(...uncommittedFeedback);
        } else {
          await log(formatAligned('📢', 'FEEDBACK DETECTED!', '', 2));
          feedbackLines.forEach(async line => {
            await log(formatAligned('', `• ${line}`, '', 4));
          });
          await log('');
          await log(formatAligned('🔄', 'Restarting:', `Re-running ${argv.tool.toUpperCase()} to handle feedback...`));
        }

        // Execute tool using shared utility
        const toolResult = await executeToolIteration({
          issueUrl,
          owner,
          repo,
          issueNumber,
          prNumber,
          branchName: prBranch || branchName,
          tempDir,
          mergeStateStatus,
          feedbackLines,
          argv,
        });

        if (!toolResult.success) {
          // Check if this is an API error using shared utility
          if (isApiError(toolResult)) {
            consecutiveApiErrors++;
            await log(formatAligned('⚠️', `${argv.tool.toUpperCase()} execution failed`, `API error detected (${consecutiveApiErrors}/${MAX_API_ERROR_RETRIES})`, 2));

            if (consecutiveApiErrors >= MAX_API_ERROR_RETRIES) {
              await log('');
              await log(formatAligned('❌', 'MAXIMUM API ERROR RETRIES REACHED', ''));
              await log(formatAligned('', 'Error details:', toolResult.result || 'Unknown API error', 2));
              await log(formatAligned('', 'Consecutive failures:', `${consecutiveApiErrors}`, 2));
              await log(formatAligned('', 'Action:', 'Exiting watch mode to prevent infinite loop', 2));
              await log('');
              await log('Please check:');
              await log('  1. The model name is valid for the selected tool');
              await log('  2. You have proper authentication configured');
              await log('  3. The API endpoint is accessible');
              await log('');
              break; // Exit the watch loop
            }

            // Apply exponential backoff for API errors
            currentBackoffSeconds = Math.min(currentBackoffSeconds * 2, 300); // Cap at 5 minutes
            await log(formatAligned('', 'Backing off:', `Will retry after ${currentBackoffSeconds} seconds`, 2));
          } else {
            // Non-API error, reset consecutive counter
            consecutiveApiErrors = 0;
            currentBackoffSeconds = watchInterval;
            await log(formatAligned('⚠️', `${argv.tool.toUpperCase()} execution failed`, 'Will retry in next check', 2));
          }

          // Issue #1290: Upload failure logs for auto-restart iterations when --attach-logs is enabled
          // This ensures that failed auto-restart sessions still report their logs
          const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
          if (isTemporaryWatch && prNumber && shouldAttachLogs) {
            await log('');
            await log(formatAligned('📎', 'Uploading auto-restart failure log...', ''));
            try {
              const logFile = getLogFile();
              if (logFile) {
                // Use "Auto-restart X/Y Failure Log" format to distinguish from success logs
                const customTitle = `⚠️ Auto-restart ${autoRestartCount}/${maxAutoRestartIterations} Failure Log`;
                const logUploadSuccess = await attachLogToGitHub({
                  logFile,
                  targetType: 'pr',
                  targetNumber: prNumber,
                  owner,
                  repo,
                  $,
                  log,
                  sanitizeLogContent,
                  verbose: argv.verbose,
                  customTitle,
                  sessionId: toolResult.sessionId || latestSessionId,
                  tempDir,
                  // Include error information in the log upload
                  errorMessage: toolResult.errorInfo?.message || toolResult.result || `${argv.tool.toUpperCase()} execution failed`,
                  // Include pricing data if available from failed attempt
                  publicPricingEstimate: toolResult.publicPricingEstimate,
                  pricingInfo: toolResult.pricingInfo,
                  // Mark if this was a usage limit failure
                  isUsageLimit: toolResult.limitReached,
                  limitResetTime: toolResult.limitResetTime,
                });

                if (logUploadSuccess) {
                  await log(formatAligned('', '✅ Auto-restart failure log uploaded to PR', '', 2));
                  lastIterationLogUploaded = true; // Issue #1290: Mark that logs were uploaded
                } else {
                  await log(formatAligned('', '⚠️  Could not upload auto-restart failure log', '', 2));
                }
              }
            } catch (logUploadError) {
              reportError(logUploadError, {
                context: 'attach_auto_restart_failure_log',
                prNumber,
                owner,
                repo,
                autoRestartCount,
                operation: 'upload_failure_log',
              });
              await log(formatAligned('', `⚠️  Log upload error: ${cleanErrorMessage(logUploadError)}`, '', 2));
            }
          }
        } else {
          // Success - reset error counters
          consecutiveApiErrors = 0;
          currentBackoffSeconds = watchInterval;

          // Capture latest session data from successful execution for accurate pricing
          if (toolResult.sessionId) {
            latestSessionId = toolResult.sessionId;
            latestAnthropicCost = toolResult.anthropicTotalCostUSD;
            if (argv.verbose) {
              await log(`   📊 Session data captured: ${latestSessionId}`, { verbose: true });
              if (latestAnthropicCost !== null && latestAnthropicCost !== undefined) {
                await log(`   💰 Anthropic cost: $${latestAnthropicCost.toFixed(6)}`, { verbose: true });
              }
            }
          }

          // Issue #1107: Attach log after each auto-restart session with its own cost estimation
          // This ensures each restart has its own log comment instead of one combined log at the end
          const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
          if (isTemporaryWatch && prNumber && shouldAttachLogs) {
            await log('');
            await log(formatAligned('📎', 'Uploading auto-restart session log...', ''));
            try {
              const logFile = getLogFile();
              if (logFile) {
                // Use "Auto-restart X/Y Log" format as requested in issue #1107
                const customTitle = `🔄 Auto-restart ${autoRestartCount}/${maxAutoRestartIterations} Log`;
                const logUploadSuccess = await attachLogToGitHub({
                  logFile,
                  targetType: 'pr',
                  targetNumber: prNumber,
                  owner,
                  repo,
                  $,
                  log,
                  sanitizeLogContent,
                  verbose: argv.verbose,
                  customTitle,
                  sessionId: latestSessionId,
                  tempDir,
                  anthropicTotalCostUSD: latestAnthropicCost,
                  // Pass agent tool pricing data when available
                  publicPricingEstimate: toolResult.publicPricingEstimate,
                  pricingInfo: toolResult.pricingInfo,
                  // Issue #1225: Pass model and tool info for PR comments
                  requestedModel: argv.model,
                  tool: argv.tool || 'claude',
                });

                if (logUploadSuccess) {
                  await log(formatAligned('', '✅ Auto-restart session log uploaded to PR', '', 2));
                  lastIterationLogUploaded = true; // Issue #1290: Mark that logs were uploaded
                } else {
                  await log(formatAligned('', '⚠️  Could not upload auto-restart session log', '', 2));
                }
              }
            } catch (logUploadError) {
              reportError(logUploadError, {
                context: 'attach_auto_restart_log',
                prNumber,
                owner,
                repo,
                autoRestartCount,
                operation: 'upload_session_log',
              });
              await log(formatAligned('', `⚠️  Log upload error: ${cleanErrorMessage(logUploadError)}`, '', 2));
            }
          }

          await log('');
          if (isTemporaryWatch) {
            await log(formatAligned('✅', `${argv.tool.toUpperCase()} execution completed:`, 'Checking for remaining changes...'));
          } else {
            await log(formatAligned('✅', `${argv.tool.toUpperCase()} execution completed:`, 'Resuming watch mode...'));
          }
        }

        // Clear the first iteration flag after handling initial uncommitted changes
        if (firstIterationInTemporaryMode) {
          firstIterationInTemporaryMode = false;
        }
      } else {
        await log(formatAligned('', 'No feedback detected', 'Continuing to watch...', 2));
      }
    } catch (error) {
      reportError(error, {
        context: 'watch_pr_general',
        prNumber,
        owner,
        repo,
        operation: 'watch_pull_request',
      });
      await log(formatAligned('⚠️', 'Check failed:', cleanErrorMessage(error), 2));
      if (!isTemporaryWatch) {
        await log(formatAligned('', 'Will retry in:', `${watchInterval} seconds`, 2));
      }
    }

    // Wait for next interval (skip wait entirely in temporary watch mode / auto-restart)
    if (!isTemporaryWatch && !firstIterationInTemporaryMode) {
      // Use backoff interval if we have consecutive API errors
      const actualWaitSeconds = consecutiveApiErrors > 0 ? currentBackoffSeconds : watchInterval;
      const actualWaitMs = actualWaitSeconds * 1000;
      await log(formatAligned('⏱️', 'Next check in:', `${actualWaitSeconds} seconds...`, 2));
      await log(''); // Blank line for readability
      await new Promise(resolve => setTimeout(resolve, actualWaitMs));
    } else if (isTemporaryWatch && !firstIterationInTemporaryMode) {
      // In auto-restart mode, check immediately without waiting
      await log(formatAligned('', 'Checking immediately for uncommitted changes...', '', 2));
      await log(''); // Blank line for readability
    }
  }

  // Return latest session data for accurate pricing in log uploads
  // Issue #1290: Include flags to help solve.mjs decide whether to upload final logs
  return {
    latestSessionId,
    latestAnthropicCost,
    autoRestartIterationsRan, // True if any auto-restart iterations actually ran
    lastIterationLogUploaded, // True if the last iteration's logs were uploaded
  };
};

/**
 * Start watch mode after initial execution
 */
export const startWatchMode = async params => {
  const { argv } = params;

  if (argv.verbose) {
    await log('');
    await log('📊 startWatchMode called with:', { verbose: true });
    await log(`   argv.watch: ${argv.watch}`, { verbose: true });
    await log(`   params.prNumber: ${params.prNumber || 'null'}`, { verbose: true });
  }

  if (!argv.watch) {
    if (argv.verbose) {
      await log('   Watch mode not enabled - exiting startWatchMode', { verbose: true });
    }
    return null; // Watch mode not enabled
  }

  if (!params.prNumber) {
    await log('');
    await log(formatAligned('⚠️', 'Watch mode:', 'Requires a pull request'));
    await log(formatAligned('', 'Note:', 'Watch mode only works with existing PRs', 2));
    if (argv.verbose) {
      await log('   prNumber is missing - cannot start watch mode', { verbose: true });
    }
    return null;
  }

  // Start the watch loop and return session data
  return await watchForFeedback(params);
};
