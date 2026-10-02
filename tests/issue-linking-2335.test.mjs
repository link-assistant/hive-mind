/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyIssueLinkStatus } from '../src/github-issue-auto-close.lib.mjs';
import { extractLinkedPullRequestsForIssue } from '../src/github.batch.lib.mjs';
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

test('PR 2336: a quoted negative example before the real link does not misroute the session', () => {
  // `solve` on PR 2336 itself resolved issue #322: the old parser tried `close`
  // before `fixes` and matched the quoted sentence ahead of "Fixes #2335".
  const body = 'Agent PR #326 merged while leaving Agent #322 unfinished. Its negated sentence (`does not close #322`) fooled local link detection.\n\nFixes #2335';
  assert.equal(extractLinkedIssueNumber(body, 'link-assistant', 'hive-mind'), '2335');
  assert.equal(prClosesIssue(body, 322, 'link-assistant', 'hive-mind'), false);
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
test('a title alone cannot replace a closing reference in the description', () => {
  const status = classifyIssueLinkStatus({ prBody: 'Related work.', prTitle: 'Fixes #322', issueNumber: 322, owner: 'link-assistant', repo: 'agent', baseBranch: 'feature', defaultBranch: 'main' });
  assert.equal(status.hasClosingKeyword, false);
  assert.equal(status.requiresManualClose, false);
  assert.equal(status.reason, 'missing-keyword');
});

test('hive batch discovery uses description links and the exact issue repository', async () => {
  const issueData = { timelineItems: { nodes: [{ source: { number: 1, state: 'OPEN', title: 'Fixes #322', body: 'Related work.' } }, { source: { number: 2, state: 'OPEN', title: 'Work', body: 'Fixes foreign/project#322' } }, { source: { number: 3, state: 'OPEN', title: 'Work', body: 'Fixes link-assistant/agent#322' } }] } };
  assert.deepEqual(
    (await extractLinkedPullRequestsForIssue(issueData, 322, async () => {}, { owner: 'link-assistant', repo: 'agent' })).map(pr => pr.number),
    [3]
  );
  issueData.timelineItems.nodes.push({ source: { number: 4, state: 'OPEN', url: 'https://github.com/foreign/project/pull/4', body: 'Fixes #322' } }, { source: { number: 5, state: 'OPEN', url: 'https://github.com/foreign/project/pull/5', body: 'Fixes link-assistant/agent#322' } });
  assert.deepEqual(
    (await extractLinkedPullRequestsForIssue(issueData, 322, async () => {}, { owner: 'link-assistant', repo: 'agent' })).map(pr => pr.number),
    [3, 5]
  );
});
