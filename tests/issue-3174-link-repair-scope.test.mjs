#!/usr/bin/env node
/**
 * Issues #3174, #3276 and #3282: the post-session link repair must not add (or
 * keep) closing references for sub-issues the description keeps open, for
 * sub-issues in other repositories, for sub-issues that are already closed,
 * created after the pull request was opened or closed by another open pull
 * request, nor for an umbrella the description says it is only part of. The
 * merge guard must refuse a merge that GitHub would use to close such issues.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { checkIssueLinksBeforeMerge, fetchOtherPullRequestClaims, fetchRequiredIssueScope, issueKey, splitDescriptionScope, splitRepairBlock } from '../src/issue-link-verification.lib.mjs';
import { repairRequiredIssueLinks } from '../src/pr-issue-link-repair.lib.mjs';
import { extractOpenIssueMentions, extractPartialIssueMentions } from '../src/github-linking.lib.mjs';
import { REPOSITORY_MODE_MARKER, REQUIRED_CLOSING_REFERENCES_HEADING } from '../src/solve.repository-mode.lib.mjs';

const json = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const linkPage = keys => ({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: keys.map(key => ({ number: Number(key.split('#')[1]), repository: { nameWithOwner: key.split('#')[0] } })) } } } } });

/**
 * A finite GitHub fixture: `tree` maps "owner/repo#N" to its sub-issue keys,
 * `linked` is what GitHub's closingIssuesReferences returns for the PR,
 * `issues` holds extra issue fields (state, created_at) and `claims` maps an
 * issue key to the other pull requests ({ number, state, body, linked }) that
 * reference it.
 */
function fixture({ owner, repo, prNumber, tree, body, linked = [], issues = {}, claims = {}, createdAt }) {
  const pr = { number: prNumber, body, head: { sha: 'a'.repeat(40), ref: 'feature' }, base: { ref: 'main' }, ...(createdAt && { created_at: createdAt }) };
  const state = { pr, linked, issues, claims, edits: 0, claimQueries: 0 };
  state.run = async args => {
    if (args[0] === 'pr' && args[1] === 'edit') {
      state.edits++;
      pr.body = await readFile(args[args.indexOf('--body-file') + 1], 'utf8');
      return json({});
    }
    const endpoint = args[1];
    const query = args.find(arg => arg.startsWith('query=')) || '';
    if (endpoint === 'graphql' && query.includes('closedByPullRequestsReferences')) {
      state.claimQueries++;
      const nodes = {};
      for (const [, number] of query.matchAll(/\bi(\d+): issue/g)) {
        const others = state.claims[`${owner}/${repo}#${number}`] || [];
        const pull = other => ({ number: other.number, state: other.state || 'OPEN', body: other.body ?? '', url: `https://github.com/${owner}/${repo}/pull/${other.number}`, repository: { nameWithOwner: `${owner}/${repo}` } });
        nodes[`i${number}`] = { closedByPullRequestsReferences: { nodes: others.filter(other => other.linked).map(pull) }, timelineItems: { nodes: others.map(other => ({ source: pull(other) })) } };
      }
      return json({ data: { repository: nodes } });
    }
    // No earlier revision of the description (tests/issue-3174-agent-decisions.test.mjs covers the history).
    if (endpoint === 'graphql' && query.includes('userContentEdits')) return json([{ data: { repository: { pullRequest: { userContentEdits: { nodes: [], pageInfo: { hasNextPage: false } } } } } }]);
    if (endpoint === 'graphql') return json([linkPage(state.linked)]);
    if (endpoint === `repos/${owner}/${repo}`) return json({ default_branch: 'main' });
    if (endpoint === `repos/${owner}/${repo}/pulls/${prNumber}`) return json(pr);
    const match = endpoint.match(/^repos\/([^/]+)\/([^/]+)\/issues\/(\d+)(\/sub_issues)?$/);
    const key = match && `${match[1]}/${match[2]}#${match[3]}`;
    assert.ok(key && key in tree, `unexpected gh ${args.join(' ')}`);
    if (!match[4]) return json({ number: Number(match[3]), body: '', ...state.issues[key] });
    return json([tree[key].map(child => ({ number: Number(child.split('#')[1]), repository_url: `https://api.github.com/repos/${child.split('#')[0]}` }))]);
  };
  return state;
}

