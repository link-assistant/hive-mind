/**
 * Guard rails for the --auto-merge / --auto-restart-until-mergeable watch loop.
 *
 * Issue #2182: a single task stayed in the "Processing" state for 4d 12h 13m 35s
 * because the watch loop had no answer for a pull request it could never merge:
 * no wall-clock ceiling, no classification of the merge failure and no reaction to
 * a pull request left in draft. Those three decisions live here so that
 * `watchUntilMergeable()` only keeps the control flow (`continue` / `return`) and
 * the loop state.
 *
 * These are *defense in depth*. The root cause of #2182 is that hive-mind did not
 * put the pull request back to "ready for review" when the working session ended;
 * that is fixed in pr-draft-state.lib.mjs and its callers. The guards below make
 * sure that a pull request which is a draft anyway - for instance because a human
 * drafted it, or because the process was SIGKILLed before the safety nets ran -
 * costs a few seconds instead of several days.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2182
 */

const { classifyMergeError, MAX_CONSECUTIVE_MERGE_FAILURES } = await import('./merge-error-classification.lib.mjs');
const { ensurePullRequestIsReady } = await import('./pr-draft-state.lib.mjs');

export { MAX_CONSECUTIVE_MERGE_FAILURES };

/**
 * How long to wait after restoring "ready for review" before the next
 * mergeability check. Short on purpose: nothing is running, we only need GitHub
 * to reflect the new state.
 */
export const DRAFT_RECHECK_DELAY_MS = 5000;

/** Default wall-clock ceiling for the auto-restart-until-mergeable loop. */
export const DEFAULT_WATCH_TIMEOUT_HOURS = 24;

/** How many times the loop may restore "ready for review" before giving up. */
export const MAX_DRAFT_SELF_HEALS = 3;

/**
 * Normalize the `--auto-restart-until-mergeable-timeout-hours` value. `0` (and
 * any negative input) means "no wall-clock limit"; when the flag is absent the
 * default keeps a run from silently occupying a queue slot for days, as happened
 * in the reported 4d 12h run.
 *
 * @param {number|string|null|undefined} raw
 * @returns {number} hours, 0 = unlimited
 */
export const normalizeWatchTimeoutHours = raw => {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_WATCH_TIMEOUT_HOURS;
  const parsed = Number(raw);
  // A non-numeric value is a typo, not a request for an unlimited run: fall back
  // to the default instead of silently disabling the timeout again (issue #2182).
  if (!Number.isFinite(parsed)) return DEFAULT_WATCH_TIMEOUT_HOURS;
  if (parsed <= 0) return 0;
  return parsed;
};

/**
 * Decide whether the watch loop has exceeded its wall-clock ceiling.
 *
 * @returns {{message: string, details: string[]}|null} null while within budget
 */
export const evaluateWatchTimeout = ({ watchTimeoutHours, watchStartedAt, now, checksCompleted }) => {
  if (!(watchTimeoutHours > 0)) return null;
  const elapsedHours = (now - watchStartedAt) / 3600000;
  if (elapsedHours < watchTimeoutHours) return null;
  return {
    message: `Auto-restart-until-mergeable stopped after ${elapsedHours.toFixed(1)}h (limit: ${watchTimeoutHours}h, ${checksCompleted} checks). The pull request never became mergeable.`,
    details: ['Raise or disable the limit with --auto-restart-until-mergeable-timeout-hours (0 = unlimited).'],
  };
};

/**
 * React to a pull request that is still a draft while no AI session is running.
 *
 * GitHub answers mergeable=MERGEABLE / mergeStateStatus=CLEAN for such a pull
 * request, so nothing else in the loop notices - the merge then fails with
 * "Pull Request is still a draft" on every single check, which is exactly the
 * 2692-iteration loop reported in #2182.
 *
 * @param {Object} options
 * @param {{draftSelfHealCount: number}} options.state - mutable loop state
 * @returns {Promise<{action: 'stop'|'retry'|'continue', reason?: string}>}
 */
