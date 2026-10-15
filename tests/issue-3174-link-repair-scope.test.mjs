#!/usr/bin/env node
/**
 * Issues #3174 and #3276: the post-session link repair must not add (or keep)
 * closing references for sub-issues the description keeps open, nor for
 * sub-issues in other repositories, and the merge guard must refuse a merge
 * that GitHub would use to close such issues.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { checkIssueLinksBeforeMerge, fetchRequiredIssueScope, issueKey, splitDescriptionScope, splitRepairBlock } from '../src/issue-link-verification.lib.mjs';
import { repairRequiredIssueLinks } from '../src/pr-issue-link-repair.lib.mjs';
import { extractOpenIssueMentions } from '../src/github-linking.lib.mjs';

const json = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const linkPage = keys => ({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: keys.map(key => ({ number: Number(key.split('#')[1]), repository: { nameWithOwner: key.split('#')[0] } })) } } } } });

/**
 * A finite GitHub fixture: `tree` maps "owner/repo#N" to its sub-issue keys,
 * `linked` is what GitHub's closingIssuesReferences returns for the PR.
 */
function fixture({ owner, repo, prNumber, tree, body, linked = [] }) {
  const pr = { number: prNumber, body, head: { sha: 'a'.repeat(40), ref: 'feature' }, base: { ref: 'main' } };
  const state = { pr, linked, edits: 0 };
  state.run = async args => {
    if (args[0] === 'pr' && args[1] === 'edit') {
      state.edits++;
      pr.body = await readFile(args[args.indexOf('--body-file') + 1], 'utf8');
      return json({});
    }
    const endpoint = args[1];
    if (endpoint === 'graphql') return json([linkPage(state.linked)]);
    if (endpoint === `repos/${owner}/${repo}`) return json({ default_branch: 'main' });
    if (endpoint === `repos/${owner}/${repo}/pulls/${prNumber}`) return json(pr);
    const match = endpoint.match(/^repos\/([^/]+)\/([^/]+)\/issues\/(\d+)(\/sub_issues)?$/);
    const key = match && `${match[1]}/${match[2]}#${match[3]}`;
    assert.ok(key && key in tree, `unexpected gh ${args.join(' ')}`);
    if (!match[4]) return json({ number: Number(match[3]), body: '' });
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
  assert.match(logs.join('\n'), /keeps these sub-issues open.*#2, #3/);
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
  // The primary issue is always required, even when it is only mentioned.
  f.pr.body = 'Part of #1. #2 and #3 stay open.';
  assert.equal((await repairRequiredIssueLinks({ ...context, run: f.run })).updated, true);
  assert.equal(f.pr.body, 'Part of #1. #2 and #3 stay open.\n\n---\n\nFixes #1');
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
  assert.deepEqual(split('Part of #1. #2 stays open. Fixes #4'), { required: [1, 3, 4, 5, 6], deferred: [2] }, 'an explicit keyword wins over the parent');
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