test('extractOpenIssueMentions: mentions without a positive keyword, with ranges, own repository only', () => {
  const mentions = text => [...extractOpenIssueMentions(text, 'o', 'r')].sort((a, b) => a - b);
  assert.deepEqual(mentions('Closes #1. This PR only plans the work: #2 and #3 stay open.'), [2, 3]);
  assert.deepEqual(mentions('Merging this PR closes only #227. The open sub-issues #236 to #246 stay open.'), [227, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246]);
  assert.deepEqual(mentions('Fixes #227\nThe open sub-issues #236 to #238 stay open.'), [236, 237, 238]);
  assert.deepEqual(mentions('Part of #5, see o/r#6, https://github.com/o/r/issues/7, other/project#8 and #9–#10.'), [5, 6, 7, 9, 10]);
  assert.deepEqual(mentions('Fixes #5, #6'), [6], 'GitHub closes only the first issue of "Fixes #5, #6"');
  assert.deepEqual(mentions('This PR does not close #2.'), [2], 'a negated keyword is not a positive closing reference');
  assert.deepEqual(mentions('`#4` <!-- #5 --> &#6; a#7 x/#8 #1 to #9999'), [1, 9999], 'code, comments, entities and huge ranges are not expanded');
  assert.deepEqual(mentions(''), []);
});

test('splitRepairBlock separates the appended "Fixes" blocks from the agent text', () => {
  assert.deepEqual(splitRepairBlock('Text\n\n---\n\nFixes #2\nFixes #3'), { head: 'Text', lines: ['Fixes #2', 'Fixes #3'] });
  assert.deepEqual(splitRepairBlock('Text\n\n---\n\nFixes #2\n\n---\n\nFixes o/r#3\n'), { head: 'Text', lines: ['Fixes #2', 'Fixes o/r#3'] });
  assert.deepEqual(splitRepairBlock('Fixes #1'), { head: '', lines: ['Fixes #1'] });
  assert.deepEqual(splitRepairBlock('Text\nFixes #2'), { head: 'Text\nFixes #2', lines: [] });
  assert.deepEqual(splitRepairBlock('Text\n\n---\n\nFixes #2 and more'), { head: 'Text\n\n---\n\nFixes #2 and more', lines: [] });
});

test('link-assistant/calculator#227: a plan PR keeps the implementation sub-issues open across sessions', async () => {
  const context = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 10 };
  const f = fixture({ ...context, tree: { 'o/r#1': ['o/r#2', 'o/r#3'], 'o/r#2': [], 'o/r#3': [] }, body: 'Closes #1\n\nThis PR only plans the work: #2 and #3 stay open.', linked: ['o/r#1'] });
  const logs = [];
  const repaired = await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.deepEqual([repaired.checked, repaired.updated, f.edits], [true, false, 0]);
  assert.equal(f.pr.body, 'Closes #1\n\nThis PR only plans the work: #2 and #3 stay open.');
  assert.match(logs.join('\n'), /kept open by the description: #2, #3/);
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker, null);

  // The lines an older repair appended are removed again instead of overriding the agent.
  f.pr.body += '\n\n---\n\nFixes #2\nFixes #3';
  f.linked = ['o/r#1', 'o/r#2', 'o/r#3'];
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker.reason, 'unintended_closing_references');
  const cleaned = await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.equal(cleaned.updated, true);
  assert.equal(f.pr.body, 'Closes #1\n\nThis PR only plans the work: #2 and #3 stay open.');
  assert.match(logs.at(-1), /Removed 2 closing reference\(s\).*o\/r#2, o\/r#3/);
  f.linked = ['o/r#1'];
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker, null);
});

