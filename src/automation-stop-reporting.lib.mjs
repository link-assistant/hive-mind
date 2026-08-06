#!/usr/bin/env node

/**
 * Announce on GitHub *why* a long-running automation loop stopped.
 *
 * Issue #2144: `--auto-restart-until-mergeable` and `--watch` used to exit
 * silently on several paths (terminal GitHub entity states, tool execution
 * failures, auto-resume limit). The reported incident stopped the loop on an
 * open, mergeable pull request because its linked issue was closed, and left
 * no GitHub comment at all — from the pull request's point of view the
 * automation simply vanished.
 *
 * Two things live here:
 *   1. A registry that turns an internal stop reason into human-readable text
 *      (what happened, what it means, what the user should do next).
 *   2. `reportAutomationStop`, which posts that text as a deduplicated,
 *      tracked tool comment. Every stop path calls it, so "we stopped and
 *      exactly why" is always published.
 *
 * The module is intentionally free of top-level `command-stream` /`use-m`
 * imports: the comment builders are pure functions and can be unit-tested
 * without a GitHub environment. The `$` helper is passed in by callers.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2144
 */

import { AUTOMATION_STOPPED_MARKER, AUTO_MERGE_BLOCKED_MARKER, postTrackedComment } from './tool-comments.lib.mjs';

export { AUTOMATION_STOPPED_MARKER, AUTO_MERGE_BLOCKED_MARKER };

/**
 * Human-readable descriptions for every stop reason the solver can return.
 *
 * `canComment: false` marks reasons where the comment target itself is gone
 * (deleted repository / pull request), so posting is skipped instead of
 * producing a guaranteed API failure.
 */
export const STOP_REASONS = {
  pull_request_closed: {
    title: 'the pull request was closed without merging',
    detail: 'A closed pull request can never become mergeable, so continuing to work on it would be pointless.',
    nextSteps: ['Reopen the pull request and re-run the command to continue.'],
  },
  pull_request_unavailable: {
    title: 'the pull request is no longer accessible',
    detail: 'GitHub answered with 404/410 for this pull request (deleted, transferred, or access revoked).',
    nextSteps: ['Verify the pull request still exists and that the token has access to it.'],
    canComment: false,
  },
  repository_unavailable: {
    title: 'the repository is no longer accessible',
    detail: 'GitHub answered with 404/410 for the repository (deleted, renamed, made private, or access revoked).',
    nextSteps: ['Verify the repository still exists and that the token has access to it.'],
    canComment: false,
  },
  source_branch_unavailable: {
    title: 'the source branch of the pull request is gone',
    detail: 'The head branch (or its repository) is no longer accessible, so no further commits can be pushed to this pull request.',
    nextSteps: ['Restore the source branch, or open a new pull request from a branch that still exists.'],
  },
  target_branch_unavailable: {
    title: 'the target branch of the pull request is gone',
    detail: 'The base branch (or its repository) is no longer accessible, so this pull request can never be merged as-is.',
    nextSteps: ['Restore the base branch, or retarget this pull request to an existing branch.'],
  },
  terminal_github_entity_error: {
    title: 'a GitHub entity required by this automation is no longer accessible',
    detail: 'A repository, pull request, or branch answered with 404/410 while checking CI status.',
    nextSteps: ['Verify the repository, pull request, and branches still exist and that the token has access to them.'],
  },
  auto_resume_limit_reached: {
    title: 'the usage-limit auto-resume budget was exhausted',
    detail: 'The AI session hit provider usage limits more times than `--auto-resume-max-iterations` allows.',
    nextSteps: ['Re-run the command after the usage limit resets, or raise `--auto-resume-max-iterations`.'],
  },
  tool_failure: {
    title: 'the AI session failed',
    detail: 'The AI tool exited with an error that is not a usage limit, so restarting it automatically would most likely fail the same way.',
    nextSteps: ['Review the attached working session log for the failure, fix the cause, and re-run the command.'],
  },
  tool_failure_after_resume: {
    title: 'the AI session failed after resuming from a usage limit',
    detail: 'The session was resumed once the usage limit reset, but the resumed run exited with an error.',
    nextSteps: ['Review the attached working session log for the failure, fix the cause, and re-run the command.'],
  },
  merge_failed: {
    title: 'GitHub refused the merge',
    detail: 'Every merge requirement was satisfied, but the merge API call itself failed (branch protection, required reviews, or a race with another push).',
    nextSteps: ['Check the branch protection rules and required reviews, then merge manually or re-run the command.'],
  },
  issue_closed: {
    title: 'the linked issue is closed, so auto-merge was held back',
    detail: 'The pull request is ready to merge. A closed issue never stops work on the pull request — it only blocks the automatic merge.',
    nextSteps: ['Reopen the linked issue and re-run the command so auto-merge can complete.', 'Or merge this pull request manually — it is ready.'],
  },
  issue_unavailable: {
    title: 'the linked issue is no longer accessible, so auto-merge was held back',
    detail: 'The pull request is ready to merge. A missing issue never stops work on the pull request — it only blocks the automatic merge.',
    nextSteps: ['Restore or re-create the linked issue and re-run the command so auto-merge can complete.', 'Or merge this pull request manually — it is ready.'],
  },
  watch_stopped: {
    title: 'watch mode stopped',
    detail: 'The watch loop reached a state where it can no longer make progress.',
    nextSteps: ['Re-run the command once the reported condition is resolved.'],
  },
};

