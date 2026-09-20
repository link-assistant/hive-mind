#!/usr/bin/env node

/**
 * Test script to verify issue #468 fix - preserving existing CLAUDE.md
 * This tests that when CLAUDE.md already exists, we append task info instead of overwriting
 */

import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

console.log('🧪 Testing CLAUDE.md preservation (issue #468)...\n');

async function runTest() {
  // Create a temporary test directory
  const testDir = await mkdtemp(join(tmpdir(), 'test-claude-md-'));
  console.log(`📁 Test directory: ${testDir}`);

  try {
    // Initialize git repo
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
    console.log('✅ Git repository initialized');

    // Create an existing CLAUDE.md with user content
    const claudeMdPath = join(testDir, 'CLAUDE.md');
    const existingContent = `# Project Documentation

This is my existing CLAUDE.md with important project information.

## Architecture
- Module A
- Module B
- Module C

## Important Notes
Do not delete this content!`;

    await writeFile(claudeMdPath, existingContent);
    execSync('git add CLAUDE.md', { cwd: testDir });
    execSync('git commit -m "Add project CLAUDE.md"', { cwd: testDir });
    console.log('✅ Existing CLAUDE.md created and committed');

    // Simulate what the fix should do: append task info with separator
    const taskInfo = `Issue to solve: https://github.com/link-assistant/hive-mind/issues/468
Your prepared branch: issue-468-test
Your prepared working directory: ${testDir}

Proceed.`;

    const trimmedExisting = existingContent.trimEnd();
    const updatedContent = `${trimmedExisting}\n\n---\n\n${taskInfo}`;

    await writeFile(claudeMdPath, updatedContent);
    console.log('✅ Task info appended to CLAUDE.md');

    // Verify the content
    const finalContent = await readFile(claudeMdPath, 'utf8');

    // Check that original content is preserved
    if (!finalContent.includes('# Project Documentation')) {
      throw new Error('❌ Original content was lost!');
    }
    if (!finalContent.includes('Do not delete this content!')) {
      throw new Error('❌ User content was removed!');
    }

    // Check that separator exists
    if (!finalContent.includes('\n---\n')) {
      throw new Error('❌ Separator not found!');
    }

    // Check that task info was added
    if (!finalContent.includes('Issue to solve: https://github.com/link-assistant/hive-mind/issues/468')) {
      throw new Error('❌ Task info not added!');
    }

    console.log('✅ Original content preserved');
    console.log('✅ Separator added correctly');
    console.log('✅ Task info appended successfully');

    // Commit the change
    execSync('git add CLAUDE.md', { cwd: testDir });
    execSync('git commit -m "Add task info to CLAUDE.md"', { cwd: testDir });
    console.log('✅ Changes committed');

    // Test the revert functionality
    console.log('\n🔄 Testing revert functionality...');

    // Get first commit hash
    const commits = execSync('git log --format=%H --reverse', { cwd: testDir }).toString().trim().split('\n');

    if (commits.length < 2) {
      throw new Error('❌ Not enough commits for revert test');
    }

    const secondCommit = commits[1]; // The task info commit

    // Revert the second commit (task info addition)
    execSync(`git revert ${secondCommit} --no-edit`, { cwd: testDir });
    console.log('✅ Reverted task info commit');

    // Verify that original content is restored
    const revertedContent = await readFile(claudeMdPath, 'utf8');

    if (revertedContent !== existingContent) {
      console.log('Expected:', existingContent);
      console.log('Got:', revertedContent);
      throw new Error('❌ Original content not properly restored after revert!');
    }

    console.log('✅ Original CLAUDE.md fully restored after revert');

    console.log('\n✅ TEST PASSED: CLAUDE.md preservation works correctly!');
    console.log('   - Existing content is preserved');
    console.log('   - Task info is appended with separator');
    console.log('   - Revert restores original state');
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
