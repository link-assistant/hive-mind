#!/usr/bin/env node

/**
 * Experiment to reproduce and test fixes for stderr errors in solve command
 *
 * This script tests:
 * 1. Git repository error when running git commands before repo is cloned
 * 2. YError from yargs argument parsing
 */

import { execSync } from 'child_process';

console.log('=== Testing Git Repository Error ===\n');

// Test 1: Git error with default behavior (should show error to stderr)
console.log('Test 1: Git command without stderr suppression');
try {
  const result = execSync('git rev-parse --git-dir', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']  // Capture stderr
  });
  console.log('  Result:', result.trim());
} catch (error) {
  console.log('  Caught error (stderr was captured)');
  console.log('  Stderr:', error.stderr?.toString() || '(empty)');
}

console.log('\nTest 2: Git command with stderr suppressed (stdio ignore)');
try {
  const result = execSync('git rev-parse --git-dir', {
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'ignore']  // Suppress both stdout and stderr
  });
  console.log('  Result:', result.trim());
} catch (error) {
  console.log('  Caught error (stderr was suppressed via stdio)');
}

console.log('\n=== Testing YError from Yargs ===\n');

// Test 4: Yargs error handling
console.log('Test 4: Yargs "Not enough arguments" error');
const yargsModule = await import('yargs');
const yargs = yargsModule.default;
const { hideBin } = await import('yargs/helpers');

try {
  // Simulate the command structure that causes YError
  const argv = yargs(hideBin(['node', 'test.js']))
    .command('$0 <issue-url>', 'Test command', (yargs) => {
      yargs.positional('issue-url', {
        type: 'string',
        description: 'Test URL'
      });
    })
    .fail((msg, err, yargsInstance) => {
      // This should suppress yargs' default error output
      if (err) throw err;
      const error = new Error(msg);
      error.name = 'YargsValidationError';
      throw error;
    })
    .parse();

  console.log('  Parsed argv:', argv);
} catch (error) {
  console.log('  Caught error:', error.name, '-', error.message);
}

console.log('\n=== End of tests ===');
