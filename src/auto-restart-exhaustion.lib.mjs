#!/usr/bin/env node

/**
 * Issue #2119: what happens when the shared auto-restart budget runs out.
 *
 * The issue requires that after the configured number of iterations the run
 * "must actually stop (fail + auto-commit on fail recovery). So the result will
 * be actually visible."
 *
 * Before this, the two auto-restart subsystems ended differently and neither
 * preserved the work:
 *
 *   - `solve.watch.lib.mjs` logged "MAX ITERATIONS REACHED" and simply `break`ed
 *     out of the loop, leaving the uncommitted changes that caused every restart
 *     on the disposable temporary clone, where they were deleted with it;
 *   - `solve.auto-merge.lib.mjs` posted a comment and returned
 *     `auto_restart_limit_reached`, also without committing anything.
 *
 * This module is the one exhaustion path for both: log the failure, auto-commit
 * (and push) whatever is uncommitted through the same critical-error recovery
 * helper used elsewhere, and post a single comment that states the limit, the
 * remaining blocker and what was preserved.
 */

import { commitUncommittedChangesOnCriticalError, describePreservedWork } from './critical-error-commit.lib.mjs';
import { formatAutoRestartLabel, formatAutoRestartLimit, getAutoRestartIterationsUsed } from './auto-restart-budget.lib.mjs';
import { ensurePullRequestStaysDraftAfterFailure } from './pr-draft-state.lib.mjs';
import { AUTO_RESTART_MARKER, postTrackedComment } from './tool-comments.lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { buildRestartCooldownMarker } from './auto-restart-cooldown.lib.mjs';
import { recordDisposableFailure } from './failed-task-retention.lib.mjs';

/**
 * The single reason string returned by every auto-restart subsystem when the
 * shared budget is exhausted, so `solve` can treat both the same way.
 */
export const AUTO_RESTART_LIMIT_REACHED_REASON = 'auto_restart_limit_reached';

// Module-level singleton, like the shared budget itself: `solve.mjs` runs both
// auto-restart loops sequentially and neither returns through a common result
// object, so this is what lets `finalizeSolveProcess` exit non-zero. Without it
// the run reported success even though the blocker was never resolved.
let limitFailure = null;

/** @returns {boolean} true once any auto-restart loop exhausted the shared budget */
export const hasAutoRestartLimitFailure = () => Boolean(limitFailure);

/** @returns {{reason: string, iterationsUsed: number, committed: boolean, pushed: boolean}|null} */
export const getAutoRestartLimitFailure = () => limitFailure;

/** Clear the recorded failure. Intended for tests. */
export const resetAutoRestartLimitFailure = () => {
  limitFailure = null;
};

/**
 * Issue #2492: auto-restart comments state each fact once. The `N/M` heading
 * already carries the limit, so the footers that repeated it are gone.
 */

/** Posted by the auto-restart-until-mergeable loop before it starts the next session. */
export const buildAutoRestartComment = ({ label, reason }) => `## 🔄 ${AUTO_RESTART_MARKER} ${label}

**Reason:** ${reason}

Starting a new session to address it.`;

/** Posted by the watch loop when the previous session left uncommitted changes. */
export const buildUncommittedChangesRestartComment = ({ label, uncommittedFilesList = '' }) => `## 🔄 ${AUTO_RESTART_MARKER} ${label}

The previous session left uncommitted changes. Starting a new session to commit or discard them.${uncommittedFilesList}`;

/** Posted once when the shared budget is exhausted; the run then fails. */
export const buildAutoRestartLimitComment = ({ label, blocker, preservedText, headSha = null }) => `## ❌ ${AUTO_RESTART_MARKER} ${label} - limit reached

**Remaining blocker:** ${blocker}

${preservedText}

No more sessions will start automatically. Resolve the blocker, or rerun with a higher \`--auto-restart-max-iterations\`. Automatic issue requeues wait for the configured cooldown (six hours by default) unless the PR has new commits or feedback.\n\n${buildRestartCooldownMarker(headSha)}`;

