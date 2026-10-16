#!/usr/bin/env node
/** Issue #3355: after every merge, verify the intended issues closed, and close the ones GitHub left open. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeGitHub } from '../experiments/issue-3354/fake-github.mjs';
import { POST_MERGE_BACKOFF_MS, appendIssueClosingSection, buildClosingComment, closeIntendedIssuesAfterMerge, closeIssuesAfterMerge, formatIssueClosingReport, issueClosingOptions, summarizeIssueClosing, unclosedIssueKeys } from '../src/post-merge-issue-closing.lib.mjs';

const SHA = 'c'.repeat(40);
const URL_326 = 'https://github.com/link-assistant/agent/pull/326';

/** The merge guard's snapshot for agent#326-like pull requests. */
const snapshotFor = (body, numbers, extra = {}) => ({
  pr: { number: 326, body, base: { ref: 'main' }, html_url: URL_326 },
  prNumber: 326,
  repository: { owner: 'link-assistant', repo: 'agent' },
  issues: numbers.map(number => ({ owner: 'link-assistant', repo: 'agent', number })),
  deferred: [],
  reasons: new Map(),
  defaultBranch: 'main',
  ...extra,
});

const github = (issues, pr = {}) =>
  createFakeGitHub({
    repos: { 'link-assistant/agent': { default_branch: 'main' } },
    prs: { 'link-assistant/agent#326': { body: '', merged: true, merge_commit_sha: SHA, ...pr } },
    issues: Object.fromEntries(Object.entries(issues).map(([number, value]) => [`link-assistant/agent#${number}`, { state: 'open', ...value }])),
  });

