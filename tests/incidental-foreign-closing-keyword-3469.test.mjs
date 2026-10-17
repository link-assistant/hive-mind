#!/usr/bin/env node
/**
 * Issue #3469 (log audit of PR #3446): the description said "Upstream report,
 * with a reproducible example, a workaround and a suggested fix:
 * https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/236".
 * GitHub reads "fix: <issue URL>" as a closing keyword anywhere in the text,
 * and the #3358 rule took it for an author-written closing reference, so the
 * merge would have closed the upstream report. Only the agent's own rewording
 * kept it open. The colon form in the middle of a line now blocks the merge
 * like any closing reference the author did not mean to write.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeGitHub } from '../experiments/issue-3354/fake-github.mjs';
import { extractClosingIssueReferences, extractDeclaredClosingReferences } from '../src/github-linking.lib.mjs';
import { checkIssueLinksBeforeMerge } from '../src/issue-link-verification.lib.mjs';

const UPSTREAM = 'https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/236';
const KEY = 'link-foundation/js-ai-driven-development-pipeline-template#236';
const context = { owner: 'link-assistant', repo: 'hive-mind', prNumber: 3446 };

const github = body =>
  createFakeGitHub({
    repos: { 'link-assistant/hive-mind': { default_branch: 'main' }, 'link-foundation/js-ai-driven-development-pipeline-template': { default_branch: 'main' } },
    prs: { 'link-assistant/hive-mind#3446': { body, head: 'issue-3445-7cd6fd7f1b0b', linked: ['link-assistant/hive-mind#3445', KEY], merge_commit_sha: 'e'.repeat(40) } },
    issues: { 'link-assistant/hive-mind#3445': { state: 'open' }, [KEY]: { state: 'open' } },
  });

test('the PR #3446 wording blocks the merge instead of closing the upstream report', async () => {
  const fake = github(`Fixes #3445\n\nUpstream report, with a reproducible example, a workaround and a suggested fix: ${UPSTREAM}\n`);
  const links = await checkIssueLinksBeforeMerge({ ...context, run: fake.run });
  assert.equal(links.blocker?.reason, 'cross_repository_closing_references');
  assert.deepEqual(links.blocker.details, [KEY]);
  assert.match(links.blocker.resolution, /a suggested fix: <issue URL>/);
});

test('the reworded description merges and leaves the upstream report alone', async () => {
  const fake = github(`Fixes #3445\n\nReported upstream, with a reproducible example, a workaround and a suggested code change: ${UPSTREAM}\n`);
  fake.state.prs['link-assistant/hive-mind#3446'].linked = ['link-assistant/hive-mind#3445'];
  const links = await checkIssueLinksBeforeMerge({ ...context, run: fake.run });
  assert.equal(links.blocker, null);
  assert.deepEqual(
    links.snapshot.issues.map(issue => `${issue.owner}/${issue.repo}#${issue.number}`),
    ['link-assistant/hive-mind#3445']
  );
});

test('a declared colon form or verb form is still the author closing it (issue #3358)', () => {
  for (const body of [`Fixes: ${UPSTREAM}`, `- Fixes: ${UPSTREAM}`, `1. Resolves: ${UPSTREAM}`, `**Closes: ${UPSTREAM}**`, `> Closes: ${UPSTREAM}`, `This pull request fixes ${UPSTREAM}`, `Fixes ${UPSTREAM}`]) {
    assert.equal(extractDeclaredClosingReferences(body).length, 1, body);
  }
});

test('GitHub still closes the incidental form, so the shared parser keeps reporting it', () => {
  for (const body of [`a suggested fix: ${UPSTREAM}`, `Workaround and fix: ${UPSTREAM}`, `Status - resolved: ${UPSTREAM}`]) {
    assert.equal(extractDeclaredClosingReferences(body).length, 0, body);
    assert.equal(extractClosingIssueReferences(body).length, 1, body);
  }
});
