#!/usr/bin/env node

/**
 * Regression tests for issue #2295 (root cause B).
 *
 * On paranjko/external-test-lab#177 the AI agent wrote a PR body that declared
 * partial scope ("This PR is **not** a solution for issue #49 … Part of #49." /
 * "Closes none. Relates to #49."). After every session hive-mind's
 * ensurePullRequestIssueLink appended "Fixes paranjko/external-test-lab#49",
 * which contradicted the PR, would have closed the issue on merge and was the
 * direct reason for the maintainer's complaint "Fixes #49 (no, not a solution)".
 *
 * An explicit non-closing reference is a scope decision and must be preserved.
 * A bare mention ("for issue #54") must still get the closing keyword restored
 * (issues #1616 and #1763).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2295
 */

import { findNonClosingIssueReference, hasGitHubLinkingKeyword } from '../src/github-linking.lib.mjs';
import { ensureIssueLinkInPullRequestBody } from '../src/pr-issue-linking.lib.mjs';

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

console.log('Testing issue #2295 partial-scope PR ↔ issue link handling');
console.log('='.repeat(70));

const owner = 'paranjko';
const repo = 'external-test-lab';

// Excerpts of the real PR #177 bodies, as logged right before hive-mind
// appended "Fixes paranjko/external-test-lab#49" (see docs/case-studies/issue-2295).
const realBodies = [
  {
    name: 'session 1 (2026-09-23): "Closes none. Relates to #49."',
    body: '## Summary\n\nFixes the public gateway health probe clock.\n\nCloses none. Relates to #49.\n',
    phrase: 'relates to',
  },
  {
    name: 'session 2 (2026-09-24): "Part of #49."',
    body: '## Scope\n\nThis PR is **not** a solution for issue #49. It fixes one defect found on the way.\n\nPart of #49.\n\n## Defect and root cause\n\n...',
    phrase: 'part of',
  },
  {
    name: 'session 3 (2026-09-25): "Part of #49." with CI note',
    body: '## Scope\n\nThis PR is **not** a solution for issue #49.\n\nPart of #49.\n\n## Tests\n\n- The exact-head runbook CI job is `action_required` with no jobs or logs.',
    phrase: 'part of',
  },
];

for (const { name, body, phrase } of realBodies) {
  const result = ensureIssueLinkInPullRequestBody(body, { issueNumber: 49, owner, repo });
  assert(result.updated === false, `${name}: body is not modified`, JSON.stringify(result.body.slice(-80)));
  assert(!/Fixes\s+\S*#49/.test(result.body), `${name}: no "Fixes #49" appended`);
  assert(result.nonClosingReference === phrase, `${name}: reports non-closing phrase "${phrase}"`, `got ${result.nonClosingReference}`);
}

// Accepted variants of non-closing references.
const nonClosingCases = [
  ['Part of #49', 'part of'],
  ['part  of issue #49', 'part of'],
  ['Refs: paranjko/external-test-lab#49', 'refs'],
  ['See also https://github.com/paranjko/external-test-lab/issues/49', 'see also'],
  ['Related to #49.', 'related to'],
  ['Towards #49', 'towards'],
  ['Follow-up to #49', 'follow-up to'],
  ['- Contributes to #49', 'contributes to'],
];
for (const [text, expected] of nonClosingCases) {
  const phrase = findNonClosingIssueReference(text, 49, owner, repo);
  assert(phrase === expected, `findNonClosingIssueReference(${JSON.stringify(text)}) === ${JSON.stringify(expected)}`, `got ${phrase}`);
}

// Things that must NOT be treated as a non-closing scope declaration.
const notNonClosingCases = ['Part of #490', 'oversee #49', 'Fixes #49', 'This PR implements the frontend refactor for issue #54 and #49.', 'Issue #49', 'Part of the work', ''];
for (const text of notNonClosingCases) {
  const phrase = findNonClosingIssueReference(text, 49, owner, repo);
  assert(phrase === null, `findNonClosingIssueReference(${JSON.stringify(text)}) === null`, `got ${phrase}`);
}

// Bare mention: closing keyword is still restored (issues #1616 / #1763).
{
  const result = ensureIssueLinkInPullRequestBody('This PR implements the frontend refactor for issue #54.', { issueNumber: 54, owner, repo });
  assert(result.updated === true && result.body.endsWith('Fixes #54'), 'bare mention still gets "Fixes #54" appended', result.body);
}

// An explicit closing keyword wins over a non-closing phrase for the same issue.
{
  const body = 'Relates to #12.\n\nFixes #49';
  const result = ensureIssueLinkInPullRequestBody(body, { issueNumber: 49, owner, repo });
  assert(result.updated === false && hasGitHubLinkingKeyword(body, 49, owner, repo), 'existing closing keyword is left untouched');
}

// A non-closing reference to a DIFFERENT issue does not suppress the link.
{
  const result = ensureIssueLinkInPullRequestBody('Part of #12.', { issueNumber: 49, owner, repo });
  assert(result.updated === true && result.body.endsWith('Fixes #49'), 'non-closing reference to another issue does not block the link', result.body);
}

console.log('='.repeat(70));
console.log(`Passed: ${testsPassed}, Failed: ${testsFailed}`);
if (testsFailed > 0) {
  process.exit(1);
}
