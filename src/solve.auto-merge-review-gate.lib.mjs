#!/usr/bin/env node
/**
 * Issue #4082: the review gate of the `--auto-restart-until-mergeable` loop.
 *
 * "CI passed, no conflicts, no uncommitted changes" is not enough to announce
 * "✅ Ready to merge". This module adds three checks to that decision:
 *
 *   1. Unresolved review threads (cases 1, 4, 5). A thread seen for the first
 *      time restarts the AI with the finding, whoever wrote it: review bots
 *      such as `chatgpt-codex-connector[bot]` included. A thread the AI already
 *      received but left unresolved holds "Ready to merge" back and is named
 *      in the status comment, instead of buying another restart.
 *   2. Merge-order prerequisites (case 6) declared in the pull request
 *      description or the latest session summary ("merge the companion PR
 *      first", "Depends on owner/repo#12"). Unmet ones replace "Ready to merge"
 *      with "Ready for review — blocked by …".
 *   3. A review window (cases 2, 3). Review apps start on "ready for review"
 *      and on every push, often minutes to an hour after the session ended.
 *      After "Ready to merge" the loop keeps watching for this many minutes, so
 *      a new review, thread or comment restarts the AI instead of waiting for a
 *      human.
 *
 * Every GitHub read here fails open: when the state cannot be read, nothing is
 * held back, because the other merge checks still apply and a broken probe
 * must not stall a ready pull request forever.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4082
 */

import { buildUnresolvedReviewThreadLines, createReviewThreadTracker, fetchUnresolvedReviewThreads, formatThreadsForComment } from './review-threads.lib.mjs';
import { checkMergePrerequisites, formatPrerequisitesForComment } from './merge-prerequisites.lib.mjs';
import { READY_FOR_REVIEW_MARKER } from './tool-comments.lib.mjs';

export const DEFAULT_REVIEW_WINDOW_MINUTES = 120;
export const READY_FOR_REVIEW_BLOCKED_SIGNATURE = `## 🟡 ${READY_FOR_REVIEW_MARKER} — blocked by`;

const pick = (argv, camel, kebab) => argv?.[camel] ?? argv?.[kebab];

/** Non-negative whole minutes; anything else means "no window". */
export const normalizeReviewWindowMinutes = value => {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
};

/**
 * Gate options from argv. The review window defaults to 0 here: the CLI
 * default (`DEFAULT_REVIEW_WINDOW_MINUTES`) comes from solve.config.lib.mjs,
 * so direct callers of the loop keep returning as soon as the PR is ready.
 */
export const resolveReviewGateOptions = argv => ({
  threadsEnabled: pick(argv, 'autoRestartOnUnresolvedReviewThreads', 'auto-restart-on-unresolved-review-threads') ?? true,
  prerequisitesEnabled: pick(argv, 'checkMergePrerequisites', 'check-merge-prerequisites') ?? true,
  reviewWindowMinutes: normalizeReviewWindowMinutes(pick(argv, 'autoRestartUntilMergeableReviewWindowMinutes', 'auto-restart-until-mergeable-review-window-minutes') ?? 0),
});

/** The "Ready for review — blocked by …" comment that replaces "Ready to merge" while holds remain. */
export const buildReadyForReviewBlockedComment = ({ holds, ciLine }) => {
  const sections = holds.map(hold => `**${hold.title}:**\n${hold.items.join('\n')}${hold.resolution ? `\n\n${hold.resolution}` : ''}`);
  const names = holds.map(hold => hold.title.toLowerCase()).join(' and ');
  return `${READY_FOR_REVIEW_BLOCKED_SIGNATURE} ${names}\n\nCI and mergeability checks passed, but this pull request should not be merged yet:\n${ciLine}\n- No merge conflicts\n- No uncommitted changes\n\n${sections.join('\n\n')}`;
};

/**
 * @param {Object} params
 * @param {Function} params.commandRunner - quiet tagged-template runner for GitHub reads
 * @param {Object} params.options - from `resolveReviewGateOptions`
 */
