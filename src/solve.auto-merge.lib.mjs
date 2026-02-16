#!/usr/bin/env node

/**
 * Auto-merge and auto-restart-until-mergeable module for solve.mjs
 * Handles automatic merging of PRs and continuous restart until PR becomes mergeable
 *
 * Uses shared utilities from solve.restart-shared.lib.mjs for common functions.
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

// Import shared library functions
const lib = await import('./lib.mjs');
const { log, cleanErrorMessage, formatAligned, getLogFile } = lib;

// Note: We don't use detectAndCountFeedback from solve.feedback.lib.mjs
// because we have our own non-bot comment detection logic that's more
// appropriate for auto-restart-until-mergeable mode

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

// Import GitHub merge functions
const githubMergeLib = await import('./github-merge.lib.mjs');
const { checkPRMergeable, checkMergePermissions, mergePullRequest, waitForCI, checkForBillingLimitError, getRepoVisibility, BILLING_LIMIT_ERROR_PATTERN, getDetailedCIStatus, rerunWorkflowRun, getWorkflowRunsForSha } = githubMergeLib;

// Import GitHub functions for log attachment
const githubLib = await import('./github.lib.mjs');
const { sanitizeLogContent, attachLogToGitHub } = githubLib;

// Import shared utilities from the restart-shared module
const restartShared = await import('./solve.restart-shared.lib.mjs');
const { checkPRMerged, checkPRClosed, checkForUncommittedChanges, getUncommittedChangesDetails, executeToolIteration, buildAutoRestartInstructions, isApiError } = restartShared;

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
 * Get the reasons why PR is not mergeable
 * Issue #1314: Comprehensive CI/CD status handling covering all possible states:
 * - success: All CI passed → no blocker
 * - failure: Genuine code failures → restart AI
 * - cancelled: Manually cancelled or workflow cancelled → re-trigger, don't restart AI
 * - pending/queued: Still running or waiting for runner → wait, don't restart AI
 * - billing_limit: Billing/spending limit reached → stop (private) or wait (public)
 * - no_checks: No CI checks yet (race condition) → wait
 */