test('a sub-issue the description does not mention is still required and repaired (#2335)', async () => {
  const context = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 10 };
  const f = fixture({ ...context, tree: { 'o/r#1': ['o/r#2', 'o/r#3'], 'o/r#2': [], 'o/r#3': [] }, body: 'Fixes #1\n\n#3 stays open.', linked: ['o/r#1'] });
  assert.deepEqual((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker.details, ['o/r#2']);
  assert.equal((await repairRequiredIssueLinks({ ...context, run: f.run })).updated, true);
  assert.equal(f.pr.body, 'Fixes #1\n\n#3 stays open.\n\n---\n\nFixes #2');
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker.reason, 'unverified_issue_links');
  f.linked = ['o/r#1', 'o/r#2'];
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker, null);
  // The primary issue stays required when it is only mentioned (#3282 keeps it open only on "Part of #1").
  f.pr.body = 'Related to #1. #2 and #3 stay open.';
  assert.equal((await repairRequiredIssueLinks({ ...context, run: f.run })).updated, true);
  assert.equal(f.pr.body, 'Related to #1. #2 and #3 stay open.\n\n---\n\nFixes #1');
});

test('keeping an umbrella child open also keeps its own sub-issues open (#3282)', () => {
  const issue = (number, ...parents) => ({ owner: 'o', repo: 'r', number, parents: parents.map(parent => `o/r#${parent}`) });
  const scope = [issue(1), issue(2, 1), issue(3, 1), issue(4, 2), issue(5, 2, 3), issue(6, 4)];
  const split = body => {
    const { required, deferred } = splitDescriptionScope(scope, body, { owner: 'o', repo: 'r' });
    return { required: required.map(item => item.number), deferred: deferred.map(item => item.number) };
  };
  assert.deepEqual(split('Fixes #1'), { required: [1, 2, 3, 4, 5, 6], deferred: [] });
  assert.deepEqual(split('Fixes #1. #2 stays open.'), { required: [1, 3, 5], deferred: [2, 4, 6] }, '#5 is still required through #3');
  assert.deepEqual(split('Fixes #1. #2 and #3 stay open.'), { required: [1], deferred: [2, 3, 4, 5, 6] });
  assert.deepEqual(split('Fixes #1. #2 stays open. Fixes #4'), { required: [1, 3, 4, 5, 6], deferred: [2] }, 'an explicit keyword wins over the parent');
  assert.deepEqual(split('Part of #1. Fixes #4'), { required: [4, 6], deferred: [1, 2, 3, 5] }, '"Part of" the primary keeps the whole umbrella open except what the PR closes');
});

