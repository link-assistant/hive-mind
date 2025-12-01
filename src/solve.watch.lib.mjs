#!/usr/bin/env node

/**
 * Watch mode module for solve.mjs
 * Monitors for feedback continuously and restarts when changes are detected
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
const { log, cleanErrorMessage, formatAligned } = lib;

// Import feedback detection functions
const feedbackLib = await import('./solve.feedback.lib.mjs');
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

const { detectAndCountFeedback } = feedbackLib;

/**
 * Check if PR has been merged
 */
const checkPRMerged = async (owner, repo, prNumber) => {
  try {
    const prResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.merged'`;
    if (prResult.code === 0) {
      return prResult.stdout.toString().trim() === 'true';
    }
  } catch (error) {
    reportError(error, {
      context: 'check_pr_merged',
      owner,
      repo,
      prNumber,
      operation: 'check_merge_status'
    });
    // If we can't check, assume not merged
    return false;
  }
  return false;
};

/**
 * Check if there are uncommitted changes in the repository
 */
const checkForUncommittedChanges = async (tempDir, $) => {
  try {
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
    if (gitStatusResult.code === 0) {
      const statusOutput = gitStatusResult.stdout.toString().trim();
      return statusOutput.length > 0;
    }
  } catch (error) {
    reportError(error, {
      context: 'check_pr_closed',
      tempDir,
      operation: 'check_close_status'
    });
    // If we can't check, assume no uncommitted changes
  }
  return false;
};

/**
 * Monitor for feedback in a loop and trigger restart when detected
 */
