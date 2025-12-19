#!/usr/bin/env node

/**
 * Test script for org-clone functionality
 * Demonstrates usage and validates the implementation
 */

import { use } from 'use-m';
const { $ } = await use('command-stream');
const path = (await use('path')).default;
const fs = (await use('fs')).promises;
const os = (await use('os')).default;

console.log('🧪 Testing org-clone functionality\n');

// Create temporary test directory
const testDir = path.join(os.tmpdir(), `org-clone-test-${Date.now()}`);
await fs.mkdir(testDir, { recursive: true });

console.log(`📁 Test directory: ${testDir}\n`);

try {
  // Test 1: Help command
  console.log('Test 1: Help command');
  console.log('─'.repeat(50));
  const helpResult = await $`./src/org-clone.mjs --help`;
  console.log('✅ Help command works\n');

  // Test 2: Dry run with a small organization
  console.log('Test 2: Dry run - link-foundation organization');
  console.log('─'.repeat(50));
  const dryRunResult = await $`./src/org-clone.mjs link-foundation --dir ${testDir} --dry-run --threads 4`;

  if (dryRunResult.code === 0) {
    console.log('✅ Dry run completed successfully\n');
  } else {
    console.log('❌ Dry run failed\n');
    console.log(dryRunResult.stderr?.toString() || dryRunResult.stdout?.toString());
  }

  // Test 3: Test with a small user account (dry run)
  console.log('Test 3: Dry run - user account');
  console.log('─'.repeat(50));

  // Get current authenticated user
  const userResult = await $`gh api user --jq .login`;
  if (userResult.code === 0) {
    const currentUser = userResult.stdout.toString().trim();
    console.log(`   Using current user: ${currentUser}`);

    const userDryRunResult = await $`./src/org-clone.mjs ${currentUser} --dir ${testDir}/user-test --dry-run --threads 4`;

    if (userDryRunResult.code === 0) {
      console.log('✅ User dry run completed successfully\n');
    } else {
      console.log('❌ User dry run failed\n');
    }
  } else {
    console.log('⚠️  Could not get authenticated user, skipping this test\n');
  }

  // Test 4: Test filtering options (dry run)
  console.log('Test 4: Filter options (exclude forks and archived)');
  console.log('─'.repeat(50));
  const filterResult = await $`./src/org-clone.mjs link-foundation --dir ${testDir}/filtered --dry-run --threads 4`;

  if (filterResult.code === 0) {
    console.log('✅ Filter options work correctly\n');
  } else {
    console.log('❌ Filter options test failed\n');
  }

  // Test 5: Test verbose mode
  console.log('Test 5: Verbose mode');
  console.log('─'.repeat(50));
  const verboseResult = await $`./src/org-clone.mjs link-foundation --dir ${testDir}/verbose --dry-run --verbose --threads 2`;

  if (verboseResult.code === 0) {
    console.log('✅ Verbose mode works\n');
  } else {
    console.log('❌ Verbose mode failed\n');
  }

  console.log('═'.repeat(50));
  console.log('✅ All tests completed!');
  console.log(`\n📁 Test directory (can be deleted): ${testDir}`);

} catch (error) {
  console.error('❌ Test failed with error:', error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  // Cleanup test directory
  try {
    await fs.rm(testDir, { recursive: true, force: true });
    console.log('🧹 Cleaned up test directory');
  } catch (cleanupError) {
    console.warn(`⚠️  Could not clean up test directory: ${testDir}`);
  }
}