test('a default-branch merge GitHub left half-closed: the fallback waits 5 minutes with backoff, then closes the rest with a comment', async () => {
  const fake = github({ 330: { state: 'closed' }, 331: {} });
  const waits = [];
  const result = await closeIntendedIssuesAfterMerge(snapshotFor('Fixes #330\nFixes #331', [330, 331]), { run: fake.run, sleep: async ms => waits.push(ms), closeParents: false });
  assert.deepEqual(result.alreadyClosed, ['link-assistant/agent#330']);
  assert.deepEqual(result.closed, ['link-assistant/agent#331']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(waits, [10_000, 20_000, 40_000, 60_000, 60_000, 60_000, 50_000]);
  assert.equal(
    waits.reduce((sum, ms) => sum + ms, 0),
    5 * 60_000
  );
  assert.deepEqual(POST_MERGE_BACKOFF_MS.slice(0, 1), [10_000]);
  assert.deepEqual(fake.closeCalls(), ['link-assistant/agent#331']);
  const close = fake.calls.find(args => args[0] === 'issue' && args[1] === 'close');
  assert.deepEqual(close.slice(0, 7), ['issue', 'close', '331', '--repo', 'link-assistant/agent', '--reason', 'completed']);
  assert.equal(fake.issue('link-assistant/agent#331').comments[0].body, `Closed by ${URL_326} (merged ${SHA}): GitHub did not close it after the merge although the description closes it.`);
  assert.deepEqual(unclosedIssueKeys(result), []);
});

test('an issue GitHub closes during the wait is left alone', async () => {
  const fake = github({ 331: { closesAfterSleeps: 2 } });
  const waits = [];
  const result = await closeIntendedIssuesAfterMerge(snapshotFor('Fixes #331', [331]), {
    run: fake.run,
    sleep: async ms => {
      waits.push(ms);
      await fake.sleep();
    },
    closeParents: false,
  });
  assert.deepEqual(result.alreadyClosed, ['link-assistant/agent#331']);
  assert.deepEqual(result.closed, []);
  assert.deepEqual(waits, [10_000, 20_000]);
  assert.deepEqual(fake.closeCalls(), []);
});

test('a non-default-branch merge closes at once, and the comment names the branches', async () => {
  const fake = github({ 331: {} }, { base: 'stack' });
  const waits = [];
  const snapshot = snapshotFor('Fixes #331', [331]);
  snapshot.pr.base.ref = 'stack';
  const result = await closeIntendedIssuesAfterMerge(snapshot, { run: fake.run, sleep: async ms => waits.push(ms), closeParents: false });
  assert.deepEqual(result.closed, ['link-assistant/agent#331']);
  assert.deepEqual(waits, []);
  assert.match(fake.issue('link-assistant/agent#331').comments[0].body, /^Closed by https:\/\/github\.com\/link-assistant\/agent\/pull\/326 \(merged c{40}\): it was merged into `stack`, not the default branch `main`/);
});

test('with the switch off (option or HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES=false) nothing is closed, only reported', async () => {
  assert.equal(issueClosingOptions({}, {}).autoCloseLinkedIssues, true);
  assert.equal(issueClosingOptions({ autoCloseLinkedIssues: false }, {}).autoCloseLinkedIssues, false);
  assert.equal(issueClosingOptions({}, { HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES: 'false' }).autoCloseLinkedIssues, false);
  assert.equal(issueClosingOptions({ autoCloseLinkedIssues: true }, { HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES: 'false' }).autoCloseLinkedIssues, true);
  const previous = process.env.HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES;
  process.env.HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES = 'false';
  try {
    for (const options of [{}, { autoCloseLinkedIssues: false }]) {
      const fake = github({ 331: {} });
      const result = await closeIssuesAfterMerge(snapshotFor('Fixes #331', [331]), options, { run: fake.run, sleep: async () => {} });
      assert.equal(result.mode, 'report');
      assert.deepEqual(result.stillOpen, ['link-assistant/agent#331']);
      assert.deepEqual(fake.closeCalls(), []);
      assert.deepEqual(unclosedIssueKeys(result), ['link-assistant/agent#331']);
      assert.match(formatIssueClosingReport(result).join('\n'), /Still open after the merge, not closed because --no-auto-close-linked-issues is set: link-assistant\/agent#331/);
      assert.match(summarizeIssueClosing(result), /still open link-assistant\/agent#331/);
    }
  } finally {
    if (previous === undefined) delete process.env.HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES;
    else process.env.HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES = previous;
  }
});

test('agent#326: "does not close #322" is kept open even though GitHub links it', async () => {
  const body = 'Related to #322. **The OpenTUI blocker remains, so this PR does not close #322 or lift the `0.25.10` pin.**';
  const fake = github({ 322: {} });
  const snapshot = snapshotFor(body, [], { deferred: [{ owner: 'link-assistant', repo: 'agent', number: 322 }], reasons: new Map([['link-assistant/agent#322', 'description']]) });
  const result = await closeIntendedIssuesAfterMerge(snapshot, { run: fake.run, sleep: async () => {} });
  assert.deepEqual(result.intended, []);
  assert.deepEqual(result.skippedKeptOpen, [{ key: 'link-assistant/agent#322', reason: 'description' }]);
  assert.deepEqual(fake.calls, []);
  assert.match(formatIssueClosingReport(result).join('\n'), /link-assistant\/agent#322 \(kept open by the description\)/);
});

test('failures are reported, never thrown: an unmerged pull request, an unreadable issue, a refused close', async () => {
  const unmerged = github({ 331: {} }, { merged: false });
  const notMerged = await closeIntendedIssuesAfterMerge(snapshotFor('Fixes #331', [331]), { run: unmerged.run, sleep: async () => {} });
  assert.deepEqual(notMerged.failed, [{ key: 'link-assistant/agent#331', error: 'the pull request is not merged' }]);
  assert.deepEqual(unmerged.closeCalls(), []);
  const unreadable = github({});
  const missing = await closeIntendedIssuesAfterMerge(snapshotFor('Fixes #331', [331]), { run: unreadable.run, sleep: async () => {} });
  assert.equal(missing.failed[0].key, 'link-assistant/agent#331');
  const refused = github({ 331: {} });
  refused.state.failClose = ['link-assistant/agent#331'];
  const logs = [];
  const denied = await closeIntendedIssuesAfterMerge(snapshotFor('Fixes #331', [331]), { run: refused.run, sleep: async () => {}, logger: async message => logs.push(message), closeParents: false });
  assert.match(denied.failed[0].error, /403/);
  assert.deepEqual(unclosedIssueKeys(denied), ['link-assistant/agent#331']);
  assert.match(logs[0], /Could not close linked issue link-assistant\/agent#331/);
  assert.match(summarizeIssueClosing(denied), /could not close link-assistant\/agent#331/);
  assert.deepEqual(await closeIntendedIssuesAfterMerge(null), { mode: 'close', pr: null, mergeSha: null, intended: [], closed: [], alreadyClosed: [], failed: [], closedNotCompleted: [], skippedKeptOpen: [], stillOpen: [], parents: null });
});

test('the report goes into the auto-merge comment, and the foreign-issue comment names the commit', () => {
  const result = { mode: 'close', closed: ['o/r#2'], alreadyClosed: ['o/r#1'], failed: [], stillOpen: [], skippedKeptOpen: [{ key: 'o/r#3', reason: 'partial' }], parents: null };
  const body = appendIssueClosingSection('## Auto-merged', result);
  assert.match(body, /^## Auto-merged\n\n### Linked issues\n\n- 🔒 Closed by GitHub: o\/r#1\n- 🔒 Closed explicitly after the merge \(GitHub did not\): o\/r#2\n- ℹ️ {2}Not closed, the description keeps them open: o\/r#3 \(only partly done here/);
  assert.equal(appendIssueClosingSection('x', { ...result, closed: [], alreadyClosed: [], skippedKeptOpen: [] }), 'x');
  assert.equal(summarizeIssueClosing({ ...result, closed: [] }), '');
  const comment = buildClosingComment({ issue: { owner: 'link-assistant', repo: 'formal-ai', number: 9 }, pr: { base: { ref: 'main' }, html_url: URL_326 }, repository: { owner: 'link-assistant', repo: 'agent' }, mergeSha: SHA, defaultBranch: 'main' });
  assert.equal(comment, `Closed by ${URL_326} (merged link-assistant/agent@${SHA}): GitHub did not close it after the merge (it closes an issue in another repository only when the merger can write to it), although the description closes it.`);
});