const getMergeBlockers = async (owner, repo, prNumber, verbose = false) => {
  const blockers = [];

  // Use detailed CI status to distinguish between all possible states
  const ciStatus = await getDetailedCIStatus(owner, repo, prNumber, verbose);

  if (ciStatus.status === 'no_checks') {
    // No CI checks exist yet - race condition after push, treat as pending
    blockers.push({
      type: 'ci_pending',
      message: 'CI/CD checks have not started yet (waiting for checks to appear)',
      details: [],
    });
  } else if (ciStatus.status === 'pending') {
    // CI is still running or queued - wait for completion
    const pendingNames = [...ciStatus.pendingChecks, ...ciStatus.queuedChecks].map(c => c.name);
    blockers.push({
      type: 'ci_pending',
      message: 'CI/CD checks are still running or queued',
      details: pendingNames,
    });
  } else if (ciStatus.status === 'cancelled') {
    // All non-passed checks are cancelled or stale (no genuine failures)
    // First check if this is actually a billing limit issue (billing-limited jobs may appear as cancelled)
    const billingCheck = await checkForBillingLimitError(owner, repo, prNumber, verbose);
    if (billingCheck.isBillingLimitError) {
      blockers.push({
        type: 'billing_limit',
        message: 'GitHub Actions billing/spending limit reached',
        details: billingCheck.affectedJobs,
        allJobsAffected: billingCheck.allJobsAffected,
        billingMessage: billingCheck.message,
      });
    } else {
      // These need to be re-triggered, NOT treated as AI-fixable failures
      const cancelledOrStaleChecks = [...ciStatus.cancelledChecks, ...(ciStatus.staleChecks || [])];
      blockers.push({
        type: 'ci_cancelled',
        message: 'CI/CD checks were cancelled or became stale',
        details: cancelledOrStaleChecks.map(c => c.name),
        sha: ciStatus.sha,
      });
    }
  } else if (ciStatus.status === 'failure') {
    // Some checks genuinely failed - check if it's billing limits first
    const billingCheck = await checkForBillingLimitError(owner, repo, prNumber, verbose);

    if (billingCheck.isBillingLimitError) {
      blockers.push({
        type: 'billing_limit',
        message: 'GitHub Actions billing/spending limit reached',
        details: billingCheck.affectedJobs,
        allJobsAffected: billingCheck.allJobsAffected,
        billingMessage: billingCheck.message,
      });
    } else {
      // Check if there are also cancelled/stale checks alongside failures
      const cancelledOrStaleChecks = [...(ciStatus.hasCancelled ? ciStatus.cancelledChecks : []), ...((ciStatus.hasStale && ciStatus.staleChecks) || [])];
      if (cancelledOrStaleChecks.length > 0) {
        blockers.push({
          type: 'ci_cancelled',
          message: 'Some CI/CD checks were cancelled or became stale (will be re-triggered)',
          details: cancelledOrStaleChecks.map(c => c.name),
          sha: ciStatus.sha,
        });
      }
      blockers.push({
        type: 'ci_failure',
        message: 'CI/CD checks are failing',
        details: ciStatus.failedChecks.map(c => c.name),
      });
    }
  } else if (ciStatus.status === 'unknown') {
    // Unable to determine CI status - treat as pending to be safe
    // Do NOT treat as mergeable (which would be incorrect)
    blockers.push({
      type: 'ci_pending',
      message: 'CI/CD status could not be determined (will retry)',
      details: [],
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
 * This implements --auto-restart-until-mergeable functionality
 */
export const watchUntilMergeable = async params => {
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
  await log(formatAligned('🔄', 'AUTO-RESTART-UNTIL-MERGEABLE MODE ACTIVE', ''));
  await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
  await log(formatAligned('', 'Mode:', isAutoMerge ? 'Auto-merge (will merge when ready)' : 'Auto-restart-until-mergeable (will NOT auto-merge)', 2));
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
      await log(formatAligned('🎉', 'PR MERGED!', 'Stopping auto-restart-until-mergeable mode'));
      await log(formatAligned('', 'Pull request:', `#${prNumber} has been merged`, 2));
      await log('');
      return { success: true, reason: 'merged', latestSessionId, latestAnthropicCost };
    }

    // Check if PR is closed (not merged)
    const isClosed = await checkPRClosed(owner, repo, prNumber);
    if (isClosed) {
      await log('');
      await log(formatAligned('🚫', 'PR CLOSED!', 'Stopping auto-restart-until-mergeable mode'));
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

      // Check for uncommitted changes using shared utility
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
          await log(formatAligned('', 'Exiting auto-restart-until-mergeable mode', '', 2));

          // Post success comment
          try {
            const commentBody = `## ✅ Ready to merge\n\nThis pull request is now ready to be merged:\n- All CI checks have passed\n- No merge conflicts\n- No pending changes\n\n---\n*Monitored by hive-mind with --auto-restart-until-mergeable flag*`;
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

      // Issue #1314: Check for billing limit errors BEFORE regular CI failures
      // Billing limits require human intervention and should NOT trigger AI restarts
      const billingBlocker = blockers.find(b => b.type === 'billing_limit');
      if (billingBlocker) {
        await log('');
        await log(formatAligned('💳', 'GITHUB ACTIONS BILLING LIMIT DETECTED', ''));
        await log(formatAligned('', 'Affected jobs:', billingBlocker.details.join(', '), 2));
        await log(formatAligned('', 'All jobs affected:', billingBlocker.allJobsAffected ? 'Yes' : 'No', 2));
        await log('');

        // Check if this is a private repository
        const repoInfo = await getRepoVisibility(owner, repo, argv.verbose);

        if (repoInfo.isPrivate) {
          // For private repos, human intervention is required - stop and post comment
          await log(formatAligned('🛑', 'STOPPING', 'Private repository - billing limit requires human intervention'));
          await log(formatAligned('', 'Action required:', "Check the 'Billing & plans' section in your GitHub settings", 2));

          // Post comment explaining the billing limit issue
          try {
            const commentBody = `## 💳 GitHub Actions Billing Limit Reached

The CI/CD jobs could not start due to billing/spending limits.

**Affected jobs:**
${billingBlocker.details.map(j => `- ${j}`).join('\n')}

**Error message:**
> ${billingBlocker.billingMessage || BILLING_LIMIT_ERROR_PATTERN}

**Action Required:**
Please check the 'Billing & plans' section in your GitHub settings and either:
1. Add or update your payment method
2. Increase your spending limit
3. Wait for the free tier limits to reset (if applicable)

Once the billing issue is resolved, you can re-run the CI checks or push a new commit to trigger a new run.

---
*Detected by hive-mind with --auto-restart-until-mergeable flag. This is NOT a code issue - human intervention is required.*`;
            await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
            await log(formatAligned('', '💬 Posted billing limit notification to PR', '', 2));
          } catch (commentError) {
            reportError(commentError, {
              context: 'post_billing_limit_comment',
              owner,
              repo,
              prNumber,
              operation: 'comment_on_pr',
            });
            await log(formatAligned('', '⚠️  Could not post comment to PR', '', 2));
          }

          return { success: false, reason: 'billing_limit', latestSessionId, latestAnthropicCost };
        } else {
          // For public repos (unusual case), apply exponential backoff and wait
          // Public repos typically have unlimited free CI, so this is unexpected
          await log(formatAligned('⏳', 'Public repository with billing limit (unusual)', 'Applying exponential backoff'));
          await log(formatAligned('', 'Next check in:', `${currentBackoffSeconds} seconds`, 2));

          // Don't trigger AI restart - just wait and check again
          // The backoff will be applied at the end of the loop
          currentBackoffSeconds = Math.min(currentBackoffSeconds * 2, 3600); // Max 1 hour
        }
      }

      // Issue #1314: Handle cancelled CI/CD checks - re-trigger them instead of restarting AI
      // Cancelled checks (e.g., manually cancelled, cancelled by another workflow) should be
      // re-triggered automatically. We should NOT restart the AI for these.
      const cancelledBlocker = blockers.find(b => b.type === 'ci_cancelled');
      if (cancelledBlocker && !billingBlocker) {
        await log('');
        await log(formatAligned('🔄', 'CANCELLED CI/CD CHECKS DETECTED', ''));
        await log(formatAligned('', 'Cancelled checks:', cancelledBlocker.details.join(', '), 2));

        // Attempt to re-trigger the cancelled/stale workflow runs
        const sha = cancelledBlocker.sha;
        if (sha) {
          const runs = await getWorkflowRunsForSha(owner, repo, sha, argv.verbose);
          const retriggerable = runs.filter(r => r.conclusion === 'cancelled' || r.conclusion === 'stale');
          let rerunTriggered = false;

          for (const run of retriggerable) {
            await log(formatAligned('', `Re-triggering workflow "${run.name}" (${run.id})...`, '', 2));
            const rerunResult = await rerunWorkflowRun(owner, repo, run.id, argv.verbose);
            if (rerunResult.success) {
              await log(formatAligned('', `✅ Re-triggered: ${run.name}`, '', 2));
              rerunTriggered = true;
            } else {
              await log(formatAligned('', `⚠️  Could not re-trigger ${run.name}: ${rerunResult.error}`, '', 2));
            }
          }

          if (rerunTriggered) {
            await log(formatAligned('⏳', 'Waiting for re-triggered CI to complete...', '', 2));
            // Don't restart AI - just wait for re-triggered jobs to complete
            // The next iteration of the loop will check the new status
          }
        }
        // Don't set shouldRestart for cancelled checks - wait for re-triggered jobs instead
      }

      // Reason 2: CI failures (only if NOT a billing limit issue and NOT just cancelled)
      // Only restart AI when we have genuine code failures (real feedback to act on)
      const ciBlocker = blockers.find(b => b.type === 'ci_failure');
      if (ciBlocker && !billingBlocker) {
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

        // Get uncommitted changes for display using shared utility
        const changes = await getUncommittedChangesDetails(tempDir);
        feedbackLines.push('📝 Uncommitted changes detected:');
        for (const line of changes) {
          feedbackLines.push(`  ${line}`);
        }
        feedbackLines.push('');
        feedbackLines.push('IMPORTANT: You MUST handle these uncommitted changes by either:');
        feedbackLines.push('1. COMMITTING them if they are part of the solution (git add + git commit + git push)');
        feedbackLines.push('2. REVERTING them if they are not needed (git checkout -- <file> or git clean -fd)');
      }

      if (shouldRestart) {
        // Add standard instructions for auto-restart-until-mergeable mode using shared utility
        feedbackLines.push(...buildAutoRestartInstructions());

        await log(formatAligned('🔄', 'RESTART TRIGGERED:', restartReason));
        await log('');

        // Post a comment to PR about the restart
        try {
          const commentBody = `## 🔄 Auto-restart triggered\n\n**Reason:** ${restartReason}\n\nStarting new session to address the issues.\n\n---\n*Auto-restart-until-mergeable mode is active. Will continue until PR becomes mergeable.*`;
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

        // Execute the AI tool using shared utility
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
          // Check if this is an API error using shared utility
          if (isApiError(toolResult)) {
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
                const customTitle = `🔄 Auto-restart-until-mergeable Log (iteration ${iteration})`;
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
        // There are blockers but none that warrant an AI restart
        // Issue #1314: Distinguish between different waiting reasons
        const pendingBlocker = blockers.find(b => b.type === 'ci_pending');
        const cancelledOnly = blockers.every(b => b.type === 'ci_cancelled' || b.type === 'ci_pending');

        if (cancelledOnly && cancelledBlocker) {
          await log(formatAligned('🔄', 'Waiting for re-triggered CI:', cancelledBlocker.details.join(', '), 2));
        } else if (pendingBlocker) {
          await log(formatAligned('⏳', 'Waiting for CI:', pendingBlocker.details.length > 0 ? pendingBlocker.details.join(', ') : pendingBlocker.message, 2));
        } else {
          await log(formatAligned('⏳', 'Waiting for:', blockers.map(b => b.message).join(', '), 2));
        }
      } else {
        await log(formatAligned('', 'No action needed', 'Continuing to monitor...', 2));
      }

      // Update last check time
      lastCheckTime = currentTime;
    } catch (error) {
      reportError(error, {
        context: 'watch_until_mergeable',
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

  // Issue #1226: Check merge permissions before attempting
  const { canMerge, permission } = await checkMergePermissions(owner, repo, argv.verbose);
  if (!canMerge) {
    await log(formatAligned('⚠️', 'Cannot merge:', `Insufficient permissions (${permission || 'unknown'})`, 2));
    return { success: false, reason: 'insufficient_permissions', error: `User has ${permission || 'unknown'} access, needs push/maintain/admin` };
  }

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
 * Start auto-restart-until-mergeable mode
 */
export const startAutoRestartUntilMergeable = async params => {
  const { argv, owner, repo, prNumber } = params;

  // Determine the mode
  const isAutoMerge = argv.autoMerge || false;
  const isAutoRestartUntilMergeable = argv.autoRestartUntilMergeable || false;

  if (!isAutoMerge && !isAutoRestartUntilMergeable) {
    return null; // Neither mode enabled
  }

  if (!prNumber) {
    await log('');
    await log(formatAligned('⚠️', 'Auto-restart-until-mergeable:', 'Requires a pull request'));
    await log(formatAligned('', 'Note:', 'This mode only works with existing PRs', 2));
    return null;
  }

  // Issue #1226: Check if running in fork mode — auto-merge cannot work without write access
  if (argv.fork && isAutoMerge) {
    await log('');
    await log(formatAligned('⚠️', 'Auto-merge:', 'Cannot auto-merge fork PRs'));
    await log(formatAligned('', 'Reason:', 'Fork contributors do not have write access to merge PRs to upstream repositories', 2));
    await log(formatAligned('', 'Action:', 'PR is ready for manual merge by a repository maintainer', 2));
    await log('');

    // Post a comment to the PR notifying the maintainer
    try {
      const commentBody = `## ✅ Ready to merge\n\nThis pull request is ready to be merged. Auto-merge was requested (\`--auto-merge\`) but cannot be performed because this PR was created from a fork (no write access to the target repository).\n\nPlease merge manually.\n\n---\n*hive-mind with --auto-merge flag (fork mode)*`;
      await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
      await log(formatAligned('', '💬 Posted merge readiness notification to PR', '', 2));
    } catch {
      // Don't fail if comment posting fails
    }

    return { success: false, reason: 'fork_no_write_access' };
  }

  // Issue #1226: Verify merge permissions before entering the auto-merge/restart loop
  if (isAutoMerge && owner && repo) {
    const { canMerge, permission } = await checkMergePermissions(owner, repo, argv.verbose);
    if (!canMerge) {
      await log('');
      await log(formatAligned('⚠️', 'Auto-merge:', 'Insufficient permissions to merge'));
      await log(formatAligned('', 'Permission level:', permission || 'unknown', 2));
      await log(formatAligned('', 'Required:', 'push, maintain, or admin access', 2));
      await log(formatAligned('', 'Action:', 'PR is ready for manual merge by a repository maintainer', 2));
      await log('');

      // Post a comment to the PR notifying the maintainer
      try {
        const commentBody = `## ✅ Ready to merge\n\nThis pull request is ready to be merged. Auto-merge was requested (\`--auto-merge\`) but cannot be performed because the authenticated user lacks write access to \`${owner}/${repo}\` (current permission: \`${permission || 'unknown'}\`).\n\nPlease merge manually.\n\n---\n*hive-mind with --auto-merge flag*`;
        await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
        await log(formatAligned('', '💬 Posted merge readiness notification to PR', '', 2));
      } catch {
        // Don't fail if comment posting fails
      }

      return { success: false, reason: 'insufficient_permissions' };
    }
  }

  // If --auto-merge implies --auto-restart-until-mergeable
  if (isAutoMerge) {
    argv.autoRestartUntilMergeable = true;
  }

  // Start the watch loop
  return await watchUntilMergeable(params);
};

export default {
  watchUntilMergeable,
  attemptAutoMerge,
  startAutoRestartUntilMergeable,
  checkForNonBotComments,
};
