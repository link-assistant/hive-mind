#!/usr/bin/env node

/**
 * Test script to verify that commit hash is saved and used for revert
 * This tests the improvement requested in PR #470 comment
 */

import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

console.log('🧪 Testing commit hash save and revert...\n');

async function runTest() {
  // Create a temporary test directory
  const testDir = await mkdtemp(join(tmpdir(), 'test-commit-hash-'));
  console.log(`📁 Test directory: ${testDir}`);

  try {
    // Initialize git repo
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
    console.log('✅ Git repository initialized');

    // Create some initial commits to simulate a repository with history
    for (let i = 1; i <= 5; i++) {
      await writeFile(join(testDir, `file${i}.txt`), `Content ${i}`);
      execSync(`git add file${i}.txt`, { cwd: testDir });
      execSync(`git commit -m "Initial commit ${i}"`, { cwd: testDir });
    }
    console.log('✅ Created 5 initial commits (simulating existing repo history)');

    // Create an existing CLAUDE.md with user content
    const claudeMdPath = join(testDir, 'CLAUDE.md');
    const existingContent = `# My Important Documentation

This content must be preserved!`;

    await writeFile(claudeMdPath, existingContent);
    execSync('git add CLAUDE.md', { cwd: testDir });
    execSync('git commit -m "Add user CLAUDE.md"', { cwd: testDir });
    console.log('✅ Created existing CLAUDE.md');

    // Simulate adding task info (what auto-pr creation does)
    const taskInfo = `Issue to solve: https://github.com/link-assistant/hive-mind/issues/468
Your prepared branch: test-branch
Your prepared working directory: ${testDir}

Proceed.`;

    const trimmedExisting = existingContent.trimEnd();
    const updatedContent = `${trimmedExisting}\n\n---\n\n${taskInfo}`;

    await writeFile(claudeMdPath, updatedContent);
    execSync('git add CLAUDE.md', { cwd: testDir });
    execSync('git commit -m "Initial commit with task details for issue #468"', { cwd: testDir });

    // Get the commit hash we just created (simulating what auto-pr does now)
    const claudeCommitHash = execSync('git log --format=%H -1', { cwd: testDir })
      .toString()
      .trim();

    console.log(`✅ Created CLAUDE.md task commit: ${claudeCommitHash.substring(0, 7)}...`);
    console.log(`   This is commit #7 in the repository (not the first commit overall)`);

    // Add more commits after the CLAUDE.md commit (simulating work done)
    for (let i = 1; i <= 3; i++) {
      await writeFile(join(testDir, `work${i}.txt`), `Work ${i}`);
      execSync(`git add work${i}.txt`, { cwd: testDir });
      execSync(`git commit -m "Work commit ${i}"`, { cwd: testDir });
    }
    console.log('✅ Added 3 more commits (simulating work done by AI)');

    // Now test the OLD way (getting first commit - WRONG!)
    console.log('\n❌ OLD METHOD: Getting first commit from entire history');
    const firstCommitOld = execSync('git log --format=%H --reverse', { cwd: testDir })
      .toString()
      .trim()
      .split('\n')[0];
    console.log(`   First commit overall: ${firstCommitOld.substring(0, 7)}...`);
    console.log(`   This is WRONG - it's the first commit of the repo, not the CLAUDE.md commit!`);

    // Test the NEW way (using saved hash - CORRECT!)
    console.log('\n✅ NEW METHOD: Using saved commit hash');
    console.log(`   Saved commit hash: ${claudeCommitHash.substring(0, 7)}...`);
    console.log(`   This is CORRECT - it's the exact CLAUDE.md commit we created!`);

    // Verify they're different
    if (firstCommitOld === claudeCommitHash) {
      console.log('\n⚠️  In this simple test they happen to match, but in real scenarios');
      console.log('   with existing commits, they would be different!');
    } else {
      console.log('\n✅ Confirmed: Old method would revert wrong commit!');
      console.log(`   Old method would try to revert: ${firstCommitOld.substring(0, 7)}`);
      console.log(`   New method correctly reverts: ${claudeCommitHash.substring(0, 7)}`);
    }

    // Test the revert using the CORRECT hash
    console.log('\n🔄 Testing revert with saved commit hash...');
    execSync(`git revert ${claudeCommitHash} --no-edit`, { cwd: testDir });
    console.log('✅ Reverted CLAUDE.md commit using saved hash');

    // Verify that original content is restored
    const revertedContent = await readFile(claudeMdPath, 'utf8');

    if (revertedContent !== existingContent) {
      console.log('Expected:', existingContent);
      console.log('Got:', revertedContent);
      throw new Error('❌ Original content not properly restored after revert!');
    }

    console.log('✅ Original CLAUDE.md fully restored');

    console.log('\n✅ TEST PASSED: Commit hash save and revert works correctly!');
    console.log('   ✓ Saved commit hash immediately after creating it');
    console.log('   ✓ Used saved hash instead of searching for first commit');
    console.log('   ✓ Correctly reverted the right commit');
    console.log('   ✓ Original content fully restored');
    console.log('\n💡 Benefits:');
    console.log('   • Faster: No need to list all commits');
    console.log('   • Safer: Always reverts the correct commit');
    console.log('   • Simpler: Direct hash lookup instead of array operations');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cleanup
    await rm(testDir, { recursive: true, force: true });
    console.log(`\n🗑️  Cleaned up test directory`);
  }
}

runTest();
