#!/usr/bin/env node
/**
 * The status comment `watchUntilMergeable` posts once the pull request is
 * ready (without `--auto-merge`): "✅ Ready to merge", or, when the review gate
 * holds it back, "🟡 Ready for review — blocked by …" (issue #4082, case 6).
 *
 * Two layers of deduplication:
 *   1. `state` (in memory, per watch loop): issue #1371. The loop resets it when
 *      the head SHA changes, so a new commit gets a fresh comment.
 *   2. `checkForExistingComment` on the PR history: issue #1567. It catches a
 *      second, concurrent watch loop that found the PR ready at the same time.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4082
 */

import { READY_TO_MERGE_MARKER } from './tool-comments.lib.mjs';
import { READY_FOR_REVIEW_BLOCKED_SIGNATURE, buildReadyForReviewBlockedComment } from './solve.auto-merge-review-gate.lib.mjs';

/** Issue #1345: the CI line differs when no CI is configured or none ran. */
export const buildReadyCiLine = ({ noCiConfigured, noCiTriggered, workflowRunConclusions }) => (noCiConfigured ? '- No CI/CD checks are configured for this repository' : noCiTriggered ? (workflowRunConclusions ? `- CI workflows completed without executing (${workflowRunConclusions})` : '- CI workflows exist but were not triggered for this commit') : '- All CI checks have passed');

/** A fresh dedup state; the watch loop resets it in place when the head SHA changes. */
export const createReadyCommentState = () => ({ readyToMergeCommentPosted: false, blockedCommentKey: null });
export const resetReadyCommentState = state => Object.assign(state, createReadyCommentState());

/**
 * Posts the final ready status comment once per state and returns the outcome.
 *
 * @returns {Promise<'blocked'|'ready'|'skipped'|'failed'>}
 */
export const postReadyStatusComment = async ({ $, owner, repo, prNumber, holds = [], ciLine, issueMergeBlockers = [], state, verbose = false, log, formatAligned, checkForExistingComment, postTrackedComment }) => {
  try {
    const holdsKey = holds.length > 0 ? JSON.stringify(holds.map(h => h.items)) : null;
    if (holdsKey) {
      // Issue #4082 (case 6): "Ready for review — blocked by …" instead of "Ready to merge",
      // posted again only when the holds change.
      if (holdsKey === state.blockedCommentKey) return 'skipped';
      const alreadyPosted = state.blockedCommentKey === null && (await checkForExistingComment(owner, repo, prNumber, READY_FOR_REVIEW_BLOCKED_SIGNATURE, verbose));
      if (!alreadyPosted) {
        const result = await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: buildReadyForReviewBlockedComment({ holds, ciLine }) });
        if (result?.ok === false) return 'failed';
      }
      state.blockedCommentKey = holdsKey;
      return alreadyPosted ? 'skipped' : 'blocked';
    }
    if (state.readyToMergeCommentPosted) {
      await log(formatAligned('', `Skipping duplicate "${READY_TO_MERGE_MARKER}" comment (already posted this session)`, '', 2));
      return 'skipped';
    }
    if (await checkForExistingComment(owner, repo, prNumber, `## ✅ ${READY_TO_MERGE_MARKER}`, verbose)) {
      await log(formatAligned('', `Skipping duplicate "${READY_TO_MERGE_MARKER}" comment (already posted by another process)`, '', 2));
      state.readyToMergeCommentPosted = true;
      return 'skipped';
    }
    // Issue #2144: a closed/unavailable linked issue does not stop this mode, but the
    // comment states it so the reader knows why no automatic merge will follow.
    const issueLine =
      issueMergeBlockers.length > 0
        ? `\n\nNote: ${issueMergeBlockers.map(b => b.message).join(' ')} ${issueMergeBlockers
            .map(b => b.resolution)
            .filter(Boolean)
            .join(' ')}`
        : '';
    // Issue #2492: "uncommitted" is what was checked, and the comment states checked facts only.
    const body = `## ✅ ${READY_TO_MERGE_MARKER}\n\nThis pull request is now ready to be merged:\n${ciLine}\n- No merge conflicts\n- No uncommitted changes${issueLine}`;
    // Issue #1625: a tracked comment cannot count as an AI-authored comment.
    const result = await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body });
    if (result?.ok === false) return 'failed';
    state.readyToMergeCommentPosted = true;
    return 'ready';
  } catch {
    return 'failed';
  }
};

export default { buildReadyCiLine, createReadyCommentState, resetReadyCommentState, postReadyStatusComment };
