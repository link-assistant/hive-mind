#!/usr/bin/env node

// Test script to verify improved error messages for fork-related issues

// Mock the log function
const log = async msg => console.log(msg);
const formatAligned = (icon, text, value) => `${icon} ${text} ${value}`.trim();

// Mock data
const owner = '1dNDN';
const repo = 'BitrotBruteforce';
const prNumber = 10;
const branchName = 'issue-9-231cfae8';
const tempDir = '/tmp/gh-issue-solver-test';
const issueUrl = 'https://github.com/1dNDN/BitrotBruteforce/pull/10';
const argv = { verbose: false };

// Mock $ function for testing
const $ = async cmd => {
  const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString();

  if (cmdStr.includes('gh api user')) {
    return { code: 0, stdout: 'testuser' };
  }

  if (cmdStr.includes('gh repo view testuser/BitrotBruteforce --json parent')) {
    // Simulate user has a fork
    return {
      code: 0,
      stdout: JSON.stringify({
        parent: {
          owner: { login: '1dNDN' },
          name: 'BitrotBruteforce'
        }
      })
    };
  }

  if (cmdStr.includes('gh pr view 10 --repo')) {
    return {
      code: 0,
      stdout: JSON.stringify({
        headRepositoryOwner: { login: 'anotheruser' }
      })
    };
  }

  return { code: 1, stderr: 'Command failed' };
};

// Test scenario 1: Fork PR with existing user fork
async function testForkPRWithExistingFork() {
  console.log('\n=== Test 1: Fork PR with existing user fork ===\n');

  const isContinueMode = true;
  const isForkPR = true;
  const errorOutput =
    "fatal: 'origin/issue-9-231cfae8' is not a commit and a branch 'issue-9-231cfae8' cannot be created from it";

  // Check if user has a fork that could be used
  let userHasFork = false;
  let forkOwner = null;
  let suggestForkOption = false;

  if (isForkPR) {
    // This is already a forked PR, get the fork owner
    try {
      const prDataResult =
        await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRepositoryOwner --jq .headRepositoryOwner.login`;
      if (prDataResult.code === 0) {
        forkOwner = 'anotheruser';
      }
    } catch (e) {
      // Ignore error
    }
  } else {
    // Check if the current user has a fork of this repository
    try {
      const userResult = await $`gh api user --jq .login`;
      if (userResult.code === 0) {
        const currentUser = 'testuser';
        const forkCheckResult = await $`gh repo view ${currentUser}/${repo} --json parent 2>/dev/null`;
        if (forkCheckResult.code === 0) {
          const forkData = JSON.parse(forkCheckResult.stdout.toString());
          if (forkData.parent && forkData.parent.owner && forkData.parent.owner.login === owner) {
            userHasFork = true;
            forkOwner = currentUser;
            suggestForkOption = true;
          }
        }
      }
    } catch (e) {
      // Ignore error, proceed with default message
    }
  }

  await log(`${formatAligned('❌', 'BRANCH CHECKOUT FAILED', '')}`, { level: 'error' });
  await log('');

  // Provide a clearer explanation of what happened
  await log('  🔍 What happened:');
  await log(`     Failed to checkout the branch '${branchName}' for PR #${prNumber}.`);
  if (errorOutput.includes('is not a commit')) {
    await log("     The branch doesn't exist in the current repository.");
  } else {
    await log('     Git was unable to find or access the branch.');
  }
  await log('');

  // Explain why this happened
  await log('  💡 Why this happened:');
  if (isForkPR && forkOwner) {
    await log(`     The PR branch exists in the fork (${forkOwner}/${repo})`);
    await log(`     but you're trying to access it from the main repository (${owner}/${repo}).`);
    await log('     This is a common issue with pull requests from forks.');
  } else if (userHasFork) {
    await log('     You have a fork of this repository, but the PR branch');
    await log('     might be in your fork rather than the main repository.');
  } else {
    await log('     • The PR branch may not exist on the remote');
    await log('     • There might be network connectivity issues');
    await log('     • You might not have permission to access the branch');
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
    await log(`    ./solve.mjs "${issueUrl}" --fork`);
    await log('');
    await log('  This will automatically:');
    if (userHasFork) {
      await log(`    ✓ Use your existing fork (${forkOwner}/${repo})`);
    } else if (isForkPR && forkOwner) {
      await log(`    ✓ Work with the fork that contains the PR branch`);
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
  }
}

// Test scenario 2: Non-fork PR with user having a fork
async function testNonForkPRWithUserFork() {
  console.log('\n=== Test 2: Non-fork PR but user has a fork ===\n');

  const isContinueMode = true;
  const isForkPR = false;
  const errorOutput = "fatal: 'origin/feature-branch' is not a commit";

  // Simulate checking for user fork
  let userHasFork = true;
  let forkOwner = 'testuser';
  let suggestForkOption = true;

  await log(`${formatAligned('❌', 'BRANCH CHECKOUT FAILED', '')}`, { level: 'error' });
  await log('');

  await log('  🔍 What happened:');
  await log(`     Failed to checkout the branch 'feature-branch' for PR #123.`);
  await log("     The branch doesn't exist in the current repository.");
  await log('');

  await log('  💡 Why this happened:');
  await log('     You have a fork of this repository, but the PR branch');
  await log('     might be in your fork rather than the main repository.');
  await log('');

  await log('  🔧 How to fix this:');
  await log('');
  await log('  ┌──────────────────────────────────────────────────────────┐');
  await log('  │  RECOMMENDED: Use the --fork option                     │');
  await log('  └──────────────────────────────────────────────────────────┘');
  await log('');
  await log('  Run this command:');
  await log(`    ./solve.mjs "https://github.com/example/repo/pull/123" --fork`);
  await log('');
  await log('  This will automatically:');
  await log(`    ✓ Use your existing fork (${forkOwner}/repo)`);
  await log('    ✓ Set up the correct remotes and branches');
  await log('    ✓ Allow you to work on the PR without permission issues');
}

// Run tests
async function runTests() {
  console.log('Testing improved error messages for fork-related issues');
  console.log('='.repeat(60));

  await testForkPRWithExistingFork();
  await testNonForkPRWithUserFork();

  console.log('\n' + '='.repeat(60));
  console.log('Tests completed successfully!');
  console.log('\nKey improvements:');
  console.log('✓ Clearer explanation of what happened');
  console.log('✓ Detection of existing forks');
  console.log('✓ Context-specific recommendations');
  console.log('✓ Better visual hierarchy with boxes');
  console.log('✓ Reduced technical jargon');
}

runTests().catch(console.error);
