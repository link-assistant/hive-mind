/**
 * A session ended by the repeated-tool-call breaker inside the
 * --auto-restart-until-mergeable loop (issue #2395).
 *
 * Such a session is not a tool failure: `classifySessionResult` has already
 * posted "🔁 Session stopped" saying that the next session continues with
 * feedback. Stopping the loop as `tool_failure` contradicted that comment and
 * ended the automation while CI was still running (link-assistant/agent#323).
 * The loop attaches this session's full log and goes on to the next iteration.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2395
 */

/** `true` when the session was stopped to restart with feedback rather than failing. */
export const isRestartWithFeedback = toolResult => !!toolResult && !toolResult.success && !!toolResult.restartWithFeedback;

/**
 * Log the stop and attach the stopped session's full log; never throws.
 *
 * @param {Object} params
 * @param {Object} params.toolResult - the classified session result
 * @param {Object} params.argv
 * @param {string} params.restartLabel - `formatAutoRestartLabel(restartCount)`
 * @returns {Promise<boolean>} `true` if the log was attached
 */
export const reportSessionStoppedForFeedback = async ({ toolResult, argv, restartLabel, prNumber, owner, repo, $, log, formatAligned, getLogFile, attachLogToGitHub, sanitizeLogContent, formatToolExecutionFailure, reportError, cleanErrorMessage, latestSessionId = null, tempDir = null }) => {
  const stopReason = toolResult.stopReason || 'restart with feedback';
  await log(formatAligned('🔁', 'Session stopped:', `${stopReason} — the next iteration continues with feedback`, 2));
  if (!prNumber || !(argv.attachLogs || argv['attach-logs'])) return false;
  try {
    const logFile = getLogFile();
    if (!logFile) return false;
    return !!(await attachLogToGitHub({
      logFile,
      targetType: 'pr',
      targetNumber: prNumber,
      owner,
      repo,
      $,
      log,
      sanitizeLogContent,
      verbose: argv.verbose,
      customTitle: `🔁 Auto-restart ${restartLabel} Log (session stopped: ${stopReason})`,
      errorMessage: formatToolExecutionFailure({ tool: argv.tool, toolResult }),
      sessionId: toolResult.sessionId || latestSessionId,
      tempDir,
      requestedModel: argv.originalModel || argv.model,
      tool: argv.tool || 'claude',
    }));
  } catch (logUploadError) {
    reportError(logUploadError, { context: 'attach_restart_with_feedback_log', prNumber, owner, repo, operation: 'upload_session_log' });
    await log(formatAligned('', `⚠️  Session log upload error: ${cleanErrorMessage(logUploadError)}`, '', 2));
    return false;
  }
};

export default { isRestartWithFeedback, reportSessionStoppedForFeedback };
