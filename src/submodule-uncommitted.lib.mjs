/**
 * The end-of-session and kill/interrupt "uncommitted changes?" check, with git submodules.
 *
 * Issue #3433: each tool's `checkForUncommittedChanges` runs `git status
 * --porcelain` in the top-level repository only. Work inside a submodule shows
 * there as one ` M modules/sandbox` line at best, and not at all when the work
 * is commits that the parent already records but that exist on no remote.
 * {@link withSubmoduleWork} wraps any tool's check:
 *
 * - without `.gitmodules` or without work inside submodules, the tool's check
 *   runs unchanged;
 * - otherwise the submodule work is listed; with auto-commit (kill, CTRL+C,
 *   limit reached, critical error) it is committed and pushed inside each
 *   submodule first (innermost first), and the parent then records only the
 *   pointers that reached a remote; without auto-commit, work inside
 *   submodules asks for a restart exactly like uncommitted files do.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3433
 */

import { ensureAiToolScratchIgnored } from './ai-tool-scratch.lib.mjs';
import { SUBMODULE_NETWORK_TIMEOUT_MS, attempt, collectSubmoduleWork, errorOf, formatSubmoduleWorkLines, hasGitmodules, runIn, summarizeSubmoduleWork } from './git-submodules.lib.mjs';
import { preserveSubmoduleWork } from './submodule-preserve.lib.mjs';
import { unstageUnregisteredGitlinks } from './unregistered-gitlinks.lib.mjs';

/** The name each tool uses in its auto-commit message. */
export const TOOL_COMMIT_NAMES = { claude: 'Claude', codex: 'Codex', agent: 'Agent', gemini: 'Gemini', opencode: 'OpenCode', qwen: 'Qwen Code' };

export const toolCommitName = argv => (argv?.useAgentCommander ? 'Agent' : TOOL_COMMIT_NAMES[argv?.tool] || 'Claude');

/** Commit the parent's own changes, leaving out the pointers of submodules whose work reached no remote. */
const commitParentWithoutFailedPointers = async ({ $, tempDir, branchName, log, failed, message }) => {
  await ensureAiToolScratchIgnored(tempDir, log);
  const git = runIn($, tempDir);
  const added = await attempt(() => git`git add -A`);
  if (added.code !== 0) {
    await log(`⚠️ Warning: Could not stage changes: ${errorOf(added)}`, { level: 'warning' });
    return;
  }
  // Issue #3572: never commit an embedded repository that `.gitmodules` does not list.
  await unstageUnregisteredGitlinks(tempDir, $, log);
  for (const entry of failed) await attempt(() => git`git reset -q -- ${entry.smPath}`);
  const staged = await attempt(() => git`git diff --cached --quiet`);
  if (staged.code === 0) {
    await log('ℹ️ Nothing outside the unpushed submodules is left to commit.');
    return;
  }
  const committed = await attempt(() => git`git commit -m ${message}`);
  if (committed.code !== 0) {
    await log(`⚠️ Warning: Could not commit changes: ${errorOf(committed)}`, { level: 'warning' });
    return;
  }
  await log(`✅ Changes committed (without the pointers of: ${failed.map(entry => entry.path).join(', ')})`);
  const pushed = await attempt(() => runIn($, tempDir, SUBMODULE_NETWORK_TIMEOUT_MS)`git push origin ${branchName} 2>&1`);
  if (pushed.code === 0) await log('✅ Changes pushed successfully');
  else await log(`⚠️ Warning: Could not push changes: ${errorOf(pushed)}`, { level: 'warning' });
};

/**
 * Wrap a tool's `checkForUncommittedChanges(tempDir, owner, repo, branchName, $, log, autoCommit, autoRestartEnabled)`.
 *
 * @param {Function} check - the tool's check
 * @param {{tool?: string}} [options] - the name in the auto-commit message
 * @returns {Function} a check with the same signature and return value
 */
export const withSubmoduleWork = (check, { tool = 'Claude' } = {}) => {
  if (typeof check !== 'function') return check;
  return async (tempDir, owner, repo, branchName, $, log, autoCommit = false, autoRestartEnabled = true) => {
    const runCheck = () => check(tempDir, owner, repo, branchName, $, log, autoCommit, autoRestartEnabled);
    if (!hasGitmodules(tempDir) || typeof $ !== 'function') return runCheck();
    const work = await collectSubmoduleWork({ $, cwd: tempDir }).catch(() => null);
    if (!work?.dirty.length) return runCheck();
    await log(`\n📦 Work inside git submodules: ${summarizeSubmoduleWork(work)}`);
    for (const line of formatSubmoduleWorkLines(work)) await log(`   ${line}`);
    if (!autoCommit) {
      const restart = await runCheck();
      if (restart) return restart;
      if (!autoRestartEnabled) {
        await log('⚠️  Work inside submodules is not on any remote and auto-restart is disabled; commit and push it inside each submodule.', { level: 'warning' });
        return false;
      }
      await log('🔄 AUTO-RESTART: Restarting so the work inside the submodules gets committed and pushed...');
      return true;
    }
    const message = `Auto-commit: Changes made by ${tool} during problem-solving session`;
    const kept = await preserveSubmoduleWork({ $, cwd: tempDir, branchName, mode: 'commit', reason: 'auto-commit', message, log });
    const failedTop = kept.top.filter(entry => !entry.ok);
    if (!failedTop.length) return runCheck();
    await log(`❌ Not recording the pointers of ${failedTop.length} submodule(s) whose work reached no remote: ${failedTop.map(entry => entry.path).join(', ')}`, { level: 'error' });
    await commitParentWithoutFailedPointers({ $, tempDir, branchName, log, failed: failedTop, message });
    return false;
  };
};

export default { TOOL_COMMIT_NAMES, toolCommitName, withSubmoduleWork };
