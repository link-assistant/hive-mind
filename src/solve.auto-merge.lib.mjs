#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

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
  await ensureUseM();
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $: __rawDollar$ } = await use('command-stream');
const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const $ = wrapDollarWithGhRetry(__rawDollar$);
// Import shared library functions
const lib = await import('./lib.mjs');
const { log, cleanErrorMessage, formatAligned, formatToolExecutionFailure, extractToolErrorCore, getLogFile } = lib;

// Note: We don't use detectAndCountFeedback from solve.feedback.lib.mjs
// because we have our own non-bot comment detection logic that's more
// appropriate for auto-restart-until-mergeable mode

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

// Import GitHub merge functions
const githubMergeLib = await import('./github-merge.lib.mjs');
const { checkPRMergeable, checkMergePermissions, mergePullRequest, waitForCI, getRepoVisibility, BILLING_LIMIT_ERROR_PATTERN, getDetailedCIStatus, rerunWorkflowRun, getWorkflowRunsForSha, getAllActiveRepoRuns, checkCIConsensus } = githubMergeLib;

// Import GitHub functions for log attachment
const githubLib = await import('./github.lib.mjs');
const { sanitizeLogContent, attachLogToGitHub } = githubLib;

// Import shared utilities from the restart-shared module
const restartShared = await import('./solve.restart-shared.lib.mjs');
const { checkForUncommittedChanges, getUncommittedChangesDetails, executeToolIteration, buildAutoRestartInstructions, isUsageLimitReached } = restartShared;

// Issue #1931: deleted/inaccessible repositories, PRs, issues, and branches
// are terminal states for long-running watch loops, not retryable CI states.
const terminalStateLib = await import('./github-terminal-state.lib.mjs');
const { checkGitHubTerminalState } = terminalStateLib;

// Import validation functions for time parsing (used for usage limit wait)
const validation = await import('./solve.validation.lib.mjs');
const { calculateWaitTime } = validation;

// Import configuration (used for limit reset buffer and jitter)
import { limitReset } from './config.lib.mjs';

// Import helper functions extracted for file size management (Issue #1593)
const autoMergeHelpers = await import('./solve.auto-merge-helpers.lib.mjs');
const { checkForExistingComment, checkForNonBotComments, getMergeBlockers, shouldResetNoRunsCounter, trackAuthenticatedUserCommentsSince, nextMonotonicCheckTime } = autoMergeHelpers;

// Issue #1769: cancelled/stale CI re-run failures need a human action stop, not polling forever.
const cancelledCiRerunLib = await import('./cancelled-ci-rerun.lib.mjs');
const { buildCancelledCIReviewComment, getRetriggerableWorkflowRuns, shouldStopForCancelledCIReview } = cancelledCiRerunLib;

// Issue #1625: Shared marker constants + posting/tracking helpers
const toolComments = await import('./tool-comments.lib.mjs');
const { READY_TO_MERGE_MARKER, READY_FOR_REVIEW_MARKER, AUTO_RESTART_MARKER, AUTO_MERGED_MARKER, postTrackedComment } = toolComments;

const externalReviewLimitLib = await import('./external-review-limit.lib.mjs');
const { buildReadyForReviewComment } = externalReviewLimitLib;

// Issue #1728: Per-iteration working session summary attachment helper
// Issue #1763: Per-iteration PR ↔ issue link verification (so a clobbered
// PR body is restored before the next stop condition fires).
const resultsLib = await import('./solve.results.lib.mjs');
const { maybeAttachWorkingSessionSummary, ensurePullRequestIssueLink } = resultsLib;

// Issue #1574: Interruptible sleep so CTRL+C is never blocked by a lingering timer
const { interruptibleSleep } = await import('./interruptible-sleep.lib.mjs');
const { formatAutoIterationLimit, hasReachedAutoIterationLimit, normalizeAutoIterationLimit, shouldSyncBeforeRestart } = await import('./auto-iteration-limits.lib.mjs');
const { ensurePullRequestBaseBranch } = await import('./solve.pr-base-guard.lib.mjs');

// Issue #1895: explicitly close linked issues after merging a PR into a
// non-default branch, where GitHub does not auto-close them.
const { ensureLinkedIssueClosedAfterMerge } = await import('./github-issue-auto-close.lib.mjs');

const shouldDeleteBranchAfterMerge = argv => argv.autoDeleteBranchOnMerge || argv.deleteBranchAfterMerge || false;

/**
 * Main function: Watch and restart until PR becomes mergeable
 * This implements --auto-restart-until-mergeable functionality
 */
