#!/usr/bin/env node
/**
 * Issue #3174, second part: the link repair respects the agent's decisions.
 *
 * - "#236 to #246 stay open", "#2 and #3 stay open" keep every listed issue open.
 * - A closing line an earlier repair added and the session then removed is not
 *   added back; the conflict is logged and the merge guard keeps the merge
 *   blocked until a human decides.
 * - GitHub closes "does not close #2" (link-assistant/calculator#261), so the
 *   repair warns about negated keywords and the guard refuses such a merge.
 * - The link-assistant/calculator#227 plan PR, with its own wording.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { checkIssueLinksBeforeMerge } from '../src/issue-link-verification.lib.mjs';
import { repairRequiredIssueLinks } from '../src/pr-issue-link-repair.lib.mjs';
import { extractClosingIssueReferences, extractNegatedClosingReferences, extractOpenIssueMentions, extractPartialIssueMentions } from '../src/github-linking.lib.mjs';
import { selectIntendedIssues } from '../src/post-merge-issue-closing.lib.mjs';
import { REPOSITORY_MODE_MARKER, REQUIRED_CLOSING_REFERENCES_HEADING } from '../src/solve.repository-mode.lib.mjs';

const json = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const sorted = set => [...set].sort((a, b) => a - b);
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => first + index);

/**
 * A GitHub fixture that, like GitHub, records every description revision in
 * the pull request's userContentEdits (newest first). `agentEdit` is a session
 * rewriting the description.
 */
function fixture({ owner = 'o', repo = 'r', prNumber, tree, body, linked = [], issues = {}, createdAt, primaryBody = '' }) {
  const pr = { number: prNumber, body, head: { sha: 'a'.repeat(40), ref: 'feature' }, base: { ref: 'main' }, ...(createdAt && { created_at: createdAt }) };
  const state = { pr, linked, edits: 0, history: [body], historyQueries: 0, comments: [] };
  state.agentEdit = text => {
    pr.body = text;
    state.history.push(text);
  };
  state.run = async args => {
    if (args[0] === 'pr' && args[1] === 'edit') {
      state.edits++;
      state.agentEdit(await readFile(args[args.indexOf('--body-file') + 1], 'utf8'));
      return json({});
    }
    if (args[0] === 'pr' && args[1] === 'comment') {
      state.comments.push(await readFile(args[args.indexOf('--body-file') + 1], 'utf8'));
      return json({});
    }
    const endpoint = args[1];
    if (endpoint === `repos/${owner}/${repo}/issues/${prNumber}/comments`) return json([state.comments.map(text => ({ body: text }))]);
    const query = args.find(arg => String(arg).startsWith('query=')) || '';
    if (endpoint === 'graphql' && query.includes('userContentEdits')) {
      state.historyQueries++;
      const nodes = [...state.history].reverse().map(diff => ({ diff }));
      return json([{ data: { repository: { pullRequest: { userContentEdits: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } } }]);
    }
    if (endpoint === 'graphql' && query.includes('closedByPullRequestsReferences')) {
      const nodes = Object.fromEntries([...query.matchAll(/\bi(\d+): issue/g)].map(([, number]) => [`i${number}`, { closedByPullRequestsReferences: { nodes: [] }, timelineItems: { nodes: [] } }]));
      return json({ data: { repository: nodes } });
    }
    if (endpoint === 'graphql') return json([{ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: state.linked.map(number => ({ number, repository: { nameWithOwner: `${owner}/${repo}` } })) } } } } }]);
    if (endpoint === `repos/${owner}/${repo}`) return json({ default_branch: 'main' });
    if (endpoint === `repos/${owner}/${repo}/pulls/${prNumber}`) return json(pr);
    const match = endpoint.match(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)(\/sub_issues)?$/);
    const number = match && Number(match[1]);
    assert.ok(number in tree, `unexpected gh ${args.join(' ')}`);
    if (!match[2]) return json({ number, body: number === Number(Object.keys(tree)[0]) ? primaryBody : '', state: 'open', ...issues[number] });
    return json([tree[number].map(child => ({ number: child, repository_url: `https://api.github.com/repos/${owner}/${repo}` }))]);
  };
  return state;
}

