#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

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
  await ensureUseM();
}
const use = globalThis.use;
const { $ } = await use('command-stream');

const lib = await import('./lib.mjs');
const { log, ghCmdRetry } = lib;
const githubLib = await import('./github.lib.mjs');

/**
 * Probe whether the repository allows forking via the GitHub API
 * (`allow_forking` is true for repos that can be forked by users with read
 * access — including private repositories). Returns `null` when the
 * attribute could not be determined so callers can decide a safe default.
 *
 * Kept here (instead of github.lib.mjs) because it's only used by the
 * auto-fork branch and the existing `detectRepositoryVisibility` already
 * makes a separate API call; this avoids reshuffling shared helpers.
 *
 * Issue #1795: a private repository with read-only access can still be
 * forked when `allow_forking` is true, so failing early was overly
 * conservative.
 */
async function detectAllowForking(owner, repo) {
  const result = await ghCmdRetry(() => $`gh api repos/${owner}/${repo} --jq .allow_forking`, { label: `allow_forking ${owner}/${repo}` });
  if (result.code !== 0) return null;
  const raw = result.stdout.toString().trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

function describeRepoPermissionLevel(permissions) {
  if (permissions.admin === true) return 'Admin';
  if (permissions.maintain === true) return 'Maintain';
  if (permissions.push === true) return 'Write';
  if (permissions.triage === true) return 'Triage';
  if (permissions.pull === true) return 'Read';
  return 'No confirmed repository access';
}

/**
 * Handle the --auto-fork option: when the user lacks write access, attempt
 * to enable fork mode (including for private repositories where
 * `allow_forking` is true). Only fail when forking is also unavailable.
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
        // Issue #1795: read access to a private repo is enough to fork it
        // when the upstream allows forking. Probe `allow_forking` before
        // bailing out so users with limited (read-only) access can still
        // proceed via their own fork.
        const allowForking = await detectAllowForking(owner, repo);
        if (allowForking === false) {
          const permissionLevel = describeRepoPermissionLevel(permissions);

          await log('');
          await log("❌ --auto-fork failed: Repository is private, you don't have write access, and forking is disabled", { level: 'error' });
          await log('');
          await log('   🔍 What happened:', { level: 'error' });
          await log(`      Repository ${owner}/${repo} is private`, { level: 'error' });
          await log(`      Your detected GitHub repository access level is ${permissionLevel}`, { level: 'error' });
          await log(`      API permissions: ${JSON.stringify(permissions)}`, { level: 'error' });
          await log('      Direct branch mode requires push/write access, but permissions.push is false', { level: 'error' });
          await log("      Fork mode is also unavailable because the repository owner disabled private forking ('allow_forking' is false)", {
            level: 'error',
          });
          await log('');
          await log('   💡 Solution:', { level: 'error' });
          await log('      • To let Hive Mind work directly in this repository:', { level: 'error' });
          await log(`        Ask an owner/admin to open https://github.com/${owner}/${repo}/settings/access`, { level: 'error' });
          await log('        Then add this GitHub account or its team with the Write role (Maintain/Admin also works)', { level: 'error' });
          await log('      • To let Hive Mind work through a fork instead:', { level: 'error' });
          await log(`        Ask an owner/admin to open https://github.com/${owner}/${repo}/settings`, { level: 'error' });
          await log('        Then enable Settings -> General -> Features -> Allow forking', { level: 'error' });
          await log('        For organization-owned private repositories, the organization must also allow private repository forks', {
            level: 'error',
          });
          await log('');
          await safeExit(1, 'Auto-fork failed - private repository without access and forking is disabled');
          return;
        }

        if (allowForking === true) {
          await log('✅ Auto-fork: Read-only access to private repository, enabling fork mode (allow_forking=true)');
        } else {
          await log("✅ Auto-fork: Read-only access to private repository, attempting fork mode (allow_forking couldn't be confirmed)");
          await log("   ⚠️  Could not determine 'allow_forking' for the private repository; letting gh repo fork report the exact result", {
            verbose: true,
            level: 'warning',
          });
        }

        argv.fork = true;
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
