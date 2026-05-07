#!/usr/bin/env node
/**
 * Experiment: Test solve.mjs with --use-agent-commander in dry-run mode
 *
 * This script tests that solve.mjs correctly handles the --use-agent-commander
 * flag in dry-run mode (no actual tool execution).
 *
 * Usage:
 *   node experiments/test-solve-dry-run.mjs
 *
 * Expected behavior:
 *   - Without agent-commander installed: should fail gracefully with clear error message
 *   - With agent-commander installed: should show the command that would be executed
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const solvePath = path.join(__dirname, '..', 'src', 'solve.mjs');

// Test issue URL (public issue from this repo)
const testIssueUrl = 'https://github.com/link-assistant/hive-mind/issues/1043';

async function runTest(testName, args) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Test: ${testName}`);
  console.log(`Args: ${args.join(' ')}`);
  console.log('='.repeat(60));

  return new Promise((resolve, reject) => {
    const child = spawn('node', [solvePath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    child.stderr.on('data', data => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    child.on('close', code => {
      console.log(`\nExit code: ${code}`);
      resolve({ code, stdout, stderr });
    });

    child.on('error', error => {
      reject(error);
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      child.kill();
      reject(new Error('Test timed out after 60 seconds'));
    }, 60000);
  });
}

async function main() {
  console.log('Testing solve.mjs with --use-agent-commander flag\n');

  // Test 1: Without --use-agent-commander (baseline)
  try {
    await runTest('Baseline: solve --dry-run (without --use-agent-commander)', [testIssueUrl, '--dry-run', '--skip-tool-connection-check']);
  } catch (e) {
    console.error(`Test failed: ${e.message}`);
  }

  // Test 2: With --use-agent-commander
  try {
    await runTest('Experimental: solve --dry-run --use-agent-commander', [testIssueUrl, '--dry-run', '--skip-tool-connection-check', '--use-agent-commander']);
  } catch (e) {
    console.error(`Test failed: ${e.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('All tests completed.');
  console.log('='.repeat(60));
}

main().catch(console.error);
