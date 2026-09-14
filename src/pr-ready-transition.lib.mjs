/**
 * The one transition that turns "hive-mind thinks this pull request is mergeable" into
 * "this pull request is out of draft and the user may merge it".
 *
 * Issue #2246: in a mergeable mode the pull request is deliberately kept in draft while
 * hive-mind works (see the ready hold in pr-draft-state.lib.mjs), so the monitoring loop
 * evaluates mergeability with `ignoreDraft`. That option has a blind spot: GitHub answers
 * `mergeStateStatus: 'DRAFT'` for a draft pull request and hides BLOCKED / BEHIND /
 * UNSTABLE behind it. So the moment the loop believes the ready-to-merge state is
 * reached, the pull request leaves draft first, and the state is re-verified strictly on
 * the now-real pull request. If that strict check disagrees, the pull request goes back
 * into draft and the loop keeps working — bounded by MAX_READY_FOR_REVIEW_RECHECKS so a
 * disagreement can never become a draft/ready flapping loop.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2246
 */

import { ensurePullRequestIsDraft, ensurePullRequestIsReady, holdReadyForReview, isReadyForReviewHeld, releaseReadyForReviewHold } from './pr-draft-state.lib.mjs';
import { checkPRMergeable } from './github-merge.lib.mjs';
import { isMergeableModeActive, describeReadinessMode } from './pr-readiness-policy.lib.mjs';
import { checkForExistingComment } from './solve.auto-merge-helpers.lib.mjs';
import { READY_TO_MERGE_MARKER, postTrackedComment } from './tool-comments.lib.mjs';

/** How many times a pull request may be pushed back into draft by the strict re-check. */
export const MAX_READY_FOR_REVIEW_RECHECKS = 3;

/**
 * Take the pull request out of draft because the ready-to-merge state was reached, then
 * verify that state once more without the draft masking it.
 *
 * A no-op that reports success when the ready hold is not engaged: the pull request is
 * already out of draft, and the caller's own checks were performed on the real state.
 *
 * @param {Object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {number|string} options.prNumber
 * @param {boolean} [options.verbose=false]
 * @param {Function} options.$ - Tagged-template command runner
 * @param {Function} options.log
 * @param {Function} options.formatAligned
 * @param {Function} [options.reportError]
 * @param {Object} [options.guardState={}] - Per-loop state; carries the re-check counter
 * @param {Object} [options.deps] - Injection points for tests
 * @returns {Promise<{confirmed: boolean, leftDraft: boolean, reason: string|null}>}
 *   `confirmed: false` means the caller must keep monitoring instead of merging.
 */
export const confirmReadyToMergeState = async ({ owner, repo, prNumber, verbose = false, $, log, formatAligned, reportError, guardState = {}, deps = {} }) => {
  const { isHeld = isReadyForReviewHeld, release = releaseReadyForReviewHold, hold = holdReadyForReview, markReady = ensurePullRequestIsReady, markDraft = ensurePullRequestIsDraft, checkMergeable = checkPRMergeable } = deps;

  if (!isHeld()) {
    return { confirmed: true, leftDraft: false, reason: null };
  }

  release();
  const ready = await markReady({ owner, repo, prNumber, $, log, formatAligned, reason: 'ready-to-merge state reached', reportError, ignoreReadyHold: true });
  const stayedDraftOnPurpose = ready?.reason === 'left_in_draft_on_purpose' || ready?.reason === 'no_changes';
  if (ready?.ok === false || stayedDraftOnPurpose) {
    const reason = ready.error || ready.reason || 'could not take the pull request out of draft';
    hold({ reason: 'ready-for-review transition was not completed' });
    await log(formatAligned('⚠️', 'Could not leave draft:', reason, 2), { level: 'warning' });
    return { confirmed: false, leftDraft: false, reason };
  }

  const recheck = await checkMergeable(owner, repo, prNumber, verbose);
  if (recheck.mergeable) {
    return { confirmed: true, leftDraft: true, reason: null };
  }

  const reason = recheck.reason || 'unknown reason';
  guardState.readyRecheckFailures = (guardState.readyRecheckFailures || 0) + 1;
  await log(formatAligned('⚠️', 'Not mergeable after leaving draft:', reason, 2), { level: 'warning' });

  if (guardState.readyRecheckFailures >= MAX_READY_FOR_REVIEW_RECHECKS) {
    // The pull request keeps disagreeing with itself. Leaving it ready for review is the
    // honest outcome: the state is visible to the user, and the loop stops re-drafting it.
    await log(formatAligned('', 'Draft policy:', `giving up after ${MAX_READY_FOR_REVIEW_RECHECKS} re-checks - leaving the pull request ready for review`, 2), { level: 'warning' });
    return { confirmed: false, leftDraft: true, reason };
  }

  hold({ reason: 'ready-to-merge state was not confirmed once the pull request left draft' });
  await markDraft({ owner, repo, prNumber, $, log, formatAligned, reason: 'ready-to-merge state not confirmed', reportError });
  return { confirmed: false, leftDraft: false, reason };
};

