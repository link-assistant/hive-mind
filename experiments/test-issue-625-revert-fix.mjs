#!/usr/bin/env node

/**
 * Test script for issue #625: git revert conflict resolution
 *
 * This script simulates the scenario where CLAUDE.md exists,
 * gets appended to in an initial commit, then modified again,
 * and tests if the revert logic handles the conflict correctly.
 */

// Use use-m to dynamically import modules
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const os = (await use('os')).default;

// Import the function we're testing
const { cleanupClaudeFile } = await import('../src/solve.results.lib.mjs');

// Create a test repository
const createTestRepo = async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-revert-625-'));

  console.log(`\n📁 Creating test repository in: ${tempDir}`);

  // Initialize git repo
  await $({ cwd: tempDir })`git init`;
  await $({ cwd: tempDir })`git config user.email "test@example.com"`;
  await $({ cwd: tempDir })`git config user.name "Test User"`;

  return tempDir;
};

// Test Case 1: CLAUDE.md existed before, was appended to, then modified by prettier
const testCase1_ExistingFileModified = async () => {
  console.log('\n🧪 Test Case 1: CLAUDE.md existed, appended to, then modified\n');

  const tempDir = await createTestRepo();

  try {
    // Step 1: Create initial state with existing CLAUDE.md
    const initialContent = `Issue to solve: undefined
Your prepared branch: issue-14-abc123
Your prepared working directory: /tmp/test-1

Proceed.
`;
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), initialContent);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -m "Previous session commit"`;

    console.log('✓ Created initial commit with CLAUDE.md');

    // Step 2: Append new task info (simulate initial commit)
    const appendedContent = initialContent + `
---

Issue to solve: undefined
Your prepared branch: issue-19-xyz789
Your prepared working directory: /tmp/test-2

Proceed.
`;
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), appendedContent);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -m "Initial commit with task details"`;

    const initialCommitResult = await $({ cwd: tempDir })`git rev-parse HEAD`;
    const initialCommitHash = initialCommitResult.stdout.trim();

    console.log(`✓ Created initial commit (${initialCommitHash.substring(0, 7)}...)`);

    // Step 3: Simulate prettier removing trailing newline (or other modification)
    const modifiedContent = appendedContent.replace(/\n$/, ''); // Remove trailing newline
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), modifiedContent);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -m "chore: format files with prettier"`;

    console.log('✓ Created work commit with CLAUDE.md modification');

    // Step 4: Try to revert the initial commit using our fixed function
    console.log('\n🔄 Attempting to revert initial commit with cleanupClaudeFile...');
    await cleanupClaudeFile(tempDir, 'test-branch', initialCommitHash);

    // Step 5: Verify the result
    const finalContent = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    const statusResult = await $({ cwd: tempDir })`git status --short`;

    console.log('\n📊 Results:');
    console.log('   Git status:', statusResult.stdout.trim() || 'clean');
    console.log('   CLAUDE.md content matches initial state:', finalContent === initialContent);

    if (finalContent === initialContent && statusResult.stdout.trim() === '') {
      console.log('\n✅ Test Case 1 PASSED: Conflict was resolved correctly!');
      return true;
    } else {
      console.log('\n❌ Test Case 1 FAILED: CLAUDE.md not in expected state');
      console.log('\nExpected content:');
      console.log(initialContent);
      console.log('\nActual content:');
      console.log(finalContent);
      return false;
    }
  } catch (error) {
    console.error('\n❌ Test Case 1 ERROR:', error.message);
    return false;
  } finally {
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

// Test Case 2: CLAUDE.md was created fresh (didn't exist before)
const testCase2_NewFileCreated = async () => {
  console.log('\n🧪 Test Case 2: CLAUDE.md was created fresh in session\n');

  const tempDir = await createTestRepo();

  try {
    // Step 1: Create initial commit without CLAUDE.md
    await fs.writeFile(path.join(tempDir, 'README.md'), '# Test Repo\n');
    await $({ cwd: tempDir })`git add README.md`;
    await $({ cwd: tempDir })`git commit -m "Initial commit"`;

    console.log('✓ Created initial commit without CLAUDE.md');

    // Step 2: Add CLAUDE.md (simulate initial commit)
    const newContent = `Issue to solve: undefined
Your prepared branch: issue-19-xyz789
Your prepared working directory: /tmp/test-2

