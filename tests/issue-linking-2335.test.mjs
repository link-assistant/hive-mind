/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prClosesIssue, extractLinkedIssueNumber } from '../src/github-linking.lib.mjs';
import { ensureIssueLinkInPullRequestBody } from '../src/pr-issue-linking.lib.mjs';
import { findMissingSubIssueReferences } from '../src/solve.ensure-sub-issues.detect.lib.mjs';

const repository = { owner: 'link-assistant', repo: 'agent' };

test('PR 326: a negated closing keyword is not a closing reference', () => {
  const body = 'Related to #322. **The OpenTUI blocker remains, so this PR does not close #322 or lift the pin.**';
  assert.equal(prClosesIssue(body, 322, repository.owner, repository.repo), false);
  assert.equal(extractLinkedIssueNumber(body), null);
  assert.equal(ensureIssueLinkInPullRequestBody(body, { ...repository, issueNumber: 322 }).updated, true);
});

test('negated, hypothetical, and example references do not satisfy the repair check', () => {
  for (const body of ['Does not fix #322', "This PR won't resolve #322", 'Never closes #322', 'Cannot close #322', 'Not intended to fix #322', 'Example: `Fixes #322`', '```\nFixes #322\n```', '<!-- Fixes #322 -->']) {
    assert.equal(prClosesIssue(body, 322), false, body);
  }
  assert.equal(prClosesIssue('Does not close #12, but fixes #322', 322), true);
});

test('repository-qualified links must match the issue repository', () => {
  for (const body of ['Fixes elsewhere/agent#322', 'Fixes https://github.com/link-assistant/other/issues/322']) {
    assert.equal(prClosesIssue(body, 322, repository.owner, repository.repo), false, body);
  }
  assert.equal(prClosesIssue('Fixes LINK-ASSISTANT/AGENT#322', 322, repository.owner, repository.repo), true);
});

test('a local reference cannot satisfy a foreign sub-issue with the same number', () => {
  const subIssues = [{ number: 322, owner: 'other', repo: 'agent' }];
  assert.equal(findMissingSubIssueReferences({ text: 'Fixes #322', subIssues, ...repository }).missing.length, 1);
  assert.equal(findMissingSubIssueReferences({ text: 'Fixes other/agent#322', subIssues, ...repository }).missing.length, 0);
});
