/**
 * Placeholder-staging helper for auto PR creation.
 *
 * Extracted from solve.auto-pr.lib.mjs (issue #1825) to keep that module under
 * the max-lines lint budget.
 */

/**
 * Stage the temporary placeholder file (CLAUDE.md or .gitkeep) used to seed the
 * initial auto-PR commit.
 *
 * The solver writes this placeholder deliberately to create the first commit so
 * a draft PR can be opened, and removes it again once the task completes (see
 * cleanupClaudeFile in solve.results.lib.mjs). When the target repository's
 * .gitignore matches the placeholder — issue #1825: e.g. rumaster/tg-games
 * ignores `.gitkeep` — a plain `git add <file>` exits non-zero with
 * "The following paths are ignored by one of your .gitignore files", which
 * previously aborted PR creation with a fatal "Failed to add .gitkeep".
 *
 * Because the placeholder belongs to us and is short-lived, we confirm the path
 * is actually ignored with `git check-ignore` and then retry with
 * `git add -f`. Force-adding only happens for the ignored-placeholder case;
 * any other add failure is surfaced unchanged so genuine errors are not masked.
 *
 * @param {object} params
 * @param {Function} params.$ - command-stream tagged-template runner.
 * @param {string} params.tempDir - repository working directory.
 * @param {string} params.fileName - placeholder file name (CLAUDE.md or .gitkeep).
 * @param {Function} [params.log] - async logger.
 * @param {Function} [params.formatAligned] - log line formatter.
 * @param {boolean} [params.verbose] - emit verbose diagnostics.
 * @returns {Promise<{code: number, forced: boolean, ignored: boolean, stderr: string}>}
 */
export async function addPlaceholderFileToGit({ $, tempDir, fileName, log, formatAligned, verbose = false }) {
  // Run silently: `git add` is quiet on success and only emits the noisy
  // "paths are ignored ... Use -f" hint on failure, which we capture in
  // `stderr` and re-surface from the caller only when the failure is genuine.
  const addResult = await $({ cwd: tempDir, silent: true })`git add ${fileName}`;
  if (addResult.code === 0) {
    return { code: 0, forced: false, ignored: false, stderr: '' };
  }

  const stderr = addResult.stderr ? addResult.stderr.toString() : '';

  // Determine whether the add failed because the placeholder is git-ignored.
  // `git check-ignore` exits 0 when the path matches a .gitignore rule.
  const checkIgnore = await $({ cwd: tempDir, silent: true })`git check-ignore ${fileName}`;
  const ignored = checkIgnore.code === 0;

  if (!ignored) {
    // The failure was not caused by .gitignore — surface the original error so
    // genuine problems (permissions, corrupt index, ...) are not masked.
    return { code: addResult.code, forced: false, ignored: false, stderr };
  }

  if (log && formatAligned) {
    await log(formatAligned('ℹ️', `${fileName} is ignored:`, 'Force-adding placeholder (git add -f)'));
  }
  if (verbose && log) {
    await log(`   ${fileName} matched a .gitignore rule; retrying with: git add -f ${fileName}`, { verbose: true });
  }

  const forcedResult = await $({ cwd: tempDir, silent: true })`git add -f ${fileName}`;
  return {
    code: forcedResult.code,
    forced: true,
    ignored: true,
    stderr: forcedResult.stderr ? forcedResult.stderr.toString() : '',
  };
}
