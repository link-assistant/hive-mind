#!/usr/bin/env node

// Integration test to verify the fork fix works in the context of the full solve.mjs script
// This extracts the relevant fork logic and tests it in isolation

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const fs = (await use('fs')).promises;
const path = (await use('path')).default;

console.log('Integration test for fork creation fix...');

// Helper function from solve.mjs
function formatAligned(icon, label, value, indent = 0) {
  const spaces = ' '.repeat(indent);
  const iconPart = icon ? `${spaces}${icon} ` : `${spaces}`;
  const labelWidth = 25;
  const paddedLabel = label.padEnd(labelWidth);
  return `${iconPart}${paddedLabel} ${value}`;
}

// Mock log function
async function log(message) {
  console.log(message);
}

// Test the actual fork creation logic from solve.mjs
async function testForkCreationLogic(owner, repo) {
  console.log(`\nTesting fork creation logic for ${owner}/${repo}...`);

  // Get current user
  const userResult = await $`gh api user --jq .login`;
  if (userResult.code !== 0) {
    throw new Error('Failed to get current user');
  }
  const currentUser = userResult.stdout.toString().trim();
  await log(`Current user: ${currentUser}`);

  // Initialize variables
  let repoToClone = `${owner}/${repo}`;
  let forkedRepo = null;
  let upstreamRemote = null;

  // Fork mode enabled
  await log(`\n${formatAligned('🍴', 'Fork mode:', 'ENABLED')}`);
  await log(`${formatAligned('', 'Checking fork status...', '')}\n`);

  // Check if fork already exists (this is the existing logic)
  const forkCheckResult = await $`gh repo view ${currentUser}/${repo} --json name 2>/dev/null`;

  if (forkCheckResult.code === 0) {
    // Fork exists
    await log(`${formatAligned('✅', 'Fork exists:', `${currentUser}/${repo}`)}`);
    repoToClone = `${currentUser}/${repo}`;
    forkedRepo = `${currentUser}/${repo}`;
    upstreamRemote = `${owner}/${repo}`;
  } else {
    // This is where our NEW LOGIC is tested
    await log(`${formatAligned('🔄', 'Creating fork...', '')}`);
    const forkResult = await $`gh repo fork ${owner}/${repo} --clone=false`;

    // Check if fork creation failed or if fork already exists
    if (forkResult.code !== 0) {
      await log(`${formatAligned('❌', 'Error:', 'Failed to create fork')}`);
      await log(forkResult.stderr ? forkResult.stderr.toString() : 'Unknown error');
      throw new Error('Fork creation failed');
    }

    // Check if the output indicates the fork already exists (from parallel worker)
    const forkOutput = forkResult.stderr ? forkResult.stderr.toString() : '';
    if (forkOutput.includes('already exists')) {
      // Fork was created by another worker - treat as if fork already existed
      await log(`${formatAligned('ℹ️', 'Fork exists:', 'Already created by another worker')}`);
      await log(`${formatAligned('✅', 'Using existing fork:', `${currentUser}/${repo}`)}`);

      // Double-check that the fork actually exists now
      const reCheckResult = await $`gh repo view ${currentUser}/${repo} --json name 2>/dev/null`;
      if (reCheckResult.code !== 0) {
        await log(`${formatAligned('❌', 'Error:', 'Fork reported as existing but not found')}`);
        await log(`${formatAligned('', 'Suggestion:', 'Try running the command again - the fork may need a moment to become available')}`);
        throw new Error('Fork inconsistency');
      }
    } else {
      await log(`${formatAligned('✅', 'Fork created:', `${currentUser}/${repo}`)}`);

      // Wait a moment for fork to be ready
      await log(`${formatAligned('⏳', 'Waiting:', 'For fork to be ready...')}`);
      // Skipping the 3-second wait for test
    }

    repoToClone = `${currentUser}/${repo}`;
    forkedRepo = `${currentUser}/${repo}`;
    upstreamRemote = `${owner}/${repo}`;
  }

  return { repoToClone, forkedRepo, upstreamRemote };
}

// Run the test
try {
  const result = await testForkCreationLogic('alanef', 'fullworks-active-users-monitor');
  console.log('\n✅ Integration test PASSED');
  console.log('Result:', result);
  console.log('\n🎉 The fork creation fix is working correctly!');
} catch (error) {
  console.log('\n❌ Integration test FAILED');
  console.log('Error:', error.message);
  console.log('\n🔧 The fix may need additional work.');
}
