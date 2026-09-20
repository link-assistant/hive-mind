#!/usr/bin/env node

/**
 * Test suite for telegram bot --base-branch/--target-branch early validation (issue #1482)
 * Tests that validateBranchInArgs() correctly parses and validates branch flags from args arrays
 */

import { validateBranchInArgs } from '../src/solve.branch.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('\u2705 PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`\u274C FAILED: ${error.message}`);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

console.log('\ud83e\uddea Telegram Bot Branch Validation Tests (Issue #1482)\n');

// === Valid args (no error) ===

runTest('valid: --base-branch with simple branch name', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo/issues/1', '--base-branch', 'main']);
  assert(result === null, `Expected null, got: ${result}`);
});

runTest('valid: -b alias with branch name', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo/issues/1', '-b', 'develop']);
  assert(result === null, `Expected null, got: ${result}`);
});

runTest('valid: --target-branch with branch name', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo', '--target-branch', 'feature/login']);
  assert(result === null, `Expected null, got: ${result}`);
});

runTest('valid: --base-branch=value format', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo/issues/1', '--base-branch=release-1.0']);
  assert(result === null, `Expected null, got: ${result}`);
});

runTest('valid: no branch flag present', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo/issues/1', '--model', 'opus']);
  assert(result === null, `Expected null, got: ${result}`);
});

// === Reject URLs as branch names (primary issue #1482 case) ===

runTest('reject: --base-branch with HTTPS URL', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo/issues/1', '--base-branch', 'https://github.com/rumaster/2book-es/pull/172']);
  assert(result !== null, 'Should reject URL as branch name');
  assert(result.includes('URL'), `Error should mention URL: ${result}`);
});

runTest('reject: -b with HTTPS URL', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo/issues/1', '-b', 'https://github.com/org/repo/pull/1']);
  assert(result !== null, 'Should reject URL as branch name with -b alias');
});

runTest('reject: --target-branch with URL', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo', '--target-branch', 'https://github.com/org/repo/pull/5']);
  assert(result !== null, 'Should reject URL as target-branch');
});

runTest('reject: --base-branch=URL format', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo/issues/1', '--base-branch=https://github.com/org/repo/pull/1']);
  assert(result !== null, 'Should reject URL in = format');
});

// === Reject invalid git ref names ===

runTest('reject: branch name with spaces', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo/issues/1', '--base-branch', 'my branch']);
  assert(result !== null, 'Should reject branch name with spaces');
});

runTest('reject: branch name with ..', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo/issues/1', '--base-branch', 'main..develop']);
  assert(result !== null, 'Should reject branch name with ..');
});

// === Edge cases ===

runTest('edge: --base-branch at end of args without value', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo/issues/1', '--base-branch']);
  assert(result === null, 'Should not error when no value follows the flag');
});

runTest('edge: multiple flags with valid values', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo/issues/1', '--base-branch', 'main', '--model', 'opus']);
  assert(result === null, `Expected null, got: ${result}`);
});

runTest('edge: -tb alias with valid branch', () => {
  const result = validateBranchInArgs(['https://github.com/org/repo', '-tb', 'release/v2']);
  assert(result === null, `Expected null, got: ${result}`);
});

// === Summary ===

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total`);

if (testsFailed > 0) {
  console.log('\n\u274C Some tests failed!');
  process.exit(1);
} else {
  console.log('\n\u2705 All tests passed!');
}
