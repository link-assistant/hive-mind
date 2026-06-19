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
 * @returns {Promise<boolean>} `true` if a log has been attached (by this helper or earlier).
 */
export const attachFinalLogIfMissing = async ({ shouldAttachLogs, prNumber, owner, repo, $, log, sanitizeLogContent, getLogFile, attachLogToGitHub, argv, sessionId = null, tempDir = null, anthropicTotalCostUSD = null, resultModelUsage = null, globalState = global }) => {
  // Only fire as a last resort: --attach-logs enabled, a PR to attach to, and nothing attached yet.
  if (!shouldAttachLogs || !prNumber || globalState.logAttachedToGitHub) {
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

  return globalState.logAttachedToGitHub === true;
};
