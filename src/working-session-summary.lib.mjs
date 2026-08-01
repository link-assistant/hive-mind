#!/usr/bin/env node

/**
 * Issue #2119: make the published "Working session summary" comment honest.
 *
 * The Kotlin reproduction run ended with the AI tool answering a single `pwd`
 * and returning, and Hive Mind published exactly that as the session's result:
 *
 *     <!-- hive-mind:working-session-summary -->
 *     ## Working session summary
 *
 *     The `pwd` command completed. Output:
 *
 *     ```text
 *     /tmp/gh-issue-solver-1785421161275
 *     ```
 *
 * (https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2#issuecomment-5132013034)
 *
 * Two things are wrong with that comment, and both are Hive Mind's to fix - the
 * tool returning nothing useful is a separate, upstream problem:
 *
 *   1. It reads as a report of completed work. A reader has to open the diff to
 *      discover the pull request is still empty. Stating that in the comment
 *      turns a misleading summary into an accurate one.
 *   2. It publishes the solver's private workspace path. That path is an
 *      implementation detail of the machine the run happened on; it is noise in
 *      a public comment and it tells readers about the host filesystem.
 */

/** Solver workspace directories, as created by solve.repository.lib.mjs. */
const WORKSPACE_PATH_PATTERN = /(?:\/private)?\/(?:tmp|var\/folders\/[^\s/]+\/[^\s/]+\/[^\s/]+)\/gh-issue-solver(?:-resume)?-[A-Za-z0-9._-]+/g;

/** Replacement shown in place of a redacted workspace path. */
export const WORKSPACE_PATH_PLACEHOLDER = '<workspace>';

/**
 * Replace solver workspace paths with a placeholder.
 *
 * Only the solver's own `gh-issue-solver-*` directories are touched: paths the
 * user actually cares about (repository-relative paths, other absolute paths)
 * are left exactly as the AI wrote them.
 *
 * @param {string} text
 * @returns {string}
 */
export const redactWorkspacePaths = text => {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(WORKSPACE_PATH_PATTERN, WORKSPACE_PATH_PLACEHOLDER);
};

/**
 * The line appended when the pull request still has an empty diff.
 *
 * @param {{measured: boolean, hasChanges: boolean}|null} changeStats - from
 *   `getPullRequestChangeStats`; `null` or unmeasured stats produce no notice,
 *   so a failed diff read never turns into a false "no changes" claim.
 * @returns {string} the notice, or an empty string when none applies
 */
export const buildNoChangesNotice = changeStats => {
  if (!changeStats || !changeStats.measured || changeStats.hasChanges) return '';
  return '> ⚠️ This pull request still contains no changes - nothing was implemented yet.';
};

export default { buildNoChangesNotice, redactWorkspacePaths, WORKSPACE_PATH_PLACEHOLDER };
