#!/usr/bin/env node
/**
 * PR Closes Issue Detection Tests
 *
 * Tests for the prClosesIssue function that detects if a PR body/title
 * contains GitHub closing keywords (fixes, closes, resolves) for a specific issue.
 *
 * Run with: node tests/pr-closes-issue.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1094
 */

import assert from 'node:assert/strict';
import { prClosesIssue } from '../src/github.batch.lib.mjs';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

// ============================================================================
// Basic Keyword Tests
// ============================================================================

console.log('\n📋 Basic Keyword Tests\n');

test('detects "fixes #123"', () => {
  assert.equal(prClosesIssue('fixes #123', 123), true);
  assert.equal(prClosesIssue('fixes #123', 124), false);
});

test('detects "Fixes #123" (case-insensitive)', () => {
  assert.equal(prClosesIssue('Fixes #123', 123), true);
  assert.equal(prClosesIssue('FIXES #123', 123), true);
});

test('detects "closes #123"', () => {
  assert.equal(prClosesIssue('closes #123', 123), true);
  assert.equal(prClosesIssue('Closes #123', 123), true);
  assert.equal(prClosesIssue('CLOSES #123', 123), true);
});

test('detects "resolves #123"', () => {
  assert.equal(prClosesIssue('resolves #123', 123), true);
  assert.equal(prClosesIssue('Resolves #123', 123), true);
  assert.equal(prClosesIssue('RESOLVES #123', 123), true);
});

test('detects "fix #123"', () => {
  assert.equal(prClosesIssue('fix #123', 123), true);
});

test('detects "fixed #123"', () => {
  assert.equal(prClosesIssue('fixed #123', 123), true);
});

test('detects "close #123"', () => {
  assert.equal(prClosesIssue('close #123', 123), true);
});

test('detects "closed #123"', () => {
  assert.equal(prClosesIssue('closed #123', 123), true);
});

test('detects "resolve #123"', () => {
  assert.equal(prClosesIssue('resolve #123', 123), true);
});

test('detects "resolved #123"', () => {
  assert.equal(prClosesIssue('resolved #123', 123), true);
});

// ============================================================================
// Edge Case Tests
// ============================================================================

console.log('\n📋 Edge Case Tests\n');

test('returns false for null/undefined text', () => {
  assert.equal(prClosesIssue(null, 123), false);
  assert.equal(prClosesIssue(undefined, 123), false);
});

test('returns false for empty string', () => {
  assert.equal(prClosesIssue('', 123), false);
});

test('returns false for non-string text', () => {
  assert.equal(prClosesIssue(123, 123), false);
  assert.equal(prClosesIssue({}, 123), false);
});

test('returns false when issue number is part of larger number', () => {
  assert.equal(prClosesIssue('fixes #1234', 123), false);
  assert.equal(prClosesIssue('fixes #12', 123), false);
});

test('returns true when issue number is at end of text', () => {
  assert.equal(prClosesIssue('This PR fixes #123', 123), true);
});

test('returns true when issue number is followed by punctuation', () => {
  assert.equal(prClosesIssue('fixes #123.', 123), true);
  assert.equal(prClosesIssue('fixes #123, and other changes', 123), true);
  assert.equal(prClosesIssue('fixes #123)', 123), true);
});

test('handles multiple issue references', () => {
  const text = 'fixes #123 and closes #456';
  assert.equal(prClosesIssue(text, 123), true);
  assert.equal(prClosesIssue(text, 456), true);
  assert.equal(prClosesIssue(text, 789), false);
});

// ============================================================================
// Commit Style Tests
// ============================================================================

console.log('\n📋 Commit Style Tests\n');

test('detects "fix: #123" (commit message style)', () => {
  assert.equal(prClosesIssue('fix: #123', 123), true);
});

test('detects "fixes: #123"', () => {
  assert.equal(prClosesIssue('fixes: #123', 123), true);
});

test('detects "fix(scope): #123"', () => {
  // This is less common but should be tested
  assert.equal(prClosesIssue('fix(scope): resolves #123', 123), true);
});

