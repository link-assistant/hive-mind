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

// Issue #3433: work inside git submodules is preserved first, innermost first, on
// `recovery/<branch>` in each submodule's own repository; the snapshot records a submodule pointer
// only when that commit reached a remote (submodule-preserve.lib.mjs).
//
// Issue #3572: the recovery branch is named after the PR branch even when the failure happens
// before solve recorded `branchName` (`fallbackBranchName`), and never `recovery/detached-head`.

import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { filterAiToolScratchFromStatus, isAiToolScratchFile } from './ai-tool-scratch.lib.mjs';
import { BUILD_OUTPUT_DIR_PATTERN, classifyUntrackedFiles, recoveryBranchFor, seedIndexFromRealIndex } from './preserved-files.lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { applyGitlinkDecisions, describeSubmodulePreservation, preserveSubmoduleWork } from './submodule-preserve.lib.mjs';

// Issue #3433: these moved to preserved-files.lib.mjs (submodule-preserve uses them too).
export { BUILD_OUTPUT_DIR_PATTERN, classifyUntrackedFiles, recoveryBranchFor };

/** The path of a porcelain status line; the first line may have lost its leading space to `.trim()`. */
const statusLinePath = line => {
  if (!line?.trim()) return '';
  const start = line[2] === ' ' ? 3 : line[1] === ' ' ? 2 : 3;
  return line.slice(start).trim().replace(/^"|"$/g, '');
};

const describeSkipped = paths => {
  const toolState = paths.filter(isAiToolScratchFile).length;
  if (toolState === paths.length) return 'AI tool state';
  return toolState ? 'build output and AI tool state' : 'build output';
};

/**
 * One line for a failure comment: where the preserved work is and how to drop it.
 *
 * @param {{committed: boolean, pushed: boolean, recoveryBranch?: string, commit?: string, skipped?: string[]}|null} preserved
 * @returns {string}
 */
const describeTopLevelWork = preserved => {
  if (!preserved?.committed) {
    return preserved?.skipped?.length ? `The uncommitted files were ${describeSkipped(preserved.skipped)} (${preserved.skipped.join(', ')}) and were not preserved.` : 'There were no uncommitted changes left to preserve.';
  }
  const where = preserved.pushed ? `pushed to the branch \`${preserved.recoveryBranch}\` (commit ${preserved.commit.slice(0, 8)})` : `committed locally as \`${preserved.recoveryBranch}\` (push failed - see the log)`;
  const drop = preserved.pushed ? ` To drop it: \`git push origin --delete ${preserved.recoveryBranch}\`.` : '';
  return `The uncommitted changes were preserved outside this pull request: ${where}; the pull request branch was not changed.${drop}`;
};

export const describePreservedWork = preserved => {
  const top = describeTopLevelWork(preserved);
  // Issue #3433: say where the work inside submodules went, and loudly which work reached no remote.
  const inSubmodules = describeSubmodulePreservation(preserved);
  if (!inSubmodules) return top;
  return preserved?.committed || preserved?.skipped?.length ? `${top} ${inSubmodules}` : inSubmodules;
};

/**
 * Issue #3572: the name of the recovery branch. The PR branch when it is known
 * (`branchName`, else `fallbackBranchName` - the PR branch solve resolved before
 * it checked the branch out), else the branch that is checked out, else
 * `recovery/detached-<sha>-<time>`. Never throws.
 */
const resolveRecoveryBranch = async ({ git, branchName, fallbackBranchName }) => {
  const known = branchName || fallbackBranchName;
  if (known) return recoveryBranchFor(known);
  const read = async run => {
    try {
      const result = await run();
      return result?.code === 0 ? result.stdout?.toString().trim() || null : null;
    } catch {
      return null;
    }
  };
  const checkedOut = await read(() => git`git symbolic-ref --short -q HEAD`);
  if (checkedOut) return recoveryBranchFor(checkedOut);
  return recoveryBranchFor(null, { sha: await read(() => git`git rev-parse HEAD`) });
};

/**
 * Preserve (and optionally push) any uncommitted changes in a working tree on the
 * `recovery/<branch>` branch before critical-error recovery resets the session.
 *
 * @param {object} params
 * @param {string} params.tempDir - Working tree (git clone) to inspect.
 * @param {string} [params.branchName] - The PR branch; its work goes to `recovery/<branchName>`.
 * @param {string|null} [params.fallbackBranchName] - Issue #3572: the PR branch solve already knows
 *   (argv / PR URL) when `branchName` is not recorded yet; never `recovery/detached-head`.
 * @param {Function} params.$ - command-stream tagged-template executor.
 * @param {Function} params.log - async logger.
 * @param {string} [params.reason] - Short human-readable reason, recorded in the commit message.
 * @param {boolean} [params.push=true] - Whether to push the recovery branch.
 * @returns {Promise<{committed: boolean, pushed: boolean, recoveryBranch?: string, commit?: string, preserved?: string[], skipped?: string[], submodules?: Object[], submodulesFailed?: Object[]}>}
 *   Issue #3433: with submodule work, `submodules` lists the work preserved inside them and
 *   `submodulesFailed` the work that reached no remote (its pointer is not recorded).
 */
