#!/usr/bin/env node
/**
 * Issue #3357: one post-merge closing implementation, closeIntendedIssuesAfterMerge,
 * behind every entry point: /merge and solve (mergePullRequest), the Telegram
 * merge queue, the merged-PR sweeper and `close-linked-issues`. The same pull
 * request (non-default base, closes three issues, keeps one open) gives the same
 * result through each of them.
 */

import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createFakeGitHub } from '../experiments/issue-3354/fake-github.mjs';
import { runCloseLinkedIssues } from '../src/close-linked-issues.lib.mjs';
import { fetchRequirementSources } from '../src/issue-completion.lib.mjs';
import { createRequirementsReportTemplate, formatRequirementsReport } from '../src/issue-requirements.lib.mjs';
import { sweepMergedPullRequests } from '../src/merged-pr-sweeper.lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const experiments = join(root, 'experiments', 'issue-3354');
const INTENDED = ['link-assistant/demo#31', 'link-assistant/demo#32', 'link-assistant/demo#33'];
const KEPT_OPEN = 'link-assistant/demo#34';

/** PR #40 into `issue-30-umbrella` (not the default branch): closing keywords for issues 31 to 33, a negated one for issue 34. */
const fixture = () => ({
  repos: { 'link-assistant/demo': { default_branch: 'main' } },
  prs: { 'link-assistant/demo#40': { body: 'Fixes #31\nFixes #32\nFixes #33\n\nThis pull request does not close #34: the migration is still pending.', base: 'issue-30-umbrella', head: 'issue-31-abc', merged_at: new Date(Date.now() - 30 * 60_000).toISOString(), linked: [...INTENDED, KEPT_OPEN] } },
  issues: Object.fromEntries([...INTENDED, KEPT_OPEN].map(key => [key, { state: 'open' }])),
  search: [{ repo: 'link-assistant/demo', number: 40, merged_at: new Date(Date.now() - 30 * 60_000).toISOString() }],
});

const assertClosedOnce = (state, closeCalls) => {
  assert.deepEqual([...closeCalls].sort(), INTENDED);
  for (const key of INTENDED) {
    assert.equal(state.issues[key].state, 'closed', key);
    assert.equal(state.issues[key].state_reason, 'completed', key);
    assert.match(state.issues[key].comments[0].body, /^Closed by https:\/\/github\.com\/link-assistant\/demo\/pull\/40 \(merged b{40}\): it was merged into `issue-30-umbrella`, not the default branch `main`/);
  }
  assert.equal(state.issues[KEPT_OPEN].state, 'open');
  assert.equal(state.issues[KEPT_OPEN].comments, undefined);
};

/** Issue #2406: a merge also needs a current, complete requirements report in the description. */
async function withCompletedReport(state) {
  const pr = state.prs['link-assistant/demo#40'];
  const issues = [...INTENDED].map(key => ({ owner: 'link-assistant', repo: 'demo', number: Number(key.split('#')[1]) }));
  const { requirements } = await fetchRequirementSources({ owner: 'link-assistant', repo: 'demo', prNumber: 40, issues, run: createFakeGitHub(JSON.parse(JSON.stringify(state))).run });
  const report = createRequirementsReportTemplate({ headSha: 'a'.repeat(40), issues: requirements });
  for (const requirement of report.issues.flatMap(issue => issue.requirements)) Object.assign(requirement, { status: 'done', evidence: 'covered by tests' });
  pr.body = `${pr.body}\n\n${formatRequirementsReport(report)}`;
  return state;
}

