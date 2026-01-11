#!/usr/bin/env node

// Test script to simulate the concurrent fork creation scenario
// This tests what happens when we try to fork a repo that already exists

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

console.log('Testing concurrent fork creation scenario...');

async function testConcurrentForkCreation() {
  // Get current user
  const currentUser = await $`gh api user --jq .login`;
  const username = currentUser.stdout.toString().trim();
  console.log(`Current user: ${username}`);

  // Test with a repository we know we've already forked
  const owner = 'alanef';
  const repo = 'fullworks-active-users-monitor';

  console.log(`\nTesting with ${owner}/${repo}...`);

  // First, verify the fork exists
  console.log('1. Verifying fork exists...');
  const forkCheck = await $`gh repo view ${username}/${repo} --json name 2>/dev/null`;
  if (forkCheck.code !== 0) {
    console.log("❌ Fork doesn't exist - need a forked repo for this test");
    return;
  }
  console.log(`✅ Fork exists: ${username}/${repo}`);

  // Now simulate what happens when we try to fork again (concurrent scenario)
  console.log('\n2. Simulating concurrent fork creation (trying to fork again)...');

  try {
    const forkResult = await $`gh repo fork ${owner}/${repo} --clone=false`;

    console.log('Fork command exit code:', forkResult.code);
    console.log('Fork stdout:', forkResult.stdout ? forkResult.stdout.toString() : '(empty)');
    console.log('Fork stderr:', forkResult.stderr ? forkResult.stderr.toString() : '(empty)');

    // Test our new logic
    if (forkResult.code !== 0) {
      console.log('❌ Fork creation failed with non-zero exit code');
      return;
    }

    const forkOutput = forkResult.stderr ? forkResult.stderr.toString() : '';
    console.log('\n3. Testing the new error recovery logic...');

    if (forkOutput.includes('already exists')) {
      console.log('✅ DETECTED: Fork already exists message');
      console.log("ℹ️ This would be handled by the new logic as 'created by another worker'");

      // Test the double-check logic
      const reCheckResult = await $`gh repo view ${username}/${repo} --json name 2>/dev/null`;
      if (reCheckResult.code === 0) {
        console.log('✅ Double-check successful: Fork verified to exist');
        console.log('✅ Concurrent fork creation would be handled gracefully');
      } else {
        console.log("❌ Double-check failed: Fork not found after 'already exists' message");
      }
    } else {
      console.log("ℹ️ No 'already exists' message detected");
      console.log('   This might mean GitHub CLI handled it differently than expected');
    }
  } catch (error) {
    console.log('❌ Error during fork creation test:', error.message);
  }
}

try {
  await testConcurrentForkCreation();
  console.log('\n✅ Test completed');
} catch (error) {
  console.log('\n❌ Test failed:', error.message);
}
