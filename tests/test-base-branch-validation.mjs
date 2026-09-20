#!/usr/bin/env node

/**
 * Test suite for --base-branch validation (issue #1482)
 * Tests validateBranchName() from solve.branch.lib.mjs
 * Ensures URLs and invalid git branch names are rejected
 */

import { validateBranchName } from '../src/solve.branch.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

console.log('🧪 Base Branch Validation Tests (Issue #1482)\n');

// === Valid branch names ===

runTest('valid: simple branch names', () => {
  assert(validateBranchName('main').valid, 'main should be valid');
  assert(validateBranchName('develop').valid, 'develop should be valid');
  assert(validateBranchName('master').valid, 'master should be valid');
  assert(validateBranchName('release-1.0').valid, 'release-1.0 should be valid');
  assert(validateBranchName('feature/my-feature').valid, 'feature/my-feature should be valid');
  assert(validateBranchName('v2.0.0').valid, 'v2.0.0 should be valid');
});

runTest('valid: branch names with slashes', () => {
  assert(validateBranchName('feature/add-login').valid, 'feature/add-login should be valid');
  assert(validateBranchName('bugfix/fix-crash').valid, 'bugfix/fix-crash should be valid');
  assert(validateBranchName('user/john/experiment').valid, 'user/john/experiment should be valid');
});

runTest('valid: branch names with numbers and hyphens', () => {
  assert(validateBranchName('issue-123').valid, 'issue-123 should be valid');
  assert(validateBranchName('issue-1482-4888232299e7').valid, 'issue branch format should be valid');
  assert(validateBranchName('123').valid, 'numeric branch should be valid');
  assert(validateBranchName('my-branch-123').valid, 'hyphens and numbers should be valid');
});

runTest('valid: branch names with underscores and dots', () => {
  assert(validateBranchName('my_branch').valid, 'underscores should be valid');
  assert(validateBranchName('release/1.2.3').valid, 'dots in path should be valid');
  assert(validateBranchName('v1.0-rc1').valid, 'dots and hyphens should be valid');
});

// === URLs (the primary issue #1482 case) ===

runTest('reject: HTTPS URLs', () => {
  const result = validateBranchName('https://github.com/rumaster/2book-es/pull/172');
  assert(!result.valid, 'Should reject HTTPS GitHub URL');
  assert(result.reason.includes('URL'), 'Reason should mention URL');
});

runTest('reject: HTTP URLs', () => {
  const result = validateBranchName('http://github.com/org/repo/pull/1');
  assert(!result.valid, 'Should reject HTTP URL');
  assert(result.reason.includes('URL'), 'Reason should mention URL');
});

runTest('reject: SSH URLs', () => {
  assert(!validateBranchName('git@github.com:org/repo.git').valid, 'Should reject git@ SSH URL');
  assert(!validateBranchName('ssh://git@github.com/org/repo').valid, 'Should reject ssh:// URL');
});

runTest('reject: URLs with different protocols', () => {
  assert(!validateBranchName('ftp://example.com/branch').valid, 'Should reject ftp:// URL');
});

// === Git ref format violations ===

runTest('reject: empty and whitespace', () => {
  assert(!validateBranchName('').valid, 'Should reject empty string');
  assert(!validateBranchName(null).valid, 'Should reject null');
  assert(!validateBranchName(undefined).valid, 'Should reject undefined');
  assert(!validateBranchName(' main').valid, 'Should reject leading space');
  assert(!validateBranchName('main ').valid, 'Should reject trailing space');
});

runTest('reject: control characters', () => {
  assert(!validateBranchName('branch\x00name').valid, 'Should reject null byte');
  assert(!validateBranchName('branch\tname').valid, 'Should reject tab');
  assert(!validateBranchName('branch\nname').valid, 'Should reject newline');
});

runTest('reject: invalid special characters', () => {
  assert(!validateBranchName('branch name').valid, 'Should reject space');
  assert(!validateBranchName('branch~name').valid, 'Should reject tilde');
  assert(!validateBranchName('branch^name').valid, 'Should reject caret');
  assert(!validateBranchName('branch:name').valid, 'Should reject colon');
  assert(!validateBranchName('branch?name').valid, 'Should reject question mark');
  assert(!validateBranchName('branch*name').valid, 'Should reject asterisk');
  assert(!validateBranchName('branch[name').valid, 'Should reject open bracket');
  assert(!validateBranchName('branch\\name').valid, 'Should reject backslash');
});

runTest('reject: double dots', () => {
  assert(!validateBranchName('branch..name').valid, 'Should reject double dots');
  assert(!validateBranchName('a..b..c').valid, 'Should reject multiple double dots');
});

runTest('reject: starts with dot or hyphen', () => {
  assert(!validateBranchName('.branch').valid, 'Should reject leading dot');
  assert(!validateBranchName('-branch').valid, 'Should reject leading hyphen');
});

runTest('reject: ends with dot or .lock', () => {
  assert(!validateBranchName('branch.').valid, 'Should reject trailing dot');
  assert(!validateBranchName('branch.lock').valid, 'Should reject .lock suffix');
});

runTest('reject: @{ sequence and bare @', () => {
  assert(!validateBranchName('branch@{0}').valid, 'Should reject @{ sequence');
  assert(!validateBranchName('@').valid, 'Should reject bare @');
});

runTest('reject: path component issues', () => {
  assert(!validateBranchName('feature//branch').valid, 'Should reject consecutive slashes');
  assert(!validateBranchName('/branch').valid, 'Should reject leading slash');
  assert(!validateBranchName('branch/').valid, 'Should reject trailing slash');
  assert(!validateBranchName('feature/.hidden').valid, 'Should reject component starting with dot');
  assert(!validateBranchName('feature/ref.lock').valid, 'Should reject component ending with .lock');
});

runTest('reject: excessively long branch names', () => {
  const longName = 'a'.repeat(256);
  assert(!validateBranchName(longName).valid, 'Should reject branch names over 255 chars');
  assert(validateBranchName('a'.repeat(255)).valid, 'Should accept 255 char branch name');
});

// === Edge cases ===

runTest('valid: @ in branch names (not bare @ or @{)', () => {
  assert(validateBranchName('user@feature').valid, 'user@feature should be valid');
});

runTest('reject: case-insensitive URL detection', () => {
  assert(!validateBranchName('HTTPS://github.com/org/repo').valid, 'Should reject uppercase HTTPS');
  assert(!validateBranchName('Http://github.com/org/repo').valid, 'Should reject mixed case Http');
});

// Summary
console.log('\n📊 Test Summary:');
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);

if (testsFailed > 0) {
  process.exit(1);
}

console.log('\n🎉 All tests passed!');
