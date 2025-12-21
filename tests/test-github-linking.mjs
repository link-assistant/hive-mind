#!/usr/bin/env node

/**
 * Unit tests for GitHub issue linking keyword detection
 *
 * This test ensures that the system correctly detects GitHub's reserved keywords
 * for linking pull requests to issues, and prevents regression of issue #568.
 *
 * References:
 * - Issue #568: https://github.com/link-assistant/hive-mind/issues/568
 * - PR #558: Missing "Resolves #515" keyword
 * - PR #563: Used "Implements issue #524" which is NOT a GitHub keyword
 */

import {
  getGitHubLinkingKeywords,
  hasGitHubLinkingKeyword,
  extractLinkedIssueNumber
} from '../src/github-linking.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.log(`❌ FAIL: ${testName}`);
    if (details) {
      console.log(`   Details: ${details}`);
    }
    testsFailed++;
  }
}

function assertEquals(actual, expected, testName) {
  const passed = actual === expected;
  if (passed) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.log(`❌ FAIL: ${testName}`);
    console.log(`   Expected: ${JSON.stringify(expected)}`);
    console.log(`   Actual:   ${JSON.stringify(actual)}`);
    testsFailed++;
  }
}

console.log('🧪 Testing GitHub Issue Linking Detection\n');
console.log('='.repeat(60));

// Test 1: Verify all GitHub keywords are included
console.log('\n📋 Test Suite 1: Keyword List Validation\n');

const keywords = getGitHubLinkingKeywords();
const expectedKeywords = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];

assert(
  keywords.length === expectedKeywords.length,
  'Correct number of keywords',
  `Expected ${expectedKeywords.length}, got ${keywords.length}`
);

for (const keyword of expectedKeywords) {
  assert(keywords.includes(keyword), `Keyword '${keyword}' is included`);
}

// Test 2: Valid GitHub linking formats (should detect)
console.log('\n📋 Test Suite 2: Valid Linking Formats (Should Detect)\n');

const validFormats = [
  { prBody: 'This PR fixes #515', issueNumber: '515', desc: 'Simple fixes #N' },
  { prBody: 'This PR Fixes #515', issueNumber: '515', desc: 'Capitalized Fixes #N' },
  { prBody: 'This PR FIXES #515', issueNumber: '515', desc: 'All caps FIXES #N' },
  { prBody: 'Closes #42', issueNumber: '42', desc: 'closes #N' },
  { prBody: 'Resolves #123', issueNumber: '123', desc: 'Resolves #N' },
  { prBody: 'Fix #99', issueNumber: '99', desc: 'Fix #N' },
  { prBody: 'Close #88', issueNumber: '88', desc: 'Close #N' },
  { prBody: 'Resolve #77', issueNumber: '77', desc: 'Resolve #N' },
  { prBody: 'Fixed #66', issueNumber: '66', desc: 'Fixed #N' },
  { prBody: 'Closed #55', issueNumber: '55', desc: 'Closed #N' },
  { prBody: 'Resolved #44', issueNumber: '44', desc: 'Resolved #N' },
  { prBody: 'Some text here\n\nFixes #515\n\nMore text', issueNumber: '515', desc: 'Fixes #N in middle of text' },
  {
    prBody: 'Fixes link-assistant/hive-mind#515',
    issueNumber: '515',
    owner: 'link-assistant',
    repo: 'hive-mind',
    desc: 'Fixes owner/repo#N'
  },
  {
    prBody: 'Resolves https://github.com/link-assistant/hive-mind/issues/515',
    issueNumber: '515',
    owner: 'link-assistant',
    repo: 'hive-mind',
    desc: 'Resolves full URL'
  },
  { prBody: 'Multiple changes\n\n---\n\nResolves #568', issueNumber: '568', desc: 'Resolves #N after separator' }
];

for (const test of validFormats) {
  const result = hasGitHubLinkingKeyword(test.prBody, test.issueNumber, test.owner, test.repo);
  assert(result === true, test.desc, `Should detect linking keyword in: "${test.prBody}"`);
}

// Test 3: Invalid formats (should NOT detect)
console.log('\n📋 Test Suite 3: Invalid Formats (Should NOT Detect)\n');

