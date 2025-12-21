#!/usr/bin/env node

// Test script to verify the fork creation fix works as expected
// This simulates the scenario where two workers try to create the same fork

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const fs = (await use('fs')).promises;
const path = (await use('path')).default;

console.log('Testing fork creation error recovery fix...');

// Test the logic that was implemented
async function simulateForkCreation(owner, repo, currentUser) {
  console.log(`\nSimulating fork creation for ${owner}/${repo} by user ${currentUser}...`);

  // Simulate the check for existing fork
  console.log('1. Checking if fork already exists...');
  const forkCheckResult = await $`gh repo view ${currentUser}/${repo} --json name 2>/dev/null`;

  if (forkCheckResult.code === 0) {
    console.log(`✅ Fork exists: ${currentUser}/${repo}`);
    return {
      repoToClone: `${currentUser}/${repo}`,
      forkedRepo: `${currentUser}/${repo}`,
      upstreamRemote: `${owner}/${repo}`
    };
  } else {
    console.log("❌ Fork doesn't exist, need to create...");

    // This is where the new logic kicks in
    console.log('2. Attempting to create fork...');
    const forkResult = await $`gh repo fork ${owner}/${repo} --clone=false`;

    if (forkResult.code !== 0) {
      console.log('❌ Fork creation failed with non-zero exit code');
      console.log('stderr:', forkResult.stderr ? forkResult.stderr.toString() : 'No stderr');
      throw new Error('Failed to create fork');
    }

    // Check if the output indicates the fork already exists (from parallel worker)
    const forkOutput = forkResult.stderr ? forkResult.stderr.toString() : '';
    console.log('Fork stderr output:', forkOutput);

    if (forkOutput.includes('already exists')) {
      console.log('ℹ️ Fork exists: Already created by another worker');
      console.log('✅ Using existing fork');

      // Double-check that the fork actually exists now
      const reCheckResult = await $`gh repo view ${currentUser}/${repo} --json name 2>/dev/null`;
      if (reCheckResult.code !== 0) {
        console.log('❌ Fork reported as existing but not found');
        throw new Error('Fork inconsistency');
      }
      console.log('✅ Fork verified to exist after double-check');
    } else {
      console.log('✅ Fork created successfully');
      console.log('⏳ Waiting for fork to be ready...');
      // In real scenario, we'd wait 3 seconds here
    }

    return {
      repoToClone: `${currentUser}/${repo}`,
      forkedRepo: `${currentUser}/${repo}`,
      upstreamRemote: `${owner}/${repo}`
    };
  }
}

// Test with the repository from the issue
const testRepo = 'alanef/fullworks-active-users-monitor';
const [owner, repo] = testRepo.split('/');

try {
  const currentUser = await $`gh api user --jq .login`;
  const username = currentUser.stdout.toString().trim();
  console.log(`Current user: ${username}`);

  const result = await simulateForkCreation(owner, repo, username);
  console.log('\n✅ Test completed successfully!');
  console.log('Result:', result);
} catch (error) {
  console.log('\n❌ Test failed:', error.message);
  console.log('Error details:', error);
}
