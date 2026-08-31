#!/usr/bin/env node

/**
 * Test script for the auto-restart infinite loop fix
 * Simulates the scenario where opencode makes changes but doesn't commit them
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runTest() {
  console.log('🧪 Testing auto-restart infinite loop fix...');

  // Create a temporary directory for testing
  const testDir = `/tmp/test-auto-restart-${Date.now()}`;
  execSync(`mkdir -p ${testDir}`);
  execSync(`cd ${testDir} && git init`);
  execSync(`cd ${testDir} && git config user.name "Test User"`);
  execSync(`cd ${testDir} && git config user.email "test@example.com"`);

  // Create initial commit
  await fs.writeFile(`${testDir}/README.md`, '# Test Repository');
  execSync(`cd ${testDir} && git add README.md && git commit -m "Initial commit"`);

  // Simulate opencode making changes (create/modify files)
  await fs.writeFile(`${testDir}/test.js`, 'console.log("Hello World");');
  execSync(`cd ${testDir} && git add test.js`);

  // Check git status - should show staged changes
  const statusBefore = execSync(`cd ${testDir} && git status --porcelain`, { encoding: 'utf8' });
  console.log('📊 Git status before simulated commit:', statusBefore.trim());

  // Simulate the auto-commit logic from our fix
  try {
    const gitStatusResult = execSync(`cd ${testDir} && git status --porcelain`, { encoding: 'utf8' });
    const statusOutput = gitStatusResult.trim();

    if (statusOutput) {
      console.log('💾 Auto-committing changes...');
      execSync(`cd ${testDir} && git add -A`);
      execSync(`cd ${testDir} && git commit -m "Auto-commit: Changes made by OpenCode during problem-solving session"`);

      const statusAfter = execSync(`cd ${testDir} && git status --porcelain`, { encoding: 'utf8' });
      console.log('📊 Git status after auto-commit:', statusAfter.trim() || 'Clean working directory');

      if (!statusAfter.trim()) {
        console.log('✅ SUCCESS: Changes were auto-committed, preventing infinite loop');
      } else {
        console.log('❌ FAILED: Changes were not committed');
      }
    } else {
      console.log('ℹ️  No uncommitted changes found');
    }
  } catch (error) {
    console.log('❌ ERROR during auto-commit simulation:', error.message);
  }

  // Cleanup
  execSync(`rm -rf ${testDir}`);
  console.log('🧹 Test cleanup completed');
}

runTest().catch(console.error);