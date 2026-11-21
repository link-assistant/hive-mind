#!/usr/bin/env node
/**
 * Issue #4082: the review gate of the `--auto-restart-until-mergeable` loop.
 *
 * "CI passed, no conflicts, no uncommitted changes" is not enough to announce
 * "✅ Ready to merge". This module adds four checks to that decision:
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
 *   3. An optional review window (issues #4082 and #4106). It gives new reviews,
 *      threads and comments time to arrive before the final readiness comment.
 *   4. Review apps (issue #4081). While a review app from `--review-bots`
 *      (Codex connector, CodeRabbit, …) is still reviewing the head commit,
 *      the loop waits up to `--review-bots-wait-minutes` before announcing
 *      "Ready to merge" or merging. When the app's own summary reports
 *      unresolved findings, the AI is restarted with them; findings the AI
 *      already received hold "Ready to merge" back and are named.
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
import { REVIEW_BOTS_START_GRACE_MINUTES, buildReviewBotFindingLines, createReviewBotFindingsTracker, createReviewBotMatcher, evaluateReviewBotActivity, fetchReviewBotActivity, formatReviewBotFindingsForComment, parseReviewBotsOption } from './review-bots.lib.mjs';

export const DEFAULT_REVIEW_WINDOW_MINUTES = 0;
export const READY_FOR_REVIEW_BLOCKED_SIGNATURE = `## 🟡 ${READY_FOR_REVIEW_MARKER} — blocked by`;

const pick = (argv, camel, kebab) => argv?.[camel] ?? argv?.[kebab];

/** Non-negative whole minutes; anything else means "no window". */
export const normalizeReviewWindowMinutes = value => {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
};

/**
 * Gate options from argv. Direct callers wait for review apps only when they
 * supply a duration. The CLI sets its own review-app default.
 */
export const resolveReviewGateOptions = argv => ({
  threadsEnabled: pick(argv, 'autoRestartOnUnresolvedReviewThreads', 'auto-restart-on-unresolved-review-threads') ?? true,
  prerequisitesEnabled: pick(argv, 'checkMergePrerequisites', 'check-merge-prerequisites') ?? true,
  reviewWindowMinutes: normalizeReviewWindowMinutes(pick(argv, 'autoRestartUntilMergeableReviewWindowMinutes', 'auto-restart-until-mergeable-review-window-minutes') ?? DEFAULT_REVIEW_WINDOW_MINUTES),
  reviewBots: parseReviewBotsOption(pick(argv, 'reviewBots', 'review-bots')),
  reviewBotsWaitMinutes: normalizeReviewWindowMinutes(pick(argv, 'reviewBotsWaitMinutes', 'review-bots-wait-minutes') ?? 0),
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
  const botFindingsTracker = createReviewBotFindingsTracker();
  const reviewBots = options.reviewBots || [];
  const isReviewBot = createReviewBotMatcher(reviewBots);
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
     * Issue #4081: what review apps say about the head commit.
     * `pending` lists apps still reviewing it (wait `remainingMs` before
     * "Ready to merge"); `fresh` are findings the AI has not received yet,
     * `alreadyReported` are findings it received and did not clear.
     */
    async checkReviewBots(now = Date.now()) {
      const none = { ok: true, pending: [], remainingMs: 0, findings: [], fresh: [], alreadyReported: [], timedOut: [] };
      if (reviewBots.length === 0) return none;
      const result = await fetchReviewBotActivity({ owner, repo, prNumber, commandRunner });
      if (!result.ok) {
        await log(formatAligned('⚠️', 'Review bots:', `activity could not be read (${result.error}); not waiting for them`, 2), { level: 'warning' });
        return { ...none, ok: false };
      }
      const waitMinutes = options.reviewBotsWaitMinutes || 0;
      const evaluation = evaluateReviewBotActivity({ activity: result.activity, isReviewBot, now, waitMinutes, startGraceMinutes: Math.min(REVIEW_BOTS_START_GRACE_MINUTES, waitMinutes) });
      const { fresh, alreadyReported } = botFindingsTracker.split(evaluation.findings);
      if (evaluation.findings.length > 0) await log(formatAligned('🤖', 'Review bot findings:', `${evaluation.findings.length} summary(ies) report unresolved findings (${fresh.length} new to the AI)`, 2));
      if (evaluation.timedOut.length > 0) await log(formatAligned('⏱️', 'Review bots:', `${evaluation.timedOut.join(', ')} still reviewing after ${waitMinutes} min; not waiting longer`, 2), { level: 'warning' });
      return { ok: true, ...evaluation, fresh, alreadyReported };
    },

    /** Start-up description of the review apps the loop waits for. */
    describeReviewBots() {
      if (reviewBots.length === 0) return 'none (--review-bots none)';
      return `${reviewBots.join(', ')} (wait up to ${options.reviewBotsWaitMinutes || 0} minute(s) for their review of the head commit)`;
    },

    /**
     * Issue #4081: how long to sleep while review apps are still reviewing the
     * head commit (never past their deadline, never below `minSeconds`).
     * `null` when nothing is pending.
     */
    reviewBotsWait(botState, backoffSeconds, minSeconds) {
      if (!botState?.pending?.length) return null;
      const seconds = Math.max(minSeconds, Math.min(backoffSeconds, Math.ceil(botState.remainingMs / 1000)));
      return { seconds, detail: `${botState.pending.map(bot => `${bot.login} (${bot.reason})`).join(', ')}; up to ${Math.ceil(botState.remainingMs / 60_000)} more minute(s)` };
    },

    /** Restart reasons for review threads (#4082) and review-app findings (#4081) the AI has not received yet. */
    restartReasons(threadState, botState) {
      const reasons = [];
      const fresh = threadState?.fresh || [];
      if (fresh.length > 0) reasons.push(`${fresh.length} unresolved review thread(s) from ${[...new Set(fresh.map(thread => thread.author))].join(', ')}`);
      const findings = botState?.fresh || [];
      if (findings.length > 0) reasons.push(`review bot finding(s) from ${[...new Set(findings.map(finding => finding.login))].join(', ')}`);
      return reasons;
    },

    /**
     * Restart feedback for review-app findings; they count as reported from now
     * on. Findings whose comment is already in the new-comment feedback
     * (`skipCommentIds`) are not repeated.
     */
    restartReviewBotFeedback(findings, skipCommentIds = []) {
      if (!findings || findings.length === 0) return [];
      botFindingsTracker.markReported(findings);
      const skip = new Set((skipCommentIds || []).map(String));
      return buildReviewBotFindingLines(findings.filter(finding => !skip.has(String(finding.id).split('@')[0])));
    },

    /**
     * What still holds "Ready to merge" back once CI is green: threads the AI
     * already saw but left unresolved, review-app findings it already received
     * (issue #4081), and unmet merge prerequisites.
     * Each hold is `{ reason, title, message, resolution, items }`.
     */
    async collectHolds(threadState, botState = null) {
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
      const botFindingsLeft = botState?.alreadyReported || [];
      if (botFindingsLeft.length > 0) {
        holds.push({
          reason: 'review_bot_findings',
          title: 'Review bot findings',
          message: `${botFindingsLeft.length} review bot summary(ies) still report unresolved findings for the head commit after the AI was given them.`,
          resolution: 'Address each finding (fix it, or reply with evidence why it does not apply) and push, so the review bot reviews the new head commit. A new comment or review restarts the AI.',
          items: formatReviewBotFindingsForComment(botFindingsLeft),
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
     * Called once CI and review apps are clear. Returns how long to watch for
     * late reviews before the final readiness decision.
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
