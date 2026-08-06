#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

/**
 * One-shot `--auto-merge` attempt after a session ends.
 *
 * Extracted from solve.auto-merge.lib.mjs (Issue #2144) to keep both files
 * under the 1500-line limit while the stop-reporting paths were added.
 *
 * Issue #2144 behaviour: a closed or missing linked issue is *not* a terminal
 * state here either. The merge requirements are still evaluated, and only the
 * final merge is held back — with a comment asking the user to reopen the
 * issue or merge manually. Every other stop path reports its exact reason to
 * the pull request.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2144
 */

if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}
const use = globalThis.use;

const { $: __rawDollar$ } = await use('command-stream');
const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const $ = wrapDollarWithGhRetry(__rawDollar$);

const lib = await import('./lib.mjs');
const { log, formatAligned } = lib;

const githubMergeLib = await import('./github-merge.lib.mjs');
const { checkPRMergeable, checkMergePermissions, mergePullRequest, waitForCI } = githubMergeLib;

const terminalStateLib = await import('./github-terminal-state.lib.mjs');
const { checkGitHubTerminalState } = terminalStateLib;

// Issue #2144: these probes answer with a ~33 KB pull request object and a full
// issue object on every iteration. Issue #2130 made the helper's own default
// runner quiet, but passing `$` here bypassed it and the payloads were still
// mirrored into the attached log. Bind the quiet options to the injected `$`.
const { quietProbe } = await import('./quiet-probe.lib.mjs');

const toolComments = await import('./tool-comments.lib.mjs');
const { AUTO_MERGED_MARKER, postTrackedComment } = toolComments;

const stopReporting = await import('./automation-stop-reporting.lib.mjs');
const { AUTO_MERGE_BLOCKED_MARKER, buildAutoMergeBlockedComment, reportAutomationStop } = stopReporting;

const { ensureLinkedIssueClosedAfterMerge } = await import('./github-issue-auto-close.lib.mjs');

const shouldDeleteBranchAfterMerge = argv => argv.autoDeleteBranchOnMerge || argv.deleteBranchAfterMerge || false;

/**
 * Report the merge blockers that prevent an automatic merge of a pull request
 * which otherwise satisfies every merge requirement (Issue #2144).
 *
 * @returns {Promise<{posted: boolean, reason: string, skipped?: string, error?: string}>}
 */
export const reportAutoMergeBlockedByIssue = async ({ owner, repo, prNumber, issueNumber, mergeBlockers, verbose = false, commandRunner = $ }) => {
  const blockers = (mergeBlockers || []).filter(Boolean);
  if (blockers.length === 0) {
    return { posted: false, reason: 'no_blockers', skipped: 'no_blockers' };
  }

  await log('');
  await log(formatAligned('⚠️', 'AUTO-MERGE HELD BACK:', blockers.map(b => b.message).join('; '), 2), { level: 'warning' });
  for (const blocker of blockers) {
    if (blocker.resolution) {
      await log(formatAligned('', 'Action:', blocker.resolution, 4), { level: 'warning' });
    }
  }

  return reportAutomationStop({
    $: commandRunner,
    owner,
    repo,
    targetNumber: prNumber,
    reason: blockers[0].reason,
    mode: 'auto-merge',
    verbose,
    log,
    body: buildAutoMergeBlockedComment({ blockers, issueNumber }),
    signature: AUTO_MERGE_BLOCKED_MARKER,
  });
};

/**
 * Attempt to auto-merge a PR after the session ends.
 * Implements the one-shot `--auto-merge` path.
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
    commandRunner: quietProbe($),
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
    // Issue #2144: never stop silently — publish the exact reason.
    await reportAutomationStop({
      $,
      owner,
      repo,
      targetNumber: prNumber,
      reason: terminalState.reason,
      mode: 'auto-merge',
      message: terminalState.message,
      details: terminalState.details,
      verbose: argv.verbose,
      log,
    });
    return { success: false, reason: terminalState.reason, error: terminalState.message };
  }

  // Issue #2144: a closed/unavailable linked issue blocks only the merge step.
  const issueMergeBlockers = terminalState.mergeBlockers || [];

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
    await reportAutomationStop({
      $,
      owner,
      repo,
      targetNumber: prNumber,
      reason: 'terminal_github_entity_error',
      mode: 'auto-merge',
      message: mergeStatus.reason,
      verbose: argv.verbose,
      log,
    });
    return { success: false, reason: 'terminal_github_entity_error', error: mergeStatus.reason };
  }

  if (!mergeStatus.mergeable) {
    await log(formatAligned('⚠️', 'PR not mergeable:', mergeStatus.reason || 'Unknown reason', 2));
    return { success: false, reason: 'not_mergeable', error: mergeStatus.reason };
  }

  // Issue #2144: the pull request is ready. If the linked issue is closed or
  // gone, do not merge automatically — ask the user to reopen it or merge
  // manually, and say so on the pull request.
  if (issueMergeBlockers.length > 0) {
    await reportAutoMergeBlockedByIssue({ owner, repo, prNumber, issueNumber, mergeBlockers: issueMergeBlockers, verbose: argv.verbose });
    return { success: false, reason: issueMergeBlockers[0].reason, error: issueMergeBlockers[0].message, mergeBlockers: issueMergeBlockers };
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
    await reportAutomationStop({
      $,
      owner,
      repo,
      targetNumber: prNumber,
      reason: 'merge_failed',
      mode: 'auto-merge',
      message: mergeResult.error || 'GitHub rejected the merge request.',
      verbose: argv.verbose,
      log,
    });
    return { success: false, reason: 'merge_failed', error: mergeResult.error };
  }
};

export default {
  attemptAutoMerge,
  reportAutoMergeBlockedByIssue,
};
