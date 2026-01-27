#!/usr/bin/env node

/**
 * Auto-merge and auto-restart-until-mergable module for solve.mjs
 * Handles automatic merging of PRs and continuous restart until PR becomes mergeable
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1190
 */

// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Import path and fs for cleanup operations
const path = (await use('path')).default;
const fs = (await use('fs')).promises;

// Import shared library functions
const lib = await import('./lib.mjs');
const { log, cleanErrorMessage, formatAligned, getLogFile } = lib;

// Import feedback detection functions
const feedbackLib = await import('./solve.feedback.lib.mjs');
const { detectAndCountFeedback } = feedbackLib;

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

// Import GitHub merge functions
const githubMergeLib = await import('./github-merge.lib.mjs');
const { checkPRCIStatus, checkPRMergeable, mergePullRequest, waitForCI } = githubMergeLib;

// Import GitHub functions for log attachment
const githubLib = await import('./github.lib.mjs');
const { sanitizeLogContent, attachLogToGitHub } = githubLib;

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
      operation: 'check_merge_status',
    });
    // If we can't check, assume not merged
    return false;
  }
  return false;
};

/**
 * Check if PR is closed (but not merged)
 */
const checkPRClosed = async (owner, repo, prNumber) => {
  try {
    const prResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.state'`;
    if (prResult.code === 0) {
      return prResult.stdout.toString().trim() === 'closed';
    }
  } catch (error) {
    reportError(error, {
      context: 'check_pr_closed',
      owner,
      repo,
      prNumber,
      operation: 'check_close_status',
    });
    // If we can't check, assume not closed
    return false;
  }
  return false;
};

/**
 * Check for new comments from non-bot users since last commit
 * @returns {Promise<{hasNewComments: boolean, comments: Array}>}
 */
