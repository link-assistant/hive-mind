#!/usr/bin/env node

// Issue #4079: a failed run preserves its uncommitted work on `recovery/<branch>` (issue #2315),
// but the next `solve` of the same pull request starts from a fresh clone of the PR branch and
// never looked there, so the work was lost unless an operator noticed the branch. On a continue
// run this module finds that branch and:
//
// - applies its changes to the working tree (uncommitted, for the session to review and commit)
//   when the PR branch is still at the commit the work was preserved from;
// - does nothing when the PR branch already contains those changes;
// - otherwise (the PR branch moved on and the changes no longer apply cleanly) tells the session
//   where the work is, so it can bring over what is still needed.
//
// The recovery branch itself is never changed or deleted. Like critical-error-commit.lib.mjs this
// is dependency-light (receives `$` and `log`) and never throws.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recoveryBranchFor } from './critical-error-commit.lib.mjs';

const RESTORE_TIMEOUT_MS = 2 * 60_000;
const text = result => result?.stdout?.toString().trim() || '';

/**
 * @param {Object} params
 * @param {string} params.tempDir - the clone, checked out on the PR branch
 * @param {string} params.branchName - the PR branch
 * @param {Function} params.$ - command-stream style `$`
 * @param {Function} params.log
 * @param {string} [params.remote='origin'] - the remote the recovery branch was pushed to
 * @returns {Promise<{status: 'none'|'applied'|'already-applied'|'not-applied'|'error', recoveryBranch?: string, commit?: string, files?: string[], feedbackLines: string[]}>}
 */
export const restoreRecoveryBranchWork = async ({ tempDir, branchName, $, log, remote = 'origin' }) => {
  if (!tempDir || !branchName || typeof $ !== 'function') return { status: 'none', feedbackLines: [] };
  // One bound for the whole check: a hung fetch must not hold the run (the work stays on the branch).
  const git = $({ cwd: tempDir, signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS) });
  const recoveryBranch = recoveryBranchFor(branchName);
  let patchDir = null;
  try {
    const listing = await git`git ls-remote --heads ${remote} ${`refs/heads/${recoveryBranch}`} 2>&1`;
    if (listing.code !== 0) throw new Error(`git ls-remote ${remote} failed: ${text(listing)}`);
    const commit = text(listing).split(/\s+/)[0];
    if (!/^[0-9a-f]{40,64}$/.test(commit || '')) return { status: 'none', recoveryBranch, feedbackLines: [] };
    await log(`\n🛟 Found work preserved by a previous run on ${recoveryBranch} (${commit.slice(0, 8)})`);
    const fetched = await git`git fetch --no-tags ${remote} ${`+refs/heads/${recoveryBranch}:refs/remotes/${remote}/${recoveryBranch}`} 2>&1`;
    if (fetched.code !== 0) throw new Error(`git fetch ${recoveryBranch} failed: ${text(fetched)}`);
    const parent = text(await git`git rev-parse ${`${commit}^`}`);
    const head = text(await git`git rev-parse HEAD`);
    const files = text(await git`git diff --name-only ${parent} ${commit}`)
      .split('\n')
      .filter(Boolean);
    patchDir = await mkdtemp(join(tmpdir(), 'hive-mind-recovery-'));
    const patch = join(patchDir, 'recovery.patch');
    const diff = await git`git diff --binary --full-index ${parent} ${commit} --output=${patch}`;
    if (diff.code !== 0) throw new Error(`git diff of ${recoveryBranch} failed: ${text(diff)}`);
    const where = `\`${recoveryBranch}\` (commit ${commit.slice(0, 8)}, ${files.length} file${files.length === 1 ? '' : 's'}: ${files.slice(0, 10).join(', ')}${files.length > 10 ? ', …' : ''})`;

    if (head !== parent && (await git`git apply --check --reverse ${patch} 2>&1`).code === 0) {
      await log(`   ✅ The pull request branch already contains it; nothing to restore`);
      return { status: 'already-applied', recoveryBranch, commit, files, feedbackLines: [] };
    }
    const dirty = text(await git`git status --porcelain --untracked-files=no`);
    if (head === parent && !dirty && (await git`git apply --check ${patch} 2>&1`).code === 0) {
      const applied = await git`git apply ${patch} 2>&1`;
      if (applied.code !== 0) throw new Error(`git apply failed: ${text(applied)}`);
      await log(`   ✅ Restored it to the working tree as uncommitted changes (${files.length} file${files.length === 1 ? '' : 's'}); the recovery branch is kept`);
      return {
        status: 'applied',
        recoveryBranch,
        commit,
        files,
        feedbackLines: [`Work the previous run left uncommitted when it failed was preserved on ${where} and has been restored to the working tree as uncommitted changes. Review it, keep and commit what is correct, and discard the rest.`],
      };
    }
    await log(`   ⚠️ Not restored automatically: ${head === parent ? 'the working tree has changes' : 'the pull request branch has moved on since it was preserved'}`, { level: 'warning' });
    return {
      status: 'not-applied',
      recoveryBranch,
      commit,
      files,
      feedbackLines: [`Work the previous run left uncommitted when it failed is preserved on ${where}, which is not part of this pull request and could not be restored automatically. Inspect it with \`git fetch ${remote} ${recoveryBranch}\` and \`git diff HEAD ${remote}/${recoveryBranch}\` (or \`git show ${commit.slice(0, 8)}\`), and bring over what this pull request still needs.`],
    };
  } catch (error) {
    await log(`⚠️ Could not check ${recoveryBranch} for preserved work: ${error.message}`, { level: 'warning', verbose: true });
    return { status: 'error', recoveryBranch, feedbackLines: [] };
  } finally {
    if (patchDir) await rm(patchDir, { recursive: true, force: true }).catch(() => {});
  }
};

export default { restoreRecoveryBranchWork };
