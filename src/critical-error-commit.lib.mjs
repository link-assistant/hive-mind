#!/usr/bin/env node

// Issue #1834 (PR #1835 feedback): "On all critical errors we auto commit uncommitted changes by
// default." When the tool hits a critical error and has to discard/restart a session (e.g. the
// corrupted extended-thinking-block 400, anthropics/claude-code#63147), any work the agent already
// made on disk would otherwise be silently lost when the session context is reset. This helper
// commits — and best-effort pushes — those uncommitted changes so the partial work is preserved in
// the PR branch history before recovery proceeds.
//
// It is intentionally dependency-light (receives `$` and `log`) and NEVER throws: a failure to
// commit must not mask the original critical error or break the recovery flow.

import { reportError } from './sentry.lib.mjs';

/**
 * Commit (and optionally push) any uncommitted changes in a working tree before critical-error
 * recovery resets the session.
 *
 * @param {object} params
 * @param {string} params.tempDir - Working tree (git clone) to inspect.
 * @param {string} [params.branchName] - Branch to push to (push skipped when absent).
 * @param {Function} params.$ - command-stream tagged-template executor.
 * @param {Function} params.log - async logger.
 * @param {string} [params.reason] - Short human-readable reason, recorded in the commit message.
 * @param {boolean} [params.push=true] - Whether to push after committing.
 * @returns {Promise<{committed: boolean, pushed: boolean}>}
 */
export const commitUncommittedChangesOnCriticalError = async ({ tempDir, branchName, $, log, reason = 'critical error', push = true }) => {
  if (!tempDir || typeof $ !== 'function') {
    return { committed: false, pushed: false };
  }
  try {
    const statusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
    const statusOutput = statusResult.stdout?.toString().trim() || '';
    if (!statusOutput) {
      await log('   ℹ️ No uncommitted changes to preserve before recovery.', { verbose: true });
      return { committed: false, pushed: false };
    }
    await log(`💾 Critical error (${reason}) — auto-committing uncommitted changes to preserve work before recovery...`);
    for (const line of statusOutput.split('\n')) await log(`   ${line}`, { verbose: true });
    const addResult = await $({ cwd: tempDir })`git add -A`;
    if (addResult.code !== 0) {
      await log(`⚠️ Could not stage changes before recovery: ${addResult.stderr?.toString().trim()}`, { level: 'warning' });
      return { committed: false, pushed: false };
    }
    const commitMessage = `🛟 Auto-commit before critical-error recovery (${reason})`;
    const commitResult = await $({ cwd: tempDir })`git commit -m ${commitMessage}`;
    if (commitResult.code !== 0) {
      await log(`⚠️ Could not commit changes before recovery: ${commitResult.stderr?.toString().trim() || commitResult.stdout?.toString().trim()}`, { level: 'warning' });
      return { committed: false, pushed: false };
    }
    await log('✅ Uncommitted changes committed before recovery.');
    if (!push || !branchName) {
      return { committed: true, pushed: false };
    }
    const pushResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
    if (pushResult.code === 0) {
      await log('✅ Preserved work pushed to remote.');
      return { committed: true, pushed: true };
    }
    await log(`⚠️ Committed locally but could not push preserved work: ${pushResult.stderr?.toString().trim() || pushResult.stdout?.toString().trim()}`, { level: 'warning' });
    return { committed: true, pushed: false };
  } catch (error) {
    reportError(error, { context: 'commit_uncommitted_on_critical_error', tempDir, operation: 'auto_commit_recovery' });
    await log(`⚠️ Error while auto-committing before recovery (continuing anyway): ${error.message}`, { level: 'warning' });
    return { committed: false, pushed: false };
  }
};

export default { commitUncommittedChangesOnCriticalError };