const MODE_LABELS = {
  'auto-restart-until-mergeable': '`--auto-restart-until-mergeable`',
  'auto-merge': '`--auto-merge`',
  watch: '`--watch`',
};

/**
 * Resolve a stop reason to its description, with a safe fallback so an unknown
 * or newly added reason is still reported (never silently swallowed).
 *
 * @param {string} reason
 * @returns {{reason: string, title: string, detail: string, nextSteps: string[], canComment: boolean, known: boolean}}
 */
export const describeStopReason = reason => {
  const key = String(reason || 'unknown');
  const known = Object.prototype.hasOwnProperty.call(STOP_REASONS, key);
  const entry = known ? STOP_REASONS[key] : null;
  return {
    reason: key,
    title: entry?.title || `the automation stopped with reason \`${key}\``,
    detail: entry?.detail || 'No further automatic progress is possible in this state.',
    nextSteps: entry?.nextSteps || ['Review the working session log, resolve the reported condition, and re-run the command.'],
    canComment: entry?.canComment !== false,
    known,
  };
};

const bulletList = lines => (lines || []).filter(Boolean).map(line => `- ${line}`).join('\n');

/**
 * Build the "automation stopped" comment body.
 *
 * @param {Object} options
 * @param {string} options.reason internal stop reason
 * @param {string} [options.mode] which loop stopped
 * @param {string} [options.message] concrete message from the detector
 * @param {string[]} [options.details] extra evidence lines
 * @returns {string} markdown comment body
 */
export const buildAutomationStopComment = ({ reason, mode = null, message = null, details = [] }) => {
  const description = describeStopReason(reason);
  const modeLabel = MODE_LABELS[mode] || (mode ? `\`${mode}\`` : 'This automation');
  const sections = [`## 🛑 ${AUTOMATION_STOPPED_MARKER}: ${description.title}`, '', `${modeLabel} stopped working on this pull request.`, '', `**Reason code:** \`${description.reason}\``];

  if (message) {
    sections.push('', `**What happened:** ${message}`);
  }
  sections.push('', description.detail);

  const evidence = (details || []).filter(Boolean);
  if (evidence.length > 0) {
    sections.push('', '**Details:**', bulletList(evidence));
  }

  sections.push('', '**What to do next:**', bulletList(description.nextSteps));
  sections.push('', '---', `*Reported automatically by hive-mind (${mode || 'automation'}).*`);

  return sections.join('\n');
};

/**
 * Build the comment posted when the pull request is ready but `--auto-merge`
 * is blocked by the state of the linked issue.
 *
 * Issue #2144: a closed issue must never stop the loop from making the pull
 * request mergeable — it only blocks the *automatic* merge, and then the user
 * is asked to reopen the issue or merge manually.
 *
 * @param {Object} options
 * @param {Array<{reason: string, message: string, resolution?: string, details?: string[]}>} options.blockers
 * @param {number|string|null} [options.issueNumber]
 * @returns {string} markdown comment body
 */
