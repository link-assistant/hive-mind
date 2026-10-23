#!/usr/bin/env node

/**
 * Issue #3572: never commit a nested repository the user did not register.
 *
 * `git add -A` stages any nested git repository it finds as a gitlink (mode
 * 160000) and only prints `warning: adding embedded git repository`. Claude
 * Code subagents run with `isolation: "worktree"` leave such repositories under
 * `.claude/worktrees/agent-<id>/`, so the end-of-session auto-commit pushed
 * five gitlinks to a pull request branch:
 *
 *     create mode 160000 .claude/worktrees/agent-a6f6b1eccdeeb44b8
 *
 * They point at commits that exist only in the solver's container. The next run
 * in the same directory saw them as ` M` and refused to start, and every CI
 * checkout of the branch failed with
 * `fatal: No url found for submodule path '.claude/worktrees/agent-…' in .gitmodules`.
 *
 * `.claude/worktrees/` is excluded as AI tool scratch (ai-tool-scratch.lib.mjs),
 * but any other tool can create a nested repository anywhere. A gitlink that
 * `.gitmodules` does not list is never a submodule anyone can check out, so the
 * auto-commit paths unstage every such entry after `git add -A`.
 */

const GITLINK_MODE = '160000';
// Local index operations; a hung git (a stale index.lock waiter) must not stall the auto-commit.
const GIT_TIMEOUT_MS = 30000;
const gitOptions = tempDir => ({ cwd: tempDir, mirror: false, signal: AbortSignal.timeout(GIT_TIMEOUT_MS) });

/**
 * Parse `git ls-files -s -z` output into the gitlink paths it lists.
 *
 * @param {string} lsFilesOutput - NUL- or newline-separated entries like `160000 <sha> 0\t<path>`
 * @returns {string[]}
 */
export const parseGitlinkPaths = lsFilesOutput =>
  String(lsFilesOutput || '')
    .split(/[\0\n]/)
    .map(line => line.match(/^(\d{6}) [0-9a-f]+ \d+\t(.+)$/))
    .filter(match => match && match[1] === GITLINK_MODE)
    .map(match => match[2]);

/**
 * Parse `git config -f .gitmodules --get-regexp path` output into the submodule
 * paths the repository registers.
 *
 * @param {string} gitmodulesOutput - lines like `submodule.vendor/lib.path vendor/lib`
 * @returns {Set<string>}
 */
export const parseRegisteredSubmodulePaths = gitmodulesOutput =>
  new Set(
    String(gitmodulesOutput || '')
      .split('\n')
      .map(line => line.match(/^submodule\..+\.path\s+(.+)$/))
      .filter(Boolean)
      .map(match => match[1].trim().replace(/\/$/, ''))
  );

/**
 * Staged (added or changed against HEAD) gitlinks that `.gitmodules` does not
 * register. A gitlink that is in HEAD and unchanged is not reported: it is
 * already history, and unstaging it would be a no-op.
 *
 * @param {string} tempDir - the workspace
 * @param {Function} $ - command-stream `$`
 * @returns {Promise<string[]>}
 */
export const findUnregisteredStagedGitlinks = async (tempDir, $) => {
  const index = await $(gitOptions(tempDir))`git ls-files -s -z`;
  if (index.code !== 0) return [];
  const gitlinks = parseGitlinkPaths(index.stdout?.toString());
  if (gitlinks.length === 0) return [];
  // `git diff --cached` fails before the first commit (no HEAD); then every entry is staged.
  const changed = await $(gitOptions(tempDir))`git diff --cached --name-only --no-renames -z`;
  const changedPaths = changed.code === 0 ? new Set(changed.stdout.toString().split('\0').filter(Boolean)) : null;
  const stagedGitlinks = changedPaths ? gitlinks.filter(gitlink => changedPaths.has(gitlink)) : gitlinks;
  if (stagedGitlinks.length === 0) return [];
  // Exit code 1 means "no .gitmodules" or "no path entries": nothing is registered.
  const registeredResult = await $(gitOptions(tempDir))`git config -f .gitmodules --get-regexp path`;
  const registered = registeredResult.code === 0 ? parseRegisteredSubmodulePaths(registeredResult.stdout?.toString()) : new Set();
  return stagedGitlinks.filter(gitlink => !registered.has(gitlink));
};

/**
 * Unstage every gitlink `.gitmodules` does not register. Call right after
 * `git add -A` on an auto-commit path.
 *
 * `git reset -- <path>` puts the index entry back to what HEAD has: a gitlink
 * an earlier run already pushed keeps its committed entry (this never deletes
 * one from the pull request), and a new one leaves the index while the nested
 * repository stays on disk. Before the first commit there is no HEAD, so the
 * entry is dropped with `git update-index --force-remove`.
 *
 * @param {string} tempDir - the workspace
 * @param {Function} $ - command-stream `$`
 * @param {(msg: string, opts?: object) => Promise<void>} log
 * @returns {Promise<string[]>} the paths that were unstaged
 */
export const unstageUnregisteredGitlinks = async (tempDir, $, log) => {
  let unregistered;
  try {
    unregistered = await findUnregisteredStagedGitlinks(tempDir, $);
  } catch (error) {
    await log(`⚠️  Could not check for embedded git repositories: ${error.message}`, { level: 'warning' });
    return [];
  }
  const unstaged = [];
  for (const gitlink of unregistered) {
    let result = await $(gitOptions(tempDir))`git reset -q -- ${gitlink}`;
    if (result.code !== 0) result = await $(gitOptions(tempDir))`git update-index --force-remove -- ${gitlink}`;
    if (result.code === 0) {
      unstaged.push(gitlink);
      await log(`🧹 Not committing embedded git repository ${gitlink} (a gitlink that .gitmodules does not list)`);
    } else {
      await log(`⚠️  Could not unstage embedded git repository ${gitlink}: ${result.stderr?.toString().trim()}`, { level: 'warning' });
    }
  }
  return unstaged;
};

export default {
  findUnregisteredStagedGitlinks,
  parseGitlinkPaths,
  parseRegisteredSubmodulePaths,
  unstageUnregisteredGitlinks,
};
