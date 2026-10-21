#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #3684 asks that every action is done only if it was not done yet, so a
 * repeated run (a kill recovery, a re-sent command) duplicates nothing. These
 * cover the other creators that used to file a second copy on a repeated run:
 *   - `/fix --ci-cd` and `/fix --update-all-dependencies` (fixed-title issues);
 *   - `/task --split` (the split section in the parent body);
 *   - the "Repository Initialization Required" notice of an empty repository.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { CI_CD_ISSUE_TITLE } from '../src/fix.ci-cd.lib.mjs';
import { createCiCdIssue } from '../src/fix.ci-cd-issue.lib.mjs';
import { createOrReuseTaskIssue, findOpenIssueWithTitle } from '../src/task.issue-creation.lib.mjs';
import { appendOrReplaceParentSplitSection, parseParentSplitSection } from '../src/task.split.lib.mjs';
import { REPOSITORY_INITIALIZATION_REQUIRED_MARKER, findCommentWithMarker } from '../src/tool-comments.lib.mjs';

const repository = { owner: 'acme', repo: 'widgets', fullName: 'acme/widgets', url: 'https://github.com/acme/widgets' };
const ok = value => ({ code: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });

/** A fake `gh` with open issues, `issue create`, `issue edit` and issue search. */
function fakeGitHub(openIssues = []) {
  const issues = [...openIssues];
  const calls = [];
  let next = 50;
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'api' && args.includes('search/issues')) {
      const query = args[args.indexOf('-f') + 1];
      return ok({ items: issues.filter(issue => issue.state === 'open' && query.includes(`"${issue.title}"`)) });
    }
    if (args[0] === 'issue' && args[1] === 'create') {
      const number = next++;
      issues.push({ number, title: args[args.indexOf('--title') + 1], body: await readFile(args[args.indexOf('--body-file') + 1], 'utf8'), state: 'open', html_url: `https://github.com/acme/widgets/issues/${number}` });
      return ok(`https://github.com/acme/widgets/issues/${number}\n`);
    }
    if (args[0] === 'issue' && args[1] === 'edit') {
      issues.find(issue => issue.number === Number(args[2])).body = await readFile(args[args.indexOf('--body-file') + 1], 'utf8');
      return ok('');
    }
    if (args[0] === 'api' && String(args[1]).startsWith('graphql')) return ok({ data: { repository: { issueTypes: { nodes: [{ name: 'Bug' }, { name: 'Task' }] } } } });
    return ok('[]');
  };
  return { run, calls, issues, creates: () => calls.filter(call => call[1] === 'issue' && call[2] === 'create').length };
}

test('createOrReuseTaskIssue creates the fixed-title issue once and refreshes it on repeated runs', async () => {
  const gh = fakeGitHub();
  const first = await createOrReuseTaskIssue({ repository, title: CI_CD_ISSUE_TITLE, body: 'run 1', run: gh.run });
  const second = await createOrReuseTaskIssue({ repository, title: CI_CD_ISSUE_TITLE, body: 'run 2', run: gh.run });
  assert.equal(gh.creates(), 1);
  assert.equal(first.reused, undefined);
  assert.equal(second.reused, true);
  assert.equal(second.refreshed, true);
  assert.equal(second.url, first.url);
  assert.equal(gh.issues[0].body.trim(), 'run 2', 'the reused issue describes the latest state');
});

test('createCiCdIssue (/fix --ci-cd) reuses the open issue of an earlier run', async () => {
  const gh = fakeGitHub([{ number: 7, title: CI_CD_ISSUE_TITLE, state: 'open', html_url: 'https://github.com/acme/widgets/issues/7' }]);
  const issue = await createCiCdIssue({ repository, prepared: { title: CI_CD_ISSUE_TITLE, body: 'fresh CI/CD data' }, run: gh.run });
  assert.equal(issue.number, 7);
  assert.equal(issue.reused, true);
  assert.equal(gh.creates(), 0);
});

