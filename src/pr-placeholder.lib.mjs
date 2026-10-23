/**
 * Placeholder content of the WIP pull request created by solve.auto-pr.lib.mjs.
 *
 * Issue #1162: `verifyResults` uses these helpers to detect a title or description
 * the agent never wrote. Issue #3434: the run-end draft restore in
 * pr-draft-state.lib.mjs uses them too, so a failed run never marks a placeholder
 * pull request ready for review. This module has no dependencies on purpose:
 * pr-draft-state.lib.mjs must not import the heavy solve.results.lib.mjs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1162
 * @see https://github.com/link-assistant/hive-mind/issues/3434
 */

/**
 * Placeholder patterns used to detect auto-generated PR content that was not updated by the agent.
 * These patterns match the initial WIP PR created by solve.auto-pr.lib.mjs.
 */
export const PR_TITLE_PLACEHOLDER_PREFIX = '[WIP]';

export const PR_BODY_PLACEHOLDER_PATTERNS = ['_Details will be added as the solution draft is developed..._', '**Work in Progress** - The AI assistant is currently analyzing and implementing the solution draft.', '### 🚧 Status'];

/**
 * Check if PR title still contains auto-generated placeholder content
 * @param {string} title - PR title
 * @returns {boolean} - true if title has placeholder content
 */
export const hasPRTitlePlaceholder = title => {
  return title && title.startsWith(PR_TITLE_PLACEHOLDER_PREFIX);
};

/**
 * Check if PR body still contains auto-generated placeholder content
 * @param {string} body - PR body
 * @returns {boolean} - true if body has placeholder content
 */
export const hasPRBodyPlaceholder = body => {
  return body && PR_BODY_PLACEHOLDER_PATTERNS.some(pattern => body.includes(pattern));
};

export default { PR_TITLE_PLACEHOLDER_PREFIX, PR_BODY_PLACEHOLDER_PATTERNS, hasPRTitlePlaceholder, hasPRBodyPlaceholder };
