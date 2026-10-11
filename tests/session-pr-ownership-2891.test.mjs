/**
 * @hive-mind-test-suite default
 *
 * Issue #2891: kill-recovery notices, intermediate logs and completion links of
 * the link-assistant/router #724/#725/#727/#728 sessions were posted on the
 * parent plan PR #721 (branch `issue-720-…`, "Fixes #720 … Fixes #741"),
 * because it was the first PR GitHub linked to each sub-issue.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractLinkedPullRequestsForIssue } from '../src/github.batch.lib.mjs';
import { getPullRequestPrimaryIssueUrl, isIssueOwnPullRequest } from '../src/github-linking.lib.mjs';
import { extractAnnouncedPullRequestUrlFromText, extractPullRequestUrlFromText, resolvePullRequestUrlForSession, selectIssueOwnPullRequest } from '../src/session-monitor.lib.mjs';

const data = new URL('../docs/case-studies/issue-2891/data/', import.meta.url);
const root = 'https://github.com/link-assistant/router';
const captured = JSON.parse(readFileSync(new URL('pr-721.json', data)));
const references = JSON.parse(readFileSync(new URL('closing-references.json', data))).data.repository;
const planPr = { ...captured, url: `${root}/pull/721` };
const ownPr = (issue, number, headRefName) => ({ number, headRefName, url: `${root}/pull/${number}`, body: `Fixes #${issue}` });
const sessionFor = (number, extra = {}) => ({ urlContext: { type: 'issue', owner: 'link-assistant', repo: 'router', number }, ...extra });
const logReader = text => async () => text;

test('captured data: GitHub links the plan PR first to every affected sub-issue', () => {
  for (const issue of [724, 725, 727, 728]) {
    const nodes = references[`i${issue}`].closedByPullRequestsReferences.nodes;
    assert.equal(nodes[0].number, 721, `#${issue}`);
    assert.match(nodes[1].headRefName, new RegExp(`^issue-${issue}-`));
  }
  assert.match(planPr.body, /Fixes #724/);
});

test('the plan PR belongs to its own issue, not to the sub-issues it closes', () => {
  assert.equal(getPullRequestPrimaryIssueUrl(planPr), `${root}/issues/720`);
  assert.equal(isIssueOwnPullRequest(planPr, 724, 'link-assistant', 'router'), false);
  assert.equal(isIssueOwnPullRequest(planPr, 720, 'link-assistant', 'router'), true);
  assert.equal(isIssueOwnPullRequest(ownPr(724, 749, 'issue-724-878028a21e67'), 724, 'link-assistant', 'router'), true);
  assert.equal(isIssueOwnPullRequest(ownPr(724, 749, 'issue-724-878028a21e67'), 724, 'LINK-ASSISTANT', 'Router'), true);
});

test('a PR on an ordinary branch is owned through its first closing reference', () => {
  const pr = { url: `${root}/pull/9`, headRefName: 'feature/cooldowns', body: 'Fixes #724' };
  assert.equal(isIssueOwnPullRequest(pr, 724, 'link-assistant', 'router'), true);
  assert.equal(isIssueOwnPullRequest({ ...pr, body: 'Fixes #720\nFixes #724' }, 724, 'link-assistant', 'router'), false);
});

test('the batch lookup keeps the head branch and primary issue of each linked PR', async () => {
  const nodes = [planPr, ownPr(724, 749, 'issue-724-878028a21e67')].map(source => ({ source: { ...source, state: 'OPEN', title: 't' } }));
  const linked = await extractLinkedPullRequestsForIssue({ timelineItems: { nodes } }, 724, async () => {}, { owner: 'link-assistant', repo: 'router' });
  assert.deepEqual(
    linked.map(pr => [pr.number, pr.headRefName, pr.primaryIssueUrl]),
    [
      [721, 'issue-720-99e7abc4e6c1', `${root}/issues/720`],
      [749, 'issue-724-878028a21e67', `${root}/issues/724`],
    ]
  );
});

test('selectIssueOwnPullRequest skips the parent plan PR', () => {
  const ctx = sessionFor(724).urlContext;
  assert.equal(selectIssueOwnPullRequest([planPr, ownPr(724, 749, 'issue-724-878028a21e67')], ctx), `${root}/pull/749`);
  assert.equal(selectIssueOwnPullRequest([planPr], ctx), null);
  assert.equal(selectIssueOwnPullRequest([], ctx), null);
});

test('resolvePullRequestUrlForSession never returns a PR that belongs to another issue', async () => {
  const lookupLinkedPullRequest = async () => [planPr, ownPr(724, 749, 'issue-724-878028a21e67')];
  assert.equal(await resolvePullRequestUrlForSession(sessionFor(724), { lookupLinkedPullRequest }), `${root}/pull/749`);
  assert.equal(await resolvePullRequestUrlForSession(sessionFor(724), { lookupLinkedPullRequest: async () => [planPr] }), null);
});

test('the PR solve announced wins over linked PRs and over PRs the log merely mentions', async () => {
  const log = [`Issue body: see the plan in ${root}/pull/721`, `📍 PR URL: ${root}/pull/749`].join('\n');
  const lookupLinkedPullRequest = async () => assert.fail('the session log already named the PR');
  const sessionInfo = sessionFor(724, { logPath: '/tmp/session.log' });
  assert.equal(await resolvePullRequestUrlForSession(sessionInfo, { lookupLinkedPullRequest, readFile: logReader(log) }), `${root}/pull/749`);
});

test('a log that only mentions the plan PR does not make it the session PR', async () => {
  const sessionInfo = sessionFor(724, { logPath: '/tmp/session.log' });
  const readFile = logReader(`Read ${root}/pull/721 for context\n`);
  assert.equal(await resolvePullRequestUrlForSession(sessionInfo, { lookupLinkedPullRequest: async () => [planPr], readFile }), null);
});

test('announcements are recognized in every form solve prints them', () => {
  for (const line of [`📍 PR URL: ${root}/pull/749`, `PR URL: ${root}/pull/749`, `  📍 URL: ${root}/pull/749`]) {
    assert.equal(extractAnnouncedPullRequestUrlFromText(line, { owner: 'link-assistant', repo: 'router' }), `${root}/pull/749`, line);
  }
  const mention = `Parent plan: ${root}/pull/721`;
  assert.equal(extractAnnouncedPullRequestUrlFromText(mention), null);
  assert.equal(extractPullRequestUrlFromText(mention), `${root}/pull/721`);
  assert.equal(extractAnnouncedPullRequestUrlFromText(`📍 PR URL: https://github.com/other/repo/pull/1`, { owner: 'link-assistant', repo: 'router' }), null);
});