test('(a) "stay open" keeps every issue of a range or a list open', () => {
  const partial = text => sorted(extractPartialIssueMentions(text, 'o', 'r'));
  assert.deepEqual(partial('#236 to #246 stay open'), range(236, 246));
  assert.deepEqual(partial('Merging this PR closes only #227. The open sub-issues #236 to #246 stay open.'), range(236, 246));
  assert.deepEqual(partial('#2–#4 stay open. #7..#8 remain open.'), [2, 3, 4, 7, 8]);
  assert.deepEqual(partial('#2 and #3 stay open'), [2, 3]);
  assert.deepEqual(partial('#2, #3 stay open'), [2, 3]);
  assert.deepEqual(partial('#2, #3, and o/r#4 remain open; #5 & #6 are kept open.'), [2, 3, 4, 5, 6]);
  assert.deepEqual(partial('Part of #3174 and #3282'), [3174, 3282]);
  assert.deepEqual(partial('Fixes #2 and #3 stays open'), [3], 'a positive keyword still wins');
  assert.deepEqual(partial('#1 is done and #2 stays open.'), [2], 'an issue before other words is not part of the list');
  assert.deepEqual(partial('#2, other/project#3 and #4 stay open'), [2, 4], 'other repositories are ignored');
  assert.deepEqual(partial('#1 to #9999 stay open'), [1, 9999], 'huge ranges are not expanded');
});

test('(c) negated closing keywords are reported, not treated as positive', () => {
  const negated = text => extractNegatedClosingReferences(text, 'o', 'r').map(({ number, phrase }) => [number, phrase]);
  assert.deepEqual(negated('Probe for #247: this pull request does not close #258.'), [['258', 'does not close #258']]);
  assert.deepEqual(negated("This doesn't fix #2, and it won't resolve o/r#3. Never closes #4"), [
    ['2', "doesn't fix #2"],
    ['3', "won't resolve o/r#3"],
    ['4', 'Never closes #4'],
  ]);
  assert.deepEqual(negated('Fixes #2. This does not close #3 but fixes #4.'), [['3', 'does not close #3']]);
  assert.deepEqual(negated('This does not close #2. Fixes #2'), [], 'an issue the description also closes is not reported');
  assert.deepEqual(negated('`does not close #2` <!-- does not close #3 --> Not closing #4.'), [], 'code, comments and "closing" (no GitHub keyword) are not reported');
  assert.deepEqual(extractClosingIssueReferences('This PR does not close #2. Fixes #3'), [{ owner: null, repo: null, number: '3' }], 'the positive parser is unchanged');
  assert.deepEqual(sorted(extractOpenIssueMentions('This PR does not close #2.', 'o', 'r')), [2], 'a negated keyword keeps the issue open for the repair and post-merge closing');
  const snapshot = { repository: { owner: 'o', repo: 'r' }, pr: { body: 'Fixes #1. This PR does not close #2.' }, issues: [1, 2].map(number => ({ owner: 'o', repo: 'r', number })) };
  const { intended, skippedKeptOpen } = selectIntendedIssues(snapshot);
  assert.deepEqual([intended.map(issue => issue.number), skippedKeptOpen], [[1], [{ key: 'o/r#2', reason: 'description' }]], 'post-merge closing keeps #2 open');
});

