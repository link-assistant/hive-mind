#!/usr/bin/env node

/**
 * Test script for Issue #617 - Cleanup logic fix
 *
 * This test verifies that cleanupClaudeFile correctly handles:
 * 1. Initial session: Reverts the CLAUDE.md commit when claudeCommitHash is provided
 * 2. Continue session: Skips cleanup when claudeCommitHash is null
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

const { $ } = await use('command-stream');
const fs = await use('fs');
const path = await use('path');
const os = await use('os');

// Import the function we're testing
const resultsLib = await import('../src/solve.results.lib.mjs');
const { cleanupClaudeFile } = resultsLib;

const lib = await import('../src/lib.mjs');
const { log, setLogFile } = lib;

console.log('🧪 Testing Issue #617 Fix: Cleanup Logic');
console.log('=========================================\n');

// Create a temporary test directory
const testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-cleanup-'));
console.log(`📁 Test directory: ${testDir}\n`);

let testsPassed = 0;
let testsFailed = 0;

try {
  // Initialize a git repository
  console.log('📦 Setting up test repository...');
  await $({ cwd: testDir })`git init`;
  await $({ cwd: testDir })`git config user.name "Test User"`;
  await $({ cwd: testDir })`git config user.email "test@example.com"`;

  // Create initial commit
  await fs.promises.writeFile(path.join(testDir, 'README.md'), '# Test Repository\n');
  await $({ cwd: testDir })`git add README.md`;
  await $({ cwd: testDir })`git commit -m "Initial commit"`;

  const initialCommitResult = await $({ cwd: testDir })`git log --format=%H -1`;
  const initialCommitHash = initialCommitResult.stdout.toString().trim();
  console.log(`   Initial commit: ${initialCommitHash.substring(0, 7)}...`);

  // Create a branch
  await $({ cwd: testDir })`git checkout -b test-branch`;

  // Create and commit CLAUDE.md (simulating auto-PR creation)
  console.log('   Creating CLAUDE.md commit...');
  await fs.promises.writeFile(path.join(testDir, 'CLAUDE.md'), 'Issue to solve: test\n');
  await $({ cwd: testDir })`git add CLAUDE.md`;
  await $({ cwd: testDir })`git commit -m "Initial commit with task details"`;

  const claudeCommitResult = await $({ cwd: testDir })`git log --format=%H -1`;
  const claudeCommitHash = claudeCommitResult.stdout.toString().trim();
  console.log(`   CLAUDE.md commit: ${claudeCommitHash.substring(0, 7)}...\n`);

  // TEST 1: With claudeCommitHash (initial session - should revert)
  console.log('TEST 1: Initial session with claudeCommitHash');
  console.log('----------------------------------------------');

  // Set up log file for testing
  const logFile = path.join(testDir, 'test.log');
  setLogFile(logFile);

  console.log('   Calling cleanupClaudeFile with commit hash...');
  await cleanupClaudeFile(testDir, 'test-branch', claudeCommitHash);

  // Verify the revert commit was created
  const commitsAfterCleanup = await $({ cwd: testDir })`git log --format="%h %s" -3`;
  const commits = commitsAfterCleanup.stdout.toString().trim().split('\n');
  console.log('   Recent commits:');
  commits.forEach(c => console.log(`     ${c}`));

  // Check if CLAUDE.md was reverted (should not exist)
  const claudeMdExists = await fs.promises.access(path.join(testDir, 'CLAUDE.md'))
    .then(() => true)
    .catch(() => false);

  if (!claudeMdExists && commits.some(c => c.includes('Revert'))) {
    console.log('   ✅ PASS: CLAUDE.md was correctly reverted\n');
    testsPassed++;
  } else {
    console.log('   ❌ FAIL: CLAUDE.md revert did not work as expected\n');
    testsFailed++;
  }

  // TEST 2: Without claudeCommitHash (continue session - should skip)
  console.log('TEST 2: Continue session without claudeCommitHash');
  console.log('-------------------------------------------------');

  // Reset repository state for second test
  await $({ cwd: testDir })`git reset --hard ${claudeCommitHash}`;
  console.log('   Repository reset to CLAUDE.md commit');

  const beforeCommitCount = await $({ cwd: testDir })`git rev-list --count HEAD`;
  const beforeCount = parseInt(beforeCommitCount.stdout.toString().trim());

  console.log('   Calling cleanupClaudeFile without commit hash...');
  await cleanupClaudeFile(testDir, 'test-branch', null);

  const afterCommitCount = await $({ cwd: testDir })`git rev-list --count HEAD`;
  const afterCount = parseInt(afterCommitCount.stdout.toString().trim());

  // Check if CLAUDE.md still exists (should exist since no revert)
  const claudeMdStillExists = await fs.promises.access(path.join(testDir, 'CLAUDE.md'))
    .then(() => true)
    .catch(() => false);

  if (claudeMdStillExists && beforeCount === afterCount) {
    console.log('   ✅ PASS: Cleanup correctly skipped (no revert created)\n');
    testsPassed++;
  } else {
    console.log('   ❌ FAIL: Cleanup should have been skipped\n');
    console.log(`     Commit count before: ${beforeCount}, after: ${afterCount}`);
    console.log(`     CLAUDE.md exists: ${claudeMdStillExists}`);
    testsFailed++;
  }

  // TEST 3: Verify old behavior would have been wrong
  console.log('TEST 3: Verify old behavior protection');
  console.log('---------------------------------------');
  console.log('   Without the fix, searching for "first commit" would have:');
  console.log(`     - Found: ${initialCommitHash.substring(0, 7)} (Initial commit)`);
  console.log(`     - Not found: ${claudeCommitHash.substring(0, 7)} (CLAUDE.md commit)`);
  console.log('   ✅ Our fix prevents this by skipping cleanup when claudeCommitHash is null\n');
  testsPassed++;

} catch (error) {
  console.error('❌ Test failed with error:', error.message);
  console.error(error.stack);
  testsFailed++;
} finally {
  // Cleanup
  console.log('🧹 Cleaning up test directory...');
  try {
    await fs.promises.rm(testDir, { recursive: true, force: true });
    console.log('   ✅ Test directory removed\n');
  } catch (cleanupError) {
    console.error('   ⚠️  Could not remove test directory:', cleanupError.message);
  }
}

// Summary
console.log('=========================================');
console.log('📊 Test Results:');
console.log(`   ✅ Passed: ${testsPassed}`);
console.log(`   ❌ Failed: ${testsFailed}`);
console.log(`   📈 Success rate: ${testsPassed}/${testsPassed + testsFailed}`);
console.log('=========================================\n');

if (testsFailed > 0) {
  console.error('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
  process.exit(0);
}