export const watchForFeedback = async (params) => {
  const {
    issueUrl,
    owner,
    repo,
    issueNumber,
    prNumber,
    prBranch,
    branchName,
    tempDir,
    argv
  } = params;

  const watchInterval = argv.watchInterval || 60; // seconds
  const intervalMs = watchInterval * 1000;
  const isTemporaryWatch = argv.temporaryWatch || false;
  const maxAutoRestartIterations = argv.autoRestartMaxIterations || 3;

  // Track latest session data across all iterations for accurate pricing
  let latestSessionId = null;
  let latestAnthropicCost = null;

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

  // let lastCheckTime = new Date(); // Not currently used
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
      const hasUncommitted = await checkForUncommittedChanges(tempDir, $);
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
        $
      });

      // Check if there's any feedback or if it's the first iteration in temporary mode
      const hasFeedback = feedbackLines && feedbackLines.length > 0;
      const shouldRestart = hasFeedback || firstIterationInTemporaryMode;

      if (shouldRestart) {
        if (firstIterationInTemporaryMode) {
          await log(formatAligned('📝', 'UNCOMMITTED CHANGES:', '', 2));
          // Get uncommitted changes for display
          try {
            const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
            if (gitStatusResult.code === 0) {
              const statusOutput = gitStatusResult.stdout.toString().trim();
              for (const line of statusOutput.split('\n')) {
                await log(formatAligned('', `• ${line}`, '', 4));
              }
            }
          } catch (e) {
            reportError(e, {
              context: 'check_claude_file_exists',
              owner,
              repo,
              branchName,
              operation: 'check_file_in_branch'
            });
            // Ignore errors
          }
          await log('');
          await log(formatAligned('🔄', 'Initial restart:', `Running ${argv.tool.toUpperCase()} to handle uncommitted changes...`));

          // Post a comment to PR about auto-restart
          if (prNumber) {
            try {
              autoRestartCount++;
              const remainingIterations = maxAutoRestartIterations - autoRestartCount;

              // Get uncommitted files list for the comment
              let uncommittedFilesList = '';
              try {
                const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
                if (gitStatusResult.code === 0) {
                  const statusOutput = gitStatusResult.stdout.toString().trim();
                  if (statusOutput) {
                    uncommittedFilesList = '\n\n**Uncommitted files:**\n```\n' + statusOutput + '\n```';
                  }
                }
              } catch {
                // If we can't get the file list, continue without it
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
                operation: 'comment_on_pr'
              });
              // Don't fail if comment posting fails
              await log(formatAligned('', '⚠️  Could not post comment to PR', '', 2));
            }
          }

          // Add uncommitted changes info to feedbackLines for the first run
          if (!feedbackLines) {
            feedbackLines = [];
          }
          feedbackLines.push('');
          feedbackLines.push('⚠️ UNCOMMITTED CHANGES DETECTED:');
          feedbackLines.push('The following uncommitted changes were found in the repository:');

          try {
            const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
            if (gitStatusResult.code === 0) {
              const statusOutput = gitStatusResult.stdout.toString().trim();
              feedbackLines.push('');
              for (const line of statusOutput.split('\n')) {
                feedbackLines.push(`  ${line}`);
              }
              feedbackLines.push('');
              feedbackLines.push('Please review and handle these changes appropriately.');
              feedbackLines.push('Consider committing important changes or cleaning up unnecessary files.');
            }
          } catch (e) {
            reportError(e, {
              context: 'recheck_claude_file',
              owner,
              repo,
              branchName,
              operation: 'verify_file_in_branch'
            });
            // Ignore errors
          }
        } else {
          await log(formatAligned('📢', 'FEEDBACK DETECTED!', '', 2));
          feedbackLines.forEach(async line => {
            await log(formatAligned('', `• ${line}`, '', 4));
          });
          await log('');
          await log(formatAligned('🔄', 'Restarting:', `Re-running ${argv.tool.toUpperCase()} to handle feedback...`));
        }

        // Import necessary modules for tool execution
        const memoryCheck = await import('./memory-check.mjs');
        const { getResourceSnapshot } = memoryCheck;

        let toolResult;
        if (argv.tool === 'opencode') {
          // Use OpenCode
          const opencodeExecLib = await import('./opencode.lib.mjs');
          const { executeOpenCode } = opencodeExecLib;

          // Get opencode path
          const opencodePath = argv.opencodePath || 'opencode';

          toolResult = await executeOpenCode({
            issueUrl,
            issueNumber,
            prNumber,
            prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
            branchName,
            tempDir,
            isContinueMode: true,
            mergeStateStatus,
            forkedRepo: argv.fork,
            feedbackLines,
            owner,
            repo,
            argv,
            log,
            formatAligned,
            getResourceSnapshot,
            opencodePath,
            $
          });
        } else if (argv.tool === 'codex') {
          // Use Codex
          const codexExecLib = await import('./codex.lib.mjs');
          const { executeCodex } = codexExecLib;

          // Get codex path
          const codexPath = argv.codexPath || 'codex';

          toolResult = await executeCodex({
            issueUrl,
            issueNumber,
            prNumber,
            prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
            branchName,
            tempDir,
            isContinueMode: true,
            mergeStateStatus,
            forkedRepo: argv.fork,
            feedbackLines,
            forkActionsUrl: null,
            owner,
            repo,
            argv,
            log,
            setLogFile: () => {},
            getLogFile: () => '',
            formatAligned,
            getResourceSnapshot,
            codexPath,
            $
          });
        } else {
          // Use Claude (default)
          const claudeExecLib = await import('./claude.lib.mjs');
          const { executeClaude } = claudeExecLib;

          // Get claude path
          const claudePath = argv.claudePath || 'claude';

          toolResult = await executeClaude({
            issueUrl,
            issueNumber,
            prNumber,
            prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
            branchName,
            tempDir,
            isContinueMode: true,
            mergeStateStatus,
            forkedRepo: argv.fork,
            feedbackLines,
            owner,
            repo,
            argv,
            log,
            formatAligned,
            getResourceSnapshot,
            claudePath,
            $
          });
        }

        if (!toolResult.success) {
          await log(formatAligned('⚠️', `${argv.tool.toUpperCase()} execution failed`, 'Will retry in next check', 2));
        } else {
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

          await log('');
          if (isTemporaryWatch) {
            await log(formatAligned('✅', `${argv.tool.toUpperCase()} execution completed:`, 'Checking for remaining changes...'));
          } else {
            await log(formatAligned('✅', `${argv.tool.toUpperCase()} execution completed:`, 'Resuming watch mode...'));
          }

          // Auto-commit any uncommitted changes after successful tool execution
          // This prevents infinite restart loops when tools make changes but don't commit them
          try {
            const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
            if (gitStatusResult.code === 0) {
              const statusOutput = gitStatusResult.stdout.toString().trim();
              if (statusOutput) {
                await log(formatAligned('💾', 'Auto-committing changes:', 'Found uncommitted changes after tool execution'));
                const addResult = await $({ cwd: tempDir })`git add -A`;
                if (addResult.code === 0) {
                  const commitMessage = `Auto-commit: Changes made by ${argv.tool.toUpperCase()} during problem-solving session`;
                  const commitResult = await $({ cwd: tempDir })`git commit -m ${commitMessage}`;
                  if (commitResult.code === 0) {
                    await log(formatAligned('✅', 'Changes committed successfully', '', 2));
                  } else {
                    await log(formatAligned('⚠️', 'Failed to commit changes:', commitResult.stderr?.toString().trim(), 2));
                  }
                } else {
                  await log(formatAligned('⚠️', 'Failed to stage changes:', addResult.stderr?.toString().trim(), 2));
                }
              }
            }
          } catch (commitError) {
            reportError(commitError, {
              context: 'auto_commit_after_tool_execution',
              tempDir,
              tool: argv.tool,
              operation: 'auto_commit_changes'
            });
            await log(formatAligned('⚠️', 'Error during auto-commit:', commitError.message, 2));
          }
        }

        // Note: lastCheckTime tracking removed as it was not being used

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
        operation: 'watch_pull_request'
      });
      await log(formatAligned('⚠️', 'Check failed:', cleanErrorMessage(error), 2));
      if (!isTemporaryWatch) {
        await log(formatAligned('', 'Will retry in:', `${watchInterval} seconds`, 2));
      }
    }

    // Wait for next interval (skip wait entirely in temporary watch mode / auto-restart)
    if (!isTemporaryWatch && !firstIterationInTemporaryMode) {
      await log(formatAligned('⏱️', 'Next check in:', `${watchInterval} seconds...`, 2));
      await log(''); // Blank line for readability
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } else if (isTemporaryWatch && !firstIterationInTemporaryMode) {
      // In auto-restart mode, check immediately without waiting
      await log(formatAligned('', 'Checking immediately for uncommitted changes...', '', 2));
      await log(''); // Blank line for readability
    }
  }

  // Return latest session data for accurate pricing in log uploads
  return {
    latestSessionId,
    latestAnthropicCost
  };
};

/**
 * Start watch mode after initial execution
 */
export const startWatchMode = async (params) => {
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