test('#3276: hive-mind#3215 → formal-ai#1207 → 11 formal-ai sub-issues adds no foreign closing reference', async () => {
  const context = { owner: 'link-assistant', repo: 'hive-mind', issueNumber: 3215, prNumber: 3225 };
  const formalAi = [1189, 1201, 1203, 1204, 1205, 1206, 1208, 1209, 1210, 1211, 1153].map(number => `link-assistant/formal-ai#${number}`);
  const tree = { 'link-assistant/hive-mind#3215': ['link-assistant/hive-mind#3206', 'link-assistant/formal-ai#1207'], 'link-assistant/hive-mind#3206': [], 'link-assistant/formal-ai#1207': formalAi };
  const f = fixture({ ...context, tree, body: 'Formal AI Hello World.\n\nFixes #3215', linked: ['link-assistant/hive-mind#3215'] });
  const foreign = [];
  assert.deepEqual((await fetchRequiredIssueScope({ ...context, run: f.run, foreign })).map(issueKey), ['link-assistant/hive-mind#3215', 'link-assistant/hive-mind#3206']);
  assert.deepEqual(foreign.map(issueKey), ['link-assistant/formal-ai#1207'], 'other repositories are not walked');

  const logs = [];
  await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.equal(f.pr.body, 'Formal AI Hello World.\n\nFixes #3215\n\n---\n\nFixes #3206');
  assert.doesNotMatch(f.pr.body, /formal-ai/);
  assert.match(logs.join('\n'), /other repositories.*link-assistant\/formal-ai#1207/);

  // The description #3225 was merged with: the repair must take its foreign lines out again.
  f.pr.body = `Formal AI Hello World.\n\nFixes #3215\n\n---\n\nFixes #3206\nFixes link-assistant/formal-ai#1207\n${formalAi.map(key => `Fixes ${key}`).join('\n')}`;
  f.linked = ['link-assistant/hive-mind#3215', 'link-assistant/hive-mind#3206', 'link-assistant/formal-ai#1207', ...formalAi];
  const blocked = (await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker;
  assert.equal(blocked.reason, 'cross_repository_closing_references');
  assert.equal(blocked.details.length, 12);
  await repairRequiredIssueLinks({ ...context, run: f.run });
  assert.equal(f.pr.body, 'Formal AI Hello World.\n\nFixes #3215\n\n---\n\nFixes #3206');

  // A sidebar link GitHub reports still blocks the merge.
  f.linked = ['link-assistant/hive-mind#3215', 'link-assistant/hive-mind#3206', 'link-assistant/formal-ai#1207'];
  assert.deepEqual((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker.details, ['link-assistant/formal-ai#1207']);
  f.linked = ['link-assistant/hive-mind#3215', 'link-assistant/hive-mind#3206'];
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker, null);
});

test('a negated keyword GitHub still honours blocks the merge (link-assistant/calculator#261)', async () => {
  const context = { owner: 'o', repo: 'r', issueNumber: 247, prNumber: 261 };
  const f = fixture({ ...context, tree: { 'o/r#247': [] }, body: 'Fixes #247\n\nProbe for #247: this pull request does not close #258.', linked: ['o/r#247', 'o/r#258'] });
  const { blocker } = await checkIssueLinksBeforeMerge({ ...context, run: f.run });
  assert.equal(blocker.reason, 'unintended_closing_references');
  assert.deepEqual(blocker.details, ['o/r#258']);
  assert.match(blocker.resolution, /does not close/);
});

test('extractPartialIssueMentions: only explicit "part of" or "stays open" wording, own repository only', () => {
  const partial = text => [...extractPartialIssueMentions(text, 'o', 'r')].sort((a, b) => a - b);
  assert.deepEqual(partial('Part of #3282'), [3282]);
  assert.deepEqual(partial('part of issue o/r#5, towards https://github.com/o/r/issues/6 and progress on #7.'), [5, 6, 7]);
  assert.deepEqual(partial('#8 stays open. #9 and #10 remain open. #11 is kept open.'), [8, 9, 10, 11]);
  assert.deepEqual(partial('Related to #1. See #2. Part of other/project#3.'), [], 'a bare or foreign mention is not partial');
  assert.deepEqual(partial('Part of #4.\n\nFixes #4'), [], 'a positive keyword wins');
  assert.deepEqual(partial('`Part of #4` <!-- Part of #5 -->'), []);
});

/** The #3282 tree as of 2026-10-15, trimmed: two sub-issues, each with its own sub-issue. */
const umbrellaTree = { 'link-assistant/hive-mind#3282': ['link-assistant/hive-mind#3174', 'link-assistant/hive-mind#3215'], 'link-assistant/hive-mind#3174': ['link-assistant/hive-mind#3276'], 'link-assistant/hive-mind#3215': ['link-assistant/hive-mind#3206'], 'link-assistant/hive-mind#3276': [], 'link-assistant/hive-mind#3206': [] };

test('#3282: a PR that is "Part of" an umbrella closes only what it fixes, and earlier repair lines are removed', async () => {
  const context = { owner: 'link-assistant', repo: 'hive-mind', issueNumber: 3282, prNumber: 3295 };
  const head = 'Link repair fixes.\n\nFixes #3174\nPart of #3282';
  const f = fixture({ ...context, tree: umbrellaTree, body: head, linked: ['link-assistant/hive-mind#3174'] });
  const logs = [];
  const repaired = await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.equal(f.pr.body, `${head}\n\n---\n\nFixes #3276`, 'only the subtree of the fixed sub-issue is added');
  assert.equal(repaired.updated, true);
  assert.match(logs.join('\n'), /only partly done here, as the description says: #3282; sub-issues of issues kept open: #3215, #3206/);
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker.reason, 'unverified_issue_links');
  f.linked = ['link-assistant/hive-mind#3174', 'link-assistant/hive-mind#3276'];
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker, null);

  // What the v2.35.8 repair appended to #3295, and its merge closed: the guard refuses it and the repair takes it out.
  f.pr.body = `${head}\n\n---\n\nFixes #3282\nFixes #3215\nFixes #3206\nFixes #3276`;
  f.linked = ['link-assistant/hive-mind#3282', 'link-assistant/hive-mind#3174', 'link-assistant/hive-mind#3215', 'link-assistant/hive-mind#3206', 'link-assistant/hive-mind#3276'];
  const { blocker } = await checkIssueLinksBeforeMerge({ ...context, run: f.run });
  assert.equal(blocker.reason, 'unintended_closing_references');
  assert.deepEqual(blocker.details, ['link-assistant/hive-mind#3282', 'link-assistant/hive-mind#3215', 'link-assistant/hive-mind#3206']);
  await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.equal(f.pr.body, `${head}\n\n---\n\nFixes #3276`);
  assert.match(logs.join('\n'), /Removed 3 closing reference\(s\).*#3282, .*#3215, .*#3206/);

  // A PR that is part of the umbrella and fixes none of its issues requires nothing, but still must not close any.
  f.pr.body = 'Part of #3282';
  f.linked = [];
  assert.equal((await repairRequiredIssueLinks({ ...context, run: f.run })).updated, false);
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker, null);
  f.linked = ['link-assistant/hive-mind#3282'];
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker.reason, 'unintended_closing_references');
});

