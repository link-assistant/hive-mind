#!/usr/bin/env node
/**
 * Test script to verify gh pr merge interactive behavior
 *
 * This experiment tests whether `gh pr merge` hangs when run without explicit
 * merge method flags in a non-interactive context.
 *
 * Issue #1269: Merge queue gets stuck after "Starting merge process..."
 *
 * Run with: node experiments/test-gh-pr-merge-interactive.mjs
 */

import { promisify } from 'util';
import { exec as execCallback, spawn } from 'child_process';

const exec = promisify(execCallback);

const owner = 'link-assistant';
const repo = 'hive-mind';

// Test 1: Try gh pr merge --help to verify cli is available
async function testCliAvailable() {
  console.log('Test 1: Checking gh CLI is available...');
  try {
    const { stdout } = await exec('gh --version');
    console.log(`  ✅ gh CLI version: ${stdout.trim().split('\n')[0]}`);
    return true;
  } catch (error) {
    console.error(`  ❌ gh CLI not available: ${error.message}`);
    return false;
  }
}

// Test 2: Check if gh pr merge requires TTY for merge method selection
async function testMergeMethodPrompt() {
  console.log('\nTest 2: Testing if gh pr merge prompts for merge method...');

  // Use a closed PR that can't be merged to see the error behavior
  // PR #1270 is already merged, so it should fail fast
  const prNumber = 1270;

  try {
    // Run without any merge method flags
    const command = `gh pr merge ${prNumber} --repo ${owner}/${repo}`;
    console.log(`  Running: ${command}`);
    console.log(`  (This should fail because PR #${prNumber} is already merged)`);

    const { stdout, stderr } = await exec(command, { timeout: 10000 });
    console.log(`  stdout: ${stdout}`);
    console.log(`  stderr: ${stderr}`);
    return { success: true, output: stdout };
  } catch (error) {
    console.log(`  Command failed (expected): ${error.message}`);

    // Check if the error mentions the PR being already merged
    if (error.message.includes('already been merged')) {
      console.log(`  ✅ Command completed (PR already merged error - expected behavior)`);
      return { success: true, alreadyMerged: true };
    }

    // Check if it timed out waiting for input
    if (error.message.includes('ETIMEDOUT') || error.killed) {
      console.log(`  ❌ Command timed out - likely waiting for interactive input!`);
      return { success: false, timedOut: true };
    }

    return { success: false, error: error.message };
  }
}

// Test 3: Check if merge method is required by repository settings
async function testRepoMergeSettings() {
  console.log('\nTest 3: Checking repository merge settings...');

  try {
    const { stdout } = await exec(`gh api repos/${owner}/${repo} --jq '{allow_squash_merge, allow_merge_commit, allow_rebase_merge, allow_auto_merge, delete_branch_on_merge, merge_commit_title, merge_commit_message, squash_merge_commit_title, squash_merge_commit_message}'`);
    const settings = JSON.parse(stdout);
    console.log('  Repository merge settings:');
    console.log(`    - Allow squash merge: ${settings.allow_squash_merge}`);
    console.log(`    - Allow merge commit: ${settings.allow_merge_commit}`);
    console.log(`    - Allow rebase merge: ${settings.allow_rebase_merge}`);
    console.log(`    - Allow auto-merge: ${settings.allow_auto_merge}`);
    console.log(`    - Delete branch on merge: ${settings.delete_branch_on_merge}`);

    // Count how many merge methods are allowed
    const allowedMethods = [settings.allow_squash_merge, settings.allow_merge_commit, settings.allow_rebase_merge].filter(Boolean).length;

    if (allowedMethods > 1) {
      console.log(`  ⚠️  Multiple merge methods allowed (${allowedMethods}) - gh pr merge may prompt for selection!`);
    } else if (allowedMethods === 1) {
      console.log(`  ✅ Only one merge method allowed - gh pr merge won't prompt`);
    } else {
      console.log(`  ❌ No merge methods allowed!`);
    }

    return settings;
  } catch (error) {
    console.error(`  ❌ Error checking settings: ${error.message}`);
    return null;
  }
}

// Test 4: Test with spawn to see if it requires stdin
async function testMergeWithSpawn() {
  console.log('\nTest 4: Testing gh pr merge with spawn (stdin closed)...');

  const prNumber = 1270; // Already merged PR

  return new Promise(resolve => {
    const child = spawn('gh', ['pr', 'merge', prNumber, '--repo', `${owner}/${repo}`], {
      stdio: ['ignore', 'pipe', 'pipe'], // Close stdin, capture stdout/stderr
      timeout: 10000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
    });

    child.stderr.on('data', data => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      console.log('  ⚠️  Command still running after 10s - killing...');
      child.kill('SIGTERM');
    }, 10000);

    child.on('close', (code, signal) => {
      clearTimeout(timeoutId);
      console.log(`  Exit code: ${code}, Signal: ${signal}`);
      console.log(`  stdout: ${stdout.trim()}`);
      console.log(`  stderr: ${stderr.trim()}`);

      if (signal === 'SIGTERM') {
        console.log('  ❌ Command was killed (timeout) - likely waiting for input');
        resolve({ success: false, killed: true });
      } else if (code !== 0) {
        if (stderr.includes('already been merged')) {
          console.log('  ✅ Command completed (PR already merged - expected)');
          resolve({ success: true, alreadyMerged: true });
        } else {
          console.log(`  ⚠️  Command failed with code ${code}`);
          resolve({ success: false, error: stderr });
        }
      } else {
        console.log('  ✅ Command completed successfully');
        resolve({ success: true });
      }
    });
  });
}

// Test 5: List ready PRs and their mergeable status
async function testReadyPRs() {
  console.log('\nTest 5: Listing PRs with ready label...');

  try {
    const { stdout } = await exec(`gh pr list --repo ${owner}/${repo} --label "ready" --state open --json number,title,mergeable,mergeStateStatus`);
    const prs = JSON.parse(stdout);

    console.log(`  Found ${prs.length} PRs with 'ready' label:`);
    for (const pr of prs) {
      console.log(`    - PR #${pr.number}: ${pr.title}`);
      console.log(`      mergeable: ${pr.mergeable}, mergeStateStatus: ${pr.mergeStateStatus}`);
    }

    return prs;
  } catch (error) {
    console.error(`  ❌ Error listing PRs: ${error.message}`);
    return [];
  }
}

// Main
async function main() {
  console.log('='.repeat(60));
  console.log('Testing gh pr merge interactive behavior');
  console.log('='.repeat(60));

  await testCliAvailable();
  await testRepoMergeSettings();
  await testMergeMethodPrompt();
  await testMergeWithSpawn();
  await testReadyPRs();

  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`
Key findings:
1. If the repository allows multiple merge methods, gh pr merge may prompt
   for user selection, which would hang in a non-interactive context.

2. The fix should explicitly specify a merge method flag:
   - --merge (default merge commit)
   - --squash (squash and merge)
   - --rebase (rebase and merge)

3. Alternatively, use --auto to enable auto-merge when CI passes.
`);
}

main().catch(console.error);
