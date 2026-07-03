#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

// Fork upstream-sync module for the solve command.
// Extracted from solve.repository.lib.mjs to keep files under 1500 lines (#1893).

// Use use-m to dynamically import modules for cross-runtime compatibility
// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior; wrap with rate-limit retry (#1726)
const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const $ = wrapDollarWithGhRetry((await use('command-stream')).$);

// Import shared library functions
const lib = await import('./lib.mjs');
const { log, formatAligned } = lib;

// Import exit handler
import { safeExit } from './exit-handler.lib.mjs';

// Issue #1893: helpers that decide whether the fork's default branch may be
// pushed and that distinguish a permission-denied rejection from a genuine
// fork divergence.
const { buildForkDivergenceBlockedReason, buildForkDivergenceFailureActionSection, getForkDefaultBranchDivergenceSnapshot, isPermissionDeniedPushError, shouldPushDefaultBranchToFork } = await import('./solve.branch-divergence.lib.mjs');

const firstNonEmptyLine = value =>
  String(value || '')
    .split('\n')
    .map(line => line.trim())
    .find(Boolean) || '';

const resolveSolveCommand = argv => {
  const issueUrl = argv.url || argv['issue-url'] || argv._?.[0] || '<issue-url>';
  return `solve ${issueUrl}`;
};

const extractGitHubUrlNumber = argv => {
  const url = String(argv.url || argv['issue-url'] || argv._?.[0] || '');
  const match = url.match(/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/(\d+)/i);
  return match ? { type: match[1] === 'pull' ? 'pulls' : 'issues', number: match[2] } : null;
};

const resolveTaskRequester = async ({ $, owner, repo, argv }) => {
  const target = extractGitHubUrlNumber(argv);
  if (!target) return null;
  const result = await $({ silent: true })`gh api repos/${owner}/${repo}/${target.type}/${target.number} --jq .user.login 2>&1`;
  return result.code === 0 ? firstNonEmptyLine(result.stdout) : null;
};

const logForkDivergenceDetails = async ({ snapshot, currentUser, taskRequester, solveCommand, includeAction = true }) => {
  await log('');
  await log('  🔍 What happened:');
  await log(`     Git rejected updating ${snapshot.forkedRepo}:${snapshot.branchName} after Hive Mind synced the local branch to ${snapshot.upstreamRepo}:${snapshot.branchName}.`);
  await log('');
  await log('  📦 Current state:');
  await log(`     Fork: ${snapshot.forkedRepo}`);
  await log(`     Upstream: ${snapshot.upstreamRepo}`);
  await log(`     Branch: ${snapshot.branchName}`);
  if (currentUser) await log(`     Authenticated user: ${currentUser}`);
  if (taskRequester) await log(`     Task requester: ${taskRequester}`);
  if (snapshot.compareUrl) await log(`     Compare: ${snapshot.compareUrl}`);

  if (snapshot.fetchError || snapshot.inspectError) {
    await log('');
    await log('  ⚠️  Safety check incomplete:');
    await log(`     ${snapshot.fetchError || snapshot.inspectError}`);
    await log('     Hive Mind cannot prove whether force-with-lease would overwrite fork-only commits.');
  } else {
    await log(`     Fork-only commits: ${snapshot.forkUniqueCount ?? 'unknown'}`);
    await log(`     Upstream-only commits missing from fork: ${snapshot.upstreamUniqueCount ?? 'unknown'}`);
    if ((snapshot.forkUniqueCount ?? 0) > 0) {
      await log('');
      await log('  ⚠️  Commits that would be lost from the fork default branch:');
      for (const commit of snapshot.uniqueCommits) {
        await log(`     - ${commit.shortSha || commit.sha} ${commit.author || 'unknown author'} ${commit.subject || 'no subject'}`);
      }
      if (snapshot.uniqueCommits.length < snapshot.forkUniqueCount) {
        await log(`     - ... ${snapshot.forkUniqueCount - snapshot.uniqueCommits.length} more commit(s) not shown`);
      }
    } else {
      await log('');
      await log('  ✅ Safety check:');
      await log(`     No commits unique to ${snapshot.forkRef} were found.`);
    }
  }

  const actionSection = buildForkDivergenceFailureActionSection({ snapshot, currentUser, taskRequester, solveCommand });
  if (includeAction) {
    await log('');
    await log('  🔧 GitHub comment guidance:');
    for (const line of actionSection.split('\n')) {
      await log(`     ${line}`);
    }
  }
  await log('');
  return actionSection;
};