// ============================================================================
// Repository Prefix Tests
// ============================================================================

console.log('\n📋 Repository Prefix Tests\n');

test('detects "fixes owner/repo#123"', () => {
  assert.equal(prClosesIssue('fixes owner/repo#123', 123), true);
});

test('detects "closes org-name/repo-name#456"', () => {
  assert.equal(prClosesIssue('closes org-name/repo-name#456', 456), true);
});

test('detects "resolves user.name/repo.name#789"', () => {
  assert.equal(prClosesIssue('resolves user.name/repo.name#789', 789), true);
});

// ============================================================================
// False Positive Prevention Tests
// ============================================================================

console.log('\n📋 False Positive Prevention Tests\n');

test('does NOT detect simple issue mention "#123"', () => {
  assert.equal(prClosesIssue('Related to #123', 123), false);
  assert.equal(prClosesIssue('See #123 for more details', 123), false);
  assert.equal(prClosesIssue('Issue #123 is related', 123), false);
});

test('does NOT detect issue in table (PR #369 scenario)', () => {
  const tableText = `
| # | Description |
|---|-------------|
| #370 | Edit Dialogue Flow signal not connected |
| #371 | Null Pointer Dereference in Voice Integration |
`;
  assert.equal(prClosesIssue(tableText, 370), false);
  assert.equal(prClosesIssue(tableText, 371), false);
});

test('does NOT detect issue in list without keyword', () => {
  const listText = `
Issues created:
- #370: Bug 1
- #371: Bug 2
- #372: Bug 3
`;
  assert.equal(prClosesIssue(listText, 370), false);
  assert.equal(prClosesIssue(listText, 371), false);
});

test('does NOT detect "ref #123" or "refs #123"', () => {
  assert.equal(prClosesIssue('ref #123', 123), false);
  assert.equal(prClosesIssue('refs #123', 123), false);
  assert.equal(prClosesIssue('reference #123', 123), false);
});

test('does NOT detect "related to #123"', () => {
  assert.equal(prClosesIssue('related to #123', 123), false);
});

// ============================================================================
// Real-World PR Body Tests
// ============================================================================

console.log('\n📋 Real-World PR Body Tests\n');

test('PR #369 body correctly identifies only #368 as fixed', () => {
  // This is the actual PR body from the StoryGraph repository
  const pr369Body = `
## 🔍 Комплексный аудит Graph Mode UI

### Created Issues (28 issues)
| # | Description |
|---|-------------|
| #370 | Edit Dialogue Flow signal not connected |
| #371 | Null Pointer Dereference in Voice Integration |
| #372 | Recording Studio - empty event handlers |
...

Fixes #368

---
*Automatically generated by AI Issue Solver*
`;

  // Should detect #368 as fixed
  assert.equal(prClosesIssue(pr369Body, 368), true);

  // Should NOT detect the issues in the table as fixed
  assert.equal(prClosesIssue(pr369Body, 370), false);
  assert.equal(prClosesIssue(pr369Body, 371), false);
  assert.equal(prClosesIssue(pr369Body, 372), false);
});

test('standard PR with "Fixes #N" footer', () => {
  const prBody = `
## Summary
This PR implements the feature requested in the issue.

## Changes
- Added new component
- Updated tests

Fixes #123
`;
  assert.equal(prClosesIssue(prBody, 123), true);
  assert.equal(prClosesIssue(prBody, 456), false);
});

test('PR with multiple closing keywords', () => {
  const prBody = `
## Summary
This PR addresses multiple issues.

Fixes #100
Closes #200
Resolves #300
`;
  assert.equal(prClosesIssue(prBody, 100), true);
  assert.equal(prClosesIssue(prBody, 200), true);
  assert.equal(prClosesIssue(prBody, 300), true);
  assert.equal(prClosesIssue(prBody, 400), false);
});

test('PR with inline closing reference', () => {
  const prBody = `This PR fixes #123 by updating the validation logic.`;
  assert.equal(prClosesIssue(prBody, 123), true);
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n📊 Test Results\n');
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log(`Total tests: ${testsPassed + testsFailed}`);

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
