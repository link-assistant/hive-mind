#!/usr/bin/env node
/**
 * Issue #2563: auto-merge of link-foundation/command-stream#206 was held back
 * (issue_unavailable, issue_link_unverified, issue_link_verification_failed)
 * although its description said "Fixes #205".
 *
 * The pull request lived on branch `issue-320-b2913f5b1c99` because it was
 * created while solving link-assistant/agent#320, and solve trusted the branch
 * name over the description, so every pre-merge gate looked for the
 * non-existent command-stream#320.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractBranchIssueNumber, extractForeignIssueNumbers, resolvePrimaryIssueNumber, resolvePullRequestIssueNumber } from '../src/github-linking.lib.mjs';
import { checkIssueLinksBeforeMerge, probeIssueExists, resolvePullRequestPrimaryIssue } from '../src/issue-link-verification.lib.mjs';
import { resolveSolveMode } from '../src/solve.mode.lib.mjs';

const repository = { owner: 'link-foundation', repo: 'command-stream' };
const branch = 'issue-320-b2913f5b1c99';
// Opening of the real description of command-stream#206 (6 October 2026).
const body = 'Windows cancellation now stops descendant processes in both JavaScript and Rust.\n\nFixes #205. Unblocks [link-assistant/agent#320](https://github.com/link-assistant/agent/issues/320).\n\n## Changes\n\n- Stop Windows process trees with `taskkill /PID <pid> /T /F` before terminating the parent.';
const headSha = 'b'.repeat(40);
const json = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const notFound = endpoint => Object.assign(new Error(`Command failed: gh api ${endpoint}`), { stderr: 'gh: Not Found (HTTP 404)' });

/** GitHub as it answered for command-stream#206: #205 exists, #320 does not. Unknown requests fail the test. */
function github() {
  const calls = [];
  const responses = new Map([
    ['repos/link-foundation/command-stream/pulls/206', { body, head: { sha: headSha, ref: branch }, base: { ref: 'main' }, html_url: 'https://github.com/link-foundation/command-stream/pull/206' }],
    ['repos/link-foundation/command-stream', { default_branch: 'main' }],
    ['repos/link-foundation/command-stream/issues/205', { number: 205, title: 'AbortSignal and kill leave descendant processes running on Windows', body: '' }],
    ['repos/link-foundation/command-stream/issues/205/sub_issues', [[]]],
    ['graphql', [{ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 205, repository: { nameWithOwner: 'link-foundation/command-stream' } }] } } } } }]],
  ]);
  const run = async args => {
    calls.push(args[1]);
    assert.equal(args[0], 'api');
    if (args[1] === 'repos/link-foundation/command-stream/issues/320') throw notFound(args[1]);
    assert.ok(responses.has(args[1]), `unexpected endpoint ${args[1]}`);
    return json(responses.get(args[1]));
  };
  return { calls, run };
}

test('the branch issue of command-stream#206 is recognized as foreign, so the description wins', () => {
  assert.equal(extractBranchIssueNumber(branch), '320');
  assert.deepEqual([...extractForeignIssueNumbers(body, repository.owner, repository.repo)], ['320']);
  assert.equal(resolvePrimaryIssueNumber({ body, branch, ...repository }), '205');
});

test('the actual pre-merge gate passes for command-stream#206 without touching #320', async () => {
  const { calls, run } = github();
  const { blocker, snapshot } = await checkIssueLinksBeforeMerge({ ...repository, prNumber: 206, run });
  assert.equal(blocker, null);
  assert.deepEqual(
    snapshot.issues.map(issue => `${issue.owner}/${issue.repo}#${issue.number}`),
    ['link-foundation/command-stream#205']
  );
  assert.ok(!calls.includes('repos/link-foundation/command-stream/issues/320'));
  // The reported failure: the branch-derived #320 as explicit context is unverifiable.
  assert.equal((await checkIssueLinksBeforeMerge({ ...repository, prNumber: 206, issueNumber: '320', run })).blocker.reason, 'issue_link_verification_failed');
});

