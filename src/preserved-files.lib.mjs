/**
 * Which untracked files are worth preserving when a session is cut short.
 *
 * Issue #2315: untracked binaries and known build directories are not the
 * user's work, so the critical-error snapshot leaves them out.
 * Issue #3433: the same rules apply inside every git submodule, so they live in
 * this small module that both critical-error-commit.lib.mjs and
 * submodule-preserve.lib.mjs import.
 * Issue #3572: the recovery branch name never falls back to `detached-head`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2315
 * @see https://github.com/link-assistant/hive-mind/issues/3433
 * @see https://github.com/link-assistant/hive-mind/issues/3572
 */

import { copyFile, open, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { isAiToolScratchFile } from './ai-tool-scratch.lib.mjs';

/** Directories that hold build output in the ecosystems Hive Mind works on. */
export const BUILD_OUTPUT_DIR_PATTERN = /(^|\/)(target|build|out|bin|obj|dist|node_modules|__pycache__|\.gradle|\.venv|venv|\.next|coverage)\//;

/** `20261020T111440Z`: a timestamp that is valid in a git ref name. */
const refTimestamp = now =>
  new Date(now ?? Date.now())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

/**
 * The branch that receives the preserved work of `branchName` (in the
 * repository and in each submodule).
 *
 * Issue #3572: without a branch name this used to be `recovery/detached-head`,
 * one shared name for every run that failed before its branch was known (the
 * HEAD was not even detached). Callers now pass the PR branch they already know;
 * only when no branch is known at all is the name made unique from the commit
 * and the time, so two runs never overwrite each other's preserved work.
 *
 * @param {string|null} branchName
 * @param {{sha?: string|null, now?: number|Date}} [options] - the HEAD commit and the time for the fallback name
 * @returns {string}
 */
export const recoveryBranchFor = (branchName, { sha = null, now = undefined } = {}) => {
  if (branchName) return `recovery/${branchName}`;
  const shortSha = /^[0-9a-f]{7,}$/i.test(String(sha || '')) ? `${String(sha).slice(0, 8)}-` : '';
  return `recovery/detached-${shortSha}${refTimestamp(now)}`;
};

/** git's own heuristic: a NUL byte in the first 8000 bytes means binary. */
export const isBinaryFile = async path => {
  let handle;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(8000);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } catch {
    return true;
  } finally {
    await handle?.close();
  }
};

/**
 * Split untracked paths into those worth preserving and build output or AI
 * tool state (`.formal-ai/`, Formal AI's `data/cache/derivations/`), which is
 * not the user's work: recovery branches holding only derivations were pushed
 * on every failed Formal AI draft.
 *
 * @param {string} tempDir
 * @param {string[]} paths - `git ls-files --others --exclude-standard` output
 * @returns {Promise<{keep: string[], skipped: string[]}>}
 */
export const classifyUntrackedFiles = async (tempDir, paths) => {
  const keep = [];
  const skipped = [];
  for (const path of paths) {
    if (BUILD_OUTPUT_DIR_PATTERN.test(path) || isAiToolScratchFile(path) || (await isBinaryFile(join(tempDir, path)))) skipped.push(path);
    else keep.push(path);
  }
  return { keep, skipped };
};

/**
 * Seed the private recovery index with a copy of the repository's real index.
 *
 * Issue #3656: preservation took 40 s on a busy, memory-starved container.
 * `GIT_INDEX_FILE=<tmp> git read-tree HEAD` builds an index without the stat
 * cache, so the `git add -u` that follows re-hashes every tracked file of the
 * repository. A copy of the real index keeps the stat cache (`add -u` hashes
 * only the files that changed) and also keeps what is staged but not committed.
 * Returns false when there is no real index (or it cannot be copied); the caller
 * then falls back to `read-tree HEAD`. Never throws.
 *
 * @param {{cwd: string, realIndexPath: string|null, indexFile: string}} params
 *   `realIndexPath` is `git rev-parse --git-path index` output (relative to `cwd` or absolute)
 * @returns {Promise<boolean>}
 */
export const seedIndexFromRealIndex = async ({ cwd, realIndexPath, indexFile }) => {
  if (!realIndexPath || !indexFile) return false;
  const real = isAbsolute(realIndexPath) ? realIndexPath : join(cwd, realIndexPath);
  try {
    if (!(await stat(real)).isFile()) return false;
    await copyFile(real, indexFile);
    return true;
  } catch {
    return false;
  }
};

export default { BUILD_OUTPUT_DIR_PATTERN, classifyUntrackedFiles, isBinaryFile, recoveryBranchFor, seedIndexFromRealIndex };
