/**
 * Kill-recovery notices and completion links must use the session's own pull
 * request, never a linked PR whose branch belongs to another issue (#2891).
 * @hive-mind-test-suite default
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLinkedPullRequestsForIssue } from '../src/github.batch.lib.mjs';
import { selectSessionPullRequest, lookupSessionPullRequestUrl, findSessionPullRequestUrlInText } from '../src/session-own-pr.lib.mjs';

const ROUTER = 'https://github.com/link-assistant/router';
const PLAN = { number: 721, url: `${ROUTER}/pull/721`, headRefName: 'issue-720-99e7abc4e6c1', state: 'OPEN' };
const OWN = { number: 749, url: `${ROUTER}/pull/749`, headRefName: 'issue-724-878028a21e67', state: 'OPEN' };
const ctx = { owner: 'link-assistant', repo: 'router', number: 724, type: 'issue' };

test('router#724: the parent plan PR listed first is not chosen', () => {
  assert.equal(selectSessionPullRequest([PLAN, OWN], 724)?.number, 749);
  assert.equal(selectSessionPullRequest([OWN, PLAN], 724)?.number, 749);
});

test('a PR whose branch belongs to another issue is never chosen', () => {
  assert.equal(selectSessionPullRequest([PLAN], 724), null);
  assert.equal(selectSessionPullRequest([{ ...OWN, headRefName: 'issue-7240-abcdef123456' }], 724), null);
});

test('a PR on a custom branch is used only when no own branch exists', () => {
  const custom = { number: 800, url: `${ROUTER}/pull/800`, headRefName: 'feature/router-fix' };
  assert.equal(selectSessionPullRequest([PLAN, custom], 724)?.number, 800);
  assert.equal(selectSessionPullRequest([custom, OWN], 724)?.number, 749);
  // An unknown branch (REST fallback) ranks after a known non-issue branch.
  const unknown = { number: 801, url: `${ROUTER}/pull/801` };
  assert.equal(selectSessionPullRequest([unknown, custom], 724)?.number, 800);
  assert.equal(selectSessionPullRequest([PLAN, unknown], 724)?.number, 801);
});

test('linked PRs carry the head branch fetched by GraphQL', async () => {
  const node = (pr, body) => ({ source: { ...pr, title: 't', body, isDraft: false } });
  const issueData = { timelineItems: { nodes: [node(PLAN, 'Fixes #724\nFixes #725'), node(OWN, 'Fixes #724')] } };
  const linked = await extractLinkedPullRequestsForIssue(issueData, 724, async () => {}, { owner: 'link-assistant', repo: 'router' });
  assert.deepEqual(
    linked.map(pr => [pr.number, pr.headRefName]),
    [
      [721, 'issue-720-99e7abc4e6c1'],
      [749, 'issue-724-878028a21e67'],
    ]
  );
});

test('the default lookup returns the own PR, or null instead of another issue PR', async () => {
  const batch = linkedPRs => async (owner, repo, numbers) => ({ [numbers[0]]: { linkedPRs } });
  assert.equal(await lookupSessionPullRequestUrl(ctx, { batchCheckPullRequestsForIssues: batch([PLAN, OWN]) }), OWN.url);
  const rejected = new Set();
  assert.equal(await lookupSessionPullRequestUrl(ctx, { batchCheckPullRequestsForIssues: batch([PLAN]), rejectedUrls: rejected }), null);
  assert.deepEqual([...rejected], [PLAN.url]);
});

test('the session log prefers the PR URL solve printed over the first mentioned PR', () => {
  const log = [`Parent plan: ${ROUTER}/pull/721`, '✅ PR created:                #749', `📍 PR URL:                    ${ROUTER}/pull/749`, `See also ${ROUTER}/pull/721`].join('\n');
  assert.equal(findSessionPullRequestUrlInText(log, ctx), `${ROUTER}/pull/749`);
  const continued = [`Parent plan: ${ROUTER}/pull/721`, '  Using existing PR: #749', `  PR URL: ${ROUTER}/pull/749`].join('\n');
  assert.equal(findSessionPullRequestUrlInText(continued, ctx), `${ROUTER}/pull/749`);
});

test('the session log skips PRs already known to belong to another issue', () => {
  const log = `Parent plan: ${ROUTER}/pull/721\nworking on ${ROUTER}/pull/749`;
  assert.equal(findSessionPullRequestUrlInText(log, ctx, { rejectedUrls: new Set([PLAN.url]) }), `${ROUTER}/pull/749`);
  assert.equal(findSessionPullRequestUrlInText(`foreign https://github.com/other/router/pull/1`, ctx), null);
});

test('/merge pairs a ready sub-issue with its own PR, not the older parent plan PR that also closes it', async () => {
  const { mkdtemp, writeFile, chmod, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fetchReadyIssuesWithPRs } = await import('../src/github-merge.lib.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'merge-2891-'));
  const plan = { number: 721, title: 'Plan for #720', url: 'https://github.com/link-assistant/router/pull/721', createdAt: '2026-10-01T00:00:00Z', headRefName: 'issue-720-99e7abc4e6c1' };
  const own = { number: 749, title: 'Fix #724', url: 'https://github.com/link-assistant/router/pull/749', createdAt: '2026-10-05T00:00:00Z', headRefName: 'issue-724-878028a21e67' };
  const issues = [
    { number: 724, title: 'Sub-issue', url: 'https://github.com/link-assistant/router/issues/724', createdAt: '2026-09-30T00:00:00Z' },
    { number: 726, title: 'Sub-issue without its own PR', url: 'https://github.com/link-assistant/router/issues/726', createdAt: '2026-09-30T00:00:00Z' },
  ];
  const answers = { 'issue list': issues, '#724': [own, plan], '#726': [plan] };
  await writeFile(join(dir, 'answers.json'), JSON.stringify(answers));
  await writeFile(join(dir, 'gh'), `#!/usr/bin/env node\nconst answers = require(${JSON.stringify(join(dir, 'answers.json'))});\nconst args = process.argv.slice(2).join(' ');\nconst key = args.startsWith('issue list') ? 'issue list' : (args.match(/closes (#\\d+)/) || [])[1];\nprocess.stdout.write(JSON.stringify(answers[key] || []));\n`);
  await chmod(join(dir, 'gh'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
  try {
    const result = await fetchReadyIssuesWithPRs('link-assistant', 'router');
    assert.deepEqual(
      result.map(({ issue, pr }) => [issue.number, pr.number]),
      [[724, 749]]
    );
  } finally {
    process.env.PATH = path;
    await rm(dir, { recursive: true, force: true });
  }
});
