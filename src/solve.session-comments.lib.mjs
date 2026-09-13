#!/usr/bin/env node

/**
 * The two comment operations a working session performs on its own pull request:
 * reading back whether the AI tool published anything, and saying out loud when
 * the session produced nothing.
 *
 * Both lived in `src/solve.results.lib.mjs` until issue #2247 pushed that file
 * over the 1350-line early-warning threshold of
 * `scripts/check-file-line-limits.sh` (issue #1593, enforced by
 * tests/extracted-modules-2198.test.mjs). Extracting them follows the #2198
 * precedent and has the same side benefit: neither function closes over its
 * former module's private `$`/`log` bindings any more, so both are reachable
 * from a test without starting a solver session.
 *
 * @module solve.session-comments
 */

import { quietProbe } from './quiet-probe.lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { isToolGeneratedComment, isToolTrackedCommentId, NO_CHANGES_PRODUCED_MARKER, postTrackedComment, TOOL_GENERATED_COMMENT_MARKERS } from './tool-comments.lib.mjs';

const noopLog = async () => {};

/**
 * Check if new comments were created by the AI during the session.
 * This is used by --auto-attach-solution-summary to determine if the AI
 * already provided feedback.
 *
 * Issue #1263: Support for --attach-solution-summary and --auto-attach-solution-summary
 * Issue #1625: Filter out comments produced by solve.mjs itself (session start,
 * log upload, auto-restart, etc.) so they do not falsely count as AI-authored.
 *
 * @param {Object} options
 * @param {Date} options.sessionStartTime - The timestamp when this solve work session started
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.prNumber - Pull request number (null if working on issue only)
 * @param {number} options.issueNumber - Issue number
 * @param {Function} options.$ - command-stream helper
 * @param {Function} [options.log]
 * @returns {Promise<boolean>} - True if AI created comments during the session
 */
