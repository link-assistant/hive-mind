#!/usr/bin/env node

/**
 * Issue #1952: Guarantee that a working session never finishes with NO log attached when
 * `--attach-logs` is enabled.
 *
 * Every log-attachment path in solve.mjs is conditional and can be skipped on some logic paths:
 *   - verifyResults() only attaches when the PR is detected as session-owned;
 *   - the temporary-watch block only runs when there were uncommitted changes;
 *   - the auto-merge/watch loops attach per AI iteration, but their stop-for-human-review exits
 *     (billing_limit, ci_cancelled_requires_review, external_review_limit, limit reached) can
 *     return before any iteration ran — attaching nothing.
 * Without a final safety net such a session ends with no logs at all, exactly as reported.
 *
 * `attachLogToGitHub` records `global.logAttachedToGitHub` on every successful upload anywhere in
 * the process, so this helper only attaches when nothing else did.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1952
 */

import { isLatestAiWorkAttached } from './log-attach-state.lib.mjs';

/**
 * Attach the final session log if `--attach-logs` is enabled and nothing has attached a log yet.
 *
 * @param {Object} params
 * @param {boolean} params.shouldAttachLogs - Whether `--attach-logs` is enabled.
 * @param {string|number|null} params.prNumber - Target PR number (no PR ⇒ nothing to attach to).
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {Function} params.$ - command-stream tagged executor.
 * @param {Function} params.log
 * @param {Function} params.sanitizeLogContent
 * @param {Function} params.getLogFile - Returns the path to the cumulative session log.
 * @param {Function} params.attachLogToGitHub
 * @param {Object} params.argv
 * @param {string|null} [params.sessionId]
 * @param {string|null} [params.tempDir]
 * @param {number|null} [params.anthropicTotalCostUSD]
 * @param {Object|null} [params.resultModelUsage]
 * @param {Object} [params.globalState] - Defaults to the process `global`; injectable for tests.
 * @returns {Promise<boolean>} `true` if the latest log has been attached (by this helper or earlier).
 */
export const attachFinalLogIfMissing = async ({ shouldAttachLogs, prNumber, owner, repo, $, log, sanitizeLogContent, getLogFile, attachLogToGitHub, argv, sessionId = null, tempDir = null, anthropicTotalCostUSD = null, resultModelUsage = null, globalState = global }) => {
  // Only fire as a last resort: --attach-logs enabled, a PR to attach to, and nothing attached yet.
  if (!shouldAttachLogs || !prNumber || globalState.logAttachedToGitHub) {
    // Issue #2301: an earlier log does not make the latest one attached. A failed
    // upload was already retried and reported on the pull request ("Log Upload
    // Failed"), so it is not repeated here; it is only reported as not attached.
    if (globalState.logAttachedToGitHub === true && globalState.latestLogAttachFailed === true) {
      await log('ℹ️  The latest session log could not be attached (see the "Log Upload Failed" comment); an earlier log is attached');
      return false;
    }
    return globalState.logAttachedToGitHub === true;
  }

  await log('');
  await log('📎 No session log was attached yet — attaching final log (--attach-logs safety net)...');
  try {
    const logUploadSuccess = await attachLogToGitHub({
      logFile: getLogFile(),
      targetType: 'pr',
      targetNumber: prNumber,
      owner,
      repo,
      $,
      log,
      sanitizeLogContent,
      verbose: argv?.verbose,
      sessionId,
      tempDir,
      anthropicTotalCostUSD,
      argv,
      requestedModel: argv?.originalModel || argv?.model,
      tool: argv?.tool || 'claude',
      resultModelUsage,
    });
    if (logUploadSuccess) {
      await log('✅ Final working session log attached');
    } else {
      await log('⚠️  Final log attachment did not succeed (see messages above)', { level: 'warning' });
    }
  } catch (uploadError) {
    await log(`⚠️  Error attaching final log: ${uploadError.message}`, { level: 'warning' });
  }

  return globalState.logAttachedToGitHub === true && globalState.latestLogAttachFailed !== true;
};

