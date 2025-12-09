#!/usr/bin/env node

/**
 * Unit tests for CLAUDE.md git revert conflict resolution
 *
 * This test ensures that the cleanupClaudeFile function correctly handles
 * merge conflicts when reverting the initial CLAUDE.md commit, preventing
 * regression of issue #625.
 *
 * References:
 * - Issue #625: https://github.com/deep-assistant/hive-mind/issues/625
 * - Root cause: CLAUDE.md was modified after initial commit (e.g., by prettier)
 *   causing a merge conflict when git revert tries to revert the initial commit
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

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.log(`❌ FAIL: ${testName}`);
    if (details) {
      console.log(`   Details: ${details}`);
    }
    testsFailed++;
  }
}

// Helper to create a test repository
const createTestRepo = async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-revert-625-'));
  await $({ cwd: tempDir })`git init -q`;
  await $({ cwd: tempDir })`git config user.email "test@example.com"`;
  await $({ cwd: tempDir })`git config user.name "Test User"`;
  return tempDir;
};

console.log('🧪 Testing CLAUDE.md Git Revert Conflict Resolution\n');

// Test 1: Conflict when CLAUDE.md existed before and was appended to, then modified
async function test1_ConflictWithExistingFile() {
  const tempDir = await createTestRepo();

  try {
    // Create initial state with existing CLAUDE.md
    const initialContent = `Issue to solve: undefined
Your prepared branch: issue-14-abc123
Your prepared working directory: /tmp/test-1

Proceed.
`;
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), initialContent);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -q -m "Previous session commit"`;

    // Append new task info (simulate initial commit)
    const appendedContent = initialContent + `
---

Issue to solve: undefined
Your prepared branch: issue-19-xyz789
Your prepared working directory: /tmp/test-2

Proceed.
`;
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), appendedContent);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -q -m "Initial commit with task details"`;

    const initialCommitResult = await $({ cwd: tempDir })`git rev-parse HEAD`;
    const initialCommitHash = initialCommitResult.stdout.trim();

    // Simulate prettier removing trailing newline
    const modifiedContent = appendedContent.replace(/\n$/, '');
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), modifiedContent);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -q -m "chore: format files with prettier"`;

    // Revert the initial commit
    await cleanupClaudeFile(tempDir, 'test-branch', initialCommitHash);

    // Verify the result
    const finalContent = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    const statusResult = await $({ cwd: tempDir })`git status --short`;

    assert(
      finalContent === initialContent && statusResult.stdout.trim() === '',
      'Conflict resolved: CLAUDE.md restored to pre-session state',
      `Content matches: ${finalContent === initialContent}, Status clean: ${statusResult.stdout.trim() === ''}`
    );
  } catch (error) {
    assert(false, 'Conflict resolved: CLAUDE.md restored to pre-session state', error.message);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

// Test 2: Conflict when CLAUDE.md was created fresh in session
async function test2_ConflictWithNewFile() {
  const tempDir = await createTestRepo();

  try {
    // Create initial commit without CLAUDE.md
    await fs.writeFile(path.join(tempDir, 'README.md'), '# Test Repo\n');
    await $({ cwd: tempDir })`git add README.md`;
    await $({ cwd: tempDir })`git commit -q -m "Initial commit"`;

    // Add CLAUDE.md (simulate initial commit)
    const newContent = `Issue to solve: undefined
Your prepared branch: issue-19-xyz789
Your prepared working directory: /tmp/test-2

Proceed.
`;
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), newContent);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -q -m "Initial commit with task details"`;

    const initialCommitResult = await $({ cwd: tempDir })`git rev-parse HEAD`;
    const initialCommitHash = initialCommitResult.stdout.trim();

    // Modify CLAUDE.md in a work commit
    const modifiedContent = newContent.replace(/Proceed\.\n/, 'Proceed.');
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), modifiedContent);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -q -m "chore: format files"`;

    // Revert the initial commit
    await cleanupClaudeFile(tempDir, 'test-branch', initialCommitHash);

    // Verify CLAUDE.md was deleted
    const fileExists = await fs.access(path.join(tempDir, 'CLAUDE.md')).then(() => true).catch(() => false);
    const statusResult = await $({ cwd: tempDir })`git status --short`;

    assert(
      !fileExists && statusResult.stdout.trim() === '',
      'Conflict resolved: CLAUDE.md correctly deleted',
      `File exists: ${fileExists}, Status clean: ${statusResult.stdout.trim() === ''}`
    );
  } catch (error) {
    assert(false, 'Conflict resolved: CLAUDE.md correctly deleted', error.message);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

// Test 3: No conflict scenario (baseline)
async function test3_NoConflict() {
  const tempDir = await createTestRepo();

  try {
    // Create initial commit with CLAUDE.md
    const content = `Issue to solve: undefined
Your prepared branch: issue-19-xyz789
Your prepared working directory: /tmp/test-2

Proceed.
`;
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), content);
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git commit -q -m "Initial commit with task details"`;

    const initialCommitResult = await $({ cwd: tempDir })`git rev-parse HEAD`;
    const initialCommitHash = initialCommitResult.stdout.trim();

    // Make work commits that DON'T touch CLAUDE.md
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src/index.js'), 'console.log("hello");\n');
    await $({ cwd: tempDir })`git add src/index.js`;
    await $({ cwd: tempDir })`git commit -q -m "feat: add feature"`;

    // Revert the initial commit (should work without conflict)
    await cleanupClaudeFile(tempDir, 'test-branch', initialCommitHash);

    // Verify CLAUDE.md was deleted
    const fileExists = await fs.access(path.join(tempDir, 'CLAUDE.md')).then(() => true).catch(() => false);
    const statusResult = await $({ cwd: tempDir })`git status --short`;

    assert(
      !fileExists && statusResult.stdout.trim() === '',
      'No conflict: Normal revert worked correctly',
      `File exists: ${fileExists}, Status clean: ${statusResult.stdout.trim() === ''}`
    );
  } catch (error) {
    assert(false, 'No conflict: Normal revert worked correctly', error.message);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

// Run all tests
await test1_ConflictWithExistingFile();
await test2_ConflictWithNewFile();
await test3_NoConflict();

// Print summary
console.log('\n' + '═'.repeat(60));
console.log('📊 Test Summary');
console.log('═'.repeat(60));
console.log(`Total tests: ${testsPassed + testsFailed}`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed');
  process.exit(0);
}
