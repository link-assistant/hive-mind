#!/usr/bin/env node

/**
 * Regression tests for issue #1616.
 *
 * Codex can update a pull request body after the initial verification pass.
 * The final body must still retain a GitHub closing keyword for the solved issue.
 */

import { buildIssueReference, closingIssueNumbersContain, ensureIssueLinkInPullRequestBody, parseClosingIssueNumbers } from '../src/pr-issue-linking.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`PASS: ${testName}`);
    testsPassed++;
  } else {
    console.log(`FAIL: ${testName}`);
    if (details) {
      console.log(`   Details: ${details}`);
    }
    testsFailed++;
  }
}

function assertEquals(actual, expected, testName) {
  const passed = actual === expected;
  assert(passed, testName, `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('Testing issue #1616 PR issue-link preservation');
console.log('='.repeat(60));

const codexEditedBodyWithoutIssueLink = `## Summary

Fixes auto-resume parsing for GitHub's month/day timestamp format.

## Root Cause

The parser expected an ISO timestamp and treated month/day values as invalid.`;

const appended = ensureIssueLinkInPullRequestBody(codexEditedBodyWithoutIssueLink, {
  issueNumber: 1614,
  owner: 'link-assistant',
  repo: 'hive-mind',
});

assert(appended.updated === true, 'Missing issue link is detected as an update');
assert(appended.body.includes('Fixes auto-resume parsing'), 'Existing PR body content is preserved');
assert(appended.body.endsWith('\n\nFixes #1614'), 'Short issue-closing keyword is appended for same-repo PRs');
assertEquals(appended.issueRef, '#1614', 'Same-repo issue reference uses short form');

const alreadyLinked = `## Summary

Fixes auto-resume parsing.

Fixes #1614`;

const unchanged = ensureIssueLinkInPullRequestBody(alreadyLinked, {
  issueNumber: 1614,
  owner: 'link-assistant',
  repo: 'hive-mind',
});

assert(unchanged.updated === false, 'Existing issue link is not duplicated');
assertEquals(unchanged.body, alreadyLinked, 'Already-linked PR body is left unchanged');

const fullSameRepoLink = ensureIssueLinkInPullRequestBody('## Summary\n\nFixes link-assistant/hive-mind#1614', {
  issueNumber: 1614,
  owner: 'link-assistant',
  repo: 'hive-mind',
});

assert(fullSameRepoLink.updated === false, 'Full owner/repo issue link is accepted for same-repo PRs');

const forkResult = ensureIssueLinkInPullRequestBody('## Summary\n\nImplementation details.', {
  issueNumber: 1614,
  owner: 'link-assistant',
  repo: 'hive-mind',
  fork: true,
});

assertEquals(forkResult.issueRef, 'link-assistant/hive-mind#1614', 'Fork issue reference uses owner/repo form');
assert(forkResult.body.endsWith('\n\nFixes link-assistant/hive-mind#1614'), 'Fork issue-closing keyword is appended with owner/repo');

const emptyBodyResult = ensureIssueLinkInPullRequestBody('', {
  issueNumber: 1614,
  owner: 'link-assistant',
  repo: 'hive-mind',
});

assertEquals(emptyBodyResult.body, 'Fixes #1614', 'Empty PR body does not get leading blank lines');

assertEquals(buildIssueReference({ issueNumber: 1614, owner: 'link-assistant', repo: 'hive-mind' }), '#1614', 'buildIssueReference defaults to short form');
assertEquals(buildIssueReference({ issueNumber: 1614, owner: 'link-assistant', repo: 'hive-mind', fork: true }), 'link-assistant/hive-mind#1614', 'buildIssueReference supports fork form');

const linkedIssueNumbers = parseClosingIssueNumbers('1614\n123\n');
assert(linkedIssueNumbers.includes('1614'), 'GraphQL closing issue stdout is parsed');
assert(closingIssueNumbersContain(linkedIssueNumbers, 1614), 'Numeric issue number matches string GraphQL output');
assert(closingIssueNumbersContain([1614], '1614'), 'String issue number matches numeric GraphQL output');
assert(!closingIssueNumbersContain(linkedIssueNumbers, 9999), 'Different issue number is not matched');

console.log('\n' + '='.repeat(60));
console.log(`Total tests: ${testsPassed + testsFailed}`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

if (testsFailed > 0) {
  process.exit(1);
}