test('solve on the command-stream#206 URL works with issue #205 and explains the ignored branch hint', async () => {
  const logs = [];
  const prData = { headRefName: branch, body, number: 206, mergeStateStatus: 'CLEAN', state: 'OPEN', headRepositoryOwner: { login: 'link-foundation' }, headRepository: { name: 'command-stream' } };
  const mode = await resolveSolveMode({
    argv: {},
    ...repository,
    urlNumber: 206,
    issueUrl: 'https://github.com/link-foundation/command-stream/pull/206',
    isIssueUrl: false,
    isPrUrl: true,
    skipForkForPrivateUpstream: false,
    shouldAttachLogs: false,
    log: async message => logs.push(message),
    safeExit: async (code, reason) => assert.fail(`unexpected exit ${code}: ${reason}`),
    githubLib: { ghPrView: async () => ({ code: 0, data: prData }) },
    processAutoContinueForIssue: async () => ({ isContinueMode: false }),
    handleMaintainerForkAccess: async () => {},
    reportError: error => assert.fail(error),
    cleanErrorMessage: error => error.message,
  });
  assert.equal(mode.issueNumber, '205');
  assert.ok(logs.includes('🔗 Found linked issue #205'), logs.join('\n'));
  assert.ok(
    logs.some(line => line.includes(`Branch ${branch} suggests issue #320, but the description closes #205`)),
    logs.join('\n')
  );
});

test('a branch issue that does not exist in the repository yields to the description', async () => {
  const exists = answer => async number => {
    assert.equal(number, '320');
    return answer;
  };
  const input = { body: 'Fixes #205', branch, ...repository };
  assert.equal(await resolvePullRequestIssueNumber({ ...input, checkIssueExists: exists(false) }), '205');
  // Existing or unknown branch issues keep the issue #2335 recovery of a deleted reference.
  assert.equal(await resolvePullRequestIssueNumber({ ...input, checkIssueExists: exists(true) }), '320');
  assert.equal(await resolvePullRequestIssueNumber({ ...input, checkIssueExists: exists(null) }), '320');
  const { run } = github();
  assert.equal(await resolvePullRequestPrimaryIssue({ ...repository, body: 'Fixes #205', branch, run }), '205');
});

test('the branch issue stays primary whenever the description does not contradict it', async () => {
  const probe = async () => assert.fail('no probe is needed');
  for (const [input, expected] of [
    [{ body: 'Fixes #320\nFixes #205', branch }, '320'],
    [{ body: 'Fixes #205\nFixes #320', branch }, '320'],
    [{ body: 'Unblocks link-assistant/agent#320', branch }, '320'],
    [{ body: 'Fixes #205', branch: 'feature' }, '205'],
    [{ body: 'Fixes link-foundation/command-stream#320', branch }, '320'],
    [{ body: '', branch: 'feature' }, null],
  ]) {
    assert.equal(await resolvePullRequestIssueNumber({ ...input, ...repository, checkIssueExists: probe }), expected, JSON.stringify(input));
  }
});

test('probeIssueExists distinguishes missing issues, pull requests and unknown answers', async () => {
  const probe = run => probeIssueExists({ ...repository, number: '320', run });
  assert.equal(await probe(async args => json({ number: 320, url: args[1] })), true);
  assert.equal(await probe(async () => json({ number: 320, pull_request: { url: 'x' } })), false);
  assert.equal(await probe(async args => Promise.reject(notFound(args[1]))), false);
  assert.equal(await probe(async () => ({ code: 1, stdout: '', stderr: 'gh: Gone (HTTP 410)' })), false);
  assert.equal(await probe(async () => ({ code: 1, stdout: '', stderr: 'gh: Server Error (HTTP 502)' })), null);
  assert.equal(await probe(async () => json({ number: 7 })), null);
  assert.equal(await probe(async () => ({ code: 0, stdout: 'not json', stderr: '' })), null);
});
