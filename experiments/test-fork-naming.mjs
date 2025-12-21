#!/usr/bin/env node

/**
 * Experiment to understand fork naming behavior
 *
 * This tests:
 * 1. What gh repo fork outputs when a fork already exists
 * 2. What the actual fork name is on GitHub
 * 3. What message gh displays when trying to fork again
 */

import { $ } from 'zx';

async function testForkNaming() {
  console.log('='.repeat(80));
  console.log('FORK NAMING EXPERIMENT');
  console.log('='.repeat(80));
  console.log();

  // Test repo from the issue
  const owner = 'netkeep80';
  const repo = 'jsonRVM';
  const fullRepo = `${owner}/${repo}`;

  console.log(`Testing fork behavior for: ${fullRepo}`);
  console.log();

  // Get current user
  console.log('1. Getting current user...');
  const userResult = await $`gh api user --jq .login`;
  const currentUser = userResult.stdout.toString().trim();
  console.log(`   Current user: ${currentUser}`);
  console.log();

  // Check what fork name would be
  const expectedForkName = `${currentUser}/${repo}`;
  console.log(`2. Expected fork name: ${expectedForkName}`);
  console.log();

  // Try to check if fork exists
  console.log(`3. Checking if fork exists: ${expectedForkName}`);
  const checkResult = await $`gh repo view ${expectedForkName} --json name 2>&1`.catch(e => e);
  console.log(`   Exit code: ${checkResult.exitCode || checkResult.code}`);
  if (checkResult.exitCode === 0 || checkResult.code === 0) {
    console.log(`   ✅ Fork exists at: ${expectedForkName}`);
  } else {
    console.log(`   ❌ Fork does not exist at: ${expectedForkName}`);
  }
  console.log();

  // Try to create fork (will fail if already exists)
  console.log(`4. Trying to create fork from ${fullRepo}...`);
  const forkResult = await $`gh repo fork ${fullRepo} --clone=false 2>&1`.catch(e => e);
  console.log(`   Exit code: ${forkResult.exitCode || forkResult.code}`);
  console.log('   Output:');
  const forkOutput =
    (forkResult.stdout ? forkResult.stdout.toString() : '') + (forkResult.stderr ? forkResult.stderr.toString() : '');
  console.log(
    forkOutput
      .split('\n')
      .map(line => `     ${line}`)
      .join('\n')
  );
  console.log();

  // Parse the fork output to see what fork name gh mentioned
  console.log('5. Analyzing fork output...');
  const lines = forkOutput.split('\n');
  for (const line of lines) {
    if (line.includes('already exists') || line.includes('fork')) {
      console.log(`   Found: "${line}"`);
    }
  }
  console.log();

  // List all forks of the upstream repo
  console.log(`6. Listing all forks of ${fullRepo}...`);
  const forksResult = await $`gh api repos/${fullRepo}/forks --jq '.[] | .full_name'`.catch(e => e);
  if (forksResult.exitCode === 0 || forksResult.code === 0) {
    const forks = forksResult.stdout.toString().trim().split('\n');
    console.log(`   Found ${forks.length} forks:`);
    for (const fork of forks) {
      if (fork.startsWith(currentUser + '/')) {
        console.log(`   ✅ ${fork} (owned by current user)`);
      } else {
        console.log(`      ${fork}`);
      }
    }
  } else {
    console.log('   Error listing forks');
  }
  console.log();

  console.log('='.repeat(80));
  console.log('EXPERIMENT COMPLETE');
  console.log('='.repeat(80));
}

testForkNaming().catch(console.error);