Proceed.
`;
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), newContent);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -m "Initial commit with task details"`;

    const initialCommitResult = await $({ cwd: tempDir })`git rev-parse HEAD`;
    const initialCommitHash = initialCommitResult.stdout.trim();

    console.log(`✓ Created initial commit with new CLAUDE.md (${initialCommitHash.substring(0, 7)}...)`);

    // Step 3: Modify CLAUDE.md in a work commit
    const modifiedContent = newContent.replace(/Proceed\.\n/, 'Proceed.'); // Remove trailing newline
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), modifiedContent);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -m "chore: format files"`;

    console.log('✓ Created work commit with CLAUDE.md modification');

    // Step 4: Try to revert the initial commit
    console.log('\n🔄 Attempting to revert initial commit with cleanupClaudeFile...');
    await cleanupClaudeFile(tempDir, 'test-branch', initialCommitHash);

    // Step 5: Verify the result - CLAUDE.md should be deleted
    const fileExists = await fs.access(path.join(tempDir, 'CLAUDE.md')).then(() => true).catch(() => false);
    const statusResult = await $({ cwd: tempDir })`git status --short`;

    console.log('\n📊 Results:');
    console.log('   Git status:', statusResult.stdout.trim() || 'clean');
    console.log('   CLAUDE.md exists:', fileExists);

    if (!fileExists && statusResult.stdout.trim() === '') {
      console.log('\n✅ Test Case 2 PASSED: CLAUDE.md was correctly deleted!');
      return true;
    } else {
      console.log('\n❌ Test Case 2 FAILED: CLAUDE.md should have been deleted');
      return false;
    }
  } catch (error) {
    console.error('\n❌ Test Case 2 ERROR:', error.message);
    return false;
  } finally {
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

// Test Case 3: No conflict (baseline test)
const testCase3_NoConflict = async () => {
  console.log('\n🧪 Test Case 3: No conflict scenario (baseline)\n');

  const tempDir = await createTestRepo();

  try {
    // Step 1: Create initial commit with CLAUDE.md
    const content = `Issue to solve: undefined
Your prepared branch: issue-19-xyz789
Your prepared working directory: /tmp/test-2

Proceed.
`;
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), content);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -m "Initial commit with task details"`;

    const initialCommitResult = await $({ cwd: tempDir })`git rev-parse HEAD`;
    const initialCommitHash = initialCommitResult.stdout.trim();

    console.log(`✓ Created initial commit (${initialCommitHash.substring(0, 7)}...)`);

    // Step 2: Make work commits that DON'T touch CLAUDE.md
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src/index.js'), 'console.log("hello");\n');
    await $({ cwd: tempDir })`git add src/index.js`;
    await $({ cwd: tempDir })`git commit -m "feat: add feature"`;

    console.log('✓ Created work commit without touching CLAUDE.md');

    // Step 3: Try to revert the initial commit (should work without conflict)
    console.log('\n🔄 Attempting to revert initial commit with cleanupClaudeFile...');
    await cleanupClaudeFile(tempDir, 'test-branch', initialCommitHash);

    // Step 4: Verify the result
    const fileExists = await fs.access(path.join(tempDir, 'CLAUDE.md')).then(() => true).catch(() => false);
    const statusResult = await $({ cwd: tempDir })`git status --short`;

    console.log('\n📊 Results:');
    console.log('   Git status:', statusResult.stdout.trim() || 'clean');
    console.log('   CLAUDE.md exists:', fileExists);

    if (!fileExists && statusResult.stdout.trim() === '') {
      console.log('\n✅ Test Case 3 PASSED: Normal revert worked correctly!');
      return true;
    } else {
      console.log('\n❌ Test Case 3 FAILED');
      return false;
    }
  } catch (error) {
    console.error('\n❌ Test Case 3 ERROR:', error.message);
    return false;
  } finally {
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

// Run all tests
const runAllTests = async () => {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  Testing Issue #625: Git Revert Conflict Fix      ║');
  console.log('╚════════════════════════════════════════════════════╝');

  const results = [];

  results.push(await testCase1_ExistingFileModified());
  results.push(await testCase2_NewFileCreated());
  results.push(await testCase3_NoConflict());

  console.log('\n' + '═'.repeat(54));
  console.log('📊 Test Summary:');
  console.log('═'.repeat(54));
  console.log(`Total tests: ${results.length}`);
  console.log(`Passed: ${results.filter(r => r).length}`);
  console.log(`Failed: ${results.filter(r => !r).length}`);

  if (results.every(r => r)) {
    console.log('\n✅ All tests PASSED!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests FAILED');
    process.exit(1);
  }
};

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
