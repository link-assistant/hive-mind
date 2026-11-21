/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractLinkedPullRequestsForIssue } from '../src/github.batch.lib.mjs';
import { readFileSync } from 'node:fs';
import { createRestIssueOwnershipFetcher, getIssueAncestorUrls } from '../src/github-issue-pr-ownership.lib.mjs';

const root = 'https://github.com/link-assistant/calculator';
const [captured] = JSON.parse(readFileSync(new URL('../docs/case-studies/issue-2685/data/calculator-open-prs.json', import.meta.url)));
const parentPr = { ...captured, state: 'OPEN', url: captured.html_url, headRefName: captured.head.ref };
const options = { owner: 'link-assistant', repo: 'calculator', excludeAncestorPullRequests: true };
const linked = (prs, parent = null, extra = {}) => extractLinkedPullRequestsForIssue({ parent, timelineItems: { nodes: prs.map(source => ({ source })) } }, 229, async () => {}, { ...options, ...extra });
const parent = { url: `${root}/issues/227` };

test('captured parent PR does not cover a child just because it closes it', async () => {
  assert.deepEqual(await linked([parentPr], parent), []);
});

test('a draft child PR still blocks duplicate work alongside the parent PR', async () => {
  const childPr = { ...parentPr, number: 250, headRefName: 'issue-229-abcdef123456', isDraft: true, body: 'Fixes #229', url: `${root}/pull/250` };
  const prs = await linked([parentPr, childPr], parent);
  assert.deepEqual(
    prs.map(pr => pr.number),
    [250]
  );
  assert.equal(prs[0].isDraft, true);
});

test('parent PR ownership is inferred from its closing reference on an ordinary branch', async () => {
  assert.deepEqual(await linked([{ ...parentPr, headRefName: 'planning', body: 'Closes #227\nFixes #229' }], parent), []);
});

test('branch ownership takes priority over the order of closing references', async () => {
  assert.deepEqual(await linked([{ ...parentPr, body: 'Fixes #229\nCloses #227' }], parent), []);
});

test('grandparent PRs also belong to the ancestor, not the child', async () => {
  assert.deepEqual(await linked([parentPr], { url: `${root}/issues/230`, parent }), []);
});

test('cross-repository ancestor PRs use the source repository for branch ownership', async () => {
  const ancestorPr = { ...parentPr, url: 'https://github.com/other/project/pull/228', body: `Closes #227\nFixes ${root}/issues/229` };
  assert.deepEqual(await linked([ancestorPr], { url: 'https://github.com/other/project/issues/227' }), []);
  assert.equal((await linked([ancestorPr], parent)).length, 1, 'same issue number in another repository is unrelated');
});

test('ordinary multi-issue PRs and missing hierarchy data retain closing-reference behavior', async () => {
  assert.equal((await linked([parentPr])).length, 1);
  assert.equal((await linked([parentPr], { url: `${root}/issues/300` })).length, 1);
});

test('solution reporting still includes parent PR closing links', async () => {
  assert.equal((await linked([parentPr], parent, { excludeAncestorPullRequests: false })).length, 1);
});

test('a merged parent PR is still excluded when the ownership filter is requested', async () => {
  assert.deepEqual(await linked([{ ...parentPr, state: 'MERGED' }], parent, { includeStates: ['OPEN', 'MERGED'] }), []);
});

test('REST ownership reads the branch and caches shared ancestor and PR lookups', async () => {
  const calls = [];
  const fetcher = createRestIssueOwnershipFetcher({
    log: async () => {},
    execGhWithRetry: async command => {
      calls.push(command);
      if (command.includes('/pulls/228')) return { stdout: JSON.stringify(captured) };
      if (command.includes('/issues/227/parent')) throw new Error('HTTP 404: No parent');
      return { stdout: JSON.stringify({ html_url: `${root}/issues/227` }) };
    },
  });
  assert.deepEqual(await fetcher.getAncestors('link-assistant', 'calculator', 229), [parent.url]);
  assert.deepEqual(await fetcher.getAncestors('link-assistant', 'calculator', 230), [parent.url]);
  assert.equal(calls.filter(command => command.includes('/issues/227/parent')).length, 1);
  const pr = { ...parentPr, headRefName: undefined };
  assert.equal((await fetcher.getPullRequestSource(pr)).headRefName, captured.head.ref);
  await fetcher.getPullRequestSource(pr);
  assert.equal(calls.filter(command => command.includes('/pulls/228')).length, 1);
});

test('REST ancestry remains bounded on a malformed cycle and unreadable metadata', async () => {
  const fetcher = createRestIssueOwnershipFetcher({
    log: async () => {},
    execGhWithRetry: async command => {
      if (command.includes('/pulls/')) throw new Error('metadata unavailable');
      return { stdout: JSON.stringify({ html_url: `${root}/issues/229` }) };
    },
  });
  assert.deepEqual(await fetcher.getAncestors('link-assistant', 'calculator', 229), []);
  assert.equal((await fetcher.getPullRequestSource(parentPr)).body, parentPr.body);
  const cycle = { url: parent.url };
  cycle.parent = cycle;
  assert.deepEqual(getIssueAncestorUrls({ parent: cycle }), [parent.url]);
  assert.deepEqual(getIssueAncestorUrls(cycle), [], 'an issue cannot be its own ancestor');
});
