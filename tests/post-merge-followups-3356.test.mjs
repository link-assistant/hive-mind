#!/usr/bin/env node
/**
 * Issues #3355, #3356 and #3278: the post-merge check respects an issue that
 * was reopened after the merge or closed as not planned, the command waits
 * only what is left of GitHub's own closing time, the sweeper gives up on a
 * pull request it can never finish and shares its state under a lock, and a
 * stale state lock is broken by one waiter only.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createFakeGitHub } from '../experiments/issue-3354/fake-github.mjs';
import { closeIntendedIssuesAfterMerge, formatIssueClosingReport } from '../src/post-merge-issue-closing.lib.mjs';
import { MAX_SWEEP_ATTEMPTS, startMergedPullRequestSweeper, sweepMergedPullRequests } from '../src/merged-pr-sweeper.lib.mjs';
import { withStateLock } from '../src/state-lock.lib.mjs';

const MERGED_AT = '2026-10-15T00:00:00Z';
const NOW = Date.parse('2026-10-15T12:00:00Z');
const minutesAgo = minutes => new Date(NOW - minutes * 60_000).toISOString();

const snapshotFor = (body, numbers) => ({
  pr: { number: 326, body, base: { ref: 'main' } },
  prNumber: 326,
  repository: { owner: 'link-assistant', repo: 'agent' },
  issues: numbers.map(number => ({ owner: 'link-assistant', repo: 'agent', number })),
  deferred: [],
  reasons: new Map(),
  defaultBranch: 'main',
});

const github = issues =>
  createFakeGitHub({
    repos: { 'link-assistant/agent': { default_branch: 'main' } },
    prs: { 'link-assistant/agent#326': { body: '', merged: true, merged_at: MERGED_AT } },
    issues: Object.fromEntries(Object.entries(issues).map(([number, value]) => [`link-assistant/agent#${number}`, { state: 'open', ...value }])),
  });

test('an issue reopened after the merge is left open; one reopened before it is closed', async () => {
  const fake = github({ 331: { reopened: [{ login: 'konard', at: '2026-10-15T01:00:00Z' }] }, 332: { reopened: [{ login: 'konard', at: '2026-10-14T00:00:00Z' }] } });
  const result = await closeIntendedIssuesAfterMerge(snapshotFor('Fixes #331\nFixes #332', [331, 332]), { run: fake.run, wait: false, closeParents: false });
  assert.deepEqual(result.skippedKeptOpen, [{ key: 'link-assistant/agent#331', reason: 'reopened_after_merge', by: 'konard' }]);
  assert.deepEqual(fake.closeCalls(), ['link-assistant/agent#332']);
  assert.deepEqual(result.failed, []);
  assert.ok(formatIssueClosingReport(result).includes('ℹ️  Not closed, reopened after the merge: link-assistant/agent#331 (by konard)'));
});

test('an issue already closed as not planned is not reported as closed by the merge', async () => {
  const fake = github({ 331: { state: 'closed', state_reason: 'not_planned' }, 332: { state: 'closed', state_reason: 'completed' } });
  const result = await closeIntendedIssuesAfterMerge(snapshotFor('Fixes #331\nFixes #332', [331, 332]), { run: fake.run, wait: false, closeParents: false });
  assert.deepEqual(result.closedNotCompleted, [{ key: 'link-assistant/agent#331', reason: 'not_planned' }]);
  assert.deepEqual(result.alreadyClosed, ['link-assistant/agent#332']);
  assert.deepEqual(fake.closeCalls(), []);
  const report = formatIssueClosingReport(result);
  assert.ok(report.includes('🔒 Closed by GitHub: link-assistant/agent#332'));
  assert.ok(report.includes('ℹ️  Already closed as not completed, not by this merge: link-assistant/agent#331 (not planned)'));
});

test('waitFromMerge waits only what is left of the five minutes since the merge', async () => {
  const waits = [];
  const fourMinutesLater = Date.parse(MERGED_AT) + 4 * 60_000;
  const fake = github({ 331: {} });
  const result = await closeIntendedIssuesAfterMerge(snapshotFor('Fixes #331', [331]), { run: fake.run, sleep: async ms => waits.push(ms), waitFromMerge: true, now: fourMinutesLater, closeParents: false });
  assert.deepEqual(waits, [10_000, 20_000, 30_000]);
  assert.deepEqual(result.closed, ['link-assistant/agent#331']);
  const late = github({ 331: {} });
  waits.length = 0;
  await closeIntendedIssuesAfterMerge(snapshotFor('Fixes #331', [331]), { run: late.run, sleep: async ms => waits.push(ms), waitFromMerge: true, now: NOW, closeParents: false });
  assert.deepEqual(waits, [], 'a merge from hours ago is checked at once');
});

const formalAi = () =>
  createFakeGitHub({
    repos: { 'link-assistant/formal-ai': { default_branch: 'main' } },
    prs: { 'link-assistant/formal-ai#1103': { body: 'Fixes #1091', base: 'issue-1085-abc', merged: true, merged_at: minutesAgo(30) } },
    issues: { 'link-assistant/formal-ai#1091': { state: 'open' } },
    search: [{ repo: 'link-assistant/formal-ai', number: 1103, merged_at: minutesAgo(30) }],
  });

test(`the sweeper gives up on a pull request after ${MAX_SWEEP_ATTEMPTS} failed checks`, async () => {
  const fake = formalAi();
  fake.state.failClose = ['link-assistant/formal-ai#1091'];
  const state = { enabledAt: minutesAgo(60), checked: {} };
  const logs = [];
  for (let run = 1; run <= MAX_SWEEP_ATTEMPTS; run++) {
    await sweepMergedPullRequests({ scopes: ['repo:link-assistant/formal-ai'], state, now: NOW, run: fake.run, logger: async line => logs.push(line) });
    assert.equal(state.results.length, 1, `run ${run} checks it again`);
    if (run < MAX_SWEEP_ATTEMPTS) assert.equal(state.attempts['link-assistant/formal-ai#1103'], run);
  }
  assert.deepEqual(state.checked, { 'link-assistant/formal-ai#1103': minutesAgo(30) });
  assert.deepEqual(state.attempts, {});
  assert.match(logs.join('\n'), /giving up on link-assistant\/formal-ai#1103 after 6 failed checks/);
  await sweepMergedPullRequests({ scopes: ['repo:link-assistant/formal-ai'], state, now: NOW, run: fake.run });
  assert.deepEqual(state.results, []);
});

test('in report mode a pull request is reported once, and closing it later still works', async () => {
  const fake = formalAi();
  const state = { enabledAt: minutesAgo(60), checked: {} };
  const report = { autoCloseLinkedIssues: false };
  await sweepMergedPullRequests({ scopes: ['repo:link-assistant/formal-ai'], state, now: NOW, run: fake.run, options: report });
  assert.deepEqual(state.results[0].result.stillOpen, ['link-assistant/formal-ai#1091']);
  assert.deepEqual(state.checked, {});
  assert.deepEqual(state.reported, { 'link-assistant/formal-ai#1103': minutesAgo(30) });
  await sweepMergedPullRequests({ scopes: ['repo:link-assistant/formal-ai'], state, now: NOW, run: fake.run, options: report });
  assert.deepEqual(state.results, [], 'not reported again every 5 minutes');
  await sweepMergedPullRequests({ scopes: ['repo:link-assistant/formal-ai'], state, now: NOW, run: fake.run, options: { autoCloseLinkedIssues: true } });
  assert.deepEqual(fake.closeCalls(), ['link-assistant/formal-ai#1091']);
  assert.deepEqual(state.reported, {});
  assert.deepEqual(Object.keys(state.checked), ['link-assistant/formal-ai#1103']);
});

test('a sweep waits for the lock next to the state file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sweeper-lock-3356-'));
  try {
    const statePath = join(directory, 'state.json');
    await mkdir(`${statePath}.lock`);
    const fake = formalAi();
    const logs = [];
    const sweeper = startMergedPullRequestSweeper({ scopes: ['repo:link-assistant/formal-ai'], statePath, run: fake.run, logger: async line => logs.push(line), setTimer: () => ({}), clearTimer: () => {}, lockTimeoutMs: 300 });
    assert.equal(await sweeper.runOnce(), null);
    assert.match(logs.join('\n'), /Merged-PR sweeper failed: Timed out .* merged-pr-sweeper lock/);
    assert.deepEqual(fake.calls, [], 'nothing is searched without the lock');
    assert.equal(fs.existsSync(statePath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('two waiters that both see a stale lock break it once and never run together', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'state-lock-3278-'));
  try {
    const lockPath = join(directory, 'name.lock');
    await mkdir(lockPath);
    const old = new Date(Date.now() - 60 * 60_000);
    await utimes(lockPath, old, old);
    // Both waiters read the stale lock's age; the second acts on it only after the first has broken it and taken the lock.
    let arrived = 0;
    let release;
    const barrier = new Promise(resolve => (release = resolve));
    const promises = {
      ...fs.promises,
      stat: async target => {
        const stats = await fs.promises.stat(target);
        if (target === lockPath && arrived < 2) {
          arrived += 1;
          if (arrived === 1) await barrier;
          else {
            release();
            await new Promise(resolve => setTimeout(resolve, 20));
          }
        }
        return stats;
      },
    };
    let inside = 0;
    let most = 0;
    const critical = async () => {
      inside += 1;
      most = Math.max(most, inside);
      await new Promise(resolve => setTimeout(resolve, 50));
      inside -= 1;
    };
    const options = { fsImpl: { promises }, lockPath, staleMs: 60_000, pollMs: 5, timeoutMs: 5_000 };
    await Promise.all([withStateLock('name', critical, options), withStateLock('name', critical, options)]);
    assert.equal(most, 1);
    assert.equal(fs.existsSync(lockPath), false);
    assert.equal(fs.existsSync(`${lockPath}.break`), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a parent accepts a not-planned sub-issue only where its body marks it so, not where the word is in a title', async () => {
  const { closeCompletedParents } = await import('../src/close-completed-parents.lib.mjs');
  const tree = body =>
    createFakeGitHub({
      issues: {
        'link-assistant/agent#300': { state: 'open', body, sub: ['link-assistant/agent#303'] },
        'link-assistant/agent#303': { state: 'closed', state_reason: 'not_planned', closed_at: '2026-10-03T00:00:00Z', parent: 'link-assistant/agent#300' },
      },
    });
  for (const body of ['- [x] #303 fix duplicate comments', '- [x] #303 cancel the build when obsolete files change', 'See #303: the dropped-frames bug']) assert.deepEqual((await closeCompletedParents(['link-assistant/agent#303'], { run: tree(body).run })).closed, [], body);
  for (const body of ['- #303 (not planned)', '- [x] #303 **duplicate** of #301', '- #303 — dropped', '- Dropped: #303', '- ~~#303~~ superseded by #304', '#303 was closed as not planned', '- [x] #303 parser: out of scope']) assert.deepEqual((await closeCompletedParents(['link-assistant/agent#303'], { run: tree(body).run })).closed, ['link-assistant/agent#300'], body);
});
