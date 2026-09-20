#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #2160: the final `/hive` summary reported every completed issue as "(no PR found)".
 *
 * Evidence from the reported run (docs/case-studies/issue-2160):
 *
 *     📋 Issues with solution drafts:
 *        📊 Batch PR check complete: 0/6 issues have open PRs
 *        - https://github.com/link-assistant/router/issues/186 (no PR found)
 *
 * Every one of those 6 issues *did* get a pull request, and `--auto-merge` merged it
 * (link-assistant/router PRs #196-#201, all MERGED). The listing only asked for OPEN pull
 * requests, so a successfully merged solution draft was reported as a missing one — a false
 * negative in the very summary a human reads to judge the run.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2160
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { listSolutionDrafts } from '../src/list-solution-drafts.lib.mjs';
import { extractLinkedPullRequestsForIssue } from '../src/github.batch.lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..');
const readSource = relativePath => readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

let passed = 0;
let failed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`❌ ${name}`);
    console.log(`   ${error.message}`);
  }
};

/** A timeline node shaped like the GraphQL response batchCheckPullRequestsForIssues parses. */
const timelineNode = (number, state) => ({
  source: {
    number,
    title: `Fix issue #186`,
    body: 'Fixes #186',
    state,
    isDraft: false,
    url: `https://github.com/link-assistant/router/pull/${number}`,
  },
});

await test('a merged pull request is invisible with the default OPEN-only filter', async () => {
  const issueData = { timelineItems: { nodes: [timelineNode(197, 'MERGED')] } };
  const linked = await extractLinkedPullRequestsForIssue(issueData, 186, async () => {});
  assert.deepStrictEqual(linked, [], 'the open-PR gate used by --skip-issues-with-prs must keep ignoring merged PRs');
});

await test('extractLinkedPullRequestsForIssue can include merged and closed pull requests', async () => {
  const issueData = {
    timelineItems: {
      nodes: [timelineNode(197, 'MERGED'), timelineNode(198, 'CLOSED'), timelineNode(199, 'OPEN')],
    },
  };
  const linked = await extractLinkedPullRequestsForIssue(issueData, 186, async () => {}, {
    includeStates: ['OPEN', 'MERGED', 'CLOSED'],
  });
  assert.deepStrictEqual(
    linked.map(pr => [pr.number, pr.state]),
    [
      [197, 'MERGED'],
      [198, 'CLOSED'],
      [199, 'OPEN'],
    ]
  );
});

await test('the mention-only skip message is not repeated for every requested state', async () => {
  const mentionOnly = timelineNode(300, 'MERGED');
  mentionOnly.source.body = 'Related to #186';
  mentionOnly.source.title = 'Unrelated change';
  const messages = [];
  const linked = await extractLinkedPullRequestsForIssue({ timelineItems: { nodes: [mentionOnly] } }, 186, async message => messages.push(message), { includeStates: ['OPEN', 'MERGED', 'CLOSED'] });
  assert.deepStrictEqual(linked, []);
  assert.strictEqual(messages.length, 1, `expected exactly one informational message, got ${messages.length}`);
  assert.match(messages[0], /doesn't close it/);
});

await test('listSolutionDrafts reports a merged solution draft instead of "no PR found"', async () => {
  const lines = [];
  const log = async message => lines.push(message);
  const completed = new Set(['https://github.com/link-assistant/router/issues/186']);
  const requests = [];
  const batchCheck = async (owner, repo, numbers, options) => {
    requests.push({ owner, repo, numbers, options });
    return {
      186: {
        state: 'CLOSED',
        openPRCount: 0,
        linkedPRs: [{ number: 197, state: 'MERGED', url: 'https://github.com/link-assistant/router/pull/197' }],
      },
    };
  };

  await listSolutionDrafts({ completed }, log, batchCheck);

  const output = lines.join('\n');
  assert.ok(!output.includes('no PR found'), `merged PR must not be reported as missing:\n${output}`);
  assert.match(output, /PR #197 \(merged\): https:\/\/github\.com\/link-assistant\/router\/pull\/197/);
  assert.match(output, /merged/i, `the state of a non-open solution draft must be visible:\n${output}`);
  assert.deepStrictEqual(requests[0].numbers, [186]);
  assert.ok(requests[0].options?.includeStates?.includes('MERGED'), 'the listing must ask for merged pull requests explicitly');
});

await test('listSolutionDrafts still says "no PR found" when there really is none', async () => {
  const lines = [];
  const completed = new Set(['https://github.com/link-assistant/router/issues/192']);
  await listSolutionDrafts(
    { completed },
    async message => lines.push(message),
    async () => ({ 192: { openPRCount: 0, linkedPRs: [] } })
  );
  assert.match(lines.join('\n'), /issues\/192 \(no PR found\)/);
});

await test('listSolutionDrafts handles both a Set and an Array of completed issues', async () => {
  for (const completed of [new Set(), []]) {
    const lines = [];
    await listSolutionDrafts(
      { completed },
      async message => lines.push(message),
      async () => ({})
    );
    assert.deepStrictEqual(lines, [], `an empty ${completed.constructor.name} must print nothing at all`);
  }
});

await test('the batch helper keeps openPRCount limited to open pull requests', () => {
  const source = readSource('src/github.batch.lib.mjs');
  assert.match(source, /openPRCount:\s*linkedPRs\.filter\(pr => pr\.state === 'OPEN'\)\.length/, 'openPRCount drives --skip-issues-with-prs and must count only OPEN pull requests');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
