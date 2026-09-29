#!/usr/bin/env node

// Issue #1834 (PR #1835 feedback): "On all critical errors we auto commit uncommitted changes by
// default." When the tool hits a critical error and has to discard/restart a session (e.g. the
// corrupted extended-thinking-block 400, anthropics/claude-code#63147), any work the agent already
// made on disk would otherwise be silently lost when the session context is reset.
//
// Issue #2315: that commit went into the PR branch with `git add -A`, so kotlinc's `Main.jar` and
// a garbage `Main.java` became part of the reviewable diff. The work is now preserved as a snapshot
// commit on a separate `recovery/<branch>` branch, built in a private index: the PR branch, the
// index and the working tree are left exactly as they were (the next session still sees the
// uncommitted files and is told to commit, ignore or delete them). Untracked binaries and known
// build directories are not preserved at all.
//
// It is intentionally dependency-light (receives `$` and `log`) and NEVER throws: a failure to
// preserve must not mask the original critical error or break the recovery flow.

import { open, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { reportError } from './sentry.lib.mjs';

/** Directories that hold build output in the ecosystems Hive Mind works on. */
export const BUILD_OUTPUT_DIR_PATTERN = /(^|\/)(target|build|out|bin|obj|dist|node_modules|__pycache__|\.gradle|\.venv|venv|\.next|coverage)\//;

/** The branch that receives the preserved work of `branchName`. */
export const recoveryBranchFor = branchName => `recovery/${branchName || 'detached-head'}`;

/** git's own heuristic: a NUL byte in the first 8000 bytes means binary. */
const isBinaryFile = async path => {
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
 * Split untracked paths into those worth preserving and build output.
 *
 * @param {string} tempDir
 * @param {string[]} paths - `git ls-files --others --exclude-standard` output
 * @returns {Promise<{keep: string[], skipped: string[]}>}
 */
export const classifyUntrackedFiles = async (tempDir, paths) => {
  const keep = [];
  const skipped = [];
  for (const path of paths) {
    if (BUILD_OUTPUT_DIR_PATTERN.test(path) || (await isBinaryFile(join(tempDir, path)))) skipped.push(path);
    else keep.push(path);
  }
  return { keep, skipped };
};

/**
 * One line for a failure comment: where the preserved work is and how to drop it.
 *
 * @param {{committed: boolean, pushed: boolean, recoveryBranch?: string, commit?: string, skipped?: string[]}|null} preserved
 * @returns {string}
 */
export const describePreservedWork = preserved => {
  if (!preserved?.committed) {
    return preserved?.skipped?.length ? `The uncommitted files were build output (${preserved.skipped.join(', ')}) and were not preserved.` : 'There were no uncommitted changes left to preserve.';
  }
  const where = preserved.pushed ? `pushed to the branch \`${preserved.recoveryBranch}\` (commit ${preserved.commit.slice(0, 8)})` : `committed locally as \`${preserved.recoveryBranch}\` (push failed - see the log)`;
  const drop = preserved.pushed ? ` To drop it: \`git push origin --delete ${preserved.recoveryBranch}\`.` : '';
  return `The uncommitted changes were preserved outside this pull request: ${where}; the pull request branch was not changed.${drop}`;
};

/**
 * Preserve (and optionally push) any uncommitted changes in a working tree on the
 * `recovery/<branch>` branch before critical-error recovery resets the session.
 *
 * @param {object} params
 * @param {string} params.tempDir - Working tree (git clone) to inspect.
 * @param {string} [params.branchName] - The PR branch; its work goes to `recovery/<branchName>`.
 * @param {Function} params.$ - command-stream tagged-template executor.
 * @param {Function} params.log - async logger.
 * @param {string} [params.reason] - Short human-readable reason, recorded in the commit message.
 * @param {boolean} [params.push=true] - Whether to push the recovery branch.
 * @returns {Promise<{committed: boolean, pushed: boolean, recoveryBranch?: string, commit?: string, preserved?: string[], skipped?: string[]}>}
 */
export const commitUncommittedChangesOnCriticalError = async ({ tempDir, branchName, $, log, reason = 'critical error', push = true }) => {
  if (!tempDir || typeof $ !== 'function') {
    return { committed: false, pushed: false };
  }
  const git = $({ cwd: tempDir });
  let indexFile = null;
  try {
    const statusResult = await git`git status --porcelain --untracked-files=all 2>&1`;
    const statusOutput = statusResult.stdout?.toString().trim() || '';
    if (!statusOutput) {
      await log('   ℹ️ No uncommitted changes to preserve before recovery.', { verbose: true });
      return { committed: false, pushed: false };
    }
    const recoveryBranch = recoveryBranchFor(branchName);
    await log(`💾 Critical error (${reason}) — preserving uncommitted changes on ${recoveryBranch} (the PR branch is not changed)...`);
    for (const line of statusOutput.split('\n')) await log(`   ${line}`, { verbose: true });

    const untrackedResult = await git`git ls-files --others --exclude-standard`;
    const untracked = (untrackedResult.stdout?.toString() || '').split('\n').filter(Boolean);
    const { keep, skipped } = await classifyUntrackedFiles(tempDir, untracked);
    if (skipped.length) await log(`   ⏭️ Not preserved (build output): ${skipped.join(', ')}`);

    const indexPath = (await git`git rev-parse --git-path hive-mind-recovery.index`).stdout?.toString().trim();
    indexFile = isAbsolute(indexPath) ? indexPath : join(tempDir, indexPath);
    const steps = [() => git`GIT_INDEX_FILE=${indexFile} git read-tree HEAD`, () => git`GIT_INDEX_FILE=${indexFile} git add -u`, ...keep.map(path => () => git`GIT_INDEX_FILE=${indexFile} git add -- ${path}`)];
    for (const step of steps) {
      const result = await step();
      if (result.code !== 0) {
        await log(`⚠️ Could not stage changes for ${recoveryBranch}: ${result.stderr?.toString().trim()}`, { level: 'warning' });
        return { committed: false, pushed: false, skipped };
      }
    }
    const tree = (await git`GIT_INDEX_FILE=${indexFile} git write-tree`).stdout?.toString().trim();
    const headTree = (await git`git rev-parse HEAD^{tree}`).stdout?.toString().trim();
    if (!tree || tree === headTree) {
      await log('   ℹ️ Nothing but build output was uncommitted; nothing to preserve.');
      return { committed: false, pushed: false, skipped };
    }
    const commitMessage = `🛟 Work preserved before critical-error recovery (${reason})`;
    const commitResult = await git`git commit-tree ${tree} -p HEAD -m ${commitMessage}`;
    const commit = commitResult.stdout?.toString().trim();
    if (commitResult.code !== 0 || !commit) {
      await log(`⚠️ Could not commit changes before recovery: ${commitResult.stderr?.toString().trim()}`, { level: 'warning' });
      return { committed: false, pushed: false, skipped };
    }
    await git`git update-ref ${`refs/heads/${recoveryBranch}`} ${commit}`;
    const preserved = ((await git`git diff-tree -r --name-only HEAD ${tree}`).stdout?.toString() || '').split('\n').filter(Boolean);
    const outcome = { committed: true, pushed: false, recoveryBranch, commit, preserved, skipped };
    await log(`✅ Uncommitted changes preserved as ${commit.slice(0, 8)} on ${recoveryBranch}.`);
    if (!push || !branchName) return outcome;
    const pushResult = await git`git push --force origin ${`${commit}:refs/heads/${recoveryBranch}`} 2>&1`;
    if (pushResult.code === 0) {
      await log(`✅ Preserved work pushed to ${recoveryBranch}.`);
      return { ...outcome, pushed: true };
    }
    await log(`⚠️ Preserved locally but could not push ${recoveryBranch}: ${pushResult.stderr?.toString().trim() || pushResult.stdout?.toString().trim()}`, { level: 'warning' });
    return outcome;
  } catch (error) {
    reportError(error, { context: 'commit_uncommitted_on_critical_error', tempDir, operation: 'auto_commit_recovery' });
    await log(`⚠️ Error while preserving work before recovery (continuing anyway): ${error.message}`, { level: 'warning' });
    return { committed: false, pushed: false };
  } finally {
    if (indexFile) await rm(indexFile, { force: true }).catch(() => {});
  }
};

export default { BUILD_OUTPUT_DIR_PATTERN, classifyUntrackedFiles, commitUncommittedChangesOnCriticalError, describePreservedWork, recoveryBranchFor };