export const resolveDraftBlocker = async ({ owner, repo, prNumber, $, log, formatAligned, reportError, reportAutomationStop, verbose, state }) => {
  await log(formatAligned('📝', 'PR is a draft:', 'no AI session is running - restoring "ready for review"', 2), { level: 'warning' });

  if (state.draftSelfHealCount >= MAX_DRAFT_SELF_HEALS) {
    const message = `Pull request #${prNumber} keeps returning to draft state (${state.draftSelfHealCount} restore attempts). A draft pull request cannot be merged.`;
    await log(formatAligned('❌', 'DRAFT STATE UNRECOVERABLE:', message, 2), { level: 'error' });
    await reportAutomationStop({ $, owner, repo, targetNumber: prNumber, reason: 'draft_pull_request', mode: 'auto-restart-until-mergeable', message, details: ['Mark the pull request as ready for review manually (gh pr ready), then rerun.'], verbose, log });
    return { action: 'stop', reason: 'draft_pull_request' };
  }

  state.draftSelfHealCount++;
  const readyResult = await ensurePullRequestIsReady({ owner, repo, prNumber, $, log, formatAligned, reason: 'auto-restart-until-mergeable: draft blocks the merge', reportError });
  if (readyResult?.ok) {
    await log(formatAligned('✅', 'Draft restored:', `PR #${prNumber} is ready for review again (attempt ${state.draftSelfHealCount}/${MAX_DRAFT_SELF_HEALS})`, 2));
    return { action: 'retry' };
  }

  await log(formatAligned('⚠️', 'Draft restore failed:', readyResult?.error || 'unknown error', 2), { level: 'warning' });
  return { action: 'continue' };
};

/**
 * Classify a failed `gh pr merge` and decide what the watch loop should do next.
 *
 * Before #2182 every failure - terminal or not - printed "Will continue
 * monitoring..." and was retried every 120 seconds forever (5384 identical
 * failures in the reported run).
 *
 * @param {Object} options
 * @param {{draftSelfHealCount: number, consecutiveMergeFailures: number}} options.state - mutable loop state
 * @returns {Promise<{action: 'stop'|'retry'|'continue', reason?: string}>}
 */
export const resolveMergeFailure = async ({ error, owner, repo, prNumber, $, log, formatAligned, reportError, reportAutomationStop, verbose, state }) => {
  state.consecutiveMergeFailures++;
  const classification = classifyMergeError(error);
  await log(formatAligned('⚠️', 'Auto-merge failed:', error || 'Unknown error', 2), { level: 'warning' });
  await log(formatAligned('', 'Failure category:', `${classification.category} (attempt ${state.consecutiveMergeFailures}/${MAX_CONSECUTIVE_MERGE_FAILURES})`, 2), { level: 'warning' });
  if (classification.resolution) {
    await log(formatAligned('', 'Resolution:', classification.resolution, 2), { level: 'warning' });
  }

  if (classification.recoverable && classification.category === 'draft' && state.draftSelfHealCount < MAX_DRAFT_SELF_HEALS) {
    state.draftSelfHealCount++;
    await log(formatAligned('🔧', 'Self-healing:', `marking PR #${prNumber} as ready for review (attempt ${state.draftSelfHealCount}/${MAX_DRAFT_SELF_HEALS})`, 2));
    const readyResult = await ensurePullRequestIsReady({ owner, repo, prNumber, $, log, formatAligned, reason: 'auto-merge: GitHub rejected the merge because the PR is a draft', reportError });
    if (readyResult?.ok) return { action: 'retry' };
  }

  if (classification.terminal || state.consecutiveMergeFailures >= MAX_CONSECUTIVE_MERGE_FAILURES) {
    const message = `GitHub refused to merge pull request #${prNumber}: ${error || 'Unknown error'}`;
    await log(formatAligned('❌', 'AUTO-MERGE STOPPED:', classification.terminal ? 'the failure is terminal - retrying cannot succeed' : `${state.consecutiveMergeFailures} consecutive merge failures`, 2), { level: 'error' });
    await reportAutomationStop({ $, owner, repo, targetNumber: prNumber, reason: 'merge_failed', mode: 'auto-merge', message, details: [classification.resolution || 'Merge the pull request manually after resolving the cause.', `Failure category: ${classification.category}`], verbose, log });
    return { action: 'stop', reason: 'merge_failed' };
  }

  return { action: 'continue' };
};

export default {
  DRAFT_RECHECK_DELAY_MS,
  DEFAULT_WATCH_TIMEOUT_HOURS,
  MAX_DRAFT_SELF_HEALS,
  MAX_CONSECUTIVE_MERGE_FAILURES,
  normalizeWatchTimeoutHours,
  evaluateWatchTimeout,
  resolveDraftBlocker,
  resolveMergeFailure,
};
