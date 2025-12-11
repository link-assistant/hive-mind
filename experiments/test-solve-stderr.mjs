#!/usr/bin/env node

/**
 * Test script to verify that solve command doesn't produce stderr errors
 * when called with valid arguments
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('=== Testing solve command stderr output ===\n');

// Test 1: Run solve command from a non-git directory (simulates hive worker environment)
console.log('Test 1: Running solve with issue URL (should show version without git errors)');
console.log('  Command: node src/solve.mjs https://github.com/test/test/issues/1 --dry-run --skip-tool-check\n');

const child = spawn('node', [
  join(projectRoot, 'src', 'solve.mjs'),
  'https://github.com/link-assistant/hive-mind/issues/1',
  '--dry-run',
  '--skip-tool-check'
], {
  cwd: '/tmp', // Run from /tmp (not a git repository) to simulate hive worker
  env: { ...process.env }
});

let stderrOutput = '';
let stdoutOutput = '';

child.stdout.on('data', (data) => {
  const text = data.toString();
  stdoutOutput += text;
  process.stdout.write('[STDOUT] ' + text);
});

child.stderr.on('data', (data) => {
  const text = data.toString();
  stderrOutput += text;
  process.stderr.write('[STDERR] ' + text);
});

child.on('close', (code) => {
  console.log(`\n\n=== Test Results ===`);
  console.log(`Exit code: ${code}`);
  console.log(`\nStderr output length: ${stderrOutput.length} bytes`);

  // Check for the specific errors we're trying to fix
  const hasGitError = stderrOutput.includes('fatal: not a git repository');
  const hasYError = stderrOutput.includes('YError: Not enough arguments');

  console.log(`\nErrors found:`);
  console.log(`  - Git repository error: ${hasGitError ? '❌ FOUND' : '✅ NOT FOUND'}`);
  console.log(`  - YError: ${hasYError ? '❌ FOUND' : '✅ NOT FOUND'}`);

  if (!hasGitError && !hasYError) {
    console.log(`\n✅ SUCCESS: No spurious errors in stderr!`);
    process.exit(0);
  } else {
    console.log(`\n❌ FAILURE: Found errors that should have been suppressed`);
    if (stderrOutput.length > 0) {
      console.log(`\nFull stderr output:`);
      console.log(stderrOutput);
    }
    process.exit(1);
  }
});
