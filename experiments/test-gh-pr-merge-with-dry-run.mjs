#!/usr/bin/env node
/**
 * Test script to verify gh pr merge behavior with actual mergeable PR
 *
 * This experiment tests what happens when gh pr merge is run on a PR that
 * is actually mergeable, to see if it prompts for merge method.
 *
 * Issue #1269: Merge queue gets stuck after "Starting merge process..."
 *
 * Run with: node experiments/test-gh-pr-merge-with-dry-run.mjs
 */

import { promisify } from 'util';
import { exec as execCallback, spawn } from 'child_process';

const exec = promisify(execCallback);

const owner = 'link-assistant';
const repo = 'hive-mind';

// Test: Try to merge an actual open PR with ready label
// We'll use spawn with stdin closed to detect if it hangs
async function testMergeOpenPR() {
  console.log('Testing gh pr merge on an actual open PR...\n');

  // Get the first mergeable PR
  const { stdout: prsJson } = await exec(`gh pr list --repo ${owner}/${repo} --label "ready" --state open --json number,title,mergeable,mergeStateStatus`);
  const prs = JSON.parse(prsJson);

  const mergeablePR = prs.find(pr => pr.mergeable === 'MERGEABLE');
  if (!mergeablePR) {
    console.log('No mergeable PR found with ready label');
    return;
  }

  console.log(`Testing with PR #${mergeablePR.number}: ${mergeablePR.title}`);
  console.log(`  mergeable: ${mergeablePR.mergeable}, mergeStateStatus: ${mergeablePR.mergeStateStatus}`);
  console.log('');

  // Test 1: Without any merge method flag
  console.log('Test 1: gh pr merge without merge method (stdin closed)...');
  await testMergeCommand(mergeablePR.number, [], 10000);

  // Test 2: With --merge flag
  console.log('\nTest 2: gh pr merge --merge (should not hang)...');
  await testMergeCommand(mergeablePR.number, ['--merge'], 10000);

  // Test 3: With --auto flag
  console.log('\nTest 3: gh pr merge --auto (should not hang)...');
  await testMergeCommand(mergeablePR.number, ['--auto'], 10000);
}

async function testMergeCommand(prNumber, extraArgs, timeout) {
  return new Promise(resolve => {
    const args = ['pr', 'merge', prNumber, '--repo', `${owner}/${repo}`, ...extraArgs];
    console.log(`  Running: gh ${args.join(' ')}`);
    console.log(`  (Will timeout after ${timeout / 1000}s if it hangs)`);

    const child = spawn('gh', args, {
      stdio: ['ignore', 'pipe', 'pipe'], // Close stdin, capture stdout/stderr
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
      console.log(`  ⚠️  Command still running after ${timeout / 1000}s - killing...`);
      child.kill('SIGTERM');
    }, timeout);

    child.on('close', (code, signal) => {
      clearTimeout(timeoutId);
      console.log(`  Exit code: ${code}, Signal: ${signal}`);
      if (stdout.trim()) console.log(`  stdout: ${stdout.trim()}`);
      if (stderr.trim()) console.log(`  stderr: ${stderr.trim()}`);

      if (signal === 'SIGTERM') {
        console.log('  ❌ RESULT: Command was killed (timeout) - IT HANGS!');
        resolve({ success: false, killed: true });
      } else if (code !== 0) {
        // Check the error type
        if (stderr.includes('GraphQL')) {
          console.log('  ⚠️  RESULT: GraphQL error (API issue)');
        } else if (stderr.includes('auto-merge')) {
          console.log('  ⚠️  RESULT: Auto-merge related error');
        } else if (stderr.includes('required')) {
          console.log('  ⚠️  RESULT: Missing required option');
        } else {
          console.log(`  ⚠️  RESULT: Command failed with exit code ${code}`);
        }
        resolve({ success: false, error: stderr });
      } else {
        console.log('  ✅ RESULT: Command completed successfully');
        resolve({ success: true });
      }
    });
  });
}

// Main
async function main() {
  console.log('='.repeat(60));
  console.log('Testing gh pr merge on actual open PR');
  console.log('='.repeat(60));
  console.log('');

  await testMergeOpenPR();

  console.log('\n' + '='.repeat(60));
  console.log('Test complete');
  console.log('='.repeat(60));
}

main().catch(console.error);