export const commitUncommittedChangesOnCriticalError = async ({ tempDir, branchName, fallbackBranchName = null, $, log, reason = 'critical error', push = true }) => {
  if (!tempDir || typeof $ !== 'function') {
    return { committed: false, pushed: false };
  }
  const recoveryBranch = await resolveRecoveryBranch({ git: $({ cwd: tempDir }), branchName, fallbackBranchName });
  // Issue #3433: the work inside submodules first, innermost first, each pushed to its own
  // remote; the snapshot below records only the submodule pointers that reached a remote.
  const inSubmodules = await preserveSubmoduleWork({ $, cwd: tempDir, branchName, recoveryBranch, reason, mode: 'snapshot', push, log, message: `🛟 Work preserved before critical-error recovery (${reason})` });
  const outcome = await preserveTopLevel({ tempDir, recoveryBranch, $, log, reason, push, submoduleLinks: inSubmodules.top });
  return inSubmodules.attempted ? { ...outcome, submodules: inSubmodules.submodules, submodulesFailed: inSubmodules.failed } : outcome;
};

const preserveTopLevel = async ({ tempDir, recoveryBranch, $, log, reason, push, submoduleLinks }) => {
  const git = $({ cwd: tempDir });
  let indexFile = null;
  try {
    const statusResult = await git`git status --porcelain --untracked-files=all 2>&1`;
    const statusOutput = statusResult.stdout?.toString().trim() || '';
    if (!statusOutput) {
      await log('   ℹ️ No uncommitted changes to preserve before recovery.', { verbose: true });
      return { committed: false, pushed: false };
    }
    // Issue #3656: only AI tool state (e.g. `.claude/worktrees/`) is uncommitted - skip the whole
    // snapshot instead of building a private index of the whole repository for nothing.
    if (!submoduleLinks?.length && !filterAiToolScratchFromStatus(statusOutput)) {
      const toolState = statusOutput.split('\n').map(statusLinePath).filter(Boolean);
      await log(`   ℹ️ Only AI tool state is uncommitted (${toolState.join(', ')}); nothing to preserve.`);
      return { committed: false, pushed: false, skipped: toolState };
    }
    await log(`💾 Critical error (${reason}) — preserving uncommitted changes on ${recoveryBranch} (the PR branch is not changed)...`);
    for (const line of statusOutput.split('\n')) await log(`   ${line}`, { verbose: true });

    const untrackedResult = await git`git ls-files --others --exclude-standard`;
    const untracked = (untrackedResult.stdout?.toString() || '').split('\n').filter(Boolean);
    const { keep, skipped } = await classifyUntrackedFiles(tempDir, untracked);
    if (skipped.length) await log(`   ⏭️ Not preserved (build output or AI tool state): ${skipped.join(', ')}`);

    const indexPath = (await git`git rev-parse --git-path hive-mind-recovery.index`).stdout?.toString().trim();
    indexFile = isAbsolute(indexPath) ? indexPath : join(tempDir, indexPath);
    // Issue #3656: start from a copy of the real index (stat cache kept, so `add -u` hashes only the
    // changed files); `read-tree HEAD` only when there is no real index.
    const realIndexPath = (await $({ cwd: tempDir, signal: AbortSignal.timeout(30_000) })`git rev-parse --git-path index`).stdout?.toString().trim();
    const seeded = await seedIndexFromRealIndex({ cwd: tempDir, realIndexPath, indexFile });
    const steps = [...(seeded ? [] : [() => git`GIT_INDEX_FILE=${indexFile} git read-tree HEAD`]), () => git`GIT_INDEX_FILE=${indexFile} git add -u`, ...keep.map(path => () => git`GIT_INDEX_FILE=${indexFile} git add -- ${path}`)];
    for (const step of steps) {
      const result = await step();
      if (result.code !== 0) {
        await log(`⚠️ Could not stage changes for ${recoveryBranch}: ${result.stderr?.toString().trim()}`, { level: 'warning' });
        return { committed: false, pushed: false, skipped };
      }
    }
    // Issue #3433: a submodule pointer is recorded only when its commit reached a remote.
    const links = await applyGitlinkDecisions({ $, cwd: tempDir, indexFile, children: submoduleLinks || [] });
    if (!links.ok) {
      await log(`⚠️ Could not record submodule pointers for ${recoveryBranch}: ${links.errors.join('; ')}`, { level: 'warning' });
      return { committed: false, pushed: false, skipped };
    }
    const tree = (await git`GIT_INDEX_FILE=${indexFile} git write-tree`).stdout?.toString().trim();
    const headTree = (await git`git rev-parse HEAD^{tree}`).stdout?.toString().trim();
    if (!tree || tree === headTree) {
      await log(submoduleLinks?.length ? '   ℹ️ Nothing outside the submodules is left to preserve.' : '   ℹ️ Nothing but build output or AI tool state was uncommitted; nothing to preserve.');
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
    // Issue #3572: pushed under the resolved name even before solve recorded the PR branch.
    if (!push) return outcome;
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