test('only an open issue with exactly the same title is reused', async () => {
  const gh = fakeGitHub([
    { number: 3, title: CI_CD_ISSUE_TITLE, state: 'closed', html_url: 'https://github.com/acme/widgets/issues/3' },
    { number: 4, title: `Re: ${CI_CD_ISSUE_TITLE}`, state: 'open', html_url: 'https://github.com/acme/widgets/issues/4' },
    { number: 5, title: CI_CD_ISSUE_TITLE, state: 'open', html_url: 'https://github.com/acme/widgets/pull/5', pull_request: {} },
  ]);
  assert.equal(await findOpenIssueWithTitle({ repository, title: CI_CD_ISSUE_TITLE, run: gh.run }), null);
});

test('a failing issue search falls back to creating the issue', async () => {
  const gh = fakeGitHub();
  const failingSearch = async (command, args) => (args.includes('search/issues') ? { code: 1, stdout: '', stderr: 'HTTP 403: rate limit' } : gh.run(command, args));
  const issue = await createOrReuseTaskIssue({ repository, title: CI_CD_ISSUE_TITLE, body: 'body', run: failingSearch });
  assert.equal(issue.number, 50);
  assert.equal(gh.creates(), 1);
});

test('parseParentSplitSection finds the split an earlier /task --split wrote', () => {
  const body = appendOrReplaceParentSplitSection('Parent text', [
    { number: 11, title: 'First part' },
    { number: 12, title: 'Second part' },
  ]);
  assert.deepEqual(parseParentSplitSection(body), [
    { number: 11, title: 'First part' },
    { number: 12, title: 'Second part' },
  ]);
  assert.deepEqual(parseParentSplitSection(body.replace('- [ ] #11', '- [x] #11')).length, 2, 'checked items still count');
  assert.equal(parseParentSplitSection('Parent text'), null, 'never split');
  assert.equal(parseParentSplitSection(null), null);
});

/** A fake command-stream `$` that answers the comment listing. */
function fakeDollar(commentBodies, { code = 0 } = {}) {
  const calls = [];
  const $ = (strings, ...values) => (Array.isArray(strings) ? answer(strings, values) : (parts, ...rest) => answer(parts, rest));
  const answer = async (strings, values) => {
    calls.push(strings.reduce((text, part, index) => text + part + (index < values.length ? values[index] : ''), ''));
    const jq = values[values.length - 1];
    const marker = JSON.parse(jq.match(/contains\((".*")\)/)[1]);
    const ids = commentBodies.map((body, index) => (body.includes(marker) ? String(1000 + index) : null)).filter(Boolean);
    return { code, stdout: ids.join('\n'), stderr: '' };
  };
  return { $, calls };
}

test('findCommentWithMarker finds the empty-repository notice of an earlier run', async () => {
  const posted = fakeDollar(['Hi', `## ⚠️ ${REPOSITORY_INITIALIZATION_REQUIRED_MARKER}\n\nHello!`]);
  assert.equal(await findCommentWithMarker({ $: posted.$, owner: 'acme', repo: 'widgets', targetNumber: 1, marker: REPOSITORY_INITIALIZATION_REQUIRED_MARKER }), '1001');
  assert.match(posted.calls[0], /repos\/acme\/widgets\/issues\/1\/comments --paginate/);

  const none = fakeDollar(['Hi']);
  assert.equal(await findCommentWithMarker({ $: none.$, owner: 'acme', repo: 'widgets', targetNumber: 1, marker: REPOSITORY_INITIALIZATION_REQUIRED_MARKER }), null);
  const failing = fakeDollar([`## ⚠️ ${REPOSITORY_INITIALIZATION_REQUIRED_MARKER}`], { code: 1 });
  assert.equal(await findCommentWithMarker({ $: failing.$, owner: 'acme', repo: 'widgets', targetNumber: 1, marker: REPOSITORY_INITIALIZATION_REQUIRED_MARKER }), null, 'unreadable comments: post rather than stay silent');
});
