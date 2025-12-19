#!/usr/bin/env node

/**
 * Test for the --base-branch option in solve.mjs and solve-with-opencode.mjs
 */

import { execSync } from 'child_process';
import assert from 'assert';

console.log('Testing --base-branch option...');

// Test 1: Check that --help shows the new option for solve.mjs
console.log('\n1. Testing solve.mjs --help output...');
try {
  const helpOutput = execSync('./src/solve.mjs --help', { encoding: 'utf8' });
  assert(helpOutput.includes('--base-branch'), 'solve.mjs --help should include --base-branch option');
  assert(helpOutput.includes('Target branch'), 'solve.mjs should show base-branch description');
  console.log('✓ solve.mjs --help shows --base-branch option');
} catch (error) {
  console.error('✗ Failed to find --base-branch in solve.mjs --help');
  console.error(error.message);
  process.exit(1);
}

// Test 2: Check that --help shows the new option for solve-with-opencode.mjs
console.log('\n2. Testing solve-with-opencode.mjs --help output...');
try {
  const helpOutput = execSync('./solve-with-opencode.mjs --help', { encoding: 'utf8' });
  assert(helpOutput.includes('--base-branch'), 'solve-with-opencode.mjs --help should include --base-branch option');
  assert(helpOutput.includes('Target branch for the pull request'), 'solve-with-opencode.mjs should show base-branch description');
  console.log('✓ solve-with-opencode.mjs --help shows --base-branch option');
} catch (error) {
  console.error('✗ Failed to find --base-branch in solve-with-opencode.mjs --help');
  console.error(error.message);
  process.exit(1);
}

// Test 3: Verify syntax is valid for both files
console.log('\n3. Testing syntax validity...');
try {
  execSync('node --check ./src/solve.mjs', { encoding: 'utf8' });
  console.log('✓ solve.mjs has valid syntax');
} catch (error) {
  console.error('✗ solve.mjs has syntax errors');
  console.error(error.message);
  process.exit(1);
}

try {
  execSync('node --check ./solve-with-opencode.mjs', { encoding: 'utf8' });
  console.log('✓ solve-with-opencode.mjs has valid syntax');
} catch (error) {
  console.error('✗ solve-with-opencode.mjs has syntax errors');
  console.error(error.message);
  process.exit(1);
}

console.log('\n✅ All tests passed! The --base-branch option has been successfully implemented.');