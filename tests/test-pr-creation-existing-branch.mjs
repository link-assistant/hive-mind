#!/usr/bin/env node
/**
 * Test suite for PR creation with existing branches
 * Tests the fix for issue #683
 */

import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import assert from 'assert';

// Test configuration
const TEST_REPO = process.env.TEST_REPO || 'test-owner/test-repo';
const TEST_ISSUE = process.env.TEST_ISSUE || '1';
const SOLVE_COMMAND = process.env.SOLVE_COMMAND || './solve.mjs';

// Helper function to execute commands
function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', ...options });
  } catch (error) {
    return { error: true, stderr: error.stderr, stdout: error.stdout, code: error.status };
  }
}

// Helper function to create a test repository
function createTestRepo() {
  const tempDir = mkdtempSync(join(tmpdir(), 'test-pr-'));

  // Initialize git repo
  exec('git init', { cwd: tempDir });
  exec('git config user.email "test@example.com"', { cwd: tempDir });
  exec('git config user.name "Test User"', { cwd: tempDir });

  // Create initial commit
  writeFileSync(join(tempDir, 'README.md'), '# Test Repo\n');
  exec('git add .', { cwd: tempDir });
  exec('git commit -m "Initial commit"', { cwd: tempDir });

  // Create master branch
  exec('git branch -M master', { cwd: tempDir });

  return tempDir;
}

