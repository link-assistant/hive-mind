#!/usr/bin/env node
// Reproduces the #3282 / #3174 hazard with hive-mind's own repair, using a fake `gh`.
// Usage: node experiments/issue-3282-repro.mjs [path to hive-mind checkout, default: this one]
//
// Umbrella #1 has sub-issues #2 (fixed by this PR), #3 (another open PR, stacked
// on a feature branch, closes it), #4 (already closed), and #5 (created by the
// session after the PR was opened). Scenario 1: the PR says "Part of #1" and
// "Fixes #2". Scenario 2: the PR says "Fixes #1", so it must close the subtree.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { repairRequiredIssueLinks } = await import(pathToFileURL(resolve(root, 'src', 'pr-issue-link-repair.lib.mjs')).href);

const issues = {
  1: { body: 'Tracking umbrella: solve its sub-issues one by one.', created_at: '2026-10-01T00:00:00Z', state: 'open' },
  2: { body: 'Fix A.', created_at: '2026-10-02T00:00:00Z', state: 'open' },
  3: { body: 'Fix B.', created_at: '2026-10-02T00:00:00Z', state: 'open' },
  4: { body: 'Fix C.', created_at: '2026-10-02T00:00:00Z', state: 'closed' },
  5: { body: 'Follow-up the session created.', created_at: '2026-10-15T12:00:00Z', state: 'open' },
};
const subIssues = { 1: [2, 3, 4, 5], 2: [], 3: [], 4: [], 5: [] };
const otherPullRequests = { 3: [{ number: 30, state: 'OPEN', body: 'Fixes #3', url: 'https://github.com/o/r/pull/30', repository: { nameWithOwner: 'o/r' } }] };
const pr = { number: 10, created_at: '2026-10-15T10:00:00Z', body: '' };

const ok = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const run = async args => {
  const [command, target] = args;
  if (command === 'pr' && target === 'edit') {
    pr.body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
    return ok({});
  }
  if (target === 'graphql') {
    const query = args.find(arg => arg.startsWith('query='));
    // No earlier revision of the description (issue #3174 reads the history).
    if (query.includes('userContentEdits')) return ok([{ data: { repository: { pullRequest: { userContentEdits: { nodes: [] } } } } }]);
    const repository = {};
    for (const [, number] of query.matchAll(/\bi(\d+): issue/g)) repository[`i${number}`] = { closedByPullRequestsReferences: { nodes: [] }, timelineItems: { nodes: (otherPullRequests[number] || []).map(source => ({ source })) } };
    return ok({ data: { repository } });
  }
  if (/issues\/\d+\/sub_issues$/.test(target)) return ok([subIssues[Number(target.split('/').at(-2))].map(number => ({ number, repository_url: 'https://api.github.com/repos/o/r' }))]);
  if (/issues\/\d+$/.test(target)) {
    const number = Number(target.split('/').at(-1));
    return ok({ number, ...issues[number] });
  }
  if (/pulls\/10$/.test(target)) return ok(pr);
  throw new Error(`unexpected gh ${args.join(' ')}`);
};

for (const body of ['Link repair fixes.\n\nFixes #2\nPart of #1', 'Umbrella done.\n\nFixes #1']) {
  pr.body = body;
  console.log(`--- ${JSON.stringify(body)}`);
  await repairRequiredIssueLinks({ owner: 'o', repo: 'r', issueNumber: 1, prNumber: 10, run, logger: async message => console.log(`log: ${message}`) });
  console.log(JSON.stringify(pr.body));
}