const checkForNonBotComments = async (owner, repo, prNumber, issueNumber, lastCheckTime, verbose = false) => {
  try {
    // Get current GitHub user to identify which comments are from the bot/hive-mind
    let currentUser = null;
    try {
      const userResult = await $`gh api user --jq .login`;
      if (userResult.code === 0) {
        currentUser = userResult.stdout.toString().trim();
      }
    } catch {
      // If we can't get the current user, continue without filtering
    }

    // Common bot usernames and patterns to filter out
    // Note: Patterns use word boundaries or end-of-string to avoid false positives
    // (e.g., "claudeuser" should NOT match as a bot)
    const botPatterns = [
      /\[bot\]$/i, // Any username ending with [bot]
      /^github-actions$/i, // GitHub Actions
      /^dependabot$/i, // Dependabot
      /^renovate$/i, // Renovate
      /^codecov$/i, // Codecov
      /^netlify$/i, // Netlify
      /^vercel$/i, // Vercel
      /^hive-?mind$/i, // Hive Mind (with or without hyphen)
      /^claude$/i, // Claude (exact match only)
      /^copilot$/i, // GitHub Copilot
    ];

    const isBot = login => {
      if (!login) return false;
      // Check if it's the current user (the bot running hive-mind)
      if (currentUser && login === currentUser) return true;
      // Check against known bot patterns
      return botPatterns.some(pattern => pattern.test(login));
    };

    // Fetch PR conversation comments
    const prCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`;
    let prComments = [];
    if (prCommentsResult.code === 0 && prCommentsResult.stdout) {
      prComments = JSON.parse(prCommentsResult.stdout.toString() || '[]');
    }

    // Fetch PR review comments (inline code comments)
    const prReviewCommentsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`;
    let prReviewComments = [];
    if (prReviewCommentsResult.code === 0 && prReviewCommentsResult.stdout) {
      prReviewComments = JSON.parse(prReviewCommentsResult.stdout.toString() || '[]');
    }

    // Fetch issue comments if we have an issue number
    let issueComments = [];
    if (issueNumber && issueNumber !== prNumber) {
      const issueCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --paginate`;
      if (issueCommentsResult.code === 0 && issueCommentsResult.stdout) {
        issueComments = JSON.parse(issueCommentsResult.stdout.toString() || '[]');
      }
    }

    // Combine all comments
    const allComments = [...prComments, ...prReviewComments, ...issueComments];

    // Filter for new comments from non-bot users
    const newNonBotComments = allComments.filter(comment => {
      const commentTime = new Date(comment.created_at);
      const isAfterLastCheck = commentTime > lastCheckTime;
      const isFromNonBot = !isBot(comment.user?.login);

      if (verbose && isAfterLastCheck && isFromNonBot) {
        console.log(`[VERBOSE] New non-bot comment from ${comment.user?.login} at ${comment.created_at}`);
      }

      return isAfterLastCheck && isFromNonBot;
    });

    return {
      hasNewComments: newNonBotComments.length > 0,
      comments: newNonBotComments,
    };
  } catch (error) {
    reportError(error, {
      context: 'check_non_bot_comments',
      owner,
      repo,
      prNumber,
      operation: 'fetch_comments',
    });
    return { hasNewComments: false, comments: [] };
  }
};

/**
 * Clean up .playwright-mcp/ folder to prevent browser automation artifacts
 * from triggering auto-restart
 */
const cleanupPlaywrightMcpFolder = async (tempDir, argv) => {
  if (argv.playwrightMcpAutoCleanup !== false) {
    const playwrightMcpDir = path.join(tempDir, '.playwright-mcp');
    try {
      const playwrightMcpExists = await fs
        .stat(playwrightMcpDir)
        .then(() => true)
        .catch(() => false);
      if (playwrightMcpExists) {
        await fs.rm(playwrightMcpDir, { recursive: true, force: true });
        await log('🧹 Cleaned up .playwright-mcp/ folder (browser automation artifacts)', { verbose: true });
      }
    } catch (cleanupError) {
      // Non-critical error, just log and continue
      await log(`⚠️  Could not clean up .playwright-mcp/ folder: ${cleanupError.message}`, { verbose: true });
    }
  }
};

/**
 * Check if there are uncommitted changes in the repository
 */
const checkForUncommittedChanges = async (tempDir, argv = {}) => {
  // First, clean up .playwright-mcp/ folder to prevent false positives
  await cleanupPlaywrightMcpFolder(tempDir, argv);

  try {
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
    if (gitStatusResult.code === 0) {
      const statusOutput = gitStatusResult.stdout.toString().trim();
      return statusOutput.length > 0;
    }
  } catch (error) {
    reportError(error, {
      context: 'check_uncommitted_changes',
      tempDir,
      operation: 'git_status',
    });
    // If we can't check, assume no uncommitted changes
  }
  return false;
};

/**
 * Execute the AI tool (Claude, OpenCode, etc.) for a restart iteration
 */
const executeToolIteration = async params => {
  const { issueUrl, owner, repo, issueNumber, prNumber, branchName, tempDir, mergeStateStatus, feedbackLines, argv } = params;

  // Import necessary modules for tool execution
  const memoryCheck = await import('./memory-check.mjs');
  const { getResourceSnapshot } = memoryCheck;

  let toolResult;
  if (argv.tool === 'opencode') {
    // Use OpenCode
    const opencodeExecLib = await import('./opencode.lib.mjs');
    const { executeOpenCode } = opencodeExecLib;
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
      $,
    });
  } else if (argv.tool === 'codex') {
    // Use Codex
    const codexExecLib = await import('./codex.lib.mjs');
    const { executeCodex } = codexExecLib;
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
      $,
    });
  } else if (argv.tool === 'agent') {
    // Use Agent
    const agentExecLib = await import('./agent.lib.mjs');
    const { executeAgent } = agentExecLib;
    const agentPath = argv.agentPath || 'agent';

    toolResult = await executeAgent({
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
      formatAligned,
      getResourceSnapshot,
      agentPath,
      $,
    });
  } else {
    // Use Claude (default)
    const claudeExecLib = await import('./claude.lib.mjs');
    const { executeClaude, checkPlaywrightMcpAvailability } = claudeExecLib;
    const claudePath = argv.claudePath || 'claude';

    // Check for Playwright MCP availability if using Claude tool
    if (argv.tool === 'claude' || !argv.tool) {
      if (argv.promptPlaywrightMcp) {
        const playwrightMcpAvailable = await checkPlaywrightMcpAvailability();
        if (playwrightMcpAvailable) {
          await log('🎭 Playwright MCP detected - enabling browser automation hints', { verbose: true });
        } else {
          await log('ℹ️  Playwright MCP not detected - browser automation hints will be disabled', { verbose: true });
          argv.promptPlaywrightMcp = false;
        }
      } else {
        await log('ℹ️  Playwright MCP explicitly disabled via --no-prompt-playwright-mcp', { verbose: true });
      }
    }

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
      $,
    });
  }

  return toolResult;
};

/**
 * Get the reasons why PR is not mergeable
 */
const getMergeBlockers = async (owner, repo, prNumber, verbose = false) => {
  const blockers = [];

  // Check CI status
  const ciStatus = await checkPRCIStatus(owner, repo, prNumber, verbose);
  if (ciStatus.status === 'failure') {
    blockers.push({
      type: 'ci_failure',
      message: 'CI/CD checks are failing',
      details: ciStatus.checks.filter(c => c.conclusion === 'failure').map(c => c.name),
    });
  } else if (ciStatus.status === 'pending') {
    blockers.push({
      type: 'ci_pending',
      message: 'CI/CD checks are still running',
      details: ciStatus.checks.filter(c => c.status !== 'completed').map(c => c.name),
    });
  }

  // Check mergeability
  const mergeStatus = await checkPRMergeable(owner, repo, prNumber, verbose);
  if (!mergeStatus.mergeable) {
    blockers.push({
      type: 'not_mergeable',
      message: mergeStatus.reason || 'PR is not mergeable',
      details: [],
    });
  }

  return blockers;
};

/**
 * Main function: Watch and restart until PR becomes mergeable
 * This implements --auto-restart-until-mergable functionality
 */
export const watchUntilMergable = async params => {
  const { issueUrl, owner, repo, issueNumber, prNumber, prBranch, branchName, tempDir, argv } = params;

  const watchInterval = argv.watchInterval || 60; // seconds
  const isAutoMerge = argv.autoMerge || false;

  // Track latest session data across all iterations for accurate pricing
  let latestSessionId = null;
  let latestAnthropicCost = null;

  // Track consecutive API errors for retry limit
  const MAX_API_ERROR_RETRIES = 3;
  let consecutiveApiErrors = 0;
  let currentBackoffSeconds = watchInterval;

  await log('');
  await log(formatAligned('🔄', 'AUTO-RESTART-UNTIL-MERGABLE MODE ACTIVE', ''));
  await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
  await log(formatAligned('', 'Mode:', isAutoMerge ? 'Auto-merge (will merge when ready)' : 'Auto-restart-until-mergable (will NOT auto-merge)', 2));
  await log(formatAligned('', 'Checking interval:', `${watchInterval} seconds`, 2));
  await log(formatAligned('', 'Stop conditions:', 'PR merged, PR closed, or becomes mergeable', 2));
  await log(formatAligned('', 'Restart triggers:', 'New non-bot comments, CI failures, merge conflicts', 2));
  await log('');
  await log('Press Ctrl+C to stop watching manually');
  await log('');

  let iteration = 0;
  let lastCheckTime = new Date();

  while (true) {
    iteration++;
    const currentTime = new Date();

    // Check if PR is merged
    const isMerged = await checkPRMerged(owner, repo, prNumber);
    if (isMerged) {
      await log('');
      await log(formatAligned('🎉', 'PR MERGED!', 'Stopping auto-restart-until-mergable mode'));
      await log(formatAligned('', 'Pull request:', `#${prNumber} has been merged`, 2));
      await log('');
      return { success: true, reason: 'merged', latestSessionId, latestAnthropicCost };
    }

    // Check if PR is closed (not merged)
    const isClosed = await checkPRClosed(owner, repo, prNumber);
    if (isClosed) {
      await log('');
      await log(formatAligned('🚫', 'PR CLOSED!', 'Stopping auto-restart-until-mergable mode'));
      await log(formatAligned('', 'Pull request:', `#${prNumber} has been closed without merging`, 2));
      await log('');
      return { success: false, reason: 'closed', latestSessionId, latestAnthropicCost };
    }

    await log(formatAligned('🔍', `Check #${iteration}:`, currentTime.toLocaleTimeString()));

    try {
      // Get merge blockers
      const blockers = await getMergeBlockers(owner, repo, prNumber, argv.verbose);

      // Check for new comments from non-bot users
      const { hasNewComments, comments } = await checkForNonBotComments(owner, repo, prNumber, issueNumber, lastCheckTime, argv.verbose);

      // Check for uncommitted changes
      const hasUncommittedChanges = await checkForUncommittedChanges(tempDir, argv);

      // If PR is mergeable, no blockers, no new comments, and no uncommitted changes
      if (blockers.length === 0 && !hasNewComments && !hasUncommittedChanges) {
        await log(formatAligned('✅', 'PR IS MERGEABLE!', ''));

        if (isAutoMerge) {
          // Attempt to merge the PR
          await log(formatAligned('🔀', 'Auto-merging PR...', ''));
          const mergeResult = await mergePullRequest(owner, repo, prNumber, { squash: argv.squash || false, deleteAfter: argv.deleteBranchAfterMerge || false }, argv.verbose);

          if (mergeResult.success) {
            await log(formatAligned('🎉', 'PR MERGED SUCCESSFULLY!', ''));
            await log(formatAligned('', 'Pull request:', `#${prNumber} has been auto-merged`, 2));

            // Post success comment
            try {
              const commentBody = `## 🎉 Auto-merged\n\nThis pull request has been automatically merged by hive-mind after all CI checks passed and the PR became mergeable.\n\n---\n*Auto-merged by hive-mind with --auto-merge flag*`;
              await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
            } catch {
              // Don't fail if comment posting fails
            }

            return { success: true, reason: 'auto-merged', latestSessionId, latestAnthropicCost };
          } else {
            await log(formatAligned('⚠️', 'Auto-merge failed:', mergeResult.error || 'Unknown error', 2));
            await log(formatAligned('', 'Will continue monitoring...', '', 2));
          }
        } else {
          // Just report that PR is mergeable and exit
          await log(formatAligned('', 'PR is ready to be merged manually', '', 2));
          await log(formatAligned('', 'Exiting auto-restart-until-mergable mode', '', 2));

          // Post success comment
          try {
            const commentBody = `## ✅ Ready to merge\n\nThis pull request is now ready to be merged:\n- All CI checks have passed\n- No merge conflicts\n- No pending changes\n\n---\n*Monitored by hive-mind with --auto-restart-until-mergable flag*`;
            await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
          } catch {
            // Don't fail if comment posting fails
          }

          return { success: true, reason: 'mergeable', latestSessionId, latestAnthropicCost };
        }
      }

      // Determine if we need to restart
      let shouldRestart = false;
      let restartReason = '';
      let feedbackLines = [];

      // Reason 1: New comments from non-bot users
      if (hasNewComments) {
        shouldRestart = true;
        restartReason = `New comment(s) from non-bot user(s): ${comments.map(c => c.user?.login).join(', ')}`;
        feedbackLines.push('📬 New comments detected from non-bot users:');
        for (const comment of comments) {
          feedbackLines.push(`  - ${comment.user?.login}: "${comment.body?.substring(0, 100)}${comment.body?.length > 100 ? '...' : ''}"`);
        }
        feedbackLines.push('');
        feedbackLines.push('Please review and address the feedback from these comments.');
      }

      // Reason 2: CI failures
      const ciBlocker = blockers.find(b => b.type === 'ci_failure');
      if (ciBlocker) {
        shouldRestart = true;
        restartReason = restartReason ? `${restartReason}; CI failures` : 'CI failures detected';
        feedbackLines.push('❌ CI/CD checks are failing:');
        for (const check of ciBlocker.details) {
          feedbackLines.push(`  - ${check}`);
        }
        feedbackLines.push('');
        feedbackLines.push('Please fix the failing CI checks.');
      }

      // Reason 3: Merge conflicts or other merge issues
      const mergeBlocker = blockers.find(b => b.type === 'not_mergeable');
      if (mergeBlocker && mergeBlocker.message.includes('conflicts')) {
        shouldRestart = true;
        restartReason = restartReason ? `${restartReason}; Merge conflicts` : 'Merge conflicts detected';
        feedbackLines.push('⚠️ Merge conflicts detected:');
        feedbackLines.push(`  ${mergeBlocker.message}`);
        feedbackLines.push('');
        feedbackLines.push('Please resolve the merge conflicts.');
      }

      // Reason 4: Uncommitted changes
      if (hasUncommittedChanges) {
        shouldRestart = true;
        restartReason = restartReason ? `${restartReason}; Uncommitted changes` : 'Uncommitted changes detected';

        // Get uncommitted changes for display
        try {
          const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
          if (gitStatusResult.code === 0) {
            const statusOutput = gitStatusResult.stdout.toString().trim();
            feedbackLines.push('📝 Uncommitted changes detected:');
            for (const line of statusOutput.split('\n')) {
              feedbackLines.push(`  ${line}`);
            }
            feedbackLines.push('');
            feedbackLines.push('IMPORTANT: You MUST handle these uncommitted changes by either:');
            feedbackLines.push('1. COMMITTING them if they are part of the solution (git add + git commit + git push)');
            feedbackLines.push('2. REVERTING them if they are not needed (git checkout -- <file> or git clean -fd)');
          }
        } catch {
          feedbackLines.push('📝 Uncommitted changes detected (could not get details)');
        }
      }

      if (shouldRestart) {
        await log(formatAligned('🔄', 'RESTART TRIGGERED:', restartReason));
        await log('');

        // Post a comment to PR about the restart
        try {
          const commentBody = `## 🔄 Auto-restart triggered\n\n**Reason:** ${restartReason}\n\nStarting new session to address the issues.\n\n---\n*Auto-restart-until-mergable mode is active. Will continue until PR becomes mergeable.*`;
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
          await log(formatAligned('', '⚠️  Could not post comment to PR', '', 2));
        }

        // Get PR merge state status
        const prStateResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.mergeStateStatus'`;
        const mergeStateStatus = prStateResult.code === 0 ? prStateResult.stdout.toString().trim() : null;

        // Execute the AI tool
        await log(formatAligned('🔄', 'Restarting:', `Running ${argv.tool.toUpperCase()} to address issues...`));

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
          // Check if this is an API error
          const isApiError = toolResult.result && (toolResult.result.includes('API Error:') || toolResult.result.includes('not_found_error') || toolResult.result.includes('authentication_error') || toolResult.result.includes('invalid_request_error'));

          if (isApiError) {
            consecutiveApiErrors++;
            await log(formatAligned('⚠️', `${argv.tool.toUpperCase()} execution failed`, `API error detected (${consecutiveApiErrors}/${MAX_API_ERROR_RETRIES})`, 2));

            if (consecutiveApiErrors >= MAX_API_ERROR_RETRIES) {
              await log('');
              await log(formatAligned('❌', 'MAXIMUM API ERROR RETRIES REACHED', ''));
              await log(formatAligned('', 'Error details:', toolResult.result || 'Unknown API error', 2));
              await log(formatAligned('', 'Action:', 'Exiting to prevent infinite loop', 2));
              return { success: false, reason: 'api_error', latestSessionId, latestAnthropicCost };
            }

            // Apply exponential backoff
            currentBackoffSeconds = Math.min(currentBackoffSeconds * 2, 300);
            await log(formatAligned('', 'Backing off:', `Will retry after ${currentBackoffSeconds} seconds`, 2));
          } else {
            consecutiveApiErrors = 0;
            currentBackoffSeconds = watchInterval;
            await log(formatAligned('⚠️', `${argv.tool.toUpperCase()} execution failed`, 'Will retry in next check', 2));
          }
        } else {
          // Success - reset error counters
          consecutiveApiErrors = 0;
          currentBackoffSeconds = watchInterval;

          // Capture latest session data
          if (toolResult.sessionId) {
            latestSessionId = toolResult.sessionId;
            latestAnthropicCost = toolResult.anthropicTotalCostUSD;
          }

          // Attach log if enabled
          const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
          if (prNumber && shouldAttachLogs) {
            await log('');
            await log(formatAligned('📎', 'Uploading session log...', ''));
            try {
              const logFile = getLogFile();
              if (logFile) {
                const customTitle = `🔄 Auto-restart-until-mergable Log (iteration ${iteration})`;
                await attachLogToGitHub({
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
                  publicPricingEstimate: toolResult.publicPricingEstimate,
                  pricingInfo: toolResult.pricingInfo,
                });
                await log(formatAligned('', '✅ Session log uploaded to PR', '', 2));
              }
            } catch (logUploadError) {
              reportError(logUploadError, {
                context: 'attach_auto_restart_log',
                prNumber,
                owner,
                repo,
                iteration,
                operation: 'upload_session_log',
              });
              await log(formatAligned('', `⚠️  Log upload error: ${cleanErrorMessage(logUploadError)}`, '', 2));
            }
          }

          await log('');
          await log(formatAligned('✅', `${argv.tool.toUpperCase()} execution completed:`, 'Checking if PR is now mergeable...'));
        }

        // Update last check time after restart
        lastCheckTime = new Date();
      } else if (blockers.length > 0) {
        // There are blockers but none that warrant a restart (e.g., CI pending)
        await log(formatAligned('⏳', 'Waiting for:', blockers.map(b => b.message).join(', '), 2));
      } else {
        await log(formatAligned('', 'No action needed', 'Continuing to monitor...', 2));
      }

      // Update last check time
      lastCheckTime = currentTime;
    } catch (error) {
      reportError(error, {
        context: 'watch_until_mergable',
        prNumber,
        owner,
        repo,
        operation: 'check_and_restart',
      });
      await log(formatAligned('⚠️', 'Check failed:', cleanErrorMessage(error), 2));
      await log(formatAligned('', 'Will retry in:', `${watchInterval} seconds`, 2));
    }

    // Wait for next interval
    const actualWaitSeconds = consecutiveApiErrors > 0 ? currentBackoffSeconds : watchInterval;
    await log(formatAligned('⏱️', 'Next check in:', `${actualWaitSeconds} seconds...`, 2));
    await log('');
    await new Promise(resolve => setTimeout(resolve, actualWaitSeconds * 1000));
  }
};

