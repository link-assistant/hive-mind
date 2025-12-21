#!/usr/bin/env node

/**
 * Issue: gh pr create output not captured by command-stream
 *
 * Minimal reproduction showing that command-stream fails to capture
 * the PR URL output from `gh pr create`, while execSync works correctly.
 *
 * Pattern: try { reproduction } catch { workaround }
 */

console.log('🐛 Issue #11: gh pr create output not captured by command-stream\n');

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Direct imports with top-level await
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// Global variables for cleanup
let testDir = null;
let testRepo = null;
let githubUser = null;

/**
 * Setup test environment (known to work correctly)
 */
async function setupTestEnvironment() {
  console.log('📦 Setting up test repository...');

  // Create test directory
  testDir = path.join(os.tmpdir(), `test-gh-pr-${Date.now()}`);
  testRepo = 'test-repo-' + Date.now();
  await fs.mkdir(testDir, { recursive: true });

  // Get current GitHub user
  const userResult = await $`gh api user --jq .login`;
  githubUser = userResult.stdout.toString().trim();

  // Create repository
  await $`gh repo create ${githubUser}/${testRepo} --public --clone=false 2>&1`;

  // Clone repository
  await $`cd ${testDir} && git clone https://github.com/${githubUser}/${testRepo}.git 2>&1`;
  const repoDir = path.join(testDir, testRepo);

  // Create initial commit
  await fs.writeFile(path.join(repoDir, 'README.md'), '# Test Repository\n');
  await $`cd ${repoDir} && git add README.md`;
  await $`cd ${repoDir} && git commit -m "Initial commit"`;

  // Use execSync for git push (known issue #10)
  execSync(`cd ${repoDir} && git push origin main`, { encoding: 'utf8' });

  // Create feature branch with a change
  await $`cd ${repoDir} && git checkout -b test-branch`;
  await fs.writeFile(path.join(repoDir, 'test.txt'), 'Test content\n');
  await $`cd ${repoDir} && git add test.txt`;
  await $`cd ${repoDir} && git commit -m "Add test file"`;

  // Use execSync for git push (known issue #10)
  execSync(`cd ${repoDir} && git push -u origin test-branch`, { encoding: 'utf8' });

  console.log(`✅ Created test repo: ${githubUser}/${testRepo}\n`);

  return repoDir;
}

/**
 * Cleanup function
 */
async function cleanup() {
  try {
    if (githubUser && testRepo) {
      await $`gh repo delete ${githubUser}/${testRepo} --yes 2>/dev/null || true`;
    }
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
    console.log('✅ Cleanup complete');
  } catch (error) {
    // Silent cleanup
  }
}

/**
 * Custom error for output capture failure
 */
class OutputCaptureError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'OutputCaptureError';
    this.details = details;
  }
}

/**
 * Main test - minimal reproduction
 */
async function runTest() {
  let repoDir = null;

  try {
    // SETUP
    repoDir = await setupTestEnvironment();

    console.log('='.repeat(60));
    console.log('REPRODUCING ISSUE\n');

    try {
      // TRY: Reproduce the issue - attempt to capture PR URL using command-stream
      const prTitle = 'Test PR';
      const prBody = 'Test body';

      console.log('1️⃣  Using command-stream $ to create PR:');

      const prResult =
        await $`cd ${repoDir} && gh pr create --draft --title "${prTitle}" --body "${prBody}" --base main --head test-branch 2>&1`;

      const capturedOutput = prResult.stdout.toString().trim();

      console.log(`   Exit code: ${prResult.code}`);
      console.log(`   Captured output: "${capturedOutput}"`);
      console.log(`   Output length: ${capturedOutput.length} characters`);

      // Check if output was captured
      if (!capturedOutput || capturedOutput === '') {
        // Verify PR was actually created
        const prListResult = await $`cd ${repoDir} && gh pr list --head test-branch --json url --jq '.[0].url'`;
        const actualPrUrl = prListResult.stdout.toString().trim();

        throw new OutputCaptureError('Output capture failed!', {
          expectedOutput: 'PR URL',
          actualOutput: capturedOutput,
          actualPrUrl: actualPrUrl
        });
      }

      console.log('\n✅ Output captured (issue may be fixed)');
    } catch (captureError) {
      // CATCH: Handle the failure and apply workaround

      if (captureError instanceof OutputCaptureError) {
        console.log(`\n❌ ISSUE CONFIRMED: ${captureError.message}`);
        console.log(`   Expected: ${captureError.details.expectedOutput}`);
        console.log(`   Got: "${captureError.details.actualOutput}" (empty)`);
        console.log(`   PR was created at: ${captureError.details.actualPrUrl}`);

        console.log('\n' + '='.repeat(60));
        console.log('APPLYING WORKAROUND\n');

        // Prepare second branch for workaround
        await $`cd ${repoDir} && git checkout main`;
        await $`cd ${repoDir} && git checkout -b workaround-branch`;
        await fs.writeFile(path.join(repoDir, 'workaround.txt'), 'Workaround test\n');
        await $`cd ${repoDir} && git add workaround.txt`;
        await $`cd ${repoDir} && git commit -m "Workaround test"`;

        // Use execSync for git push (known issue #10)
        execSync(`cd ${repoDir} && git push -u origin workaround-branch`, { encoding: 'utf8' });

        // WORKAROUND: Use execSync to properly capture output
        console.log('2️⃣  Using execSync workaround:');

        // Write PR body to file to avoid escaping issues
        const prBodyFile = path.join(testDir, 'pr-body.md');
        await fs.writeFile(prBodyFile, 'Workaround PR body');

        const command = `cd "${repoDir}" && gh pr create --draft --title "Workaround PR" --body-file "${prBodyFile}" --base main --head workaround-branch`;

        const output = execSync(command, { encoding: 'utf8' });
        const workaroundOutput = output.trim();

        console.log(`   Captured output: "${workaroundOutput}"`);
        console.log(`   Output length: ${workaroundOutput.length} characters`);

        if (workaroundOutput && workaroundOutput.includes('github.com')) {
          console.log('\n✅ WORKAROUND SUCCESSFUL!');
          console.log('   execSync correctly captured the PR URL');
        }
      } else {
        throw captureError;
      }
    }

    // SUMMARY
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY\n');
    console.log('❌ ISSUE: command-stream fails to capture gh pr create output');
    console.log('✅ WORKAROUND: Use execSync with --body-file flag');
    console.log('\nExample workaround code:');
    console.log('  execSync(`gh pr create --body-file /tmp/pr.md ...`, {encoding: "utf8"})');
  } catch (error) {
    console.error('\n❌ Unexpected error:', error.message);
    throw error;
  } finally {
    console.log('\n🧹 Cleaning up...');
    await cleanup();
  }
}

// Run the test with top-level await
try {
  await runTest();
} catch (error) {
  await cleanup();
  process.exit(1);
}