/**
 * Fail the run because the shared auto-restart budget is exhausted, preserving
 * any uncommitted work first.
 *
 * Never throws: a failure to commit or comment must not mask the limit itself.
 *
 * @param {Object} params
 * @param {string} params.owner GitHub owner
 * @param {string} params.repo GitHub repository
 * @param {number|null} params.prNumber PR to comment on (comment skipped when absent)
 * @param {string} params.tempDir working tree holding the uncommitted work
 * @param {string|null} params.branchName branch to push the preserved work to
 * @param {Function} params.$ command-stream tagged-template executor
 * @param {Function} params.log async logger
 * @param {Function} params.formatAligned aligned log formatter
 * @param {string} params.blocker the remaining reason that kept triggering restarts
 * @param {string} [params.subsystem] which loop hit the limit, for the log line
 * @returns {Promise<{reason: string, iterationsUsed: number, committed: boolean, pushed: boolean}>}
 */
export const failOnAutoRestartBudgetExhausted = async ({ owner, repo, prNumber, tempDir, branchName, $, log, formatAligned, blocker = 'uncommitted changes', subsystem = 'auto-restart', uploadFailureLog = null, argv = null }) => {
  if (limitFailure) return limitFailure;
  const iterationsUsed = getAutoRestartIterationsUsed();
  const label = formatAutoRestartLabel(iterationsUsed);

  await log('');
  await log(formatAligned('❌', 'AUTO-RESTART LIMIT REACHED', `Stopping ${subsystem} after ${label} iterations`), { level: 'error' });
  await log(formatAligned('', 'Configured limit:', formatAutoRestartLimit(), 2), { level: 'error' });
  await log(formatAligned('', 'Remaining blocker:', blocker, 2), { level: 'error' });
  await log('');

  // Issue #2263: exhaustion is terminal failure, not successful completion.
  // Restore draft before preservation/reporting and make it a monotonic veto.
  if (prNumber) {
    await ensurePullRequestStaysDraftAfterFailure({ owner, repo, prNumber, $, log, formatAligned, reason: `auto-restart limit ${label} reached` });
  }

  // Fail recovery: the work that kept triggering restarts lives in a temporary
  // clone that is about to be discarded. Preserve it on `recovery/<branch>` -
  // never in the PR branch, where build output became part of the diff (#2315).
  const preserved = await commitUncommittedChangesOnCriticalError({
    tempDir,
    branchName,
    $,
    log,
    reason: `auto-restart limit ${label} reached`,
    push: true,
  });

  if (prNumber) {
    let headSha = null;
    try {
      const head = await $({ mirror: false, noThrow: true })`gh pr view ${prNumber} --repo ${`${owner}/${repo}`} --json headRefOid`;
      if (head.code === 0) headSha = JSON.parse(head.stdout?.toString() || '{}').headRefOid;
    } catch {
      /* Still report exhaustion when Git is unavailable. */
    }
    const body = buildAutoRestartLimitComment({ label, blocker, preservedText: describePreservedWork(preserved), headSha });
    try {
      const comment = await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body });
      if (!comment.ok) throw new Error('GitHub rejected the exhaustion comment');
      await log(formatAligned('', '💬 Posted auto-restart limit notification to PR', '', 2));
    } catch (commentError) {
      reportError(commentError, { context: 'post_auto_restart_limit_comment', owner, repo, prNumber, operation: 'comment_on_pr' });
      await log(formatAligned('', '⚠️  Could not post auto-restart limit comment to PR', '', 2));
    }
  }

  let logsUploaded = false;
  try {
    logsUploaded = uploadFailureLog ? Boolean(await uploadFailureLog()) : false;
  } catch {
    /* Retain the container on upload failure. */
  }
  await recordDisposableFailure({ reason: 'auto_restart_limit', logsUploaded, preserved, tempDir, branchName, $, log, argv });
  limitFailure = { reason: AUTO_RESTART_LIMIT_REACHED_REASON, iterationsUsed, committed: preserved.committed, pushed: preserved.pushed, recoveryBranch: preserved.recoveryBranch || null, preservedText: describePreservedWork(preserved) };
  return limitFailure;
};

export default { AUTO_RESTART_LIMIT_REACHED_REASON, buildAutoRestartComment, buildAutoRestartLimitComment, buildUncommittedChangesRestartComment, failOnAutoRestartBudgetExhausted, hasAutoRestartLimitFailure, getAutoRestartLimitFailure, resetAutoRestartLimitFailure };