const invalidFormats = [
  { prBody: 'Implements issue #524', issueNumber: '524', desc: 'Implements issue #N (not a GitHub keyword)' },
  { prBody: 'Addresses #515', issueNumber: '515', desc: 'Addresses #N (not a GitHub keyword)' },
  { prBody: 'Handles #515', issueNumber: '515', desc: 'Handles #N (not a GitHub keyword)' },
  { prBody: 'Related to #515', issueNumber: '515', desc: 'Related to #N (not a GitHub keyword)' },
  { prBody: 'See #515', issueNumber: '515', desc: 'See #N (not a GitHub keyword)' },
  { prBody: 'Fixes issue #515', issueNumber: '999', desc: 'Fixes #515 but checking for #999' },
  { prBody: 'This closes#515 without space', issueNumber: '515', desc: 'closes#N without space (invalid format)' },
  { prBody: 'Issue 515 is fixed', issueNumber: '515', desc: 'Issue 515 without # (invalid format)' },
  { prBody: '', issueNumber: '515', desc: 'Empty PR body' },
  { prBody: 'No issue reference here', issueNumber: '515', desc: 'No reference at all' }
];

for (const test of invalidFormats) {
  const result = hasGitHubLinkingKeyword(test.prBody, test.issueNumber, test.owner, test.repo);
  assert(result === false, test.desc, `Should NOT detect linking keyword in: "${test.prBody}"`);
}

// Test 4: Edge cases
console.log('\n📋 Test Suite 4: Edge Cases\n');

assert(hasGitHubLinkingKeyword(null, '515') === false, 'Null PR body returns false');

assert(hasGitHubLinkingKeyword('Fixes #515', null) === false, 'Null issue number returns false');

assert(hasGitHubLinkingKeyword('Fixes #515', '') === false, 'Empty issue number returns false');

assert(hasGitHubLinkingKeyword('Fixes #515', 515) === true, 'Numeric issue number is handled correctly');

// Test 5: Issue extraction
console.log('\n📋 Test Suite 5: Issue Number Extraction\n');

const extractionTests = [
  { prBody: 'Fixes #515', expected: '515', desc: 'Extract from Fixes #N' },
  { prBody: 'Closes #42', expected: '42', desc: 'Extract from Closes #N' },
  { prBody: 'Resolves link-assistant/hive-mind#568', expected: '568', desc: 'Extract from owner/repo#N' },
  {
    prBody: 'Fixes https://github.com/link-assistant/hive-mind/issues/123',
    expected: '123',
    desc: 'Extract from full URL'
  },
  { prBody: 'No issue here', expected: null, desc: 'Return null when no issue found' },
  { prBody: 'Implements issue #524', expected: null, desc: 'Return null for non-GitHub keyword' },
  { prBody: '', expected: null, desc: 'Return null for empty body' }
];

for (const test of extractionTests) {
  const result = extractLinkedIssueNumber(test.prBody);
  assertEquals(result, test.expected, test.desc);
}

// Test 6: Real-world examples from issue #568
console.log('\n📋 Test Suite 6: Real-World Examples from Issue #568\n');

// PR #558 - Missing "Resolves #515"
const pr558Body = `## Summary

This PR implements full support for **GitHub Copilot CLI** as an AI tool option...`;

assert(
  hasGitHubLinkingKeyword(pr558Body, '515') === false,
  'PR #558: Should NOT detect linking (missing Resolves #515)'
);

// PR #563 - Used "Implements issue #524" instead of GitHub keyword
const pr563Body = `## Summary

Implements issue #524: Button to forcefully stop the command in hive-telegram-bot

This PR adds a new /stop command...`;

assert(
  hasGitHubLinkingKeyword(pr563Body, '524') === false,
  'PR #563: Should NOT detect linking (used "Implements issue" instead of GitHub keyword)'
);

// What PR #558 SHOULD have contained
const pr558BodyFixed = pr558Body + '\n\nResolves #515';
assert(
  hasGitHubLinkingKeyword(pr558BodyFixed, '515') === true,
  'PR #558 Fixed: Should detect linking with added "Resolves #515"'
);

// What PR #563 SHOULD have contained
const pr563BodyFixed = pr563Body.replace('Implements issue #524', 'Resolves #524');
assert(
  hasGitHubLinkingKeyword(pr563BodyFixed, '524') === true,
  'PR #563 Fixed: Should detect linking when "Implements issue" is replaced with "Resolves"'
);

// Summary
console.log('\n' + '='.repeat(60));
console.log('\n📊 Test Results Summary\n');
console.log(`Total tests: ${testsPassed + testsFailed}`);
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);

if (testsFailed === 0) {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
} else {
  console.log(`\n❌ ${testsFailed} test(s) failed`);
  process.exit(1);
}