export const buildAutoMergeBlockedComment = ({ blockers = [], issueNumber = null }) => {
  const reasons = blockers.filter(Boolean);
  const sections = [`## ⚠️ ${AUTO_MERGE_BLOCKED_MARKER}: this pull request is ready, but it was not merged automatically`, '', 'All merge requirements are satisfied — CI passed, there are no conflicts, and there are no pending changes.', '', 'Auto-merge (`--auto-merge`) was requested but is being held back:'];

  for (const blocker of reasons) {
    sections.push('', `- **${blocker.message}** (\`${blocker.reason}\`)`);
    for (const detail of blocker.details || []) {
      sections.push(`  - ${detail}`);
    }
    if (blocker.resolution) {
      sections.push(`  - ➡️ ${blocker.resolution}`);
    }
  }

  sections.push('', '**What to do next:**');
  sections.push(bulletList([issueNumber ? `Reopen issue #${issueNumber} and re-run the command so auto-merge can complete.` : 'Reopen the linked issue and re-run the command so auto-merge can complete.', 'Or merge this pull request manually — it is ready.']));
  sections.push('', '---', '*Reported automatically by hive-mind with the --auto-merge flag.*');

  return sections.join('\n');
};

/**
 * Post a stop report to the pull request (or issue), deduplicated per reason.
 *
 * Never throws: a failed comment must not mask the stop itself.
 *
 * @param {Object} options
 * @param {Function} options.$ command-stream tagged template
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {number|string} options.targetNumber pull request (or issue) number
 * @param {string} options.reason
 * @param {string} [options.mode]
 * @param {string} [options.message]
 * @param {string[]} [options.details]
 * @param {boolean} [options.verbose]
 * @param {Function} [options.log]
 * @param {string} [options.body] pre-built body (skips buildAutomationStopComment)
 * @param {string} [options.signature] pre-built dedup signature
 * @returns {Promise<{posted: boolean, reason: string, skipped?: string, error?: string}>}
 */
export const reportAutomationStop = async ({ $, owner, repo, targetNumber, reason, mode = null, message = null, details = [], verbose = false, log = null, body = null, signature = null }) => {
  const description = describeStopReason(reason);
  const write = async text => {
    if (typeof log === 'function') await log(text);
  };

  if (!$ || !owner || !repo || !targetNumber) {
    return { posted: false, reason: description.reason, skipped: 'missing_target' };
  }

  if (!description.canComment) {
    await write(`   ℹ️  Not posting a stop comment: ${description.title}`);
    return { posted: false, reason: description.reason, skipped: 'target_unavailable' };
  }

  const commentBody = body || buildAutomationStopComment({ reason, mode, message, details });
  const dedupSignature = signature || `${AUTOMATION_STOPPED_MARKER}: ${description.title}`;

  try {
    const { checkForExistingComment } = await import('./solve.auto-merge-helpers.lib.mjs');
    const alreadyPosted = await checkForExistingComment(owner, repo, targetNumber, dedupSignature, verbose);
    if (alreadyPosted) {
      await write(`   ℹ️  Stop reason already reported on #${targetNumber} (${description.reason})`);
      return { posted: false, reason: description.reason, skipped: 'duplicate' };
    }

    const result = await postTrackedComment({ $, owner, repo, targetNumber, body: commentBody });
    if (!result.ok) {
      await write(`   ⚠️  Could not post stop reason comment: ${result.stderr || 'unknown error'}`);
      return { posted: false, reason: description.reason, error: result.stderr || 'post_failed' };
    }

    await write(`   💬 Posted stop reason to #${targetNumber}: ${description.title}`);
    return { posted: true, reason: description.reason };
  } catch (error) {
    await write(`   ⚠️  Could not post stop reason comment: ${error.message}`);
    return { posted: false, reason: description.reason, error: error.message };
  }
};

export default {
  STOP_REASONS,
  describeStopReason,
  buildAutomationStopComment,
  buildAutoMergeBlockedComment,
  reportAutomationStop,
};