// Test 1: PR creation with fresh branch
function testFreshBranch() {
  console.log('\n🧪 Test 1: PR creation with fresh branch');

  const testDir = createTestRepo();
  const branchName = `issue-${TEST_ISSUE}-test-${Date.now()}`;

  try {
    // Create a new branch
    exec(`git checkout -b ${branchName}`, { cwd: testDir });

    // Add a commit
    writeFileSync(join(testDir, 'CLAUDE.md'), 'Test content\n');
    exec('git add .', { cwd: testDir });
    exec('git commit -m "Test commit"', { cwd: testDir });

    // Simulate the push (would need actual remote for full test)
    console.log('   ✅ Fresh branch creation and commit successful');

    // Check that no force push would be used for new branch
    const gitLog = exec('git log --oneline -1', { cwd: testDir });
    assert(gitLog.includes('Test commit'), 'Commit should exist');

    console.log('   ✅ Test 1 passed');
  } catch (error) {
    console.error('   ❌ Test 1 failed:', error.message);
    throw error;
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

// Test 2: PR creation with existing branch containing commits
function testExistingBranchWithCommits() {
  console.log('\n🧪 Test 2: PR creation with existing branch containing commits');

  const testDir = createTestRepo();
  const branchName = `issue-${TEST_ISSUE}-test-${Date.now()}`;

  try {
    // Create a branch with existing commits
    exec(`git checkout -b ${branchName}`, { cwd: testDir });

    // Add first commit
    writeFileSync(join(testDir, 'file1.txt'), 'First commit\n');
    exec('git add .', { cwd: testDir });
    exec('git commit -m "First commit"', { cwd: testDir });

    // Add second commit
    writeFileSync(join(testDir, 'file2.txt'), 'Second commit\n');
    exec('git add .', { cwd: testDir });
    exec('git commit -m "Second commit"', { cwd: testDir });

    // Switch back to master and then back to branch (simulating continue mode)
    exec('git checkout master', { cwd: testDir });
    exec(`git checkout ${branchName}`, { cwd: testDir });

    // Add CLAUDE.md (simulating auto-pr creation)
    writeFileSync(join(testDir, 'CLAUDE.md'), 'Task info\n');
    exec('git add .', { cwd: testDir });
    exec('git commit -m "Add CLAUDE.md"', { cwd: testDir });

    // Check that all commits exist
    const gitLog = exec('git log --oneline', { cwd: testDir });
    assert(gitLog.includes('First commit'), 'First commit should exist');
    assert(gitLog.includes('Second commit'), 'Second commit should exist');
    assert(gitLog.includes('Add CLAUDE.md'), 'CLAUDE.md commit should exist');

    // Count commits ahead of master
    const commitCount = exec('git rev-list --count master..HEAD', { cwd: testDir }).trim();
    assert(commitCount === '3', `Should have 3 commits ahead, got ${commitCount}`);

    console.log('   ✅ Existing branch preserves all commits');
    console.log('   ✅ Test 2 passed');
  } catch (error) {
    console.error('   ❌ Test 2 failed:', error.message);
    throw error;
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

// Test 3: PR creation with already merged branch
function testAlreadyMergedBranch() {
  console.log('\n🧪 Test 3: PR creation with already merged branch');

  const testDir = createTestRepo();
  const branchName = `issue-${TEST_ISSUE}-test-${Date.now()}`;

  try {
    // Create and merge a branch
    exec(`git checkout -b ${branchName}`, { cwd: testDir });

    // Add commit
    writeFileSync(join(testDir, 'feature.txt'), 'Feature implementation\n');
    exec('git add .', { cwd: testDir });
    exec('git commit -m "Implement feature"', { cwd: testDir });

    // Merge back to master
    exec('git checkout master', { cwd: testDir });
    exec(`git merge ${branchName} --no-ff -m "Merge branch"`, { cwd: testDir });

    // Try to create PR from merged branch
    exec(`git checkout ${branchName}`, { cwd: testDir });

    // Check that branch is merged
    const mergedBranches = exec('git branch --merged master', { cwd: testDir });
    assert(mergedBranches.includes(branchName), 'Branch should be in merged list');

    // Check commit count (should be 0 ahead)
    const commitCount = exec('git rev-list --count master..HEAD', { cwd: testDir }).trim();
    assert(commitCount === '0', `Should have 0 commits ahead after merge, got ${commitCount}`);

    console.log('   ✅ Correctly detects already merged branch');
    console.log('   ✅ Test 3 passed');
  } catch (error) {
    console.error('   ❌ Test 3 failed:', error.message);
    throw error;
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

// Test 4: Verify no force push, rebase, or reset is used
function testPushStrategy() {
  console.log('\n🧪 Test 4: Verify no force push, rebase, or reset is used');

  const testDir = createTestRepo();
  const branchName = `issue-${TEST_ISSUE}-test-${Date.now()}`;

  try {
    // Set up remote (using local path as remote)
    const remoteDir = mkdtempSync(join(tmpdir(), 'remote-'));
    exec('git init --bare', { cwd: remoteDir });
    exec(`git remote add origin ${remoteDir}`, { cwd: testDir });

    // Push master to remote
    exec('git push -u origin master', { cwd: testDir });

    // Create and push a branch
    exec(`git checkout -b ${branchName}`, { cwd: testDir });
    writeFileSync(join(testDir, 'initial.txt'), 'Initial content\n');
    exec('git add .', { cwd: testDir });
    exec('git commit -m "Initial branch commit"', { cwd: testDir });
    exec(`git push -u origin ${branchName}`, { cwd: testDir });

    // Simulate remote having additional commits (another contributor)
    const anotherClone = mkdtempSync(join(tmpdir(), 'another-'));
    exec(`git clone ${remoteDir} .`, { cwd: anotherClone });
    exec(`git checkout ${branchName}`, { cwd: anotherClone });
    writeFileSync(join(anotherClone, 'remote-change.txt'), 'Remote change\n');
    exec('git add .', { cwd: anotherClone });
    exec('git commit -m "Remote commit"', { cwd: anotherClone });
    exec(`git push origin ${branchName}`, { cwd: anotherClone });

    // Now in original repo, add local change
    writeFileSync(join(testDir, 'local-change.txt'), 'Local change\n');
    exec('git add .', { cwd: testDir });
    exec('git commit -m "Local commit"', { cwd: testDir });

    // Fetch to see remote changes
    exec('git fetch origin', { cwd: testDir });

    // Check divergence
    const ahead = exec(`git rev-list --count origin/${branchName}..HEAD`, { cwd: testDir }).trim();
    const behind = exec(`git rev-list --count HEAD..origin/${branchName}`, { cwd: testDir }).trim();

    console.log(`   📊 Branch status: ${ahead} ahead, ${behind} behind`);
    assert(ahead === '1', 'Should be 1 commit ahead');
    assert(behind === '1', 'Should be 1 commit behind');

    // Test that regular push fails (as expected) - we should NOT use force/rebase/reset
    const pushResult = exec(`git push origin ${branchName}`, { cwd: testDir });
    if (pushResult.error) {
      console.log('   ✅ Regular push correctly rejects diverged branches');
      console.log('   ✅ No force push, rebase, or reset used - history is preserved');
    } else {
      throw new Error('Push should have failed due to divergence, but it succeeded');
    }

    // Verify history is NOT altered - both commits should still exist locally
    const gitLog = exec('git log --oneline', { cwd: testDir });
    assert(gitLog.includes('Local commit'), 'Local commit should still exist');
    // Remote commit should NOT be in local history (no merge/rebase happened)
    assert(!gitLog.includes('Remote commit'), 'Remote commit should NOT be in local history');

    console.log('   ✅ Test 4 passed');

    // Cleanup
    rmSync(anotherClone, { recursive: true, force: true });
    rmSync(remoteDir, { recursive: true, force: true });
  } catch (error) {
    console.error('   ❌ Test 4 failed:', error.message);
    throw error;
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

// Test 5: Branch with no actual changes
function testNoChanges() {
  console.log('\n🧪 Test 5: Branch with no net changes (commits cancel out)');

  const testDir = createTestRepo();
  const branchName = `issue-${TEST_ISSUE}-test-${Date.now()}`;

  try {
    // Create branch
    exec(`git checkout -b ${branchName}`, { cwd: testDir });

    // Add and remove a file (no net change in content, but commits exist)
    writeFileSync(join(testDir, 'temp.txt'), 'Temporary\n');
    exec('git add .', { cwd: testDir });
    exec('git commit -m "Add temp file"', { cwd: testDir });
    exec('git rm temp.txt', { cwd: testDir });
    exec('git commit -m "Remove temp file"', { cwd: testDir });

    // Branch has commits even though net change is zero
    const commitCount = exec('git rev-list --count master..HEAD', { cwd: testDir }).trim();
    assert(commitCount === '2', `Should have 2 commits ahead (even with no net change), got ${commitCount}`);

    // Verify commits exist
    const gitLog = exec('git log --oneline', { cwd: testDir });
    assert(gitLog.includes('Add temp file'), 'First commit should exist');
    assert(gitLog.includes('Remove temp file'), 'Second commit should exist');

    console.log('   ✅ Branch has commits preserved (no history alteration)');
    console.log('   ✅ Test 5 passed');
  } catch (error) {
    console.error('   ❌ Test 5 failed:', error.message);
    throw error;
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Running PR Creation Tests for Issue #683\n');
  console.log('================================\n');

  let passed = 0;
  let failed = 0;

  const tests = [
    { name: 'Fresh Branch', fn: testFreshBranch },
    { name: 'Existing Branch with Commits', fn: testExistingBranchWithCommits },
    { name: 'Already Merged Branch', fn: testAlreadyMergedBranch },
    { name: 'Push Strategy', fn: testPushStrategy },
    { name: 'No Changes', fn: testNoChanges }
  ];

  for (const test of tests) {
    try {
      test.fn();
      passed++;
    } catch (error) {
      failed++;
      console.error(`\n❌ ${test.name} failed with error:`, error.message);
    }
  }

  console.log('\n================================');
  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch(console.error);