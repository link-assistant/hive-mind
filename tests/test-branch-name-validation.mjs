#!/usr/bin/env node

/**
 * Test suite for branch name validation functions
 * Tests solve.branch.lib.mjs functions for validating and parsing branch names
 */

import {
  isValidIssueBranchName,
  parseIssueBranchName,
  getIssueBranchPrefix,
  matchesIssuePattern,
  detectBranchFormat
} from '../src/solve.branch.lib.mjs';

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

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(message || `Expected ${expectedStr}, got ${actualStr}`);
  }
}

console.log('🧪 Branch Name Validation Tests\n');

// Test isValidIssueBranchName - legacy format (8 chars)
runTest('isValidIssueBranchName - legacy 8-char format', () => {
  assert(isValidIssueBranchName('issue-123-9b28ad84'), 'Should accept legacy 8-char format');
  assert(isValidIssueBranchName('issue-647-2b8599cb'), 'Should accept legacy 8-char format');
  assert(isValidIssueBranchName('issue-1-abcdef12'), 'Should accept single digit issue number');
});

// Test isValidIssueBranchName - new format (12 chars)
runTest('isValidIssueBranchName - new 12-char format', () => {
  assert(isValidIssueBranchName('issue-123-9b28ad8f32ba'), 'Should accept new 12-char format');
  assert(isValidIssueBranchName('issue-647-2b8599cb1234'), 'Should accept new 12-char format');
  assert(isValidIssueBranchName('issue-1-abcdef123456'), 'Should accept single digit issue number with 12 chars');
});

// Test isValidIssueBranchName - invalid formats
runTest('isValidIssueBranchName - invalid formats', () => {
  assert(!isValidIssueBranchName('issue-123-9b28ad8'), 'Should reject 7-char random ID');
  assert(!isValidIssueBranchName('issue-123-9b28ad8f3'), 'Should reject 9-char random ID');
  assert(!isValidIssueBranchName('issue-123-9b28ad8f32'), 'Should reject 10-char random ID');
  assert(!isValidIssueBranchName('issue-123-9b28ad8f32b'), 'Should reject 11-char random ID');
  assert(!isValidIssueBranchName('issue-123-9b28ad8f32ba1'), 'Should reject 13-char random ID');
  assert(!isValidIssueBranchName('issue-123-ABCDEF12'), 'Should reject uppercase hex');
  assert(!isValidIssueBranchName('issue-123-9b28ad8g'), 'Should reject non-hex characters');
  assert(!isValidIssueBranchName('issue-abc-9b28ad84'), 'Should reject non-numeric issue number');
  assert(!isValidIssueBranchName('bug-123-9b28ad84'), 'Should reject non-issue prefix');
  assert(!isValidIssueBranchName(''), 'Should reject empty string');
  assert(!isValidIssueBranchName(null), 'Should reject null');
  assert(!isValidIssueBranchName(undefined), 'Should reject undefined');
});

// Test isValidIssueBranchName with issue number
runTest('isValidIssueBranchName - with specific issue number', () => {
  assert(isValidIssueBranchName('issue-647-2b8599cb', 647), 'Should match correct issue number (legacy)');
  assert(isValidIssueBranchName('issue-647-2b8599cb1234', 647), 'Should match correct issue number (new)');
  assert(isValidIssueBranchName('issue-647-2b8599cb', '647'), 'Should match string issue number');
  assert(!isValidIssueBranchName('issue-647-2b8599cb', 648), 'Should not match wrong issue number');
  assert(!isValidIssueBranchName('issue-123-9b28ad84', 647), 'Should not match different issue number');
});

// Test parseIssueBranchName
runTest('parseIssueBranchName - valid branches', () => {
  assertDeepEqual(
    parseIssueBranchName('issue-647-2b8599cb'),
    { issueNumber: '647', randomId: '2b8599cb' },
    'Should parse legacy format correctly'
  );
  assertDeepEqual(
    parseIssueBranchName('issue-647-2b8599cb1234'),
    { issueNumber: '647', randomId: '2b8599cb1234' },
    'Should parse new format correctly'
  );
  assertDeepEqual(
    parseIssueBranchName('issue-1-abcdef12'),
    { issueNumber: '1', randomId: 'abcdef12' },
    'Should parse single digit issue number'
  );
});

// Test parseIssueBranchName - invalid branches
runTest('parseIssueBranchName - invalid branches', () => {
  assertEqual(parseIssueBranchName('invalid-branch'), null, 'Should return null for invalid format');
  assertEqual(parseIssueBranchName('issue-123-ABCD'), null, 'Should return null for too short random ID');
  assertEqual(parseIssueBranchName(''), null, 'Should return null for empty string');
  assertEqual(parseIssueBranchName(null), null, 'Should return null for null');
});

// Test getIssueBranchPrefix
runTest('getIssueBranchPrefix', () => {
  assertEqual(getIssueBranchPrefix(647), 'issue-647-', 'Should generate correct prefix for number');
  assertEqual(getIssueBranchPrefix('647'), 'issue-647-', 'Should generate correct prefix for string');
  assertEqual(getIssueBranchPrefix(1), 'issue-1-', 'Should generate correct prefix for single digit');
});

// Test matchesIssuePattern
runTest('matchesIssuePattern', () => {
  assert(matchesIssuePattern('issue-647-2b8599cb', 647), 'Should match correct pattern (legacy)');
  assert(matchesIssuePattern('issue-647-2b8599cb1234', 647), 'Should match correct pattern (new)');
  assert(matchesIssuePattern('issue-647-2b8599cb', '647'), 'Should match string issue number');
  assert(!matchesIssuePattern('issue-648-2b8599cb', 647), 'Should not match wrong issue number');
  assert(!matchesIssuePattern('issue-647-2b8599', 647), 'Should not match invalid random ID length');
});

// Test detectBranchFormat
runTest('detectBranchFormat - legacy', () => {
  assertEqual(detectBranchFormat('issue-647-2b8599cb'), 'legacy', 'Should detect legacy format');
  assertEqual(detectBranchFormat('issue-123-9b28ad84'), 'legacy', 'Should detect legacy format');
});

runTest('detectBranchFormat - new', () => {
  assertEqual(detectBranchFormat('issue-647-2b8599cb1234'), 'new', 'Should detect new format');
  assertEqual(detectBranchFormat('issue-123-9b28ad8f32ba'), 'new', 'Should detect new format');
});

runTest('detectBranchFormat - invalid', () => {
  assertEqual(detectBranchFormat('invalid-branch'), null, 'Should return null for invalid format');
  assertEqual(detectBranchFormat('issue-647-2b8599'), null, 'Should return null for wrong length');
  assertEqual(detectBranchFormat(''), null, 'Should return null for empty string');
  assertEqual(detectBranchFormat(null), null, 'Should return null for null');
});

// Summary
console.log('\n📊 Test Summary:');
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);

if (testsFailed > 0) {
  process.exit(1);
}

console.log('\n🎉 All tests passed!');