/**
 * Compose the `Ready to merge` comment body — the one signal a human is asked to wait for.
 *
 * @param {Object} options
 * @param {boolean} [options.noCiConfigured] - Repository has no CI/CD workflows at all
 * @param {boolean} [options.noCiTriggered] - Workflows exist but none ran for this commit
 * @param {string} [options.workflowRunConclusions] - Summary of the conclusions, when they did run
 * @param {Array<{message: string, resolution?: string}>} [options.issueMergeBlockers=[]]
 * @param {boolean} [options.leftDraft=false] - hive-mind took the PR out of draft for this state
 * @returns {string} Markdown body
 */
export const buildReadyToMergeComment = ({ noCiConfigured, noCiTriggered, workflowRunConclusions, issueMergeBlockers = [], leftDraft = false }) => {
  // Issue #1345: Differentiate message when no CI is configured
  const ciLine = noCiConfigured ? '- No CI/CD checks are configured for this repository' : noCiTriggered ? (workflowRunConclusions ? `- CI workflows completed without executing (${workflowRunConclusions})` : '- CI workflows exist but were not triggered for this commit') : '- All CI checks have passed';
  // Issue #2246: state the draft transition in the same comment, so the reader knows that
  // "ready for review" and "ready to merge" mean the same thing here, and that waiting for
  // this comment was the right call.
  const draftLine = leftDraft ? '\n- Taken out of draft by hive-mind now that this state is verified' : '';
  // Issue #2144: a closed/unavailable linked issue does not stop this mode, but it is worth
  // stating in the comment so the reader knows why no automatic merge will follow.
  const issueLine =
    issueMergeBlockers.length > 0
      ? `\n\nNote: ${issueMergeBlockers.map(b => b.message).join(' ')} ${issueMergeBlockers
          .map(b => b.resolution)
          .filter(Boolean)
          .join(' ')}`
      : '';
  return `## ✅ ${READY_TO_MERGE_MARKER}\n\nThis pull request is now ready to be merged:\n${ciLine}\n- No merge conflicts\n- No pending changes${draftLine}${issueLine}\n\n---\n*Monitored by hive-mind with --auto-restart-until-mergeable flag*`;
};

/**
 * Post the `Ready to merge` comment, once.
 *
 * Issue #1371 / #1567: two layers of deduplication — the caller's per-process flag, and a
 * search of the pull request's comments so two concurrent watch loops cannot both announce
 * the same state. Never throws: failing to post a comment must not fail the run.
 *
 * @param {Object} options - buildReadyToMergeComment() options, plus the ones below
 * @param {boolean} [options.alreadyPosted=false] - The caller's per-process flag
 * @returns {Promise<boolean>} The new value of the caller's per-process flag
 */
export const announceReadyToMerge = async ({ owner, repo, prNumber, $, log, formatAligned, verbose = false, alreadyPosted = false, ...comment }) => {
  try {
    if (alreadyPosted) {
      await log(formatAligned('', `Skipping duplicate "${READY_TO_MERGE_MARKER}" comment (already posted this session)`, '', 2));
      return true;
    }
    if (await checkForExistingComment(owner, repo, prNumber, `## ✅ ${READY_TO_MERGE_MARKER}`, verbose)) {
      await log(formatAligned('', `Skipping duplicate "${READY_TO_MERGE_MARKER}" comment (already posted by another process)`, '', 2));
      return true;
    }
    // Issue #1625: Track this comment ID so it can't falsely count as an AI-authored comment
    await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: buildReadyToMergeComment(comment) });
    return true;
  } catch {
    // Don't fail if comment posting fails
    return alreadyPosted;
  }
};

/**
 * End of an AI working session: mark the pull request ready for review (issue #2182), but
 * in a mergeable mode engage the hold first, so the ready transition is deferred to
 * confirmReadyToMergeState() and the pull request stays a draft while hive-mind works.
 *
 * "The AI working session is over" is not "the work is over" when hive-mind keeps
 * restarting the AI until the pull request is mergeable.
 */
export const endAiSessionReadyTransition = async ({ owner, repo, prNumber, argv, $, log, formatAligned, reportError }) => {
  if (isMergeableModeActive(argv)) {
    const readiness = describeReadinessMode(argv);
    holdReadyForReview({ reason: `${readiness.flag}: hive-mind is still making the pull request mergeable` });
    await log(formatAligned('⏸️', 'PR stays draft:', `${readiness.flag} - until the ready-to-merge state is verified`, 2));
  }
  await ensurePullRequestIsReady({ owner, repo, prNumber, $, log, formatAligned, reason: 'AI working session finished', reportError });
};

/**
 * End of the run, whatever the outcome (mergeable, timed out, stopped or skipped):
 * hive-mind is no longer working on this pull request, so the hold must go and the pull
 * request must not be left as a draft — issue #2182's invariant. The safety net for every
 * way out of the monitoring loop that did not already publish the ready state itself.
 */
export const releaseReadyTransitionHold = async ({ owner, repo, prNumber, $, log, formatAligned, reportError }) => {
  if (!releaseReadyForReviewHold()) {
    return false;
  }
  await ensurePullRequestIsReady({ owner, repo, prNumber, $, log, formatAligned, reason: 'hive-mind finished working on the pull request', reportError, ignoreReadyHold: true });
  return true;
};

export default { MAX_READY_FOR_REVIEW_RECHECKS, announceReadyToMerge, buildReadyToMergeComment, confirmReadyToMergeState, endAiSessionReadyTransition, releaseReadyTransitionHold };