/**
 * Attempt to auto-merge PR after session ends
 * This implements the --auto-merge functionality for one-shot merge attempts
 */
export const attemptAutoMerge = async params => {
  const { owner, repo, prNumber, argv } = params;

  await log('');
  await log(formatAligned('🔀', 'AUTO-MERGE:', 'Checking if PR can be merged...'));

  // Wait for CI to complete (with timeout)
  const ciWaitResult = await waitForCI(
    owner,
    repo,
    prNumber,
    {
      timeout: argv.autoMergeCiTimeout || 30 * 60 * 1000, // 30 minutes default
      pollInterval: argv.autoMergeCiPollInterval || 30 * 1000, // 30 seconds default
      onStatusUpdate: async status => {
        if (argv.verbose) {
          await log(`   CI status: ${status.status}`, { verbose: true });
        }
      },
    },
    argv.verbose
  );

  if (!ciWaitResult.success) {
    await log(formatAligned('⚠️', 'CI check failed or timed out:', ciWaitResult.error || ciWaitResult.status, 2));
    return { success: false, reason: ciWaitResult.status, error: ciWaitResult.error };
  }

  await log(formatAligned('✅', 'CI checks passed:', 'Checking mergeability...', 2));

  // Check if PR is mergeable
  const mergeStatus = await checkPRMergeable(owner, repo, prNumber, argv.verbose);
  if (!mergeStatus.mergeable) {
    await log(formatAligned('⚠️', 'PR not mergeable:', mergeStatus.reason || 'Unknown reason', 2));
    return { success: false, reason: 'not_mergeable', error: mergeStatus.reason };
  }

  await log(formatAligned('✅', 'PR is mergeable:', 'Attempting to merge...', 2));

  // Attempt to merge
  const mergeResult = await mergePullRequest(owner, repo, prNumber, { squash: argv.squash || false, deleteAfter: argv.deleteBranchAfterMerge || false }, argv.verbose);

  if (mergeResult.success) {
    await log(formatAligned('🎉', 'PR MERGED SUCCESSFULLY!', ''));

    // Post success comment
    try {
      const commentBody = `## 🎉 Auto-merged\n\nThis pull request has been automatically merged by hive-mind after all CI checks passed and the PR became mergeable.\n\n---\n*Auto-merged by hive-mind with --auto-merge flag*`;
      await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
    } catch {
      // Don't fail if comment posting fails
    }

    return { success: true, reason: 'merged' };
  } else {
    await log(formatAligned('⚠️', 'Merge failed:', mergeResult.error || 'Unknown error', 2));
    return { success: false, reason: 'merge_failed', error: mergeResult.error };
  }
};

/**
 * Start auto-restart-until-mergable mode
 */
export const startAutoRestartUntilMergable = async params => {
  const { argv } = params;

  // Determine the mode
  const isAutoMerge = argv.autoMerge || false;
  const isAutoRestartUntilMergable = argv.autoRestartUntilMergable || false;

  if (!isAutoMerge && !isAutoRestartUntilMergable) {
    return null; // Neither mode enabled
  }

  if (!params.prNumber) {
    await log('');
    await log(formatAligned('⚠️', 'Auto-restart-until-mergable:', 'Requires a pull request'));
    await log(formatAligned('', 'Note:', 'This mode only works with existing PRs', 2));
    return null;
  }

  // If --auto-merge implies --auto-restart-until-mergable
  if (isAutoMerge) {
    argv.autoRestartUntilMergable = true;
  }

  // Start the watch loop
  return await watchUntilMergable(params);
};

export default {
  watchUntilMergable,
  attemptAutoMerge,
  startAutoRestartUntilMergable,
  checkForNonBotComments,
};
