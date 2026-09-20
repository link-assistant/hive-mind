#!/usr/bin/env node

/**
 * Preserve a failed session's working tree without advancing its PR branch.
 *
 * The original issue #1834 recovery helper committed and pushed every dirty
 * byte before retrying. Issue #2263 demonstrated why a recovery snapshot is
 * not a solution commit: the failed Kotlin canary published corrupted source
 * and Main.class, then a clean-worktree check treated that commit as success.
 *
 * A git stash object gives recovery the same durable local evidence while
 * leaving HEAD and the pull-request branch untouched. The stash is applied
 * immediately (and kept), so a resumed/fresh agent can inspect and repair the
 * work. Diagnostics are also retained in the normal attached session log.
 *
 * This helper remains best-effort and never throws: preservation failure must
 * not mask the critical error which brought the caller here.
 */

import { ensureAiToolScratchIgnored } from './ai-tool-scratch.lib.mjs';
import { reportError } from './sentry.lib.mjs';

const noopLog = async () => {};
const emptyResult = () => ({ committed: false, pushed: false, preserved: false, recoveryRef: null, restored: false });

/**
 * Snapshot uncommitted changes outside branch history before recovery.
 *
 * `branchName` and `push` remain accepted for API compatibility, but failed or
 * unverified work is intentionally never pushed to that branch (#2263).
 *
 * @param {object} params
 * @param {string} params.tempDir working tree to inspect
 * @param {string} [params.branchName] retained for backwards compatibility
 * @param {Function} params.$ command-stream tagged-template executor
 * @param {Function} [params.log] async logger
 * @param {string} [params.reason] short diagnostic reason
 * @param {boolean} [params.push] retained for backwards compatibility
 * @returns {Promise<{committed: false, pushed: false, preserved: boolean, recoveryRef: (string|null), restored: boolean}>}
 */
export const commitUncommittedChangesOnCriticalError = async ({ tempDir, branchName: _branchName, $, log = noopLog, reason = 'critical error', push: _push = true }) => {
  if (!tempDir || typeof $ !== 'function') return emptyResult();

  try {
    // Local excludes make generated compiler output disappear before both the
    // status probe and stash snapshot. In particular, `javac Main.java` must
    // never turn Main.class into a source change.
    await ensureAiToolScratchIgnored(tempDir, log);

    const statusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
    const statusOutput = statusResult.stdout?.toString().trim() || '';
    if (!statusOutput) {
      await log('   ℹ️ No uncommitted source changes to preserve before recovery.', { verbose: true });
      return emptyResult();
    }

    await log(`💾 Critical error (${reason}) — preserving uncommitted evidence outside the pull-request branch before recovery...`);
    for (const line of statusOutput.split('\n')) await log(`   ${line}`, { verbose: true });

    const recoveryMessage = `hive-mind recovery evidence: ${reason}`;
    const stashResult = await $({ cwd: tempDir })`git stash push --include-untracked --message ${recoveryMessage}`;
    if (stashResult.code !== 0) {
      await log(`⚠️ Could not snapshot changes before recovery: ${stashResult.stderr?.toString().trim() || stashResult.stdout?.toString().trim()}`, { level: 'warning' });
      return emptyResult();
    }

    const refResult = await $({ cwd: tempDir })`git rev-parse --verify refs/stash`;
    const recoveryRef = refResult.code === 0 && refResult.stdout?.toString().trim() ? refResult.stdout.toString().trim() : 'stash@{0}';
    await log(`✅ Recovery evidence preserved outside branch history (${recoveryRef}).`);

    // Apply without dropping: the next agent sees the exact failed worktree,
    // while refs/stash remains an independent recovery copy.
    const restoreResult = await $({ cwd: tempDir })`git stash apply --index ${recoveryRef}`;
    if (restoreResult.code !== 0) {
      await log(`⚠️ Evidence was preserved, but the working tree could not be restored automatically: ${restoreResult.stderr?.toString().trim() || restoreResult.stdout?.toString().trim()}`, { level: 'warning' });
      return { committed: false, pushed: false, preserved: true, recoveryRef, restored: false };
    }

    await log('✅ Failed working tree restored for diagnosis or repair; PR branch HEAD was not changed.');
    return { committed: false, pushed: false, preserved: true, recoveryRef, restored: true };
  } catch (error) {
    reportError(error, { context: 'preserve_uncommitted_on_critical_error', tempDir, operation: 'stash_recovery_evidence' });
    await log(`⚠️ Error while preserving recovery evidence (continuing anyway): ${error.message}`, { level: 'warning' });
    return emptyResult();
  }
};

export default { commitUncommittedChangesOnCriticalError };