export const checkForAiCreatedComments = async ({ sessionStartTime, owner, repo, prNumber, issueNumber, $, log = noopLog }) => {
  const probe = quietProbe($);
  try {
    // Get the current user's GitHub username
    const userResult = await probe`gh api user --jq .login`;
    if (userResult.code !== 0) {
      return false; // Cannot determine, default to not attaching
    }
    const currentUser = userResult.stdout.toString().trim();
    if (!currentUser) {
      return false;
    }

    await log(`🔎 Checking comments by '${currentUser}' after session start ${sessionStartTime.toISOString()} (PR #${prNumber ?? 'none'}, issue #${issueNumber ?? 'none'})`, { verbose: true });
    // Issue #1625: A comment counts as an "AI comment" only if it was posted
    // by the current user AFTER sessionStartTime AND solve.mjs did NOT post it
    // itself. We identify tool-posted comments in two ways, in order:
    //   1. Primary: comment ID is in the in-memory tracked set populated by
    //      every solve.mjs posting site (postTrackedComment / trackToolCommentId).
    //      This is robust to comment-body changes.
    //   2. Fallback: comment body matches a known TOOL_GENERATED_COMMENT_MARKERS
    //      marker. This catches comments whose IDs weren't captured — for
    //      example, on resumed sessions where the posting happened in an
    //      earlier process, or legacy code paths that predate tracking.
    // Review-type inline comments cannot be posted by solve.mjs, so they are
    // treated as AI-authored by default.
    const filterNewAiComments = (comments, kind) => {
      const filtered = [];
      const skippedCounts = {};
      const skippedByIdCount = { n: 0 };
      for (const comment of comments) {
        if (!comment || !comment.user || comment.user.login !== currentUser) continue;
        if (!(new Date(comment.created_at) > sessionStartTime)) continue;
        const isReview = kind === 'review';
        if (!isReview) {
          if (isToolTrackedCommentId(comment.id)) {
            skippedByIdCount.n += 1;
            continue;
          }
          if (isToolGeneratedComment(comment.body)) {
            const markerMatch = TOOL_GENERATED_COMMENT_MARKERS.find(m => (comment.body || '').includes(m)) || 'unknown';
            skippedCounts[markerMatch] = (skippedCounts[markerMatch] || 0) + 1;
            continue;
          }
        }
        filtered.push(comment);
      }
      if (skippedByIdCount.n > 0) {
        log(`   ⏭️  Skipped ${kind} tool-tracked comment IDs: ${skippedByIdCount.n}`, { verbose: true }).catch(() => {});
      }
      if (Object.keys(skippedCounts).length > 0) {
        const summary = Object.entries(skippedCounts)
          .map(([m, c]) => `${m}=${c}`)
          .join(', ');
        log(`   ⏭️  Skipped ${kind} tool-generated comments (marker fallback): ${summary}`, { verbose: true }).catch(() => {});
      }
      return filtered;
    };

    // Check comments on the PR first (if we have a PR)
    if (prNumber) {
      // Check PR conversation comments
      const prCommentsResult = await probe`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`;
      if (prCommentsResult.code === 0) {
        const prComments = JSON.parse(prCommentsResult.stdout.toString().trim() || '[]');
        const newPrComments = filterNewAiComments(prComments, 'pr');
        await log(`   📨 PR conversation comments after session start by '${currentUser}' (excluding tool-generated): ${newPrComments.length}`, { verbose: true });
        if (newPrComments.length > 0) {
          return true;
        }
      }
      // Check PR review comments (inline code comments)
      const reviewCommentsResult = await probe`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`;
      if (reviewCommentsResult.code === 0) {
        const reviewComments = JSON.parse(reviewCommentsResult.stdout.toString().trim() || '[]');
        const newReviewComments = filterNewAiComments(reviewComments, 'review');
        await log(`   📝 PR review (inline) comments after session start by '${currentUser}': ${newReviewComments.length}`, { verbose: true });
        if (newReviewComments.length > 0) {
          return true;
        }
      }
    }

    // Check issue comments (if different from PR number or no PR)
    if (issueNumber && issueNumber !== prNumber) {
      const issueCommentsResult = await probe`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --paginate`;
      if (issueCommentsResult.code === 0) {
        const issueComments = JSON.parse(issueCommentsResult.stdout.toString().trim() || '[]');
        const newIssueComments = filterNewAiComments(issueComments, 'issue');
        await log(`   📨 Issue comments after session start by '${currentUser}' (excluding tool-generated): ${newIssueComments.length}`, { verbose: true });
        if (newIssueComments.length > 0) {
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    // On error, default to not attaching (safer choice)
    await log(`⚠️  Could not check for AI comments: ${error.message}`, { verbose: true });
    return false;
  }
};

/**
 * Issue #2247 (H2): say out loud that the session produced nothing.
 *
 * A pull request left in draft with no explanation looks like a crashed run. The
 * comment states the measured diff and what the reader is expected to do, so the
 * draft status is a reported decision rather than a symptom.
 *
 * @param {Object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {number|string} options.prNumber
 * @param {Object|null} [options.changeStats] - from `getPullRequestChangeStats`
 * @param {Function} options.$
 * @param {Function} [options.log]
 * @returns {Promise<boolean>} true when the comment was posted
 */
export const postNoChangesProducedComment = async ({ owner, repo, prNumber, changeStats = null, $: command, log: logger = noopLog }) => {
  const body = `⚠️ **${NO_CHANGES_PRODUCED_MARKER}**

The pull request still has an empty diff against its base branch${changeStats && changeStats.placeholderOnly ? ' (only the solver placeholder file is present)' : ''}, so it stays a draft instead of being marked ready for review.

Nothing was implemented, committed or pushed during this working session. Review the session log above for why, then re-run the solver or continue manually.`;

  try {
    const { ok, commentId, stderr } = await postTrackedComment({ $: command, owner, repo, targetNumber: prNumber, body });
    if (ok) {
      await logger(`  💬 Posted: ${NO_CHANGES_PRODUCED_MARKER} comment${commentId ? ` (id=${commentId})` : ''}`);
      return true;
    }
    await logger(`  ⚠️  Could not post the empty-diff notice: ${stderr || 'unknown error'}`, { level: 'warning' });
    return false;
  } catch (error) {
    reportError(error, { context: 'post_no_changes_comment', owner, repo, prNumber, operation: 'create_pr_comment' });
    await logger(`  ⚠️  Could not post the empty-diff notice: ${error.message}`, { level: 'warning' });
    return false;
  }
};

export default {
  checkForAiCreatedComments,
  postNoChangesProducedComment,
};
