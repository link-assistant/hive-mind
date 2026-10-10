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
  const iterationInfo = maxIterations > 0 ? ` (Auto-restart ${restartCount}/${maxIterations})` : '';
  return ['', `⚠️ UNCOMMITTED CHANGES DETECTED${iterationInfo}:`, 'The previous working session ended with uncommitted changes. This is the exact `git status --porcelain` output of the working tree:', '', '```', ...changes, '```', '', 'IMPORTANT: For EVERY file listed above you MUST do exactly one of:', '1. COMMIT it if it is part of the solution (git add <file> && git commit && git push).', '2. IGNORE it if it is a build output or another generated file that must not be committed (add a matching pattern to .gitignore, then commit and push .gitignore).', '3. DELETE it if it is not needed (git checkout -- <file> for a tracked file, rm <file> for an untracked file).', '', 'Do not end the session while `git status --porcelain` still prints any line. The session will auto-restart until the working tree is clean.'];
};

export default { buildUncommittedChangesFeedback };
