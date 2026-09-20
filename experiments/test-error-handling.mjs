#!/usr/bin/env node

import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const solveCmd = join(process.cwd(), 'src', 'solve.mjs');
const testDir = '/tmp/test-git-error-handling';

console.log('=== Testing Error Handling for Git Commands ===\n');

// Clean up and create test directory
try {
  rmSync(testDir, { recursive: true, force: true });
} catch {}
mkdirSync(testDir, { recursive: true });

// Test 1: Version command in non-git directory
console.log('Test 1: Version command in non-git directory');
console.log('----------------------------------------------');
process.chdir(testDir);
try {
  const output = execSync(`${solveCmd} --version 2>&1`, { encoding: 'utf8' });
  console.log('Output:', output.trim());

  // Check for error messages
  if (output.includes('fatal:') || output.includes('error:') || output.includes('Error:')) {
    console.log('❌ FAIL: Error message found in output');
    process.exit(1);
  } else {
    console.log('✅ PASS: No error messages in output');
  }
} catch (error) {
  console.log('❌ FAIL: Command threw an error');
  console.log('Error:', error.message);
  process.exit(1);
}

// Test 2: Version command in git directory
console.log('\nTest 2: Version command in git directory');
console.log('----------------------------------------------');
process.chdir(process.env.HOME || '/tmp');
execSync('git init test-repo 2>/dev/null', { encoding: 'utf8' });
process.chdir(join(process.env.HOME || '/tmp', 'test-repo'));
try {
  const output = execSync(`${solveCmd} --version 2>&1`, { encoding: 'utf8' });
  console.log('Output:', output.trim());

  if (output.includes('fatal:') || output.includes('error:') || output.includes('Error:')) {
    console.log('❌ FAIL: Error message found in output');
    process.exit(1);
  } else {
    console.log('✅ PASS: No error messages in output');
  }
} catch (error) {
  console.log('❌ FAIL: Command threw an error');
  console.log('Error:', error.message);
  process.exit(1);
} finally {
  // Clean up
  process.chdir('..');
  rmSync('test-repo', { recursive: true, force: true });
}

// Test 3: Help command in non-git directory
console.log('\nTest 3: Help command in non-git directory');
console.log('----------------------------------------------');
process.chdir(testDir);
try {
  const output = execSync(`${solveCmd} --help 2>&1 | head -5`, { encoding: 'utf8' });
  console.log('Output (first 5 lines):', output.trim());

  // Check for git-related error messages in help output
  if (output.includes('fatal: not a git repository')) {
    console.log('❌ FAIL: Git error message found in help output');
    process.exit(1);
  } else {
    console.log('✅ PASS: No git error messages in help output');
  }
} catch (error) {
  // Help command might exit with non-zero for pipe, that's okay
  const output = error.stdout || '';
  if (output.includes('fatal: not a git repository')) {
    console.log('❌ FAIL: Git error message found in help output');
    process.exit(1);
  } else {
    console.log('✅ PASS: No git error messages in help output');
  }
}

// Clean up
try {
  rmSync(testDir, { recursive: true, force: true });
} catch {}

console.log('\n=== All Tests Passed! ===');
