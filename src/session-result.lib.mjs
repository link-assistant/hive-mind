/**
 * Issue #2316: the tool-agnostic step every finished AI session goes through,
 * in the first session (`solve.mjs`) and in every restart iteration
 * (`solve.restart-shared.lib.mjs`).
 *
 * When the repeated-tool-call breaker ended the session (any adapter - see
 * `tool-call-loop-guard.lib.mjs`), the session:
 *   - ends with the `repeated_tool_call` reason naming the repeated call,
 *   - has that reason posted to the pull request,
 *   - and, when a restart loop follows, is not a terminal failure: the loop runs
 *     the next session with the breaker's reason as feedback
 *     (`takeRepeatedToolCallFeedback()` in `executeToolIteration`).
 *
 * Without a restart loop the reason becomes the session's failure message, so
 * the failure comment names the call instead of a bare exit code.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2316
 */

import { REPEATED_TOOL_CALL_REASON, takeRepeatedToolCallVerdict } from './tool-call-loop-guard.lib.mjs';
import { postTrackedComment } from './tool-comments.lib.mjs';
import { logProcessesSurvivingSession } from './session-survivors.lib.mjs';
import { recordAiSessionFinished } from './log-attach-state.lib.mjs';

/** A restart loop runs another session after this one. */
export const willRestartAfterSession = argv => !!(argv?.autoRestartUntilMergeable || argv?.watch);

export const buildRepeatedToolCallComment = ({ verdict, restarting }) => ['## 🔁 Session stopped: repeated tool call', '', verdict.reason, '', restarting ? `The session was ended by the repeated-tool-call breaker (\`${REPEATED_TOOL_CALL_REASON}\`). The next session is told about this call and asked not to repeat it.` : `The session was ended by the repeated-tool-call breaker (\`${REPEATED_TOOL_CALL_REASON}\`).`, '', '_The breaker is opt-in (`--detect-repeated-tool-calls` or `HIVE_MIND_DETECT_REPEATED_TOOL_CALLS=true`). Limit: `--repeated-tool-call-limit` / `HIVE_MIND_REPEATED_TOOL_CALL_LIMIT` (default 10) identical failing calls with identical output, or twice that many identical successful calls in a row; CI polling and wait commands are never counted._'].join('\n');

/**
 * @param {Object} params
 * @param {Object} params.toolResult - what the adapter returned
 * @param {Object} params.argv
 * @param {string} [params.owner]
 * @param {string} [params.repo]
 * @param {number} [params.prNumber]
 * @param {Function} [params.$] - command-stream, for posting the comment
 * @param {Function} [params.log]
 * @param {string} [params.tempDir] - the work directory, checked for leftover processes with `--verbose` (#2395)
 * @returns {Promise<Object>} the classified tool result
 */
export const classifySessionResult = async ({ toolResult, argv, owner, repo, prNumber, $, log = async () => {}, tempDir = null }) => {
  // Issue #2563: the log now holds AI work no attached log covers yet, with this session's usage.
  recordAiSessionFinished(toolResult);
  await logProcessesSurvivingSession({ tempDir, argv, log });
  let result = toolResult;
  const verdict = takeRepeatedToolCallVerdict();
  if (!verdict || !result) return result;

  const restarting = willRestartAfterSession(argv);
  await log(`🛑 Session ended: ${REPEATED_TOOL_CALL_REASON} - ${verdict.reason}`, { level: 'warning' });
  if (restarting) await log('   The restart loop continues; the next session receives this reason as feedback.');
  result = {
    ...result,
    success: false,
    errorDuringExecution: true,
    stopReason: REPEATED_TOOL_CALL_REASON,
    repeatedToolCall: verdict,
    restartWithFeedback: restarting,
    errorInfo: { ...(result.errorInfo || {}), code: 'REPEATED_TOOL_CALL', message: verdict.reason },
  };
  if (owner && repo && prNumber && typeof $ === 'function') {
    try {
      const { ok, stderr } = (await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: buildRepeatedToolCallComment({ verdict, restarting }) })) || {};
      if (!ok) await log(`⚠️ Could not post the repeated-tool-call comment: ${stderr || 'unknown error'}`, { level: 'warning' });
    } catch (error) {
      await log(`⚠️ Could not post the repeated-tool-call comment: ${error.message}`, { level: 'warning' });
    }
  }
  return result;
};

export default { classifySessionResult, buildRepeatedToolCallComment, willRestartAfterSession };
