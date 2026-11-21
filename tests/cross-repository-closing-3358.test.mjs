#!/usr/bin/env node
/**
 * Issue #3358: an author-written closing reference to another repository is
 * allowed and closed explicitly after the merge. The link repair never adds
 * one (#3276), and one only the repair block holds, or one for a sub-issue of
 * the pull request's tree, still blocks the merge (the #3295 regression).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeGitHub } from '../experiments/issue-3354/fake-github.mjs';
import { checkIssueLinksBeforeMerge } from '../src/issue-link-verification.lib.mjs';
import { closeIntendedIssuesAfterMerge, fetchMergedPullRequestSnapshot, issueClosingOptions } from '../src/post-merge-issue-closing.lib.mjs';

const SHA = 'd'.repeat(40);
const context = { owner: 'link-assistant', repo: 'hive-mind', prNumber: 900 };

const github = ({ body, linked = ['link-assistant/hive-mind#890', 'link-assistant/agent#55'], sub = [], issues = {} }) =>
  createFakeGitHub({
    repos: { 'link-assistant/hive-mind': { default_branch: 'main' }, 'link-assistant/agent': { default_branch: 'main' } },
    prs: { 'link-assistant/hive-mind#900': { body, head: 'issue-890-abc', linked, merge_commit_sha: SHA } },
    issues: {
      'link-assistant/hive-mind#890': { state: 'open', sub },
      // GitHub does not close it: the merger cannot write to link-assistant/agent.
      'link-assistant/agent#55': { state: 'open', closesAfterSleeps: 99 },
      ...issues,
    },
  });

test('an author-written "Fixes link-assistant/agent#55" merges, and is closed with a comment naming the PR and commit', async () => {
  const fake = github({ body: 'Fixes the parser for both repositories.\n\nFixes #890\nFixes link-assistant/agent#55\n\nTested with the agent fixture.' });
  const links = await checkIssueLinksBeforeMerge({ ...context, run: fake.run });
  assert.equal(links.blocker, null);
  assert.deepEqual(
    links.snapshot.issues.map(issue => `${issue.owner}/${issue.repo}#${issue.number}`),
    ['link-assistant/hive-mind#890', 'link-assistant/agent#55']
  );
  await fake.run(['pr', 'merge', '900', '--repo', 'link-assistant/hive-mind', '--merge']);
  const result = await closeIntendedIssuesAfterMerge(links.snapshot, { run: fake.run, sleep: fake.sleep, closeParents: false });
  assert.deepEqual(result.alreadyClosed, ['link-assistant/hive-mind#890']);
  assert.deepEqual(result.closed, ['link-assistant/agent#55']);
  assert.equal(fake.issue('link-assistant/agent#55').comments[0].body, `Closed by https://github.com/link-assistant/hive-mind/pull/900 (merged link-assistant/hive-mind@${SHA}): GitHub did not close it after the merge (it closes an issue in another repository only when the merger can write to it), although the description closes it.`);
});

test('#3295 regression: the same reference in the repair block still blocks the merge', async () => {
  const fake = github({ body: 'Fixes the parser.\n\nFixes #890\n\n---\n\nFixes link-assistant/agent#55' });
  const links = await checkIssueLinksBeforeMerge({ ...context, run: fake.run });
  assert.equal(links.blocker?.reason, 'cross_repository_closing_references');
  assert.deepEqual(links.blocker.details, ['link-assistant/agent#55']);
});

test('a sub-issue of the tree in another repository stays blocked even when written by the author, at any depth', async () => {
  const issues = { 'link-assistant/agent#55': { state: 'open' }, 'link-assistant/agent#56': { state: 'open', parent: 'link-assistant/agent#55' } };
  for (const reference of ['link-assistant/agent#55', 'link-assistant/agent#56']) {
    const fake = github({ body: `Fixes the parser.\n\nFixes #890\nFixes ${reference}\n\nDone.`, sub: ['link-assistant/agent#55'], issues, linked: ['link-assistant/hive-mind#890', reference] });
    const links = await checkIssueLinksBeforeMerge({ ...context, run: fake.run });
    assert.equal(links.blocker?.reason, 'cross_repository_closing_references', reference);
    assert.deepEqual(links.blocker.details, [reference]);
  }
});

test('--no-allow-cross-repository-closing (or HIVE_MIND_ALLOW_CROSS_REPOSITORY_CLOSING=false) restores the hard block', async () => {
  const fake = github({ body: 'Fixes the parser.\n\nFixes #890\nFixes link-assistant/agent#55\n\nDone.' });
  const links = await checkIssueLinksBeforeMerge({ ...context, run: fake.run, allowCrossRepositoryClosing: false });
  assert.equal(links.blocker?.reason, 'cross_repository_closing_references');
  assert.equal(issueClosingOptions({}, {}).allowCrossRepositoryClosing, true);
  assert.equal(issueClosingOptions({ allowCrossRepositoryClosing: false }, {}).allowCrossRepositoryClosing, false);
  assert.equal(issueClosingOptions({}, { HIVE_MIND_ALLOW_CROSS_REPOSITORY_CLOSING: 'false' }).allowCrossRepositoryClosing, false);
});

test('a foreign sidebar link the author did not write still blocks', async () => {
  const fake = github({ body: 'Fixes the parser.\n\nFixes #890\n\nDone.', linked: ['link-assistant/hive-mind#890', 'link-assistant/agent#55'] });
  const links = await checkIssueLinksBeforeMerge({ ...context, run: fake.run });
  assert.equal(links.blocker?.reason, 'cross_repository_closing_references');
});

test('after the merge, the sweeper reports a repair-appended foreign reference and never closes it', async () => {
  const fake = github({ body: 'Fixes the parser.\n\nFixes #890\n\n---\n\nFixes link-assistant/agent#55' });
  fake.state.prs['link-assistant/hive-mind#900'].merged = true;
  const snapshot = await fetchMergedPullRequestSnapshot({ ...context, run: fake.run });
  const result = await closeIntendedIssuesAfterMerge(snapshot, { run: fake.run, sleep: async () => {}, closeParents: false });
  assert.deepEqual(result.closed, ['link-assistant/hive-mind#890']);
  assert.deepEqual(result.skippedKeptOpen, [{ key: 'link-assistant/agent#55', reason: 'cross_repository' }]);
  assert.deepEqual(fake.closeCalls(), ['link-assistant/hive-mind#890']);
});