/**
 * Issue #2306: re-attach the session log after the post-solve restart loops
 * (escalation, auto-ensure, keep-working, ensure-sub-issues) ran at least one
 * AI iteration.
 *
 * `verifyResults()` uploads the log *before* those loops start, and none of them
 * uploads again, so `attachFinalLogIfMissing` saw "already attached" and the
 * iterations were never published. In the reported run the only attached log
 * ended at 05:55, while restart iterations kept committing until 07:48 and the
 * pull request was merged at 07:53 — two hours of work with no log.
 *
 * @param {Object} params - same as {@link attachFinalLogIfMissing}, plus:
 * @param {number} params.restartIterationsRan - how many post-solve loops ran iterations
 * @returns {Promise<boolean>} `true` if the updated log was attached
 */
export const attachLogAfterPostSolveRestarts = async ({ restartIterationsRan, shouldAttachLogs, prNumber, ...params }) => {
  if (!shouldAttachLogs || !prNumber || !(restartIterationsRan > 0)) return false;
  return attachUpdatedLog({ ...params, prNumber, reason: `${restartIterationsRan} post-solve restart loop(s) ran after the first upload` });
};

/**
 * Issue #2395: re-attach the session log when `--auto-merge` held the merge back.
 *
 * The merge gates (closed issue, missing closing references, unverified issue
 * link) only post an "auto-merge blocked" comment. When a log was attached
 * earlier — for example by the failed session that preceded the merge attempt —
 * `attachFinalLogIfMissing` sees "already attached" and the part of the log that
 * explains why the merge was held back is never published.
 *
 * @param {Object} params - same as {@link attachFinalLogIfMissing}, plus:
 * Issue #2563: only when an AI session finished after the latest attached log
 * (or no log is attached). In link-foundation/command-stream#206 the loop only
 * waited for CI after the first upload, and the same log was published twice.
 * When the loop can, it already published that log together with the
 * held-back notice (`reportAutoMergeBlockedByIssue`).
 *
 * @param {Object|null} params.autoMergeResult - the result of `startAutoRestartUntilMergeable`
 * @returns {Promise<boolean>} `true` if the updated log was attached
 */
export const attachLogAfterAutoMergeBlocked = async ({ autoMergeResult, shouldAttachLogs, prNumber, globalState = global, ...params }) => {
  const blockers = autoMergeResult?.success === false ? autoMergeResult.mergeBlockers || [] : [];
  if (!shouldAttachLogs || !prNumber || blockers.length === 0) return false;
  // Issue #2563: the held-back comment explains the stop; the same log is not published twice.
  if (isLatestAiWorkAttached(globalState)) {
    await params.log('ℹ️  Not uploading the session log again: the attached log already covers every AI session, and the auto-merge held-back comment explains the stop');
    return false;
  }
  return attachUpdatedLog({ ...params, prNumber, reason: `the auto-merge was held back (${blockers.map(blocker => blocker.reason).join(', ')})` });
};

const attachUpdatedLog = async ({ reason, prNumber, owner, repo, $, log, sanitizeLogContent, getLogFile, attachLogToGitHub, argv, sessionId = null, tempDir = null, anthropicTotalCostUSD = null, resultModelUsage = null }) => {
  await log('');
  await log(`📎 Uploading the working session log again: ${reason}...`);
  try {
    const logUploadSuccess = await attachLogToGitHub({
      logFile: getLogFile(),
      targetType: 'pr',
      targetNumber: prNumber,
      owner,
      repo,
      $,
      log,
      sanitizeLogContent,
      verbose: argv?.verbose,
      sessionId,
      tempDir,
      anthropicTotalCostUSD,
      argv,
      requestedModel: argv?.originalModel || argv?.model,
      tool: argv?.tool || 'claude',
      resultModelUsage,
    });
    if (logUploadSuccess) {
      await log('✅ Updated working session log attached');
    } else {
      await log('⚠️  Updated log attachment did not succeed (see messages above)', { level: 'warning' });
    }
    return logUploadSuccess === true;
  } catch (uploadError) {
    await log(`⚠️  Error attaching updated log: ${uploadError.message}`, { level: 'warning' });
    return false;
  }
};
