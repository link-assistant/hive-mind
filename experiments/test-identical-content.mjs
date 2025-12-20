#!/usr/bin/env node
/**
 * Test to understand when Git sees no changes
 * The issue is when CLAUDE.md already has the EXACT content we're trying to append
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testGitScenario() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Git behavior with identical content');
  console.log('='.repeat(60));

  const testDir = path.join('/tmp', `git-test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  try {
    // Initialize git repo
    console.log('\n1. Initializing git repository');
    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'pipe' });

    const claudeMdPath = path.join(testDir, 'CLAUDE.md');
    const taskInfo = `Issue to solve: https://github.com/test/repo/issues/1
Your prepared branch: issue-1-abc123
Your prepared working directory: /tmp/test

Proceed.`;

    // First commit
    console.log('\n2. First commit: Creating CLAUDE.md');
    await fs.writeFile(claudeMdPath, taskInfo);
    execSync('git add CLAUDE.md', { cwd: testDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: 'pipe' });
    console.log('   ✅ Commit 1 created');

    // Second attempt: Append THE SAME content that's already at the end
    console.log('\n3. Second run: Appending to existing CLAUDE.md (no timestamp)');
    const existingContent = await fs.readFile(claudeMdPath, 'utf8');
    const trimmedExisting = existingContent.trimEnd();
    const newContent = `${trimmedExisting}\n\n---\n\n${taskInfo}`;
    await fs.writeFile(claudeMdPath, newContent);

    execSync('git add CLAUDE.md', { cwd: testDir, stdio: 'pipe' });
    const status1 = execSync('git status --short', { cwd: testDir, encoding: 'utf8' });
    console.log(`   Git status: ${status1.trim() || '(no changes)'}`);

    if (status1.trim()) {
      execSync('git commit -m "Second commit"', { cwd: testDir, stdio: 'pipe' });
      console.log('   ✅ Commit 2 created');
    } else {
      console.log('   ❌ No changes to commit');
    }

    // Third attempt: Write the EXACT same file content again (simulating re-run)
    console.log('\n4. Third run: Writing EXACT same content again');
    await fs.writeFile(claudeMdPath, newContent); // Same content as before
    execSync('git add CLAUDE.md', { cwd: testDir, stdio: 'pipe' });
    const status2 = execSync('git status --short', { cwd: testDir, encoding: 'utf8' });
    console.log(`   Git status: ${status2.trim() || '(no changes)'}`);

    if (status2.trim()) {
      execSync('git commit -m "Third commit"', { cwd: testDir, stdio: 'pipe' });
      console.log('   ✅ Commit 3 created');
    } else {
      console.log('   ❌ No changes to commit (THIS IS THE PROBLEM!)');
    }

    // Now test with timestamp
    console.log('\n5. Fourth run: Appending with timestamp');
    const existingContent2 = await fs.readFile(claudeMdPath, 'utf8');
    const trimmedExisting2 = existingContent2.trimEnd();
    const timestamp = new Date().toISOString();
    const newContentWithTimestamp = `${trimmedExisting2}\n\n---\n\n${taskInfo}\n\nRun timestamp: ${timestamp}`;
    await fs.writeFile(claudeMdPath, newContentWithTimestamp);

    execSync('git add CLAUDE.md', { cwd: testDir, stdio: 'pipe' });
    const status3 = execSync('git status --short', { cwd: testDir, encoding: 'utf8' });
    console.log(`   Git status: ${status3.trim() || '(no changes)'}`);

    if (status3.trim()) {
      execSync('git commit -m "Fourth commit with timestamp"', { cwd: testDir, stdio: 'pipe' });
      console.log('   ✅ Commit 4 created (FIX WORKS!)');
    } else {
      console.log('   ❌ No changes to commit');
    }

    // Show commit history
    console.log('\n6. Commit history:');
    const log = execSync('git log --oneline', { cwd: testDir, encoding: 'utf8' });
    console.log(log.split('\n').map(l => `   ${l}`).join('\n'));

  } finally {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Run test
(async () => {
  await testGitScenario();

  console.log('\n' + '='.repeat(60));
  console.log('CONCLUSION');
  console.log('='.repeat(60));
  console.log('\nThe problem occurs when:');
  console.log('  1. CLAUDE.md already exists with content A');
  console.log('  2. We append content B to create A+B and commit it');
  console.log('  3. On re-run, we try to append B again, but content is still A+B');
  console.log('  4. Git sees no changes = no commit = PR creation fails');
  console.log('\nThe fix (timestamp) ensures:');
  console.log('  - Each append has unique content (timestamp changes)');
  console.log('  - Git always sees changes');
  console.log('  - PR creation succeeds');
  console.log('');
})();
