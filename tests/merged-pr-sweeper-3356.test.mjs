#!/usr/bin/env node
/**
 * Issue #3356: merges Hive Mind did not perform (GitHub UI, a person's
 * `gh pr merge`, GitHub auto-merge) still get their issues closed, by the
 * merged-PR sweeper in the bot and hive, or by `close-linked-issues --pr`.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createFakeGitHub } from '../experiments/issue-3354/fake-github.mjs';
import { runCloseLinkedIssues } from '../src/close-linked-issues.lib.mjs';
import { loadSweeperState, startMergedPullRequestSweeper, sweepMergedPullRequests, sweepScope } from '../src/merged-pr-sweeper.lib.mjs';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const minutesAgo = minutes => new Date(NOW - minutes * 60_000).toISOString();

/** formal-ai#1103: merged in the UI into a non-default branch with a closing keyword for formal-ai#1091, which stayed open. */
const formalAi = () =>
  createFakeGitHub({
    repos: { 'link-assistant/formal-ai': { default_branch: 'main' } },
    prs: { 'link-assistant/formal-ai#1103': { body: 'Fixes #1091', base: 'issue-1085-abc', merged: true, merged_at: minutesAgo(30), linked: ['link-assistant/formal-ai#1091'] } },
    issues: { 'link-assistant/formal-ai#1091': { state: 'open' } },
    search: [{ repo: 'link-assistant/formal-ai', number: 1103, merged_at: minutesAgo(30) }],
  });

const freshState = (enabledMinutesAgo = 60) => ({ enabledAt: minutesAgo(enabledMinutesAgo), checked: {} });

test('a UI merge into a non-default branch is closed by the next sweep, with a comment naming the branches; never twice', async () => {
  const fake = formalAi();
  const state = freshState();
  await sweepMergedPullRequests({ scopes: [sweepScope({ owner: 'link-assistant', repo: 'formal-ai' })], state, now: NOW, run: fake.run });
  assert.deepEqual(state.errors, []);
  assert.deepEqual(
    state.results.map(entry => [entry.key, entry.result.closed]),
    [['link-assistant/formal-ai#1103', ['link-assistant/formal-ai#1091']]]
  );
  assert.match(fake.issue('link-assistant/formal-ai#1091').comments[0].body, /^Closed by https:\/\/github\.com\/link-assistant\/formal-ai\/pull\/1103 \(merged b{40}\): it was merged into `issue-1085-abc`, not the default branch `main`/);
  const search = fake.calls.find(args => args.includes('search/issues'));
  assert.ok(search.includes(`q=is:pr is:merged repo:link-assistant/formal-ai merged:>=${minutesAgo(60)}`), search.join(' '));
  assert.deepEqual(state.checked, { 'link-assistant/formal-ai#1103': minutesAgo(30) });
  const calls = fake.calls.length;
  await sweepMergedPullRequests({ scopes: ['repo:link-assistant/formal-ai'], state, now: NOW + 5 * 60_000, run: fake.run });
  assert.deepEqual(state.results, []);
  assert.equal(fake.calls.length, calls + 1, 'only the search runs again');
});

