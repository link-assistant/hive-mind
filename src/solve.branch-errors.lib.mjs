#!/usr/bin/env node
'use strict';

/**
 * Branch error handling module for solve.mjs
 * Provides improved error messages for branch checkout/creation failures
 */

// Import Sentry integration
import { reportError } from './sentry.lib.mjs';

export async function handleBranchCheckoutError({
  branchName,
  prNumber,
  errorOutput,
  issueUrl,
  owner,
  repo,
  tempDir,
  argv,
  formatAligned,
  log,
  $
}) {
  // Check if this is a PR from a fork
  let isForkPR = false;
  let forkOwner = null;
  let forkRepoName = null; // Track the actual fork repo name (may be prefixed)
  let userHasFork = false;
  let suggestForkOption = false;
  let branchExistsInFork = false;

  if (prNumber) {
    try {
      const prCheckResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRepositoryOwner,headRefName,headRepository 2>/dev/null`;
      if (prCheckResult.code === 0) {
        const prData = JSON.parse(prCheckResult.stdout.toString());
        if (prData.headRepositoryOwner && prData.headRepositoryOwner.login !== owner) {
          isForkPR = true;
          forkOwner = prData.headRepositoryOwner.login;
          suggestForkOption = true;

          // Get the actual fork repository name (might be prefixed)
          let forkRepoFullName = `${forkOwner}/${repo}`;
          if (prData.headRepository && prData.headRepository.name) {
            forkRepoFullName = `${forkOwner}/${prData.headRepository.name}`;
            forkRepoName = prData.headRepository.name;
          }

          // Check if the branch exists in the fork
          try {
            const branchCheckResult = await $`gh api repos/${forkRepoFullName}/git/ref/heads/${branchName} 2>/dev/null`;
            if (branchCheckResult.code === 0) {
              branchExistsInFork = true;
            }
          } catch (e) {
            reportError(e, {
              context: 'check_fork_for_branch',
              prNumber,
              forkOwner,
              forkRepoFullName,
              branchName,
              operation: 'verify_fork_branch'
            });
            // Branch doesn't exist in fork or can't access it
          }
        }
      }
    } catch (e) {
      reportError(e, {
        context: 'handle_branch_checkout_error',
        prNumber,
        branchName,
        operation: 'analyze_branch_error'
      });
      // Ignore error, proceed with default message
    }

    // Check if the current user has a fork of this repository
    try {
      const userResult = await $`gh api user --jq .login`;
      if (userResult.code === 0) {
        const currentUser = userResult.stdout.toString().trim();
        // Determine fork name based on --prefix-fork-name-with-owner-name option
        const userForkRepoName = (argv && argv.prefixForkNameWithOwnerName) ? `${owner}-${repo}` : repo;
        const userForkRepo = `${currentUser}/${userForkRepoName}`;
        const forkCheckResult = await $`gh repo view ${userForkRepo} --json parent 2>/dev/null`;
        if (forkCheckResult.code === 0) {
          const forkData = JSON.parse(forkCheckResult.stdout.toString());
          if (forkData.parent && forkData.parent.owner && forkData.parent.owner.login === owner) {
            userHasFork = true;
            if (!forkOwner) forkOwner = currentUser;
            if (!forkRepoName) forkRepoName = userForkRepoName;
            suggestForkOption = true;

            // Check if the branch exists in user's fork
            if (!branchExistsInFork) {
              try {
                const branchCheckResult = await $`gh api repos/${userForkRepo}/git/ref/heads/${branchName} 2>/dev/null`;
                if (branchCheckResult.code === 0) {
                  branchExistsInFork = true;
                  forkOwner = currentUser;
                  forkRepoName = userForkRepoName;
                }
              } catch (e) {
                reportError(e, {
                  context: 'check_user_fork_branch',
                  userForkOwner: currentUser,
                  userForkRepoName,
                  branchName,
                  operation: 'check_branch_in_user_fork'
                });
                // Branch doesn't exist in user's fork
              }
            }
          }
        }
      }
    } catch (e) {
      reportError(e, {
        context: 'handle_branch_checkout_error',
        prNumber,
        branchName,
        operation: 'analyze_branch_error'
      });
      // Ignore error, proceed with default message
    }
  }

  await log(`${formatAligned('❌', 'BRANCH CHECKOUT FAILED', '')}`, { level: 'error' });
  await log('');

  // Provide a clearer explanation of what happened
  await log('  🔍 What happened:');
  await log(`     Failed to checkout the branch '${branchName}' for PR #${prNumber}.`);
  await log(`     Repository: https://github.com/${owner}/${repo}`);
  await log(`     Pull Request: https://github.com/${owner}/${repo}/pull/${prNumber}`);
  if (errorOutput.includes('is not a commit')) {
    await log(`     The branch doesn't exist in the main repository (https://github.com/${owner}/${repo}).`);
  } else {
    await log('     Git was unable to find or access the branch.');
  }
  await log('');

  // Only show git output if it's not the typical "not a commit" error
  if (!errorOutput.includes('is not a commit') || argv.verbose) {
    await log('  📦 Git error details:');
    for (const line of errorOutput.split('\n')) {
      await log(`     ${line}`);
    }
    await log('');
  }

  // Explain why this happened
  await log('  💡 Why this happened:');
  if (isForkPR && forkOwner) {
    // Use forkRepoName if available, otherwise default to repo
    const displayForkRepo = forkRepoName || repo;
    if (branchExistsInFork) {
      await log(`     The PR branch '${branchName}' exists in the fork repository:`);
      await log(`       https://github.com/${forkOwner}/${displayForkRepo}`);
      await log('     but you\'re trying to access it from the main repository:');
      await log(`       https://github.com/${owner}/${repo}`);
      await log('     This branch does NOT exist in the main repository.');
    } else {
      await log(`     The PR is from a fork (https://github.com/${forkOwner}/${displayForkRepo})`);
      await log(`     but the branch '${branchName}' could not be found there either.`);
      await log('     The branch may have been deleted or renamed.');
    }
    await log('     This is a common issue with pull requests from forks.');
  } else if (userHasFork && branchExistsInFork) {
    // Use forkRepoName if available, otherwise default to repo
    const displayForkRepo = forkRepoName || repo;
    await log(`     The branch '${branchName}' exists in your fork:`);
    await log(`       https://github.com/${forkOwner}/${displayForkRepo}`);
    await log('     but NOT in the main repository:');
    await log(`       https://github.com/${owner}/${repo}`);
    await log('     You need to use --fork to work with your fork.');
  } else if (userHasFork) {
    await log('     You have a fork of this repository, but the PR branch');
    await log(`     '${branchName}' doesn't exist in either the main repository`);
    await log('     or your fork. It may have been deleted or renamed.');
  } else {
    await log(`     • The branch '${branchName}' doesn't exist in https://github.com/${owner}/${repo}`);
    await log('     • This might be a PR from a fork (use --fork option)');
    await log('     • Or the branch may have been deleted/renamed');
  }
  await log('');

  // Provide clear solutions
  await log('  🔧 How to fix this:');

  if (isForkPR || suggestForkOption) {
    await log('');
    await log('  ┌──────────────────────────────────────────────────────────┐');
    await log('  │  RECOMMENDED: Use the --fork option                     │');
    await log('  └──────────────────────────────────────────────────────────┘');
    await log('');
    await log('  Run this command:');
    const fullUrl = prNumber ? `https://github.com/${owner}/${repo}/pull/${prNumber}` : issueUrl;
    await log(`    ./solve.mjs "${fullUrl}" --fork`);
    await log('');
    await log('  This will automatically:');
    if (userHasFork) {
      // Use forkRepoName if available, otherwise default to repo
      const displayForkRepo = forkRepoName || repo;
      await log(`    ✓ Use your existing fork (${forkOwner}/${displayForkRepo})`);
    } else if (isForkPR && forkOwner) {
      await log('    ✓ Work with the fork that contains the PR branch');
    } else {
      await log('    ✓ Create or use a fork of the repository');
    }
    await log('    ✓ Set up the correct remotes and branches');
    await log('    ✓ Allow you to work on the PR without permission issues');
    await log('');
    await log('  ─────────────────────────────────────────────────────────');
    await log('');
    await log('  Alternative options:');
    await log(`    • Verify PR details: gh pr view ${prNumber} --repo ${owner}/${repo}`);
    await log(`    • Check your local setup: cd ${tempDir} && git remote -v`);
  } else {
    await log(`     1. Verify PR branch exists: gh pr view ${prNumber} --repo ${owner}/${repo}`);
    await log(`     2. Check remote branches: cd ${tempDir} && git branch -r`);
    await log(`     3. Try fetching manually: cd ${tempDir} && git fetch origin`);
    await log('');
    await log('     If you don\'t have write access to this repository,');
    await log('     consider using the --fork option:');
    const altFullUrl = prNumber ? `https://github.com/${owner}/${repo}/pull/${prNumber}` : issueUrl;
    await log(`       ./solve.mjs "${altFullUrl}" --fork`);
  }
}

export async function handleBranchCreationError({
  branchName,
  errorOutput,
  tempDir,
  owner,
  repo,
  formatAligned,
  log
}) {
  await log(`${formatAligned('❌', 'BRANCH CREATION FAILED', '')}`, { level: 'error' });
  await log('');
  await log('  🔍 What happened:');
  await log(`     Unable to create branch '${branchName}'.`);
  if (owner && repo) {
    await log(`     Repository: https://github.com/${owner}/${repo}`);
  }
  await log('');
  await log('  📦 Git output:');
  for (const line of errorOutput.split('\n')) {
    await log(`     ${line}`);
  }
  await log('');
  await log('  💡 Possible causes:');
  await log('     • Branch name already exists');
  await log('     • Uncommitted changes in repository');
  await log('     • Git configuration issues');
  await log('');
  await log('  🔧 How to fix:');
  await log('     1. Try running the command again (uses random names)');
  await log(`     2. Check git status: cd ${tempDir} && git status`);
  await log(`     3. View existing branches: cd ${tempDir} && git branch -a`);
}

export async function handleBranchVerificationError({
  isContinueMode,
  branchName,
  actualBranch,
  prNumber,
  owner,
  repo,
  tempDir,
  formatAligned,
  log,
  $
}) {
  await log('');
  await log(`${formatAligned('❌', isContinueMode ? 'BRANCH CHECKOUT FAILED' : 'BRANCH CREATION FAILED', '')}`, { level: 'error' });
  await log('');
  await log('  🔍 What happened:');
  if (isContinueMode) {
    await log('     Git checkout command didn\'t switch to the PR branch.');
  } else {
    await log('     Git checkout -b command didn\'t create or switch to the branch.');
  }
  if (owner && repo) {
    await log(`     Repository: https://github.com/${owner}/${repo}`);
    if (prNumber) {
      await log(`     Pull Request: https://github.com/${owner}/${repo}/pull/${prNumber}`);
    }
  }
  await log('');
  await log('  📊 Branch status:');
  await log(`     Expected branch: ${branchName}`);
  await log(`     Currently on: ${actualBranch || '(unknown)'}`);
  await log('');

  // Show all branches to help debug
  const allBranchesResult = await $({ cwd: tempDir })`git branch -a 2>&1`;
  if (allBranchesResult.code === 0) {
    await log('  🌿 Available branches:');
    for (const line of allBranchesResult.stdout.toString().split('\n')) {
      if (line.trim()) await log(`     ${line}`);
    }
    await log('');
  }

  if (isContinueMode) {
    await log('  💡 This might mean:');
    await log('     • PR branch doesn\'t exist on remote');
    await log('     • Branch name mismatch');
    await log('     • Network/permission issues');
    await log('');
    await log('  🔧 How to fix:');
    await log(`     1. Check PR details: gh pr view ${prNumber} --repo ${owner}/${repo}`);
    await log(`     2. List remote branches: cd ${tempDir} && git branch -r`);
    await log(`     3. Try manual checkout: cd ${tempDir} && git checkout ${branchName}`);
  } else {
    await log('  💡 This is unusual. Possible causes:');
    await log('     • Git version incompatibility');
    await log('     • File system permissions issue');
    await log('     • Repository corruption');
    await log('');
    await log('  🔧 How to fix:');
    await log('     1. Try creating the branch manually:');
    await log(`        cd ${tempDir}`);
    await log(`        git checkout -b ${branchName}`);
    await log('     ');
    await log('     2. If that fails, try two-step approach:');
    await log(`        cd ${tempDir}`);
    await log(`        git branch ${branchName}`);
    await log(`        git checkout ${branchName}`);
    await log('     ');
    await log('     3. Check your git version:');
    await log('        git --version');
  }
  await log('');
  await log(`  📂 Working directory: ${tempDir}`);
  await log('');
}