test('#3174: sub-issues created after the PR was opened (plan output) or already closed are not added', async () => {
  const context = { owner: 'o', repo: 'r', issueNumber: 227, prNumber: 228 };
  const tree = { 'o/r#227': ['o/r#229', 'o/r#236', 'o/r#237'], 'o/r#229': [], 'o/r#236': ['o/r#240'], 'o/r#237': [], 'o/r#240': [] };
  const issues = { 'o/r#229': { created_at: '2026-10-01T00:00:00Z' }, 'o/r#236': { created_at: '2026-10-07T10:00:00Z' }, 'o/r#237': { created_at: '2026-10-01T00:00:00Z', state: 'closed' }, 'o/r#240': { created_at: '2026-10-07T10:05:00Z' } };
  const f = fixture({ ...context, tree, issues, createdAt: '2026-10-07T09:00:00Z', body: 'Closes #227', linked: ['o/r#227'] });
  const logs = [];
  await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.equal(f.pr.body, 'Closes #227\n\n---\n\nFixes #229', 'only the sub-issue that existed, open, before the PR is required');
  assert.match(logs.join('\n'), /created after this pull request was opened: #236, #240; already closed: #237/);
  // An explicit keyword in the agent's text still makes a later sub-issue required, but not its own later sub-issues.
  f.pr.body = 'Closes #227. Fixes #236';
  await repairRequiredIssueLinks({ ...context, run: f.run });
  assert.equal(f.pr.body, 'Closes #227. Fixes #236\n\n---\n\nFixes #229');
  // Without a creation time for the PR nothing is deferred by time.
  delete f.pr.created_at;
  f.pr.body = 'Closes #227';
  await repairRequiredIssueLinks({ ...context, run: f.run });
  assert.equal(f.pr.body, 'Closes #227\n\n---\n\nFixes #229\nFixes #236\nFixes #240');
});

test("#3174: a sub-issue another open PR closes is that PR's work, including stacked PRs GitHub does not link", async () => {
  const context = { owner: 'link-assistant', repo: 'hive-mind', issueNumber: 3282, prNumber: 3390 };
  const tree = { 'link-assistant/hive-mind#3282': ['link-assistant/hive-mind#2406', 'link-assistant/hive-mind#2303', 'link-assistant/hive-mind#2846', 'link-assistant/hive-mind#2293'], 'link-assistant/hive-mind#2406': [], 'link-assistant/hive-mind#2303': [], 'link-assistant/hive-mind#2846': [], 'link-assistant/hive-mind#2293': [] };
  const claims = {
    // #2407 is stacked on another branch, so only its description links it.
    'link-assistant/hive-mind#2406': [
      { number: 2407, body: 'Fixes #2406' },
      { number: 3295, state: 'MERGED', body: 'Fixes #2406', linked: true },
    ],
    'link-assistant/hive-mind#2303': [{ number: 2304, body: 'Fixes #2303', linked: true }],
    // Neither a mention, nor a closed PR, nor this PR itself counts.
    'link-assistant/hive-mind#2846': [
      { number: 2852, body: 'Related to #2846' },
      { number: 2853, state: 'CLOSED', body: 'Fixes #2846' },
      { number: 3390, body: 'Fixes #2846', linked: true },
    ],
  };
  const f = fixture({ ...context, tree, claims, body: 'Umbrella work.\n\nFixes #3282', linked: ['link-assistant/hive-mind#3282'] });
  const logs = [];
  await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.equal(f.pr.body, 'Umbrella work.\n\nFixes #3282\n\n---\n\nFixes #2846\nFixes #2293');
  assert.match(logs.join('\n'), /closed by another open pull request: #2406 \(link-assistant\/hive-mind#2407\), #2303 \(link-assistant\/hive-mind#2304\)/);
  assert.equal(f.claimQueries, 1, 'one batched query for all candidates');
  // A stale repair line for a claimed issue blocks the merge until the repair removes it.
  f.pr.body += '\nFixes #2406';
  f.linked = ['link-assistant/hive-mind#3282', 'link-assistant/hive-mind#2846', 'link-assistant/hive-mind#2293', 'link-assistant/hive-mind#2406'];
  assert.deepEqual((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker.details, ['link-assistant/hive-mind#2406']);
  await repairRequiredIssueLinks({ ...context, run: f.run });
  assert.equal(f.pr.body, 'Umbrella work.\n\nFixes #3282\n\n---\n\nFixes #2846\nFixes #2293');
  f.linked = f.linked.slice(0, 3);
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker, null);
  // The agent can still take a claimed sub-issue over explicitly.
  f.pr.body = 'Umbrella work.\n\nFixes #3282. Fixes #2406';
  f.claimQueries = 0;
  await repairRequiredIssueLinks({ ...context, run: f.run });
  assert.equal(f.pr.body, 'Umbrella work.\n\nFixes #3282. Fixes #2406\n\n---\n\nFixes #2846\nFixes #2293');
  assert.equal(f.claimQueries, 1);
});

test('#3174: issues a repository-mode block lists stay required, and an unreadable claim fails closed', async () => {
  const context = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 10 };
  const f = fixture({ ...context, tree: { 'o/r#1': ['o/r#2', 'o/r#3'], 'o/r#2': [], 'o/r#3': [] }, issues: { 'o/r#2': { created_at: '2026-10-08T00:00:00Z' } }, claims: { 'o/r#3': [{ number: 11, body: 'Fixes #3' }] }, createdAt: '2026-10-07T00:00:00Z', body: 'Combined.\n\nFixes #1', linked: ['o/r#1'] });
  const run = f.run;
  f.run = async args => (args[0] === 'api' && args[1] === 'repos/o/r/issues/1' ? json({ number: 1, body: `${REPOSITORY_MODE_MARKER}\n${REQUIRED_CLOSING_REFERENCES_HEADING}\n\`\`\`\nFixes #2\nFixes #3\n\`\`\`` }) : run(args));
  const scope = await fetchRequiredIssueScope({ ...context, run: f.run });
  assert.deepEqual(
    scope.map(issue => issue.listed),
    [undefined, true, true]
  );
  await repairRequiredIssueLinks({ ...context, run: f.run });
  assert.equal(f.pr.body, 'Combined.\n\nFixes #1\n\n---\n\nFixes #2\nFixes #3');
  assert.equal(f.claimQueries, 0, 'listed issues need no claim lookup');

  // A failed claim lookup neither repairs nor lets the merge through.
  const failing = fixture({ ...context, tree: { 'o/r#1': ['o/r#2'], 'o/r#2': [] }, body: 'Fixes #1', linked: ['o/r#1'] });
  const broken = async args => (String(args.find(arg => String(arg).startsWith('query=')) || '').includes('closedByPullRequestsReferences') ? json({ data: { repository: { i2: null } } }) : failing.run(args));
  const logs = [];
  const result = await repairRequiredIssueLinks({ ...context, run: broken, logger: async message => logs.push(message) });
  assert.deepEqual([result.checked, failing.edits], [false, 0]);
  assert.match(logs.join('\n'), /Cannot read the pull requests that close o\/r#2/);
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: broken })).blocker.reason, 'issue_link_verification_failed');
});