export const watchUntilMergeable = async params => {
  const { issueUrl, owner, repo, issueNumber, prNumber, prBranch, branchName, tempDir, argv } = params;

  const rawWatchInterval = argv.watchInterval || 60; // seconds
  // Issue #1567: Minimum 120s interval to conserve API rate limits while keeping responsiveness
  const MIN_CI_CHECK_INTERVAL_SECONDS = 120;
  const watchInterval = Math.max(rawWatchInterval, MIN_CI_CHECK_INTERVAL_SECONDS);
  const isAutoMerge = argv.autoMerge || false;
  const maxAutoRestartIterations = normalizeAutoIterationLimit(argv.autoRestartMaxIterations);
  const maxAutoResumeIterations = normalizeAutoIterationLimit(argv.autoResumeMaxIterations);
  // Issue #1503/#1573/#1612: repo-wide action gating is opt-in strict mode.
  // The config default may be bypassed when this module is reused directly, so normalize here.
  const waitForAllRepoActionsFlag = argv.waitForAllActionsInRepositoryBeforeMergeable ?? argv['wait-for-all-actions-in-repository-before-mergeable'] ?? argv.waitForAllActionsInRepositoryBeforeMergable ?? argv['wait-for-all-actions-in-repository-before-mergable'] ?? false;

  // Track latest session data across all iterations for accurate pricing
  let latestSessionId = null;
  let latestAnthropicCost = null;

  // Issue #1323: Track actual AI restarts separately from check cycle iterations
  let restartCount = 0;
  let limitResumeCount = 0;

  // Issue #1371: In-memory dedup for "Ready to merge" comment (per-session, not all-time)
  let readyToMergeCommentPosted = false;

  let currentBackoffSeconds = watchInterval;

  // Issue #1503: Track consecutive "no workflow runs" checks per-SHA (reset on new push)
  let consecutiveNoRunsChecks = 0;
  let lastKnownHeadSha = null;

  // Issue #1567: Initial cooldown to let CI register and solution logs post
  const INITIAL_COOLDOWN_SECONDS = MIN_CI_CHECK_INTERVAL_SECONDS;

  await log('');
  await log(formatAligned('🔄', 'AUTO-RESTART-UNTIL-MERGEABLE MODE ACTIVE', ''));
  await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
  await log(formatAligned('', 'Mode:', isAutoMerge ? 'Auto-merge (will merge when ready)' : 'Auto-restart-until-mergeable (will NOT auto-merge)', 2));
  await log(formatAligned('', 'Checking interval:', `${watchInterval} seconds (minimum: ${MIN_CI_CHECK_INTERVAL_SECONDS}s)`, 2));
  await log(formatAligned('', 'Initial cooldown:', `${INITIAL_COOLDOWN_SECONDS} seconds`, 2));
  await log(formatAligned('', 'Max restart iterations:', formatAutoIterationLimit(maxAutoRestartIterations), 2));
  await log(formatAligned('', 'Max limit resumes:', formatAutoIterationLimit(maxAutoResumeIterations), 2));
  await log(formatAligned('', 'Wait for all repo actions:', waitForAllRepoActionsFlag ? 'Yes (strict repo-wide safety)' : 'No (PR-scoped CI only)', 2));
  await log(formatAligned('', 'Stop conditions:', 'PR merged, PR closed, or becomes mergeable', 2));
  await log(formatAligned('', 'Restart triggers:', 'New non-bot comments, CI failures, merge conflicts', 2));
  // Issue #1708: Surface that --auto-input-until-mergeable streamed feedback
  // into the prior session, so any restart triggered here is a fallback.
  if (argv.autoInputUntilMergeable) {
    await log(formatAligned('', 'Streaming-first:', '--auto-input-until-mergeable was active; this loop is the fallback', 2));
  }
  await log('');
  await log('Press Ctrl+C to stop watching manually');
  await log('');

  // Issue #1567: Wait for initial cooldown before first check.
  // This gives CI/CD time to start and solution logs time to be posted.
  await log(formatAligned('⏳', 'Initial cooldown:', `Waiting ${INITIAL_COOLDOWN_SECONDS}s before first check...`));
  await interruptibleSleep(INITIAL_COOLDOWN_SECONDS * 1000);
  await log(formatAligned('✅', 'Cooldown complete:', 'Starting monitoring loop'));
  await log('');

  let iteration = 0;
  let lastCheckTime = new Date();

  while (true) {
    iteration++;
    const currentTime = new Date();

    const terminalState = await checkGitHubTerminalState({
      owner,
      repo,
      issueNumber,
      prNumber,
      sourceBranchName: prBranch || branchName,
      commandRunner: $,
    });
    if (terminalState.terminal && terminalState.success) {
      await log('');
      await log(formatAligned('🎉', 'PR MERGED!', 'Stopping auto-restart-until-mergeable mode'));
      await log(formatAligned('', 'Pull request:', `#${prNumber} has been merged`, 2));
      await log('');
      return { success: true, reason: 'merged', latestSessionId, latestAnthropicCost };
    }
    if (terminalState.terminal) {
      await log('');
      await log(formatAligned('❌', 'GITHUB TARGET UNAVAILABLE:', terminalState.message, 2), { level: 'error' });
      for (const detail of terminalState.details || []) {
        await log(formatAligned('', 'Detail:', detail, 4), { level: 'error' });
      }
      await log(formatAligned('', 'Action:', 'Stopping auto-restart-until-mergeable mode', 2), { level: 'error' });
      await log('');
      return { success: false, reason: terminalState.reason, latestSessionId, latestAnthropicCost };
    }

    await log(formatAligned('🔍', `Check #${iteration}:`, currentTime.toLocaleTimeString()));

    try {
      // Issue #1503: Get current HEAD SHA to detect new pushes and reset no-runs counter
      let currentHeadSha = null;
      try {
        const shaResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRefOid --jq .headRefOid`;
        if (shaResult.code === 0) {
          currentHeadSha = shaResult.stdout.toString().trim();
        }
      } catch {
        // If SHA check fails, proceed with current counter (safe: doesn't reset)
      }
      if (currentHeadSha && currentHeadSha !== lastKnownHeadSha) {
        if (lastKnownHeadSha !== null) {
          await log(formatAligned('🔄', 'New commit detected:', `${lastKnownHeadSha.substring(0, 7)} → ${currentHeadSha.substring(0, 7)} (resetting CI check counter)`, 2));
        }
        lastKnownHeadSha = currentHeadSha;
        consecutiveNoRunsChecks = 0;
        // Issue #1503: Also reset the readyToMergeCommentPosted flag when SHA changes,
        // so a new "Ready to merge" comment can be posted for the new commit's CI results.
        readyToMergeCommentPosted = false;
      }

      // Issue #1503: Increment counter; getMergeBlockers uses it as a safety valve
      consecutiveNoRunsChecks++;

      // Get merge blockers
      const { blockers, noCiConfigured, noCiTriggered, workflowRunConclusions, ciStatus, noWorkflowRunsForCommit } = await getMergeBlockers(owner, repo, prNumber, argv.verbose, consecutiveNoRunsChecks, prBranch);

      const terminalGitHubBlocker = blockers.find(b => b.type === 'terminal_github_entity_error');
      if (terminalGitHubBlocker) {
        await log('');
        await log(formatAligned('❌', 'GITHUB TARGET UNAVAILABLE:', terminalGitHubBlocker.message, 2), { level: 'error' });
        for (const detail of terminalGitHubBlocker.details || []) {
          await log(formatAligned('', 'Detail:', detail, 4), { level: 'error' });
        }
        await log(formatAligned('', 'Action:', 'Stopping auto-restart-until-mergeable mode', 2), { level: 'error' });
        await log('');
        return { success: false, reason: 'terminal_github_entity_error', latestSessionId, latestAnthropicCost };
      }

      // Issue #1503/#1918: Reset counter when CI checks exist (safety valve only for
      // consecutive "no runs"). Issue #1918: do NOT reset while getMergeBlockers is still
      // waiting for PR-triggered workflow runs to register (noWorkflowRunsForCommit). A
      // 'success' status from external-only checks (e.g. CodeRabbit) on a fork PR whose
      // workflow only triggers on `push` previously reset the counter every iteration,
      // pinning it at "check 1/5" forever and hanging /merge for over an hour.
      if (shouldResetNoRunsCounter(ciStatus, noWorkflowRunsForCommit)) {
        // CI checks exist (pending, success, failure, etc.) — the "no runs" counter is irrelevant
        consecutiveNoRunsChecks = 0;
      } else if (noCiConfigured || noCiTriggered) {
        // CI was definitively determined: either not configured or not triggered.
        // Keep the counter as-is (it reached the safety valve or wasn't needed).
      }

      // Check for new comments from non-bot users. At this point the AI tool
      // is not executing, so same-account non-tool comments can be trusted as
      // human feedback while known tool comments remain filtered by markers/IDs.
      const { hasNewComments, comments } = await checkForNonBotComments(owner, repo, prNumber, issueNumber, lastCheckTime, argv.verbose, $, {
        trustAuthenticatedUserComments: true,
      });

      // Check for uncommitted changes using shared utility
      const hasUncommittedChanges = await checkForUncommittedChanges(tempDir, argv);

      // Issue #1442/#1466: If CI workflows exist but were not triggered for this commit,
      // log why before proceeding to the mergeable path.
      if (noCiTriggered) {
        if (workflowRunConclusions) {
          // Issue #1466: Workflow runs exist but completed without executing (action_required, cancelled, etc.)
          await log(formatAligned('ℹ️', 'CI not executed:', `Workflow runs completed with: ${workflowRunConclusions} (likely needs maintainer approval)`, 2));
        } else {
          await log(formatAligned('ℹ️', 'CI not triggered:', 'Workflows exist but no workflow runs for this commit (fork PR, paths-ignore, workflow conditions)', 2));
        }
      }

      // If PR is mergeable, no blockers, no new comments, and no uncommitted changes
      if (blockers.length === 0 && !hasNewComments && !hasUncommittedChanges) {
        // Issue #1503 (enhanced): Multi-mechanism consensus + repo-wide action check.
        // Before declaring PR mergeable, run multiple independent CI detection mechanisms
        // and require all to agree. This catches race conditions where CI starts between
        // checks or where interacting CI/CD pipelines affect mergeability.
        if (!noCiConfigured) {
          const DOUBLE_CHECK_DELAY_MS = 10000; // 10 seconds
          await log(formatAligned('🔍', 'Multi-mechanism CI consensus check:', `Waiting ${DOUBLE_CHECK_DELAY_MS / 1000}s then verifying...`, 2));
          await interruptibleSleep(DOUBLE_CHECK_DELAY_MS);

          // Run multi-mechanism consensus: Check Runs API + Workflow Runs API + Repo-wide actions
          const consensus = await checkCIConsensus({
            owner,
            repo,
            prNumber,
            sha: currentHeadSha || ciStatus?.sha,
            waitForAllRepoActionsFlag,
            verbose: argv.verbose,
            getDetailedCIStatus,
            getWorkflowRunsForSha,
          });

          if (!consensus.allAgree) {
            const m = consensus.mechanisms;
            const repoLabel = m.repoActions.skipped ? 'skipped' : `${m.repoActions.count} active`;
            const commitsLabel = m.allCommitsCI.skipped ? 'skipped' : `${m.allCommitsCI.pendingCommits.length} pending of ${m.allCommitsCI.totalCommits}`;
            await log(formatAligned('🔄', 'CI mechanisms DISAGREE:', `CheckRuns=${m.checkRunsAPI.status}, WorkflowRuns=${m.workflowRunsAPI.inProgress} in-progress, AllCommits=${commitsLabel}, RepoActions=${repoLabel}`, 2));
            await log(formatAligned('⏳', 'Continuing to monitor...', 'Mechanisms must agree before declaring mergeable', 2));
            consecutiveNoRunsChecks = 0;
            lastCheckTime = currentTime;
            const actualWaitSeconds = currentBackoffSeconds;
            await log(formatAligned('⏱️', 'Next check in:', `${actualWaitSeconds} seconds...`, 2));
            await log('');
            await interruptibleSleep(actualWaitSeconds * 1000);
            continue;
          }
          const acLabel = consensus.mechanisms.allCommitsCI.skipped ? '' : `, AllCommits=complete(${consensus.mechanisms.allCommitsCI.totalCommits})`;
          await log(formatAligned('✅', 'All CI mechanisms agree:', `CheckRuns=${consensus.mechanisms.checkRunsAPI.status}, WorkflowRuns=complete(${consensus.mechanisms.workflowRunsAPI.total})${acLabel}, RepoActions=${consensus.mechanisms.repoActions.skipped ? 'skipped' : 'clear'}`, 2));
        } else if (waitForAllRepoActionsFlag) {
          // Even with no CI configured, check repo-wide actions for absolute safety
          const repoRuns = await getAllActiveRepoRuns(owner, repo, argv.verbose);
          if (repoRuns.hasActiveRuns) {
            await log(formatAligned('⏳', 'Waiting for repo-wide actions:', `${repoRuns.count} active run(s) in repository`, 2));
            lastCheckTime = currentTime;
            const actualWaitSeconds = currentBackoffSeconds;
            await log(formatAligned('⏱️', 'Next check in:', `${actualWaitSeconds} seconds...`, 2));
            await log('');
            await interruptibleSleep(actualWaitSeconds * 1000);
            continue;
          }
        }

        await log(formatAligned('✅', 'PR IS MERGEABLE!', ''));

        if (isAutoMerge) {
          // Attempt to merge the PR
          await log(formatAligned('🔀', 'Auto-merging PR...', ''));
          const deleteAfterMerge = shouldDeleteBranchAfterMerge(argv);
          if (deleteAfterMerge) {
            await log(formatAligned('', 'Branch cleanup:', 'will delete branch after successful merge', 2));
          }
          const mergeResult = await mergePullRequest(owner, repo, prNumber, { squash: argv.squash || false, deleteAfter: deleteAfterMerge }, argv.verbose);

          if (mergeResult.success) {
            await log(formatAligned('🎉', 'PR MERGED SUCCESSFULLY!', ''));
            await log(formatAligned('', 'Pull request:', `#${prNumber} has been auto-merged`, 2));

            // Post success comment
            try {
              // Issue #1345: Differentiate message when no CI is configured
              const ciLine = noCiConfigured ? '- No CI/CD checks are configured for this repository' : noCiTriggered ? (workflowRunConclusions ? `- CI workflows completed without executing (${workflowRunConclusions})` : '- CI workflows exist but were not triggered for this commit') : '- All CI checks have passed';
              const commentBody = `## 🎉 ${AUTO_MERGED_MARKER}\n\nThis pull request has been automatically merged by hive-mind.\n${ciLine}\n\n---\n*Auto-merged by hive-mind with --auto-merge flag*`;
              await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: commentBody });
            } catch {
              // Don't fail if comment posting fails
            }

            // Issue #1895: when the PR targeted a non-default branch GitHub does
            // not auto-close the linked issue. Close it explicitly so the issue
            // is not left open after its PR merges.
            if (issueNumber) {
              try {
                const closeResult = await ensureLinkedIssueClosedAfterMerge({ $, log, owner, repo, prNumber, issueNumber, verbose: argv.verbose });
                if (closeResult.skipped && argv.verbose) {
                  await log(formatAligned('', 'Issue auto-close:', `skipped (${closeResult.reason})`, 2), { verbose: true });
                } else if (!closeResult.closed && !closeResult.skipped) {
                  await log(formatAligned('⚠️', 'Issue auto-close:', `could not close issue #${issueNumber} (${closeResult.reason})`, 2), { level: 'warning' });
                }
              } catch (closeError) {
                await log(formatAligned('⚠️', 'Issue auto-close:', `error closing issue #${issueNumber}: ${closeError.message}`, 2), { level: 'warning' });
              }
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

          // Issue #1371: Post success comment only if not already posted in this session.
          // Issue #1567: Also check PR comment history as a cross-process guard.
          // Two layers of deduplication:
          //   1. In-memory flag (readyToMergeCommentPosted) — prevents duplicates within this process
          //   2. checkForExistingComment — prevents duplicates from concurrent processes
          // The in-memory flag is reset when HEAD SHA changes (line 614), so a new commit
          // will allow a fresh "Ready to merge" comment.
          try {
            if (!readyToMergeCommentPosted) {
              // Issue #1567: Cross-process deduplication — check if another process already
              // posted a "Ready to merge" comment. This catches the case where two concurrent
              // watchUntilMergeable processes both detect mergeability simultaneously.
              const hasExistingReadyComment = await checkForExistingComment(owner, repo, prNumber, `## ✅ ${READY_TO_MERGE_MARKER}`, argv.verbose);
              if (hasExistingReadyComment) {
                await log(formatAligned('', `Skipping duplicate "${READY_TO_MERGE_MARKER}" comment (already posted by another process)`, '', 2));
                readyToMergeCommentPosted = true;
              } else {
                // Issue #1345: Differentiate message when no CI is configured
                const ciLine = noCiConfigured ? '- No CI/CD checks are configured for this repository' : noCiTriggered ? (workflowRunConclusions ? `- CI workflows completed without executing (${workflowRunConclusions})` : '- CI workflows exist but were not triggered for this commit') : '- All CI checks have passed';
                const commentBody = `## ✅ ${READY_TO_MERGE_MARKER}\n\nThis pull request is now ready to be merged:\n${ciLine}\n- No merge conflicts\n- No pending changes\n\n---\n*Monitored by hive-mind with --auto-restart-until-mergeable flag*`;
                // Issue #1625: Track this comment ID so it can't falsely count as an AI-authored comment
                await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: commentBody });
                readyToMergeCommentPosted = true;
              }
            } else {
              await log(formatAligned('', `Skipping duplicate "${READY_TO_MERGE_MARKER}" comment (already posted this session)`, '', 2));
            }
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
            await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: commentBody });
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
      // Issue #1952: When a genuine CI failure coexists with cancelled checks, the result is a
      // failure ("if we still have other fails in the CI/CD checks - it is fail"). Defer to the
      // ci_failure path (which restarts the AI) instead of attempting a re-trigger and then
      // stopping for human review — the latter posted a misleading "Cancelled CI/CD Requires
      // Review" comment even though real failures needed fixing.
      const ciFailureBlocker = blockers.find(b => b.type === 'ci_failure');
      if (cancelledBlocker && !billingBlocker && !ciFailureBlocker) {
        await log('');
        await log(formatAligned('🔄', 'CANCELLED CI/CD CHECKS DETECTED', ''));
        await log(formatAligned('', 'Cancelled checks:', (cancelledBlocker.details || []).join(', '), 2));

        // Attempt to re-trigger the cancelled/stale workflow runs
        const sha = cancelledBlocker.sha;
        let runs = [];
        let retriggerable = [];
        let rerunTriggered = false;
        let rerunAttempted = false;
        const rerunFailures = [];

        if (sha) {
          runs = await getWorkflowRunsForSha(owner, repo, sha, argv.verbose);
          retriggerable = getRetriggerableWorkflowRuns(runs);

          if (retriggerable.length === 0) {
            await log(formatAligned('', '⚠️  No cancelled/stale workflow run found for this SHA', '', 2));
            rerunFailures.push({
              error: 'No cancelled/stale workflow run was found for this commit SHA.',
            });
          }

          for (const run of retriggerable) {
            await log(formatAligned('', `Re-triggering workflow "${run.name}" (${run.id})...`, '', 2));
            rerunAttempted = true;
            const rerunResult = await rerunWorkflowRun(owner, repo, run.id, argv.verbose);
            if (rerunResult.success) {
              await log(formatAligned('', `✅ Re-triggered: ${run.name}`, '', 2));
              rerunTriggered = true;
            } else {
              await log(formatAligned('', `⚠️  Could not re-trigger ${run.name}: ${rerunResult.error}`, '', 2));
              rerunFailures.push({ run, error: rerunResult.error });
            }
          }

          if (rerunTriggered) {
            await log(formatAligned('⏳', 'Waiting for re-triggered CI to complete...', '', 2));
            // Don't restart AI - just wait for re-triggered jobs to complete
            // The next iteration of the loop will check the new status
          }
        } else {
          await log(formatAligned('', '⚠️  Cancelled CI blocker did not include a commit SHA', '', 2));
          rerunFailures.push({
            error: 'Cancelled CI blocker did not include a commit SHA, so automatic workflow re-run could not identify the run.',
          });
        }

        if (shouldStopForCancelledCIReview({ retriggerableRuns: retriggerable, rerunTriggered, rerunFailures })) {
          await log(formatAligned('🛑', 'CANCELLED CI/CD NEEDS HUMAN REVIEW', 'Automatic re-run could not be started'));

          try {
            const commentBody = buildCancelledCIReviewComment({
              blocker: cancelledBlocker,
              runs,
              rerunFailures,
              rerunAttempted,
              sha,
            });
            await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: commentBody });
            await log(formatAligned('', '💬 Posted cancelled CI review notification to PR', '', 2));
          } catch (commentError) {
            reportError(commentError, {
              context: 'post_cancelled_ci_review_comment',
              owner,
              repo,
              prNumber,
              operation: 'comment_on_pr',
            });
            await log(formatAligned('', '⚠️  Could not post cancelled CI review comment to PR', '', 2));
          }

          return { success: false, reason: 'ci_cancelled_requires_review', latestSessionId, latestAnthropicCost };
        }
        // Don't set shouldRestart for cancelled checks - wait for re-triggered jobs instead
      }

      // Reason 2: CI failures (only if NOT a billing limit issue and NOT just cancelled)
      // Only restart AI when we have genuine code failures (real feedback to act on)
      const externalReviewLimitBlocker = blockers.find(b => b.type === 'external_review_limit');
      // Issue #1952: Reuse the ci_failure blocker resolved above so cancelled+failure mixes
      // take the restart path rather than the cancelled-review path.
      const ciBlocker = ciFailureBlocker;
      const hasMergeConflictBlocker = blockers.some(b => b.type === 'not_mergeable' && b.message?.includes('conflicts'));
      if (externalReviewLimitBlocker && !ciBlocker && !billingBlocker && !cancelledBlocker && !hasNewComments && !hasUncommittedChanges && !hasMergeConflictBlocker) {
        await log('');
        await log(formatAligned('🟡', 'READY FOR REVIEW', 'External review quota/credit limit requires human decision'));
        for (const detail of externalReviewLimitBlocker.details || []) {
          await log(formatAligned('', 'Check not executed:', detail, 2));
        }
        await log(formatAligned('', 'Action:', 'Stopping auto-restart without starting another AI session', 2));

        try {
          const commentSignature = `## 🟡 ${READY_FOR_REVIEW_MARKER}`;
          const hasExistingReadyForReviewComment = await checkForExistingComment(owner, repo, prNumber, commentSignature, argv.verbose);
          if (hasExistingReadyForReviewComment) {
            await log(formatAligned('', `Skipping duplicate "${READY_FOR_REVIEW_MARKER}" comment (already posted by another process)`, '', 2));
          } else {
            const commentBody = buildReadyForReviewComment({
              blocker: externalReviewLimitBlocker,
              ciStatus,
            });
            await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: commentBody });
            await log(formatAligned('', '💬 Posted ready-for-review notification to PR', '', 2));
          }
        } catch (commentError) {
          reportError(commentError, {
            context: 'post_external_review_limit_comment',
            owner,
            repo,
            prNumber,
            operation: 'comment_on_pr',
          });
          await log(formatAligned('', '⚠️  Could not post ready-for-review comment to PR', '', 2));
        }

        return { success: false, reason: 'external_review_limit', latestSessionId, latestAnthropicCost };
      }

      if (ciBlocker && !billingBlocker) {
        shouldRestart = true;
        restartReason = restartReason ? `${restartReason}; CI failures` : 'CI failures detected';
        feedbackLines.push('❌ CI/CD checks are failing:');
        // Issue #1690: Surface the blocker message so AI sees structured failure context
        // (e.g. "CI/CD workflow file is invalid — no jobs were instantiated") even when
        // the failure didn't produce traditional check-runs.
        if (ciBlocker.message && ciBlocker.message !== 'CI/CD checks are failing') {
          feedbackLines.push(`  ${ciBlocker.message}`);
        }
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
        if (hasReachedAutoIterationLimit(restartCount, maxAutoRestartIterations)) {
          await log('');
          await log(formatAligned('⚠️', 'AUTO-RESTART LIMIT REACHED', `Stopping after ${restartCount} restart iteration${restartCount !== 1 ? 's' : ''}`));
          await log(formatAligned('', 'Configured limit:', formatAutoIterationLimit(maxAutoRestartIterations), 2));
          await log(formatAligned('', 'Remaining blockers:', restartReason, 2));
          await log('');

          try {
            const limitComment = `## ⚠️ Auto-restart limit reached

Hive Mind stopped auto-restart-until-mergeable after ${restartCount} restart iteration${restartCount !== 1 ? 's' : ''}.

**Configured limit:** ${formatAutoIterationLimit(maxAutoRestartIterations)}
**Remaining reason:** ${restartReason}

No further AI sessions will be started automatically for this run. Please review the remaining blockers manually or rerun with a higher \`--auto-restart-max-iterations\` value.

---
*Auto-restart-until-mergeable stopped by the safety limit.*`;
            await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: limitComment });
          } catch (commentError) {
            reportError(commentError, {
              context: 'post_auto_restart_limit_comment',
              owner,
              repo,
              prNumber,
              operation: 'comment_on_pr',
            });
            await log(formatAligned('', '⚠️  Could not post auto-restart limit comment to PR', '', 2));
          }

          return { success: false, reason: 'auto_restart_limit_reached', latestSessionId, latestAnthropicCost };
        }

        // Add standard instructions for auto-restart-until-mergeable mode using shared utility
        feedbackLines.push(...buildAutoRestartInstructions());

        // Get PR merge state status
        const prStateResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.mergeStateStatus'`;
        const mergeStateStatus = prStateResult.code === 0 ? prStateResult.stdout.toString().trim() : null;

        // Issue #1572: Sync clean local branches with remote before restarting to avoid push failures.
        // Issue #1664: Do not run git pull over an unfinished merge or other uncommitted state.
        // The tool must see that state and either commit, continue, abort, or otherwise resolve it.
        const effectiveBranch = prBranch || branchName;
        if (shouldSyncBeforeRestart({ hasUncommittedChanges })) {
          const pullResult = await $({ cwd: tempDir })`git pull origin ${effectiveBranch} 2>&1`;
          if (pullResult.code === 0) {
            await log(formatAligned('🔄', 'Synced:', `Local branch ${effectiveBranch} updated from remote`));
          } else {
            const pullOutput = `${pullResult.stdout || ''}${pullResult.stderr || ''}`.trim() || 'no output';
            const pullLeftLocalChanges = await checkForUncommittedChanges(tempDir, argv);
            if (pullLeftLocalChanges && /CONFLICT|MERGE_HEAD|unmerged|Automatic merge failed|not concluded your merge/i.test(pullOutput)) {
              await log(formatAligned('⚠️', 'Sync produced merge state:', 'Proceeding with AI restart to resolve it', 2));
              feedbackLines.push('');
              feedbackLines.push('⚠️ Branch sync encountered an unfinished merge or conflicts:');
              feedbackLines.push(pullOutput);
              feedbackLines.push('');
              feedbackLines.push('Please resolve the merge state before finishing.');
            } else {
              throw new Error(`git pull failed (code ${pullResult.code}): ${pullOutput}`);
            }
          }
        } else {
          await log(formatAligned('↪️', 'Skipping branch sync:', 'Local uncommitted/merge state must be resolved by the AI session', 2));
        }

        // Issue #1323: Increment restart count only when a tool execution is about to start.
        restartCount++;

        await log(formatAligned('🔄', 'RESTART TRIGGERED:', restartReason));
        await log(formatAligned('', 'Restart iteration:', maxAutoRestartIterations === 0 ? `${restartCount}` : `${restartCount}/${maxAutoRestartIterations}`, 2));
        await log('');

        // Post a comment to PR about the restart after preflight succeeds, so every
        // posted restart notification corresponds to an actual tool session.
        try {
          const limitText = maxAutoRestartIterations === 0 ? 'No automatic restart limit is configured.' : `This run will stop after ${maxAutoRestartIterations} restart iteration${maxAutoRestartIterations !== 1 ? 's' : ''}.`;
          const commentBody = `## 🔄 ${AUTO_RESTART_MARKER} triggered (iteration ${restartCount})\n\n**Reason:** ${restartReason}\n\nStarting new session to address the issues.\n\n---\n*Auto-restart-until-mergeable mode is active. ${limitText}*`;
          // Issue #1625: Track so this doesn't falsely count as an AI-authored comment
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
          await log(formatAligned('', '⚠️  Could not post comment to PR', '', 2));
        }

        // Execute the AI tool using shared utility
        await log(formatAligned('🔄', 'Restarting:', `Running ${argv.tool.toUpperCase()} to address issues...`));

        // Issue #1728: Scope the AI-comment check that gates --auto-attach-solution-summary
        // to comments posted during *this* iteration only, not across the whole watch loop.
        const iterationStartTime = new Date();

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
          // Issue #1356: Check for usage limit errors FIRST (most specific)
          // When usage limit is reached, wait for limitResetTime + buffer + jitter,
          // then resume the session using --resume <sessionId> with a "Continue" prompt.
          // Issue #1570: Always post a GitHub comment to notify the user about the delay
          // and when exactly execution will be resumed, so the user doesn't think the process is stuck.
          if (isUsageLimitReached(toolResult)) {
            if (hasReachedAutoIterationLimit(limitResumeCount, maxAutoResumeIterations)) {
              await log('');
              await log(formatAligned('⚠️', 'AUTO-RESUME LIMIT REACHED', `Stopping after ${limitResumeCount} limit-reset continuation${limitResumeCount !== 1 ? 's' : ''}`));
              await log(formatAligned('', 'Configured limit:', formatAutoIterationLimit(maxAutoResumeIterations), 2));
              await log('');
              return { success: false, reason: 'auto_resume_limit_reached', latestSessionId, latestAnthropicCost };
            }

            limitResumeCount++;
            const resumeSessionId = toolResult.sessionId;
            const resetTime = toolResult.limitResetTime;
            const baseWaitMs = resetTime ? calculateWaitTime(resetTime, toolResult.limitTimezone || null) : 0;
            const bufferMs = limitReset.bufferMs;
            const jitterMs = Math.floor(Math.random() * limitReset.jitterMs);
            const waitMs = baseWaitMs + bufferMs + jitterMs;
            const bufferMinutes = Math.round(bufferMs / 60000);
            const jitterSeconds = Math.round(jitterMs / 1000);
            const waitMinutes = Math.round(waitMs / 60000);

            // Issue #1570: Calculate the actual resume time for user display
            const resumeDate = new Date(Date.now() + waitMs);
            const resumeTimeUTC = resumeDate
              .toISOString()
              .replace('T', ' ')
              .replace(/\.\d+Z$/, ' UTC');

            await log('');
            await log(formatAligned('⏳', 'USAGE LIMIT REACHED', ''));
            await log(formatAligned('', 'Reset time:', resetTime || 'Unknown', 2));
            await log(formatAligned('', 'Waiting:', `${waitMinutes} min (reset + ${bufferMinutes} min buffer + ${jitterSeconds}s jitter)`, 2));
            await log(formatAligned('', 'Resume at:', resumeTimeUTC, 2));
            await log(formatAligned('', 'Auto-resume iteration:', maxAutoResumeIterations === 0 ? `${limitResumeCount}` : `${limitResumeCount}/${maxAutoResumeIterations}`, 2));
            await log(formatAligned('', 'Action:', 'Posting GitHub comment and waiting for limit reset', 2));
            if (resumeSessionId) {
              await log(formatAligned('', 'Session ID:', resumeSessionId, 2));
            }
            await log('');

            // Issue #1570: Post a GitHub comment to notify the user about the usage limit delay.
            // This follows the same pattern as solve.watch.lib.mjs to ensure consistent user experience.
            const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
            if (prNumber && shouldAttachLogs) {
              try {
                const logFile = getLogFile();
                if (logFile) {
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
                    sessionId: resumeSessionId || latestSessionId,
                    tempDir,
                    anthropicTotalCostUSD: toolResult.anthropicTotalCostUSD || latestAnthropicCost,
                    isUsageLimit: true,
                    limitResetTime: resetTime,
                    toolName: `Anthropic ${(argv.tool || 'claude').charAt(0).toUpperCase() + (argv.tool || 'claude').slice(1)} Code`,
                    isAutoResumeEnabled: true,
                    autoResumeMode: 'restart',
                    requestedModel: argv.originalModel || argv.model,
                    tool: argv.tool || 'claude',
                    publicPricingEstimate: toolResult.publicPricingEstimate,
                    pricingInfo: toolResult.pricingInfo,
                    resultModelUsage: toolResult.resultModelUsage || null,
                  });
                  await log(formatAligned('', '✅ Usage limit comment posted to PR', '', 2));
                }
              } catch (commentError) {
                reportError(commentError, {
                  context: 'attach_usage_limit_comment_auto_restart',
                  prNumber,
                  owner,
                  repo,
                  operation: 'usage_limit_comment',
                });
                await log(formatAligned('', `⚠️  Usage limit comment upload error: ${cleanErrorMessage(commentError)}`, '', 2));
              }
            }

            // Wait until the limit resets
            await interruptibleSleep(waitMs);

            await log(formatAligned('✅', 'Usage limit wait complete', 'Resuming session...'));
            await log('');

            // Resume the session: execute with --resume <sessionId> and a "Continue" prompt
            // This preserves context and the system message from the original session
            if (resumeSessionId) {
              const resumeArgv = { ...argv, resume: resumeSessionId };
              const resumeResult = await executeToolIteration({
                issueUrl,
                owner,
                repo,
                issueNumber,
                prNumber,
                branchName: prBranch || branchName,
                tempDir,
                mergeStateStatus,
                feedbackLines: ['Continue'],
                argv: resumeArgv,
              });

              if (resumeResult.success) {
                // Resume succeeded - capture session data
                currentBackoffSeconds = watchInterval;
                if (resumeResult.sessionId) {
                  latestSessionId = resumeResult.sessionId;
                  latestAnthropicCost = resumeResult.anthropicTotalCostUSD;
                }
                await log(formatAligned('✅', `${argv.tool.toUpperCase()} resume completed:`, 'Checking if PR is now mergeable...'));
              } else if (isUsageLimitReached(resumeResult)) {
                // Hit the limit again immediately after resume — store for next outer iteration
                await log(formatAligned('⚠️', 'Usage limit hit again after resume', 'Will retry in next check cycle', 2));
              } else {
                // Resume failed for a non-limit reason — stop the loop
                await log('');
                await log(formatAligned('❌', `${argv.tool.toUpperCase()} RESUME FAILED`, ''));
                // Issue #1845: surface the core error in the terminal, not just in the GitHub log.
                await log(formatAligned('', 'Error details:', extractToolErrorCore({ toolResult: resumeResult }) || 'Unknown error', 2));
                await log(formatAligned('', 'Action:', 'Stopping auto-restart — tool execution failed after limit reset', 2));
                // Issue #1439: Attach failure log before stopping, so user can see what happened
                const shouldAttachLogsOnResumeFail = argv.attachLogs || argv['attach-logs'];
                if (prNumber && shouldAttachLogsOnResumeFail) {
                  try {
                    const logFile = getLogFile();
                    if (logFile) {
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
                        errorMessage: `${formatToolExecutionFailure({ tool: argv.tool, toolResult: resumeResult })} after limit reset`,
                        sessionId: latestSessionId,
                        tempDir,
                        requestedModel: argv.originalModel || argv.model,
                        tool: argv.tool || 'claude',
                      });
                    }
                  } catch (logUploadError) {
                    reportError(logUploadError, {
                      context: 'attach_auto_restart_failure_log',
                      prNumber,
                      owner,
                      repo,
                      operation: 'upload_failure_log',
                    });
                    await log(formatAligned('', `⚠️  Failure log upload error: ${cleanErrorMessage(logUploadError)}`, '', 2));
                  }
                }
                return { success: false, reason: 'tool_failure_after_resume', latestSessionId, latestAnthropicCost };
              }
            } else {
              // No session ID available — cannot resume, restart fresh in next iteration
              await log(formatAligned('⚠️', 'No session ID for resume', 'Will restart fresh in next check cycle', 2));
            }

            lastCheckTime = new Date();
            continue;
          }

          // Any other failure (not usage limit): stop the auto-restart loop
          // Per reviewer feedback: non-limit failures should fail and stop attempts
          await log('');
          await log(formatAligned('❌', `${argv.tool.toUpperCase()} EXECUTION FAILED`, ''));
          // Issue #1845: surface the core error in the terminal, not just in the GitHub log.
          await log(formatAligned('', 'Error details:', extractToolErrorCore({ toolResult }) || 'Unknown error', 2));
          await log(formatAligned('', 'Action:', 'Stopping auto-restart — tool execution failed', 2));
          // Issue #1439: Attach failure log before stopping, so user can see what happened
          const shouldAttachLogsOnFail = argv.attachLogs || argv['attach-logs'];
          if (prNumber && shouldAttachLogsOnFail) {
            try {
              const logFile = getLogFile();
              if (logFile) {
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
                  errorMessage: formatToolExecutionFailure({ tool: argv.tool, toolResult }),
                  sessionId: latestSessionId,
                  tempDir,
                  requestedModel: argv.originalModel || argv.model,
                  tool: argv.tool || 'claude',
                });
              }
            } catch (logUploadError) {
              reportError(logUploadError, {
                context: 'attach_auto_restart_failure_log',
                prNumber,
                owner,
                repo,
                operation: 'upload_failure_log',
              });
              await log(formatAligned('', `⚠️  Failure log upload error: ${cleanErrorMessage(logUploadError)}`, '', 2));
            }
          }
          return { success: false, reason: 'tool_failure', latestSessionId, latestAnthropicCost };
        } else {
          // Success - capture latest session data
          currentBackoffSeconds = watchInterval;
          if (toolResult.sessionId) {
            latestSessionId = toolResult.sessionId;
            latestAnthropicCost = toolResult.anthropicTotalCostUSD;
          }

          // Issue #1508: Compute budget stats for auto-restart-until-mergeable log comment
          let autoMergeBudgetStatsData = null;
          if (argv.tokensBudgetStats && latestSessionId && tempDir) {
            try {
              const { calculateSessionTokens } = await import('./claude.lib.mjs');
              const tokenUsage = await calculateSessionTokens(latestSessionId, tempDir, toolResult.resultModelUsage);
              if (tokenUsage) {
                autoMergeBudgetStatsData = { tokenUsage, streamTokenUsage: toolResult.streamTokenUsage || null };
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
          // Before this fix, only the top-level solve.mjs flow honoured this
          // flag, so iterations inside auto-restart-until-mergeable silently
          // dropped the AI's last message — see #1728.
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
              context: 'attach_auto_restart_working_session_summary',
              prNumber,
              owner,
              repo,
              iteration,
              operation: 'attach_working_session_summary',
            });
            await log(formatAligned('', `⚠️  Working session summary error: ${cleanErrorMessage(summaryError)}`, '', 2));
          }

          // Attach log if enabled
          const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
          if (prNumber && shouldAttachLogs) {
            await log('');
            await log(formatAligned('📎', 'Uploading session log...', ''));
            try {
              const logFile = getLogFile();
              if (logFile) {
                // Issue #1323: Use restartCount (actual AI executions) instead of iteration (check cycles)
                const customTitle = `🔄 Auto-restart-until-mergeable Log (iteration ${restartCount})`;
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
                  // Issue #1225: Pass model and tool info for PR comments
                  requestedModel: argv.originalModel || argv.model,
                  tool: argv.tool || 'claude',
                  // Issue #1508: Include budget stats (context/token/cost) for auto-restart log
                  resultModelUsage: toolResult.resultModelUsage || null,
                  budgetStatsData: autoMergeBudgetStatsData,
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

          // Issue #1763: Re-verify the PR body contains a closing keyword for
          // the issue after every auto-restart-until-mergeable iteration. The
          // AI agent can rewrite the PR description mid-session and any
          // iteration may end up being the last one (mergeable, max-iters,
          // billing limit, etc.), so this check cannot be deferred to the
          // top-level verifyResults path.
          if (prNumber && issueNumber && owner && repo) {
            try {
              await log(formatAligned('🔗', 'Verifying PR issue link after iteration...', '', 2));
              await ensurePullRequestIssueLink({
                prNumber,
                issueNumber,
                owner,
                repo,
                argv,
              });
            } catch (issueLinkError) {
              reportError(issueLinkError, {
                context: 'ensure_pr_issue_link_auto_restart_iteration',
                prNumber,
                owner,
                repo,
                iteration,
                operation: 'ensure_pr_issue_link',
              });
              await log(formatAligned('', `⚠️  PR issue link check error: ${cleanErrorMessage(issueLinkError)}`, '', 2));
            }
          }

          await log('');
          await log(formatAligned('✅', `${argv.tool.toUpperCase()} execution completed:`, 'Checking if PR is now mergeable...'));
        }

        // Issue #1827: Register every comment the authenticated account posted
        // during this AI session (free-form status comments like "✅ CI now
        // green" the agent writes itself, which bypass postTrackedComment and
        // match no tool marker). Tracking their IDs stops the next iteration's
        // checkForNonBotComments from mistaking them for fresh human feedback.
        try {
          const tracked = await trackAuthenticatedUserCommentsSince(owner, repo, prNumber, issueNumber, iterationStartTime, $, { verbose: argv.verbose });
          if (argv.verbose && tracked.length > 0) {
            await log(formatAligned('🧷', 'Tracked own session comments:', `${tracked.length} (won't count as new feedback)`, 2));
          }
        } catch (trackError) {
          reportError(trackError, {
            context: 'track_authenticated_user_session_comments',
            prNumber,
            owner,
            repo,
            operation: 'track_session_comments',
          });
        }

        // Update last check time after restart
        lastCheckTime = new Date();
      } else if (blockers.length > 0) {
        // There are blockers but none that warrant an AI restart
        // Issue #1314: Distinguish between different waiting reasons
        const pendingBlocker = blockers.find(b => b.type === 'ci_pending');
        const cancelledOnly = blockers.every(b => b.type === 'ci_cancelled' || b.type === 'ci_pending');
        const cancelledBlocker = blockers.find(b => b.type === 'ci_cancelled');

        // Issue #1712: When `details` contain URLs (which they now always do for ci_pending /
        // ci_cancelled blockers), comma-joining them produces an unreadable single-line wall
        // of text. Render the first detail inline (with the message as the header) and any
        // additional details on their own indented lines. Each detail is already
        // self-explanatory: "<name> [<status>] — <url>".
        const renderBlocker = (icon, header, blocker) => {
          if (!blocker.details || blocker.details.length === 0) {
            return log(formatAligned(icon, header, blocker.message, 2));
          }
          if (blocker.details.length === 1) {
            return log(formatAligned(icon, header, blocker.details[0], 2));
          }
          return (async () => {
            await log(formatAligned(icon, header, blocker.message, 2));
            for (const detail of blocker.details) {
              await log(formatAligned('', '', detail, 4));
            }
          })();
        };

        if (cancelledOnly && cancelledBlocker) {
          await renderBlocker('🔄', 'Waiting for re-triggered CI:', cancelledBlocker);
        } else if (pendingBlocker) {
          await renderBlocker('⏳', 'Waiting for CI:', pendingBlocker);
        } else {
          await log(formatAligned('⏳', 'Waiting for:', blockers.map(b => b.message).join(', '), 2));
        }
      } else {
        await log(formatAligned('', 'No action needed', 'Continuing to monitor...', 2));
      }

      // Issue #1827: Advance the check window monotonically — never move it
      // backwards. In the restart branch above, lastCheckTime was already set
      // to a moment *after* the AI session (and after any comments the agent
      // posted). currentTime was captured at the *start* of this iteration,
      // before the AI ran, so assigning it unconditionally here would rewind
      // the window and re-detect the agent's own comments as new feedback
      // (the root cause of the auto-restart loop in #1827). In the non-restart
      // branches lastCheckTime is still the previous iteration's value, which
      // is < currentTime, so this correctly advances it.
      lastCheckTime = nextMonotonicCheckTime(lastCheckTime, currentTime);
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
    const actualWaitSeconds = currentBackoffSeconds;
    await log(formatAligned('⏱️', 'Next check in:', `${actualWaitSeconds} seconds...`, 2));
    await log('');
    await interruptibleSleep(actualWaitSeconds * 1000);
  }
};

