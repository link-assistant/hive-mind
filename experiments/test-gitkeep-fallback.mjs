#!/usr/bin/env node
/**
 * Test script for .gitkeep fallback functionality
 * Tests the behavior when CLAUDE.md is in .gitignore
 */

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTest() {
  console.log('🧪 Testing .gitkeep fallback functionality\n');

  // Create a temporary test directory
  const testDir = path.join(__dirname, `test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  try {
    // Initialize a git repo
    console.log('📦 Initializing test repository...');
    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'pipe' });

    // Create a .gitignore that ignores CLAUDE.md
    console.log('📝 Creating .gitignore with CLAUDE.md...');
    await fs.writeFile(path.join(testDir, '.gitignore'), 'CLAUDE.md\n');
    execSync('git add .gitignore && git commit -m "Add .gitignore"', { cwd: testDir, stdio: 'pipe' });

    // Test 1: Try to add CLAUDE.md (should fail)
    console.log('\n🔍 Test 1: Trying to add CLAUDE.md (should fail)...');
    await fs.writeFile(path.join(testDir, 'CLAUDE.md'), 'Test content');
    const addResult = execSync('git add CLAUDE.md 2>&1 || true', { cwd: testDir, encoding: 'utf8' });
    console.log('   Result:', addResult.trim() || '(silent failure)');

    const statusAfterClaudeAdd = execSync('git status --short', { cwd: testDir, encoding: 'utf8' });
    console.log('   Git status:', statusAfterClaudeAdd.trim() || '(nothing staged)');

    if (statusAfterClaudeAdd.trim()) {
      console.log('   ❌ FAILED: CLAUDE.md should not be staged');
      return false;
    }
    console.log('   ✅ PASSED: CLAUDE.md was not staged');

    // Test 2: Check if CLAUDE.md is ignored
    console.log('\n🔍 Test 2: Checking if CLAUDE.md is ignored...');
    const checkIgnoreResult = execSync('git check-ignore CLAUDE.md', { cwd: testDir, encoding: 'utf8' });
    console.log('   Result:', checkIgnoreResult.trim());

    if (checkIgnoreResult.trim() === 'CLAUDE.md') {
      console.log('   ✅ PASSED: CLAUDE.md is ignored');
    } else {
      console.log('   ❌ FAILED: CLAUDE.md should be ignored');
      return false;
    }

    // Test 3: Create and add .gitkeep as fallback
    console.log('\n🔍 Test 3: Creating and adding .gitkeep as fallback...');
    const gitkeepContent = `# Auto-generated file for PR creation
# This file was created because CLAUDE.md is in .gitignore
# It will be removed when the task is complete`;
    await fs.writeFile(path.join(testDir, '.gitkeep'), gitkeepContent);

    execSync('git add .gitkeep', { cwd: testDir, stdio: 'pipe' });
    const statusAfterGitkeepAdd = execSync('git status --short', { cwd: testDir, encoding: 'utf8' });
    console.log('   Git status:', statusAfterGitkeepAdd.trim());

    if (statusAfterGitkeepAdd.includes('.gitkeep')) {
      console.log('   ✅ PASSED: .gitkeep was staged successfully');
    } else {
      console.log('   ❌ FAILED: .gitkeep should be staged');
      return false;
    }

    // Test 4: Commit the .gitkeep file
    console.log('\n🔍 Test 4: Committing .gitkeep...');
    execSync('git commit -m "Add .gitkeep for PR creation"', { cwd: testDir, stdio: 'pipe' });
    const commitLog = execSync('git log --oneline -1', { cwd: testDir, encoding: 'utf8' });
    console.log('   Latest commit:', commitLog.trim());

    if (commitLog.includes('.gitkeep')) {
      console.log('   ✅ PASSED: .gitkeep was committed');
    } else {
      console.log('   ⚠️  WARNING: Commit message does not mention .gitkeep');
    }

    console.log('\n✅ All tests passed!');
    return true;

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    return false;
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up test directory...');
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

runTest().then(success => {
  process.exit(success ? 0 : 1);
});