export const createReviewGate = ({ owner, repo, prNumber, issueNumber, commandRunner, options, log = async () => {}, formatAligned = (_icon, label, value) => `${label} ${value}` }) => {
  const tracker = createReviewThreadTracker();
  let readySince = null;

  return {
    options,

    /** Unresolved threads, split into first-seen (`fresh`) and already handed to the AI. */
    async checkThreads() {
      if (!options.threadsEnabled) return { ok: true, all: [], fresh: [], alreadyReported: [] };
      const result = await fetchUnresolvedReviewThreads({ owner, repo, prNumber, commandRunner });
      if (!result.ok) {
        await log(formatAligned('⚠️', 'Review threads:', `could not be read (${result.error}); not holding the pull request back`, 2), { level: 'warning' });
        return { ok: false, all: [], fresh: [], alreadyReported: [] };
      }
      const { fresh, alreadyReported } = tracker.split(result.threads);
      if (result.threads.length > 0) await log(formatAligned('🧵', 'Unresolved review threads:', `${result.threads.length} (${fresh.length} new to the AI)`, 2));
      return { ok: true, all: result.threads, fresh, alreadyReported };
    },

    /** Restart feedback for every unresolved thread; they count as reported from now on. */
    restartFeedback(threads) {
      if (!threads || threads.length === 0) return [];
      tracker.markReported(threads);
      return buildUnresolvedReviewThreadLines(threads);
    },

    /**
     * What still holds "Ready to merge" back once CI is green: threads the AI
     * already saw but left unresolved, and unmet merge prerequisites.
     * Each hold is `{ reason, title, message, resolution, items }`.
     */
    async collectHolds(threadState) {
      const holds = [];
      const leftOpen = threadState?.alreadyReported || [];
      if (leftOpen.length > 0) {
        holds.push({
          reason: 'unresolved_review_threads',
          title: 'Unresolved review threads',
          message: `${leftOpen.length} review thread(s) are still unresolved after the AI was given them.`,
          resolution: 'Fix each finding and resolve its thread, or reply why it does not apply and resolve it. A new comment or review restarts the AI.',
          items: formatThreadsForComment(leftOpen),
        });
      }
      if (options.prerequisitesEnabled) {
        try {
          const result = await checkMergePrerequisites({ owner, repo, prNumber, issueNumber, commandRunner });
          if (result.unresolved.length > 0) {
            await log(formatAligned('🔗', 'Merge prerequisites:', `${result.unresolved.length} declared and not yet met`, 2), { level: 'warning' });
            holds.push({
              reason: 'merge_prerequisite',
              title: 'Merge prerequisites',
              message: `${result.unresolved.length} declared merge prerequisite(s) are not met yet.`,
              resolution: 'Merge or close the prerequisites first (or remove the declaration if it no longer applies), then merge this pull request.',
              items: formatPrerequisitesForComment(result.unresolved),
            });
          }
        } catch (error) {
          await log(formatAligned('⚠️', 'Merge prerequisites:', `could not be checked (${error?.message || error})`, 2), { level: 'warning' });
        }
      }
      return holds;
    },

    /** Holds as auto-merge blockers (`reportAutoMergeBlockedByIssue` format). */
    holdsAsMergeBlockers(holds) {
      return holds.map(hold => ({ reason: hold.reason, message: `${hold.message}\n${hold.items.join('\n')}`, resolution: hold.resolution }));
    },

    /**
     * Called each time the pull request is found ready. Returns how long the
     * loop should keep watching for late reviews, or `null` to stop now.
     */
    reviewWindow(now = Date.now()) {
      if (options.reviewWindowMinutes <= 0) return null;
      if (readySince === null) readySince = now;
      const remainingMs = readySince + options.reviewWindowMinutes * 60_000 - now;
      return remainingMs > 0 ? { remainingMs, remainingMinutes: Math.ceil(remainingMs / 60_000) } : null;
    },

    /** A restart or a new commit starts a new review window once the pull request is ready again. */
    resetReviewWindow() {
      readySince = null;
    },
  };
};

export default {
  DEFAULT_REVIEW_WINDOW_MINUTES,
  READY_FOR_REVIEW_BLOCKED_SIGNATURE,
  normalizeReviewWindowMinutes,
  resolveReviewGateOptions,
  buildReadyForReviewBlockedComment,
  createReviewGate,
};
