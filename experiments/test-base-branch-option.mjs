#!/usr/bin/env node

/**
 * Test for the --base-branch option in solve.mjs
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

// Test 2: Verify syntax is valid
console.log('\n2. Testing syntax validity...');
try {
  execSync('node --check ./src/solve.mjs', { encoding: 'utf8' });
  console.log('✓ solve.mjs has valid syntax');
} catch (error) {
  console.error('✗ solve.mjs has syntax errors');
  console.error(error.message);
  process.exit(1);
}

console.log('\n✅ All tests passed! The --base-branch option has been successfully implemented.');