// Set up upstream remote and sync fork
export const setupUpstreamAndSync = async (tempDir, forkedRepo, upstreamRemote, owner, repo, argv) => {
  if (!forkedRepo || !upstreamRemote) return;

  await log(`${formatAligned('🔗', 'Setting upstream:', upstreamRemote)}`);

  // Check if upstream remote already exists
  const checkUpstreamResult = await $({ cwd: tempDir })`git remote get-url upstream 2>/dev/null`;
  let upstreamExists = checkUpstreamResult.code === 0;

  if (upstreamExists) {
    await log(`${formatAligned('ℹ️', 'Upstream exists:', 'Using existing upstream remote')}`);
  } else {
    // Add upstream remote since it doesn't exist
    const upstreamResult = await $({ cwd: tempDir })`git remote add upstream https://github.com/${upstreamRemote}.git`;

    if (upstreamResult.code === 0) {
      await log(`${formatAligned('✅', 'Upstream set:', upstreamRemote)}`);
      upstreamExists = true;
    } else {
      await log(`${formatAligned('⚠️', 'Warning:', 'Failed to add upstream remote')}`);
      if (upstreamResult.stderr) {
        await log(`${formatAligned('', 'Error details:', upstreamResult.stderr.toString().trim())}`);
      }
    }
  }

  // Proceed with fork sync if upstream remote is available
  if (upstreamExists) {
    // Fetch upstream
    await log(`${formatAligned('🔄', 'Fetching upstream...', '')}`);
    const fetchResult = await $({ cwd: tempDir })`git fetch upstream`;
    if (fetchResult.code === 0) {
      await log(`${formatAligned('✅', 'Upstream fetched:', 'Successfully')}`);

      // Sync the default branch with upstream to avoid merge conflicts
      await log(`${formatAligned('🔄', 'Syncing default branch...', '')}`);

      // Get current branch so we can return to it after sync
      const currentBranchResult = await $({ cwd: tempDir })`git branch --show-current`;
      if (currentBranchResult.code === 0) {
        const currentBranch = currentBranchResult.stdout.toString().trim();

        // Get the default branch name from the original repository using GitHub API
        const repoInfoResult = await $`gh api repos/${owner}/${repo} --jq .default_branch`;
        if (repoInfoResult.code === 0) {
          const upstreamDefaultBranch = repoInfoResult.stdout.toString().trim();
          await log(`${formatAligned('ℹ️', 'Default branch:', upstreamDefaultBranch)}`);

          // Always sync the default branch, regardless of current branch
          // This ensures fork is up-to-date even if we're working on a different branch

          // Step 1: Switch to default branch if not already on it
          let syncSuccessful = true;
          if (currentBranch !== upstreamDefaultBranch) {
            await log(`${formatAligned('🔄', 'Switching to:', `${upstreamDefaultBranch} branch`)}`);
            const checkoutResult = await $({ cwd: tempDir })`git checkout ${upstreamDefaultBranch}`;
            if (checkoutResult.code !== 0) {
              await log(`${formatAligned('⚠️', 'Warning:', `Failed to checkout ${upstreamDefaultBranch}`)}`);
              syncSuccessful = false; // Cannot proceed with sync
            }
          }

          // Step 2: Sync default branch with upstream (only if checkout was successful)
          if (syncSuccessful) {
            const syncResult = await $({ cwd: tempDir })`git reset --hard upstream/${upstreamDefaultBranch}`;
            if (syncResult.code === 0) {
              await log(`${formatAligned('✅', 'Default branch synced:', `with upstream/${upstreamDefaultBranch}`)}`);

              // Step 3: Push the updated default branch to fork to keep it in sync.
              //
              // Issue #1893: only push the default branch when the current user
              // OWNS the fork. When continuing another contributor's fork PR the
              // fork belongs to them, and "Allow edits by maintainers" grants
              // push access only to the PR branch — never to the fork's default
              // branch. Attempting the push there is guaranteed to be rejected
              // with "permission denied" and is unnecessary, so we skip it and
              // keep working on the PR branch.
              const currentUserResult = await $`gh api user --jq .login`;
              const currentUser = currentUserResult.code === 0 ? currentUserResult.stdout.toString().trim() : null;
              const pushDecision = shouldPushDefaultBranchToFork({ currentUser, forkedRepo });

              if (!pushDecision.shouldPush) {
                await log(`${formatAligned('ℹ️', 'Skipping fork push:', `${upstreamDefaultBranch} synced locally only`)}`);
                await log(`${formatAligned('', 'Reason:', `Fork ${forkedRepo} is owned by ${pushDecision.forkOwner}, not ${currentUser || 'the current user'}`)}`, {
                  verbose: true,
                });
                await log(`${formatAligned('', 'Next:', 'Continuing on the PR branch (maintainer edits allowed on the PR head only)')}`, {
                  verbose: true,
                });
                // Fall through to Step 4 (return to original branch) without pushing.
                if (currentBranch !== upstreamDefaultBranch) {
                  await log(`${formatAligned('🔄', 'Returning to:', `${currentBranch} branch`)}`);
                  const returnResult = await $({ cwd: tempDir })`git checkout ${currentBranch}`;
                  if (returnResult.code === 0) {
                    await log(`${formatAligned('✅', 'Branch restored:', `Back on ${currentBranch}`)}`);
                  } else {
                    await log(`${formatAligned('⚠️', 'Warning:', `Failed to return to ${currentBranch}`)}`);
                  }
                }
                return;
              }

              await log(`${formatAligned('🔄', 'Pushing to fork:', `${upstreamDefaultBranch} branch`)}`);
              const pushResult = await $({ cwd: tempDir })`git push origin ${upstreamDefaultBranch} 2>&1`;
              if (pushResult.code === 0) {
                await log(`${formatAligned('✅', 'Fork updated:', 'Default branch pushed to fork')}`);
              } else {
                // Check if it's a non-fast-forward error (fork has diverged from upstream)
                const errorMsg = (pushResult.stderr ? pushResult.stderr.toString().trim() : '') || (pushResult.stdout ? pushResult.stdout.toString().trim() : '');

                // Issue #1893: a "permission denied" rejection is NOT a divergence.
                // It means the current user cannot write to this fork (e.g. it
                // belongs to another contributor). Force-push / force-with-lease
                // cannot fix that, so never recommend the divergence flag here.
                // Syncing the default branch is best-effort, so we warn and
                // continue working on the PR branch instead of halting.
                if (isPermissionDeniedPushError(errorMsg)) {
                  await log('');
                  await log(`${formatAligned('ℹ️', 'Skipping fork sync:', `No push access to ${forkedRepo}`)}`);
                  await log(`${formatAligned('', 'Reason:', "Fork's default branch is owned by another user; this is expected when")}`, { verbose: true });
                  await log(`${formatAligned('', '', "continuing a contributor's fork PR (maintainer edits cover the PR branch only)")}`, { verbose: true });
                  await log(`${formatAligned('', 'Push output:', errorMsg.split('\n')[0] || errorMsg)}`, { verbose: true });
                  // Return to the original branch and continue without halting.
                  if (currentBranch !== upstreamDefaultBranch) {
                    await log(`${formatAligned('🔄', 'Returning to:', `${currentBranch} branch`)}`);
                    const returnResult = await $({ cwd: tempDir })`git checkout ${currentBranch}`;
                    if (returnResult.code === 0) {
                      await log(`${formatAligned('✅', 'Branch restored:', `Back on ${currentBranch}`)}`);
                    } else {
                      await log(`${formatAligned('⚠️', 'Warning:', `Failed to return to ${currentBranch}`)}`);
                    }
                  }
                  return;
                }

                const isNonFastForward = errorMsg.includes('non-fast-forward') || errorMsg.includes('rejected') || errorMsg.includes('tip of your current branch is behind');

                if (isNonFastForward) {
                  // Fork has diverged from upstream
                  await log('');
                  await log(`${formatAligned('⚠️', 'FORK DIVERGENCE DETECTED', '')}`, { level: 'warn' });
                  const taskRequester = await resolveTaskRequester({ $, owner, repo, argv });
                  const solveCommand = resolveSolveCommand(argv);
                  const divergenceSnapshot = await getForkDefaultBranchDivergenceSnapshot({
                    $,
                    tempDir,
                    branchName: upstreamDefaultBranch,
                    forkedRepo,
                    upstreamRepo: `${owner}/${repo}`,
                  });
                  const failureActionSection = await logForkDivergenceDetails({
                    snapshot: divergenceSnapshot,
                    currentUser,
                    taskRequester,
                    solveCommand,
                    includeAction: !argv.allowForkDivergenceResolutionUsingForcePushWithLease,
                  });
                  const blockedReason = buildForkDivergenceBlockedReason({ snapshot: divergenceSnapshot });

                  // Check if user has enabled automatic force push
                  if (argv.allowForkDivergenceResolutionUsingForcePushWithLease) {
                    await log('  🔄 Auto-resolution ENABLED (--allow-fork-divergence-resolution-using-force-push-with-lease):');
                    await log('     Attempting to force-push with --force-with-lease...');
                    await log('');

                    // Use --force-with-lease for safer force push
                    // This will only force push if the remote hasn't changed since our last fetch
                    await log(`${formatAligned('🔄', 'Force pushing:', 'Syncing fork with upstream (--force-with-lease)')}`);
                    const forcePushResult = await $({
                      cwd: tempDir,
                    })`git push --force-with-lease origin ${upstreamDefaultBranch} 2>&1`;

                    if (forcePushResult.code === 0) {
                      await log(`${formatAligned('✅', 'Fork synced:', 'Successfully force-pushed to align with upstream')}`);
                      await log('');
                    } else {
                      // Force push also failed - this is a more serious issue
                      await log('');
                      await log(`${formatAligned('❌', 'FATAL ERROR:', 'Failed to sync fork with upstream')}`, {
                        level: 'error',
                      });
                      await log('');
                      await log('  🔍 What happened:');
                      await log(`     Fork branch ${upstreamDefaultBranch} has diverged from upstream`);
                      await log('     Both normal push and force-with-lease push failed');
                      await log('');
                      await log('  📦 Error details:');
                      const forceErrorMsg = forcePushResult.stderr ? forcePushResult.stderr.toString().trim() : '';
                      for (const line of forceErrorMsg.split('\n')) {
                        if (line.trim()) await log(`     ${line}`);
                      }
                      await log('');
                      await log('  💡 Possible causes:');
                      await log('     • Fork branch is protected (branch protection rules prevent force push)');
                      await log('     • Someone else pushed to fork after our fetch');
                      await log('     • Insufficient permissions to force push');
                      await log('');
                      await log('  🔧 Manual resolution:');
                      await log(`     1. Visit your fork: https://github.com/${forkedRepo}`);
                      await log('     2. Check branch protection settings');
                      await log('     3. Manually sync fork with upstream:');
                      await log('        git fetch upstream');
                      await log(`        git reset --hard upstream/${upstreamDefaultBranch}`);
                      await log(`        git push --force-with-lease origin ${upstreamDefaultBranch}`);
                      await log('');
                      await safeExit(1, 'Repository setup failed - fork sync failed', { failureActionSection });
                    }
                  } else {
                    await safeExit(1, blockedReason, { failureActionSection });
                  }
                } else {
                  // Some other push error (not divergence-related)
                  await log(`${formatAligned('❌', 'FATAL ERROR:', 'Failed to push updated default branch to fork')}`);
                  await log(`${formatAligned('', 'Push error:', errorMsg)}`);
                  await log(`${formatAligned('', 'Reason:', 'Fork must be updated or process must stop')}`);
                  await log(`${formatAligned('', 'Solution draft:', 'Fork sync is required for proper workflow')}`);
                  await log(`${formatAligned('', 'Next steps:', '1. Check GitHub permissions for the fork')}`);
                  await log(`${formatAligned('', '', '2. Ensure fork is not protected')}`);
                  await log(`${formatAligned('', '', '3. Try again after resolving fork issues')}`);
                  await safeExit(1, 'Repository setup failed');
                }
              }

              // Step 4: Return to the original branch if it was different
              if (currentBranch !== upstreamDefaultBranch) {
                await log(`${formatAligned('🔄', 'Returning to:', `${currentBranch} branch`)}`);
                const returnResult = await $({ cwd: tempDir })`git checkout ${currentBranch}`;
                if (returnResult.code === 0) {
                  await log(`${formatAligned('✅', 'Branch restored:', `Back on ${currentBranch}`)}`);
                } else {
                  await log(`${formatAligned('⚠️', 'Warning:', `Failed to return to ${currentBranch}`)}`);
                  // This is not fatal, continue with sync on default branch
                }
              }
            } else {
              await log(`${formatAligned('⚠️', 'Warning:', `Failed to sync ${upstreamDefaultBranch} with upstream`)}`);
              if (syncResult.stderr) {
                await log(`${formatAligned('', 'Sync error:', syncResult.stderr.toString().trim())}`);
              }
            }
          }
        } else {
          await log(`${formatAligned('⚠️', 'Warning:', 'Failed to get default branch name')}`);
        }
      } else {
        await log(`${formatAligned('⚠️', 'Warning:', 'Failed to get current branch')}`);
      }
    } else {
      await log(`${formatAligned('⚠️', 'Warning:', 'Failed to fetch upstream')}`);
      if (fetchResult.stderr) {
        await log(`${formatAligned('', 'Fetch error:', fetchResult.stderr.toString().trim())}`);
      }
    }
  }
};
