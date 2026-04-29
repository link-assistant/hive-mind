#!/usr/bin/env node

/**
 * Fork-detection helpers for solve.mjs
 *
 * Extracted from solve.mjs to keep the file under the 1500-line CI limit.
 * - handleAutoForkOption: implements the --auto-fork detection branch.
 * - handleMaintainerForkAccess: handles the
 *   --allow-to-push-to-contributors-pull-requests-as-maintainer follow-up
 *   that runs after a fork PR has been detected.
 *
 * Tests for Issue #1716 grep solve.mjs textually, so the *call sites* there
 * still hold the canonical condition checks; only the bodies live here.
 */

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;
const { $ } = await use('command-stream');

const lib = await import('./lib.mjs');
const { log, ghCmdRetry } = lib;
const githubLib = await import('./github.lib.mjs');

/**
 * Handle the --auto-fork option: when the user lacks write access to a public
 * repository, automatically enable fork mode; when the repository is private,
 * fail with an actionable error.
 *
 * Mutates argv.fork in place when fork mode is enabled.
 *
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {object} params.argv - CLI arguments (mutated: argv.fork may be set)
 * @param {(code: number, reason?: string) => Promise<void>} params.safeExit
 */
export async function handleAutoForkOption({ owner, repo, argv, safeExit }) {
  if (!argv.autoFork || argv.fork) return;

  const { detectRepositoryVisibility } = githubLib;
  await log('🔍 Checking repository access for auto-fork...');
  const permResult = await ghCmdRetry(() => $`gh api repos/${owner}/${repo} --jq .permissions`, { label: 'auto-fork perms' });

  if (permResult.code === 0) {
    const permissions = JSON.parse(permResult.stdout.toString().trim());
    const hasWriteAccess = permissions.push === true || permissions.admin === true || permissions.maintain === true;

    if (!hasWriteAccess) {
      const { isPublic } = await detectRepositoryVisibility(owner, repo);

      if (!isPublic) {
        await log('');
        await log("❌ --auto-fork failed: Repository is private and you don't have write access", { level: 'error' });
        await log('');
        await log('   🔍 What happened:', { level: 'error' });
        await log(`      Repository ${owner}/${repo} is private`, { level: 'error' });
        await log("      You don't have write access to this repository", { level: 'error' });
        await log('      --auto-fork cannot create a fork of a private repository you cannot access', { level: 'error' });
        await log('');
        await log('   💡 Solution:', { level: 'error' });
        await log('      • Request collaborator access from the repository owner', { level: 'error' });
        await log(`        https://github.com/${owner}/${repo}/settings/access`, { level: 'error' });
        await log('');
        await safeExit(1, 'Auto-fork failed - private repository without access');
        return;
      }

      await log('✅ Auto-fork: No write access detected, enabling fork mode');
      argv.fork = true;
    } else {
      const { isPublic } = await detectRepositoryVisibility(owner, repo);
      await log(`✅ Auto-fork: Write access detected to ${isPublic ? 'public' : 'private'} repository, working directly on repository`);
    }
  } else {
    const { isPublic } = await detectRepositoryVisibility(owner, repo);

    if (!isPublic) {
      await log('');
      await log('❌ --auto-fork failed: Could not verify permissions for private repository', { level: 'error' });
      await log('');
      await log('   🔍 What happened:', { level: 'error' });
      await log(`      Repository ${owner}/${repo} is private`, { level: 'error' });
      await log('      Could not check your permissions to this repository', { level: 'error' });
      await log('');
      await log('   💡 Solutions:', { level: 'error' });
      await log('      • Check your GitHub CLI authentication: gh auth status', { level: 'error' });
      await log("      • Request collaborator access if you don't have it yet", { level: 'error' });
      await log(`        https://github.com/${owner}/${repo}/settings/access`, { level: 'error' });
      await log('');
      await safeExit(1, 'Auto-fork failed - cannot verify private repository permissions');
      return;
    }

    await log('⚠️  Auto-fork: Could not check permissions, enabling fork mode for public repository');
    argv.fork = true;
  }
}

/**
 * After a fork PR is detected, optionally check whether the maintainer can
 * push directly to the contributor's fork. If not, request access.
 *
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string|number} params.prNumber
 */
export async function handleMaintainerForkAccess({ owner, repo, prNumber }) {
  const { checkMaintainerCanModifyPR, requestMaintainerAccess } = githubLib;
  const { canModify } = await checkMaintainerCanModifyPR(owner, repo, prNumber);

  if (canModify) {
    await log('✅ Maintainer can push to fork: Enabled by contributor');
    await log("   Will push changes directly to contributor's fork instead of creating own fork");
    return;
  }

  await log('⚠️  Maintainer cannot push to fork: "Allow edits by maintainers" is not enabled', { level: 'warning' });
  await log('   Posting comment to request access...', { level: 'warning' });
  await requestMaintainerAccess(owner, repo, prNumber);
  await log('   Comment posted. Proceeding with own fork instead.', { level: 'warning' });
}

export default { handleAutoForkOption, handleMaintainerForkAccess };