/**
 * Attempt to auto-merge PR after session ends
 * This implements the --auto-merge functionality for one-shot merge attempts
 */
export const attemptAutoMerge = async params => {
  const { owner, repo, prNumber, issueNumber = null, argv } = params;

  await log('');
  await log(formatAligned('🔀', 'AUTO-MERGE:', 'Checking if PR can be merged...'));

  const terminalState = await checkGitHubTerminalState({
    owner,
    repo,
    issueNumber,
    prNumber,
    commandRunner: $,
  });
  if (terminalState.terminal) {
    if (terminalState.success) {
      await log(formatAligned('🎉', 'PR already merged:', `#${prNumber}`, 2));
      return { success: true, reason: 'merged' };
    }
    await log(formatAligned('❌', 'GITHUB TARGET UNAVAILABLE:', terminalState.message, 2), { level: 'error' });
    for (const detail of terminalState.details || []) {
      await log(formatAligned('', 'Detail:', detail, 4), { level: 'error' });
    }
    return { success: false, reason: terminalState.reason, error: terminalState.message };
  }

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
  if (mergeStatus.terminal) {
    await log(formatAligned('❌', 'GITHUB TARGET UNAVAILABLE:', mergeStatus.reason || 'GitHub repository, pull request, issue, or branch is no longer accessible', 2), { level: 'error' });
    return { success: false, reason: 'terminal_github_entity_error', error: mergeStatus.reason };
  }

  if (!mergeStatus.mergeable) {
    await log(formatAligned('⚠️', 'PR not mergeable:', mergeStatus.reason || 'Unknown reason', 2));
    return { success: false, reason: 'not_mergeable', error: mergeStatus.reason };
  }

  await log(formatAligned('✅', 'PR is mergeable:', 'Attempting to merge...', 2));

  // Attempt to merge
  const deleteAfterMerge = shouldDeleteBranchAfterMerge(argv);
  if (deleteAfterMerge) {
    await log(formatAligned('', 'Branch cleanup:', 'will delete branch after successful merge', 2));
  }
  const mergeResult = await mergePullRequest(owner, repo, prNumber, { squash: argv.squash || false, deleteAfter: deleteAfterMerge }, argv.verbose);

  if (mergeResult.success) {
    await log(formatAligned('🎉', 'PR MERGED SUCCESSFULLY!', ''));

    // Post success comment
    try {
      const commentBody = `## 🎉 ${AUTO_MERGED_MARKER}\n\nThis pull request has been automatically merged by hive-mind after all CI checks passed and the PR became mergeable.\n\n---\n*Auto-merged by hive-mind with --auto-merge flag*`;
      await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: commentBody });
    } catch {
      // Don't fail if comment posting fails
    }

    // Issue #1895: close linked issue explicitly when GitHub will not (non-default base branch).
    try {
      const closeResult = await ensureLinkedIssueClosedAfterMerge({ $, log, owner, repo, prNumber, issueNumber, verbose: argv.verbose });
      if (!closeResult.closed && !closeResult.skipped) {
        await log(formatAligned('⚠️', 'Issue auto-close:', `could not close linked issue (${closeResult.reason})`, 2), { level: 'warning' });
      }
    } catch (closeError) {
      await log(formatAligned('⚠️', 'Issue auto-close:', `error: ${closeError.message}`, 2), { level: 'warning' });
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

  await ensurePullRequestBaseBranch({
    owner,
    repo,
    prNumber,
    argv,
    log,
    formatAligned,
    $,
    onMismatch: isAutoMerge ? 'throw' : 'restore',
    operation: isAutoMerge ? 'auto-merge' : 'auto-restart-until-mergeable',
  });

  // Issue #1226: Check if running in fork mode — auto-merge cannot work without write access
  if (argv.fork && isAutoMerge) {
    await log('');
    await log(formatAligned('⚠️', 'Auto-merge:', 'Cannot auto-merge fork PRs'));
    await log(formatAligned('', 'Reason:', 'Fork contributors do not have write access to merge PRs to upstream repositories', 2));
    await log(formatAligned('', 'Action:', 'PR is ready for manual merge by a repository maintainer', 2));
    await log('');

    // Issue #1323: Post a comment to the PR notifying the maintainer (with deduplication)
    try {
      const readyToMergeSignature = `## ✅ ${READY_TO_MERGE_MARKER}`;
      const hasExistingComment = await checkForExistingComment(owner, repo, prNumber, readyToMergeSignature, argv.verbose);
      if (!hasExistingComment) {
        const commentBody = `## ✅ ${READY_TO_MERGE_MARKER}\n\nThis pull request is ready to be merged. Auto-merge was requested (\`--auto-merge\`) but cannot be performed because this PR was created from a fork (no write access to the target repository).\n\nPlease merge manually.\n\n---\n*hive-mind with --auto-merge flag (fork mode)*`;
        // Issue #1625: Track so this doesn't falsely count as AI-authored.
        await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: commentBody });
        await log(formatAligned('', '💬 Posted merge readiness notification to PR', '', 2));
      } else {
        await log(formatAligned('', `Skipping duplicate "${READY_TO_MERGE_MARKER}" comment`, '', 2));
      }
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

      // Issue #1323: Post a comment to the PR notifying the maintainer (with deduplication)
      try {
        const readyToMergeSignature = `## ✅ ${READY_TO_MERGE_MARKER}`;
        const hasExistingComment = await checkForExistingComment(owner, repo, prNumber, readyToMergeSignature, argv.verbose);
        if (!hasExistingComment) {
          const commentBody = `## ✅ ${READY_TO_MERGE_MARKER}\n\nThis pull request is ready to be merged. Auto-merge was requested (\`--auto-merge\`) but cannot be performed because the authenticated user lacks write access to \`${owner}/${repo}\` (current permission: \`${permission || 'unknown'}\`).\n\nPlease merge manually.\n\n---\n*hive-mind with --auto-merge flag*`;
          // Issue #1625: Track so this doesn't falsely count as AI-authored.
          await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: commentBody });
          await log(formatAligned('', '💬 Posted merge readiness notification to PR', '', 2));
        } else {
          await log(formatAligned('', `Skipping duplicate "${READY_TO_MERGE_MARKER}" comment`, '', 2));
        }
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