test('pull requests merged before the sweeper was enabled are never touched, unless --since asks for a backfill', async () => {
  const fake = formalAi();
  const state = freshState(10);
  await sweepMergedPullRequests({ scopes: ['repo:link-assistant/formal-ai'], state, now: NOW, run: fake.run });
  assert.deepEqual(state.results, []);
  assert.deepEqual(fake.closeCalls(), []);
  assert.ok(fake.calls[0].some(arg => arg.endsWith(`merged:>=${minutesAgo(10)}`)));
  // The CLI backfill.
  const printed = [];
  const code = await runCloseLinkedIssues(['--repo', 'link-assistant/formal-ai', '--since', minutesAgo(120)], { run: fake.run, print: line => printed.push(line), now: NOW });
  assert.equal(code, 0);
  assert.deepEqual(fake.closeCalls(), ['link-assistant/formal-ai#1091']);
  assert.match(printed.join('\n'), /Closed explicitly after the merge \(GitHub did not\): link-assistant\/formal-ai#1091/);
});

test('a just-merged pull request waits for the next sweep; a failed close is retried', async () => {
  const fake = formalAi();
  fake.state.search[0].merged_at = minutesAgo(2);
  const state = freshState();
  await sweepMergedPullRequests({ scopes: ['repo:link-assistant/formal-ai'], state, now: NOW, run: fake.run });
  assert.deepEqual(state.results, []);
  fake.state.search[0].merged_at = minutesAgo(30);
  fake.state.failClose = ['link-assistant/formal-ai#1091'];
  await sweepMergedPullRequests({ scopes: ['repo:link-assistant/formal-ai'], state, now: NOW, run: fake.run });
  assert.match(state.results[0].result.failed[0].error, /403/);
  assert.deepEqual(state.checked, {});
  fake.state.failClose = [];
  await sweepMergedPullRequests({ scopes: ['repo:link-assistant/formal-ai'], state, now: NOW, run: fake.run });
  assert.deepEqual(state.results[0].result.closed, ['link-assistant/formal-ai#1091']);
});

test('with HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES=false the sweeper only reports', async () => {
  const fake = formalAi();
  const state = freshState();
  const logs = [];
  const previous = process.env.HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES;
  process.env.HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES = 'false';
  try {
    await sweepMergedPullRequests({ scopes: ['repo:link-assistant/formal-ai'], state, now: NOW, run: fake.run, logger: async line => logs.push(line) });
  } finally {
    if (previous === undefined) delete process.env.HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES;
    else process.env.HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES = previous;
  }
  assert.deepEqual(state.results[0].result.stillOpen, ['link-assistant/formal-ai#1091']);
  assert.deepEqual(fake.closeCalls(), []);
  assert.match(logs.join('\n'), /Still open after the merge/);
});

test('close-linked-issues --pr <agent#326> --dry-run lists what it would close and skips "does not close #322"', async () => {
  const body = 'Fixes #325\n\nRelated to #322. **The OpenTUI blocker remains, so this PR does not close #322 or lift the `0.25.10` pin.**';
  const fake = createFakeGitHub({
    repos: { 'link-assistant/agent': { default_branch: 'main' } },
    prs: { 'link-assistant/agent#326': { body, merged: true, linked: ['link-assistant/agent#325', 'link-assistant/agent#322'] } },
    issues: { 'link-assistant/agent#325': { state: 'open' }, 'link-assistant/agent#322': { state: 'open' } },
  });
  const printed = [];
  const code = await runCloseLinkedIssues(['--pr', 'https://github.com/link-assistant/agent/pull/326', '--dry-run'], { run: fake.run, print: line => printed.push(line), env: {} });
  assert.equal(code, 0);
  assert.deepEqual(printed, ['link-assistant/agent#326 (https://github.com/link-assistant/agent/pull/326):', '  would close link-assistant/agent#325: the description closes it and it is still open', '  skip link-assistant/agent#322: kept open by the description']);
  assert.deepEqual(fake.closeCalls(), []);
  assert.equal(fake.calls.filter(args => args[0] === 'issue').length, 0, 'a dry run neither closes nor comments');
  // Without --dry-run, only #325 is closed.
  assert.equal(await runCloseLinkedIssues(['--pr', 'https://github.com/link-assistant/agent/pull/326'], { run: fake.run, print: () => {}, env: {} }), 0);
  assert.deepEqual(fake.closeCalls(), ['link-assistant/agent#325']);
  assert.equal(fake.issue('link-assistant/agent#322').state, 'open');
});

test('usage errors exit 2; the bot and hive scopes', async () => {
  const printed = [];
  assert.equal(await runCloseLinkedIssues([], { print: line => printed.push(line) }), 2);
  assert.equal(await runCloseLinkedIssues(['--since', '2026-10-01'], { print: () => {} }), 2);
  assert.equal(await runCloseLinkedIssues(['--help'], { print: () => {} }), 0);
  assert.match(printed[0], /^Give --pr <url>/);
  assert.equal(sweepScope({ owner: 'link-assistant' }), 'user:link-assistant');
  assert.equal(sweepScope({ author: '@me' }), 'author:@me');
});

test('startMergedPullRequestSweeper runs now and on each tick, persists the state, and the timer does not keep the process alive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sweeper-3356-'));
  try {
    const statePath = join(directory, 'state.json');
    const fake = formalAi();
    fake.state.search[0].merged_at = new Date(Date.now() - 30 * 60_000).toISOString();
    // Enabled an hour ago.
    await import('node:fs/promises').then(fs => fs.writeFile(statePath, JSON.stringify({ enabledAt: new Date(Date.now() - 60 * 60_000).toISOString(), checked: {} })));
    let tick;
    let unref = false;
    const sweeper = startMergedPullRequestSweeper({ scopes: ['repo:link-assistant/formal-ai'], statePath, run: fake.run, setTimer: (callback, ms) => ((tick = callback), assert.equal(ms, 5 * 60_000), { unref: () => (unref = true) }), clearTimer: () => {} });
    assert.ok(unref);
    await sweeper.runOnce();
    assert.deepEqual(fake.closeCalls(), ['link-assistant/formal-ai#1091']);
    const saved = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(Object.keys(saved.checked), ['link-assistant/formal-ai#1103']);
    assert.equal(saved.results, undefined);
    await tick();
    assert.deepEqual(fake.closeCalls(), ['link-assistant/formal-ai#1091']);
    sweeper.stop();
    const missing = await loadSweeperState(join(directory, 'none.json'), NOW);
    assert.deepEqual(missing, { enabledAt: new Date(NOW).toISOString(), checked: {}, reported: {}, attempts: {} });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