test('(c) the repair warns about a negated keyword and does not add a closing line; the guard refuses the merge GitHub would close it with', async () => {
  const context = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 10 };
  const body = "Fixes #1\n\nThis PR does not close #2, and it doesn't fix #9.";
  const f = fixture({ prNumber: 10, tree: { 1: [2, 3], 2: [], 3: [] }, body, linked: [1, 2, 3, 9] });
  const logs = [];
  await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.equal(f.pr.body, `${body}\n\n---\n\nFixes #3`);
  assert.match(logs.join('\n'), /'does not close #2' still closes #2 on GitHub; write '#2 stays open' instead/);
  assert.match(logs.join('\n'), /'doesn't fix #9' still closes #9 on GitHub; write '#9 stays open' instead/);
  assert.match(logs.join('\n'), /kept open by the description: #2/);
  const { blocker } = await checkIssueLinksBeforeMerge({ ...context, run: f.run });
  assert.equal(blocker.reason, 'unintended_closing_references');
  assert.deepEqual(blocker.details, ['o/r#2', 'o/r#9']);
  f.agentEdit(`Fixes #1\n\n#2 stays open.\n\n---\n\nFixes #3`);
  f.linked = [1, 3];
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker, null);
});

test('(b) a closing line the session removed after an earlier repair added it is not re-added', async () => {
  const context = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 10 };
  const f = fixture({ prNumber: 10, tree: { 1: [2, 3], 2: [], 3: [] }, body: 'Agent text. Fixes #1', linked: [1] });
  const logs = [];
  await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.equal(f.pr.body, 'Agent text. Fixes #1\n\n---\n\nFixes #2\nFixes #3', 'the first repair adds both sub-issues');

  // The next session rewrites the description and drops "Fixes #3" without saying why.
  f.agentEdit('Fixes #1\n\nRewritten by the session.\n\n---\n\nFixes #2');
  f.linked = [1, 2];
  const result = await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.deepEqual([result.checked, result.updated, result.conflicts], [true, false, ['o/r#3']]);
  assert.equal(f.pr.body, 'Fixes #1\n\nRewritten by the session.\n\n---\n\nFixes #2', 'the agent is not undone');
  assert.match(logs.join('\n'), /⚠️ #3 was removed from the description by the session; not re-adding its closing reference/);
  // The conflict is said on the pull request once, since the session summary is posted before the repair runs.
  assert.equal(f.comments.length, 1);
  assert.match(f.comments[0], /<!-- hive-mind:closing-references-left-out o\/r#3 -->/);
  assert.match(f.comments[0], /Closing references left out[\s\S]*#3[\s\S]*will not close that issue/);
  await repairRequiredIssueLinks({ ...context, run: f.run });
  assert.equal(f.comments.length, 1, 'the same conflict is not reported twice');
  // The guard keeps the merge blocked, so a human sees the conflict.
  const { blocker } = await checkIssueLinksBeforeMerge({ ...context, run: f.run });
  assert.equal(blocker.reason, 'missing_closing_references');
  assert.deepEqual(blocker.details, ['o/r#3']);

  // The primary issue is still restored (#2335), and a removed sub-issue line stays out.
  f.agentEdit('Rewritten again.');
  await repairRequiredIssueLinks({ ...context, run: f.run });
  assert.equal(f.pr.body, 'Rewritten again.\n\n---\n\nFixes #1');
  assert.equal(f.comments.length, 2, 'a session that drops another sub-issue is a new conflict');
  assert.match(f.comments[1], /closing-references-left-out o\/r#2 o\/r#3 -->/);
  // Saying in the description that the issue stays open settles it.
  f.agentEdit('Fixes #1. #2 and #3 stay open.');
  f.linked = [1];
  assert.deepEqual((await repairRequiredIssueLinks({ ...context, run: f.run })).conflicts, []);
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker, null);
  assert.equal(f.comments.length, 2, 'no notice without a conflict');
});

test('(b) a never-repaired sub-issue is still added, repository-mode issues are always restored, and an unreadable history fails closed', async () => {
  const context = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 10 };
  const f = fixture({ prNumber: 10, tree: { 1: [2], 2: [] }, body: 'Agent text. Fixes #1\n\n---\n\nFixes #9', linked: [1] });
  f.agentEdit('Agent text. Fixes #1');
  await repairRequiredIssueLinks({ ...context, run: f.run });
  assert.equal(f.pr.body, 'Agent text. Fixes #1\n\n---\n\nFixes #2', 'only lines that closed this issue count');
  assert.equal(f.historyQueries, 1);
  assert.equal((await repairRequiredIssueLinks({ ...context, run: f.run })).updated, false);
  assert.equal(f.historyQueries, 1, 'the history is read only when a sub-issue line is missing');

  const primaryBody = `${REPOSITORY_MODE_MARKER}\n${REQUIRED_CLOSING_REFERENCES_HEADING}\n\`\`\`\nFixes #2\n\`\`\``;
  const listed = fixture({ prNumber: 10, tree: { 1: [], 2: [] }, primaryBody, body: 'Agent text. Fixes #1\n\n---\n\nFixes #2', linked: [1] });
  listed.agentEdit('Agent text. Fixes #1');
  await repairRequiredIssueLinks({ ...context, run: listed.run });
  assert.equal(listed.pr.body, 'Agent text. Fixes #1\n\n---\n\nFixes #2', 'a repository-mode block (#2212) wins over the removal');
  assert.equal(listed.historyQueries, 0);

  const broken = fixture({ prNumber: 10, tree: { 1: [2], 2: [] }, body: 'Agent text. Fixes #1', linked: [1] });
  const run = async args => (String(args.find(arg => String(arg).startsWith('query=')) || '').includes('userContentEdits') ? json([{ data: { repository: { pullRequest: null } } }]) : broken.run(args));
  const logs = [];
  const result = await repairRequiredIssueLinks({ ...context, run, logger: async message => logs.push(message) });
  assert.deepEqual([result.checked, broken.edits], [false, 0]);
  assert.match(logs.join('\n'), /Cannot read the description history of PR #10/);
});

test('(d) link-assistant/calculator#227: the plan PR wording keeps #229 to #246 open and the guard passes', async () => {
  const context = { owner: 'link-assistant', repo: 'calculator', issueNumber: 227, prNumber: 228 };
  const subIssues = range(229, 246);
  const tree = { 227: subIssues, ...Object.fromEntries(subIssues.map(number => [number, []])) };
  // Created at 09:27:30Z on 2026-10-07; the plan created the sub-issues during the session.
  const issues = Object.fromEntries(subIssues.map(number => [number, { created_at: `2026-10-07T09:${30 + (number - 229)}:00Z` }]));
  const primaryBody = "Analyse the problem and plan every required issue as a sub-issue. This issue's own result is the analysis and issue creation.";
  const head = 'Closes #227\n\nMerging this PR closes only #227. The open sub-issues #236 to #246 stay open, so this description deliberately has no Fixes lines for them.';
  const f = fixture({ ...context, tree, issues, primaryBody, createdAt: '2026-10-07T09:27:30Z', body: head, linked: [227] });
  const logs = [];
  const repaired = await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.deepEqual([repaired.checked, repaired.updated, f.edits], [true, false, 0]);
  for (const number of subIssues) assert.doesNotMatch(f.pr.body, new RegExp(`#${number}\\b(?![^\\n]*stay open)`), `#${number} must not be added`);
  assert.match(logs.join('\n'), /created after this pull request was opened: #229, .*#235; kept open by the description: #236, .*#246/);
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker, null);

  // What v2.35.8 did: the repair appended #229 to #246, and the session removed them again.
  const repairLines = subIssues.map(number => `Fixes #${number}`).join('\n');
  f.agentEdit(`${head}\n\n---\n\n${repairLines}`);
  f.agentEdit(head);
  // Even without the creation times, nothing the session removed comes back.
  delete f.pr.created_at;
  const again = await repairRequiredIssueLinks({ ...context, run: f.run, logger: async message => logs.push(message) });
  assert.deepEqual([again.updated, f.pr.body], [false, head]);
  assert.deepEqual(
    again.conflicts,
    range(229, 235).map(number => `link-assistant/calculator#${number}`)
  );
  assert.match(logs.join('\n'), /⚠️ #229 was removed from the description by the session; not re-adding its closing reference/);
  // Those seven are then a conflict for a human: the guard does not let the merge through silently.
  assert.equal((await checkIssueLinksBeforeMerge({ ...context, run: f.run })).blocker.reason, 'missing_closing_references');
});
