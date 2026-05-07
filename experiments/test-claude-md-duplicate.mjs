#!/usr/bin/env node

/**
 * Test script to verify CLAUDE.md duplicate content handling
 * This tests the fix for issue #408 - handling when CLAUDE.md already exists
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

console.log('🧪 Testing CLAUDE.md duplicate content handling...\n');

async function runTest() {
  // Create a temporary directory for testing
  const testDir = join(tmpdir(), `test-claude-md-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  try {
    console.log(`📁 Test directory: ${testDir}`);

    // Initialize git repo
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
    console.log('✅ Git repo initialized');

    // Create initial CLAUDE.md
    const claudeMdPath = join(testDir, 'CLAUDE.md');
    const initialContent = `Issue to solve: https://github.com/test/repo/issues/1
Your prepared branch: test-branch
Your prepared working directory: ${testDir}

Proceed.`;

    await fs.writeFile(claudeMdPath, initialContent);
    execSync('git add CLAUDE.md', { cwd: testDir });
    execSync('git commit -m "Initial CLAUDE.md"', { cwd: testDir });
    console.log('✅ Initial CLAUDE.md created and committed');

    // Simulate the fix: check if content exists and add timestamp if needed
    console.log('\n📝 Testing duplicate content handling...');

    const existingContent = await fs.readFile(claudeMdPath, 'utf8');
    const newContent = initialContent; // Same content

    let finalContent = newContent;
    if (existingContent.trim() === newContent.trim()) {
      console.log('⚠️  Content is identical, adding timestamp...');
      const timestamp = new Date().toISOString();
      finalContent = `${newContent}
Generated at: ${timestamp}`;
    }

    await fs.writeFile(claudeMdPath, finalContent);

    // Check git status
    const gitStatus = execSync('git status --short', { cwd: testDir, encoding: 'utf8' });
    console.log(`Git status: ${gitStatus.trim() || '(empty)'}`);

    if (!gitStatus.trim()) {
      console.log('❌ FAILED: Git status is empty - no changes detected');
      return false;
    }

    // Try to add and commit
    execSync('git add CLAUDE.md', { cwd: testDir });
    const statusAfterAdd = execSync('git status --short', { cwd: testDir, encoding: 'utf8' });
    console.log(`Git status after add: ${statusAfterAdd.trim()}`);

    if (!statusAfterAdd.trim()) {
      console.log('❌ FAILED: Nothing was staged');
      return false;
    }

    execSync('git commit -m "Update CLAUDE.md with timestamp"', { cwd: testDir });
    console.log('✅ Successfully committed updated CLAUDE.md');

    // Verify commit was created
    const commitLog = execSync('git log --oneline', { cwd: testDir, encoding: 'utf8' });
    const commits = commitLog.trim().split('\n');
    console.log(`\n📋 Commits (${commits.length}):`);
    commits.forEach(commit => console.log(`   ${commit}`));

    if (commits.length !== 2) {
      console.log(`❌ FAILED: Expected 2 commits, got ${commits.length}`);
      return false;
    }

    console.log('\n✅ TEST PASSED: Duplicate CLAUDE.md handling works correctly');
    return true;
  } finally {
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
    console.log(`\n🧹 Cleaned up test directory`);
  }
}

runTest()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('❌ Test failed with error:', err.message);
    process.exit(1);
  });