/** Runs experiments/issue-3354/merge-entry-points.mjs with the fake `gh` first on PATH. */
async function runEntryPoint(mode) {
  const directory = await mkdtemp(join(tmpdir(), `issue-3357-${mode}-`));
  try {
    const statePath = join(directory, 'state.json');
    await writeFile(statePath, JSON.stringify(await withCompletedReport(fixture())));
    const gh = join(directory, 'gh');
    await writeFile(gh, `#!/bin/sh\nexec "${process.execPath}" "${join(experiments, 'fake-gh-cli.mjs')}" "$@"\n`);
    await chmod(gh, 0o755);
    const { stdout } = await promisify(execFile)(process.execPath, [join(experiments, 'merge-entry-points.mjs'), mode, 'link-assistant', 'demo', '40'], { env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FAKE_GH_STATE: statePath, HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES: '' }, maxBuffer: 4 * 1024 * 1024 });
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const closeCalls = state.log.filter(args => args[0] === 'issue' && args[1] === 'close').map(args => `${args[args.indexOf('--repo') + 1]}#${args[2]}`);
    return { report: JSON.parse(stdout.trim().split('\n').at(-1)), state, closeCalls };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('/merge and solve: mergePullRequest closes the three issues after a non-default-branch merge, and keeps #34 open', { timeout: 60_000 }, async () => {
  const { report, state, closeCalls } = await runEntryPoint('merge');
  assert.equal(report.result.success, true, report.result.error);
  assert.ok(state.log.some(args => args[0] === 'pr' && args[1] === 'merge'));
  assertClosedOnce(state, closeCalls);
  assert.deepEqual(report.result.issueClosing.closed, INTENDED);
  assert.deepEqual(report.result.unclosedIssues, []);
  assert.ok(report.output.includes(`🔒 Closed explicitly after the merge (GitHub did not): ${INTENDED.join(', ')}`), report.output.join('\n'));
});

test('the Telegram merge queue reports the same result in its final message', { timeout: 60_000 }, async () => {
  const { report, state, closeCalls } = await runEntryPoint('queue');
  assert.equal(report.status, 'merged', report.error);
  assertClosedOnce(state, closeCalls);
  assert.match(report.finalMessage, /Linked issues: closed link\\-assistant\/demo\\#31, link\\-assistant\/demo\\#32, link\\-assistant\/demo\\#33/);
});

test('the merged-PR sweeper and close-linked-issues give the same result, without a second close', async () => {
  const fake = createFakeGitHub(fixture());
  fake.state.prs['link-assistant/demo#40'].merged = true;
  const state = { enabledAt: new Date(Date.now() - 60 * 60_000).toISOString(), checked: {} };
  await sweepMergedPullRequests({ scopes: ['repo:link-assistant/demo'], state, run: fake.run });
  assert.deepEqual(state.errors, []);
  assertClosedOnce(fake.state, fake.closeCalls());
  assert.deepEqual(state.results[0].result.skippedKeptOpen, [{ key: KEPT_OPEN, reason: 'description' }]);
  const printed = [];
  assert.equal(await runCloseLinkedIssues(['--pr', 'https://github.com/link-assistant/demo/pull/40'], { run: fake.run, print: line => printed.push(line), env: {} }), 0);
  assert.equal(fake.closeCalls().length, 3, 'already closed issues are not closed again');
  assert.match(printed.join('\n'), /Closed by GitHub: link-assistant\/demo#31, link-assistant\/demo#32, link-assistant\/demo#33/);
});

test('every closing path goes through closeIntendedIssuesAfterMerge; the old implementations are gone', async () => {
  const source = name => readFile(join(root, 'src', name), 'utf8');
  for (const name of ['github-merge.lib.mjs', 'solve.auto-merge.lib.mjs', 'solve.auto-merge-attempt.lib.mjs', 'telegram-merge-queue.lib.mjs', 'merged-pr-sweeper.lib.mjs', 'close-linked-issues.lib.mjs', 'post-merge-issue-closing.lib.mjs', 'github-issue-auto-close.lib.mjs', 'issue-link-verification.lib.mjs']) {
    const text = await source(name);
    for (const removed of ['closeLinkedIssuesAfterMerge', 'closeLinkedIssueIfNotAutoClosed', 'ensureLinkedIssueClosedAfterMerge', 'github-merge-issue-close']) assert.ok(!text.includes(removed), `${name} still mentions ${removed}`);
    assert.ok(!text.includes('extractLinkedIssueNumber('), `${name} picks one issue with extractLinkedIssueNumber`);
  }
  // Solve merges through mergePullRequest with the shared switches and reports its result.
  for (const name of ['solve.auto-merge.lib.mjs', 'solve.auto-merge-attempt.lib.mjs']) {
    const text = await source(name);
    assert.match(text, /mergePullRequest\(owner, repo, prNumber, \{[^}]*\.\.\.issueClosingOptions\(argv\) \}/, name);
    assert.match(text, /appendIssueClosingSection\(/, name);
  }
  assert.match(await source('github-merge.lib.mjs'), /closeIssuesAfterMerge\(links\.snapshot/);
  assert.match(await source('merged-pr-sweeper.lib.mjs'), /closeIntendedIssuesAfterMerge\(/);
  // The remaining extractLinkedIssueNumber callers pick a primary issue or sync labels; none closes issues.
  const callers = execFileSync('git', ['grep', '-l', 'extractLinkedIssueNumber(', '--', 'src'], { cwd: root, encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(callers, ['src/github-linking.lib.mjs', 'src/github-merge-ready-sync.lib.mjs']);
});
