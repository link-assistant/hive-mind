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
const { $: __rawDollar$ } = await use('command-stream');
const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const $ = wrapDollarWithGhRetry(__rawDollar$);
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

// Issue #1574: Interruptible sleep so CTRL+C is never blocked by a lingering timer
const { interruptibleSleep } = await import('./interruptible-sleep.lib.mjs');
const { formatAutoIterationLimit, hasReachedAutoIterationLimit, normalizeAutoIterationLimit } = await import('./auto-iteration-limits.lib.mjs');

// Issue #1625: Central marker constants + tracked comment posting
const toolComments = await import('./tool-comments.lib.mjs');
const { AUTO_RESTART_MARKER, postTrackedComment } = toolComments;

// Issue #1728: Per-iteration working session summary attachment helper
const resultsLib = await import('./solve.results.lib.mjs');
const { maybeAttachWorkingSessionSummary } = resultsLib;

/**
 * Monitor for feedback in a loop and trigger restart when detected
 */
export const watchForFeedback = async params => {
  const { issueUrl, owner, repo, issueNumber, prNumber, prBranch, branchName, tempDir, argv } = params;

  const watchInterval = argv.watchInterval || 60; // seconds
  const isTemporaryWatch = argv.temporaryWatch || false;
  const maxAutoRestartIterations = normalizeAutoIterationLimit(argv.autoRestartMaxIterations);

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
    await log(formatAligned('', 'Max iterations:', formatAutoIterationLimit(maxAutoRestartIterations), 2));
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

      // Issue #401: If --auto-delete-branch-on-merge is enabled in --watch mode,
      // delete the branch from the remote after the PR is merged. This enables
      // full GitHub Flow automation. Only applies in --watch mode (not auto-restart),
      // because auto-restart is for completing local work, not finalizing GitHub Flow.
      const shouldAutoDeleteBranch = !isTemporaryWatch && argv.autoDeleteBranchOnMerge && branchName;
      if (shouldAutoDeleteBranch) {
        await log('');
        await log(formatAligned('🗑️', 'AUTO-DELETE:', `Deleting branch ${branchName} after merge`));
        try {
          // Delete the branch from the remote via GitHub REST API.
          // We use `gh api ... -X DELETE` rather than `git push --delete` so we don't
          // require a configured local remote in tempDir at this point in the run.
          const deleteBranchResult = await $`gh api repos/${owner}/${repo}/git/refs/heads/${branchName} -X DELETE`;
          if (deleteBranchResult.code === 0) {
            await log(formatAligned('✅', 'Branch deleted:', `${branchName}`, 2));
          } else {
            const stderrText = deleteBranchResult.stderr?.toString().trim() || 'Unknown error';
            // 422 Reference does not exist -> branch was already deleted (e.g. GitHub's "Automatically delete head branches"
            // setting raced ahead of us). Treat as success rather than warning.
            if (/Reference does not exist|Not Found|422|404/i.test(stderrText)) {
              await log(formatAligned('✅', 'Branch already removed:', `${branchName} (no action needed)`, 2));
            } else {
              await log(formatAligned('⚠️', 'Branch deletion failed:', stderrText, 2));
              reportError(new Error(`Branch deletion returned non-zero exit code: ${stderrText}`), {
                context: 'delete_branch_on_merge_non_zero',
                owner,
                repo,
                branchName,
                exitCode: deleteBranchResult.code,
                operation: 'delete_remote_branch',
              });
            }
          }
        } catch (deleteError) {
          reportError(deleteError, {
            context: 'delete_branch_on_merge',
            owner,
            repo,
            branchName,
            operation: 'delete_remote_branch',
          });
          await log(formatAligned('⚠️', 'Branch deletion error:', cleanErrorMessage(deleteError), 2));
        }
      }

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
      if (hasReachedAutoIterationLimit(autoRestartCount, maxAutoRestartIterations)) {
        await log('');
        await log(formatAligned('⚠️', 'MAX ITERATIONS REACHED', `Exiting auto-restart mode after ${autoRestartCount} iterations`));
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
              const remainingIterations = maxAutoRestartIterations === 0 ? null : maxAutoRestartIterations - autoRestartCount;

              // Get uncommitted files list for the comment
              let uncommittedFilesList = '';
              if (changes.length > 0) {
                uncommittedFilesList = '\n\n**Uncommitted files:**\n```\n' + changes.join('\n') + '\n```';
              }

              const iterationLabel = maxAutoRestartIterations === 0 ? `${autoRestartCount}` : `${autoRestartCount}/${maxAutoRestartIterations}`;
              const stopText = remainingIterations === null ? 'Auto-restart is configured with no iteration limit.' : `Auto-restart will stop after changes are committed or discarded, or after ${remainingIterations} more iteration${remainingIterations !== 1 ? 's' : ''}.`;
              const commentBody = `## 🔄 ${AUTO_RESTART_MARKER} ${iterationLabel}\n\nDetected uncommitted changes from previous run. Starting new session to review and commit or discard them.${uncommittedFilesList}\n\n---\n*${stopText} Please wait until working session will end and give your feedback.*`;
              // Issue #1625: Track so this doesn't falsely count as AI-authored.
              await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: commentBody });
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

        // Issue #1728: Scope the AI-comment check that gates --auto-attach-solution-summary
        // to comments posted during *this* iteration only, not across the whole watch loop.
        const iterationStartTime = new Date();

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
                const iterationLabel = maxAutoRestartIterations === 0 ? `${autoRestartCount}` : `${autoRestartCount}/${maxAutoRestartIterations}`;
                const customTitle = `⚠️ Auto-restart ${iterationLabel} Failure Log`;
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
                  // Issue #1225: Pass model and tool info for PR comments
                  requestedModel: argv.originalModel || argv.model,
                  tool: argv.tool || 'claude',
                  // Issue #1508: Pass model usage for failure log (cost info per model)
                  resultModelUsage: toolResult.resultModelUsage || null,
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

          // Issue #1508: Compute budget stats for auto-restart log comment
          let autoRestartBudgetStatsData = null;
          if (argv.tokensBudgetStats && latestSessionId && tempDir) {
            try {
              const { calculateSessionTokens } = await import('./claude.lib.mjs');
              const tokenUsage = await calculateSessionTokens(latestSessionId, tempDir, toolResult.resultModelUsage);
              if (tokenUsage) {
                autoRestartBudgetStatsData = { tokenUsage, streamTokenUsage: toolResult.streamTokenUsage || null, subAgentCalls: toolResult.subAgentCalls || null };
              }
            } catch (budgetError) {
              if (argv.verbose) await log(`  ⚠️  Could not calculate budget stats: ${budgetError.message}`, { verbose: true });
            }
          }

          // Issue #1761: Post the working session **summary** BEFORE uploading
          // the working session **log** so the summary always appears above
          // the log in PR comment chronological order. The summary acts as a
          // human-readable header for the (potentially very long) log that
          // follows, and reordering matches the top-level flow in
          // src/solve.mjs (which calls maybeAttachWorkingSessionSummary
          // before verifyResults / attachLogToGitHub).
          //
          // Issue #1728: Attach a "Working session summary" comment for this
          // iteration if the AI didn't post any comments of its own (and
          // --auto-attach-solution-summary is enabled, which it is by default).
          // Same fix as in solve.auto-merge.lib.mjs — every working session,
          // not just the top-level run, should honour the auto-attach flag.
          try {
            await maybeAttachWorkingSessionSummary({
              argv,
              resultSummary: toolResult.resultSummary,
              workStartTime: iterationStartTime,
              owner,
              repo,
              prNumber,
              issueNumber,
              success: true,
            });
          } catch (summaryError) {
            reportError(summaryError, {
              context: 'attach_watch_working_session_summary',
              prNumber,
              owner,
              repo,
              autoRestartCount,
              operation: 'attach_working_session_summary',
            });
            await log(formatAligned('', `⚠️  Working session summary error: ${cleanErrorMessage(summaryError)}`, '', 2));
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
                const iterationLabel = maxAutoRestartIterations === 0 ? `${autoRestartCount}` : `${autoRestartCount}/${maxAutoRestartIterations}`;
                const customTitle = `🔄 Auto-restart ${iterationLabel} Log`;
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
                  requestedModel: argv.originalModel || argv.model,
                  tool: argv.tool || 'claude',
                  // Issue #1508: Include budget stats (context/token/cost) for auto-restart log
                  resultModelUsage: toolResult.resultModelUsage || null,
                  budgetStatsData: autoRestartBudgetStatsData,
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
      await interruptibleSleep(actualWaitMs);
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
