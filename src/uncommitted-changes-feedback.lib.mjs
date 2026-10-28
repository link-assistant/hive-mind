import { promptText } from './prompt-text.lib.mjs';
/**
 * Restart feedback for a working session that ended with uncommitted changes.
 *
 * Issue #2313: the Kotlin run restarted Formal AI five times with a prompt that
 * was byte-identical to the first one - the `git status --porcelain` output that
 * triggered each restart never reached the model, so it could not know that
 * `Main.class` and `Main.jar` were the problem. Every restart path (watch mode,
 * auto-restart-until-mergeable and the pre-session check) now builds the same
 * lines here, and every model's prompt builder includes them verbatim.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2313
 */

/**
 * @param {string[]} changes - `git status --porcelain` output, one entry per line
 * @param {number} [restartCount] - current auto-restart iteration
 * @param {number} [maxIterations] - auto-restart budget (0 = unknown / unlimited)
 * @returns {string[]} feedback lines for the next session's prompt
 */
export const buildUncommittedChangesFeedback = (changes, restartCount = 0, maxIterations = 0) => {
  const iterationInfo = maxIterations > 0 ? promptText('prompt.templates.feedback.restartIteration', { restartCount, maxIterations }) : '';
  return ['', promptText('prompt.templates.uncommitted-changes-feedback.buildUncommittedChangesFeedback.text1', { iterationInfo: String(iterationInfo) }), promptText('prompt.templates.uncommitted-changes-feedback.buildUncommittedChangesFeedback.text2'), '', '```', ...changes, '```', '', promptText('prompt.templates.uncommitted-changes-feedback.buildUncommittedChangesFeedback.text3'), promptText('prompt.templates.uncommitted-changes-feedback.buildUncommittedChangesFeedback.text4'), promptText('prompt.templates.uncommitted-changes-feedback.buildUncommittedChangesFeedback.text5'), promptText('prompt.templates.uncommitted-changes-feedback.buildUncommittedChangesFeedback.text6'), '', promptText('prompt.templates.uncommitted-changes-feedback.buildUncommittedChangesFeedback.text7')];
};

export default { buildUncommittedChangesFeedback };