test('#3174: a claim among the newest cross-references of a busy issue is found past the first 100', async () => {
  const pull = (number, state, body) => ({ source: { number, state, body, url: `https://github.com/o/r/pull/${number}`, repository: { nameWithOwner: 'o/r' } } });
  const queries = [];
  const run = async args => {
    const query = String(args.find(arg => String(arg).startsWith('query=')));
    const after = args.find(arg => String(arg).startsWith('after='));
    queries.push(after ?? 'first');
    const old = Array.from({ length: 100 }, (_, index) => pull(1000 + index, 'MERGED', 'Fixes #2'));
    const timelineItems = !after ? { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: old } : after === 'after=c1' ? { pageInfo: { hasNextPage: true, endCursor: 'c2' }, nodes: [pull(9, 'OPEN', 'Mentions #2 only')] } : { pageInfo: { hasNextPage: false, endCursor: 'c3' }, nodes: [pull(12, 'OPEN', 'Fixes #2')] };
    assert.equal(query.includes('after:$after'), Boolean(after));
    const node = after ? { timelineItems } : { closedByPullRequestsReferences: { nodes: [] }, timelineItems };
    return { code: 0, stdout: JSON.stringify({ data: { repository: after ? { issue: node } : { i2: node } } }) };
  };
  const claims = await fetchOtherPullRequestClaims({ owner: 'o', repo: 'r', prNumber: 5, issues: [{ owner: 'o', repo: 'r', number: 2 }], run });
  assert.deepEqual([...claims], [['o/r#2', ['o/r#12']]]);
  assert.deepEqual(queries, ['first', 'after=c1', 'after=c2']);
  const empty = async args => (args.some(arg => String(arg).startsWith('after=')) ? { code: 0, stdout: JSON.stringify({ data: { repository: { issue: null } } }) } : run(args));
  await assert.rejects(fetchOtherPullRequestClaims({ owner: 'o', repo: 'r', prNumber: 5, issues: [{ owner: 'o', repo: 'r', number: 2 }], run: empty }), /Cannot read the pull requests that close o\/r#2/);
});
