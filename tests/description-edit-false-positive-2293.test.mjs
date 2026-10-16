/**
 * Issue #2293: an auto-restart was triggered by an "issue description edited"
 * event that never happened.
 *
 * The old check treated `updated_at > last commit` as a description edit, but
 * GitHub bumps `updated_at` for comments, labels, cross-references and pull
 * request creation. Real incidents (timestamps are the real ones):
 *   - link-foundation/relative-meta-logic issue 183 has 0 edits in its history,
 *     yet runs on its pull request 184 reported "Issue description edited";
 *   - link-foundation/meta-language pull request 196 got "Pull request
 *     description was edited after last commit" at 2026-09-24T18:30Z, while the
 *     only edit after the last commit was made by the previous solver session
 *     (same `konard` account) and `updated_at` was bumped by a human comment.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSolverSessionWindows, classifyContentEdits, formatEditEvidence, parseContentEdits } from '../src/description-edits.lib.mjs';
import { detectAndCountFeedback } from '../src/solve.feedback.lib.mjs';
import { checkForIssueMetadataChanges } from '../src/solve.auto-merge-helpers.lib.mjs';

const OWNER = 'link-foundation';
const REPO = 'meta-language';
const PR = 196;
const ISSUE = 195;
const LAST_COMMIT = '2026-09-24T02:41:14Z';
const WORK_START = '2026-09-24T18:30:11Z';

const response = value => ({ code: 0, stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), stderr: Buffer.from('') });
const commandText = (strings, values) => strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');

const comment = (id, createdAt, body, login = 'konard') => ({ id: 2293000 + id, created_at: createdAt, body, user: { login } });
// Real comment timeline of meta-language#196 around the incident.
const PR_196_COMMENTS = [comment(1, '2026-09-23T20:34:20Z', '🤖 **AI Work Session Started**\n\nStarting automated work session at 2026-09-23T20:34:18.000Z'), comment(2, '2026-09-24T03:13:38Z', '## 🤖 Solution Draft Log\n\nThis log file contains the complete execution trace of the AI solution draft process.'), comment(3, '2026-09-24T03:16:27Z', '## ✅ Ready to merge\n\nThis pull request is now ready to be merged.'), comment(4, '2026-09-24T18:24:36Z', '## Required correction: deliver the actual capabilities, not a green report')];

const BODY_V1 = '## Summary\n\nImplements the CST pipeline.\n\nFixes #195';
const BODY_V2 = '## Summary\n\nImplements the CST pipeline.\n\n### Verification\n- 189 requirement checks\n\nFixes #195';
const BODY_V3 = `${BODY_V2}\n\nPlease also support Kotlin.`;

const edit = (editedAt, diff, login = 'konard', typename = 'User') => ({ editedAt, diff, editor: { __typename: typename, login } });
const editsPayload = ({ createdAt, edits = [], renames = [] }) => ({
  data: { repository: { issueOrPullRequest: { __typename: 'PullRequest', createdAt, lastEditedAt: edits[0]?.editedAt || null, userContentEdits: { totalCount: edits.length, nodes: edits }, timelineItems: { nodes: renames } } } },
});
const PR_CREATED = '2026-09-23T10:00:00Z';
const ISSUE_NO_EDITS = editsPayload({ createdAt: '2026-09-20T14:31:31Z' });

/** Minimal GitHub double. REST `updated_at` is bumped (after the last commit) everywhere, as in the incidents. */
const createGitHub = ({ prEdits, issueEdits = ISSUE_NO_EDITS, comments = PR_196_COMMENTS, prNumber = PR, issueNumber = ISSUE }) => {
  const calls = [];
  const $ = async (strings, ...values) => {
    const command = commandText(strings, values);
    calls.push(command);
    if (command.startsWith('git log')) return response(LAST_COMMIT);
    if (command === 'gh api user --jq .login') return response('konard\n');
    if (command === `gh api repos/${OWNER}/${REPO}/issues/${prNumber}/comments --paginate`) return response(comments);
    if (command.startsWith('gh api graphql')) {
      if (command.endsWith(`-F number=${prNumber}`)) return response(prEdits);
      if (command.endsWith(`-F number=${issueNumber}`)) return response(issueEdits);
    }
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/${prNumber}` || command === `gh api repos/${OWNER}/${REPO}/issues/${issueNumber}`) return response({ updated_at: '2026-09-24T18:24:36Z' });
    if (command === `gh api repos/${OWNER}/${REPO}`) return response({ default_branch: 'main' });
    return response('[]');
  };
  return { $, calls };
};

const runFeedback = async ({ $, prNumber = PR, issueNumber = ISSUE, logs = [] }) =>
  detectAndCountFeedback({
    prNumber,
    branchName: 'issue-195-cc10e17ab860',
    owner: OWNER,
    repo: REPO,
    issueNumber,
    isContinueMode: true,
    argv: { verbose: true },
    mergeStateStatus: 'CLEAN',
    prState: 'OPEN',
    workStartTime: WORK_START,
    log: async message => logs.push(String(message)),
    formatAligned: (icon, label, value) => `${icon} ${label} ${value ?? ''}`,
    cleanErrorMessage: error => error.message,
    $,
  });

const editFeedback = result => result.feedbackLines.filter(line => /edited/.test(line));

test('a bumped updated_at with no edit history is not a description edit (relative-meta-logic issue 183)', async () => {
  const github = createGitHub({ prEdits: editsPayload({ createdAt: PR_CREATED }) });
  const result = await runFeedback({ $: github.$ });
  assert.deepEqual(editFeedback(result), []);
  assert.ok(!result.feedbackLines.some(line => /description was edited/.test(line)), result.feedbackLines.join('\n'));
});

test("an edit made by the previous solver session is the solver's own (meta-language pull request 196)", async () => {
  const github = createGitHub({ prEdits: editsPayload({ createdAt: PR_CREATED, edits: [edit('2026-09-24T02:56:07Z', BODY_V2), edit(PR_CREATED, BODY_V1)] }) });
  const logs = [];
  const result = await runFeedback({ $: github.$, logs });
  assert.deepEqual(editFeedback(result), []);
  assert.ok(
    logs.some(line => /Ignored PR #196 description edited at 2026-09-24T02:56:07.000Z by konard/.test(line) && /solver session/.test(line)),
    logs.join('\n')
  );
});

test('a pull request the same run created seconds earlier is not reported as edited', async () => {
  const created = '2026-09-24T18:29:40Z';
  const github = createGitHub({ comments: [], prEdits: editsPayload({ createdAt: created, edits: [edit('2026-09-24T18:29:52Z', BODY_V2), edit(created, BODY_V1)] }) });
  const result = await runFeedback({ $: github.$ });
  assert.deepEqual(editFeedback(result), []);
});

test('a real human edit after the last commit is feedback, with evidence', async () => {
  const github = createGitHub({
    prEdits: editsPayload({ createdAt: PR_CREATED, edits: [edit('2026-09-24T18:20:00Z', BODY_V3), edit('2026-09-24T02:56:07Z', BODY_V2), edit(PR_CREATED, BODY_V1)] }),
    issueEdits: editsPayload({ createdAt: '2026-09-20T14:31:31Z', edits: [edit('2026-09-24T18:00:00Z', 'new issue body', 'maintainer'), edit('2026-09-20T14:31:31Z', 'old issue body', 'maintainer')] }),
  });
  const result = await runFeedback({ $: github.$ });
  const lines = editFeedback(result);
  assert.ok(lines.includes('Pull request description was edited after last commit:'), lines.join('\n'));
  assert.ok(lines.includes('Issue description was edited after last commit:'), lines.join('\n'));
  assert.ok(
    result.feedbackLines.some(line => /description edited at 2026-09-24T18:20:00.000Z by konard: \+2\/-0 lines \(\+ Please also support Kotlin\.\)/.test(line)),
    result.feedbackLines.join('\n')
  );
});

test('without a separate linked issue (issueNumber === prNumber) the pull request is not checked again as its own issue', async () => {
  const github = createGitHub({ prNumber: 184, issueNumber: 184, prEdits: editsPayload({ createdAt: PR_CREATED }) });
  const result = await runFeedback({ $: github.$, prNumber: 184, issueNumber: 184 });
  assert.deepEqual(editFeedback(result), []);
  assert.equal(github.calls.filter(command => command.startsWith('gh api graphql')).length, 1);
});

test('session windows: PR creation opens the first one, another human or a bot inside a window is classified correctly', () => {
  const windows = buildSolverSessionWindows(PR_196_COMMENTS, { openedAt: PR_CREATED });
  assert.ok(windows.length >= 1);
  const edits = parseContentEdits(editsPayload({ createdAt: PR_CREATED, edits: [edit('2026-09-24T02:59:00Z', BODY_V3, 'github-actions[bot]', 'Bot'), edit('2026-09-24T02:58:00Z', BODY_V2, 'maintainer'), edit('2026-09-24T02:56:07Z', BODY_V2), edit(PR_CREATED, BODY_V1)] }).data.repository.issueOrPullRequest);
  // The original body (editedAt === createdAt) is not an edit.
  assert.equal(edits.length, 3);
  const { external, ignored } = classifyContentEdits({ edits, since: LAST_COMMIT, until: WORK_START, windows, currentUser: 'konard' });
  assert.deepEqual(
    external.map(item => item.editor),
    ['maintainer']
  );
  assert.deepEqual(ignored.map(item => item.edit.editor).sort(), ['github-actions[bot]', 'konard']);
  assert.match(formatEditEvidence(external[0]), /description edited at 2026-09-24T02:58:00.000Z by maintainer/);
});

test('title renames are read from the timeline and reported with from/to', () => {
  const node = editsPayload({ createdAt: PR_CREATED, renames: [{ createdAt: '2026-09-24T18:00:00Z', actor: { __typename: 'User', login: 'maintainer' }, previousTitle: 'Old', currentTitle: 'New' }] }).data.repository.issueOrPullRequest;
  const { external } = classifyContentEdits({ edits: parseContentEdits(node), since: LAST_COMMIT, until: WORK_START, windows: [], currentUser: 'konard' });
  assert.equal(external.length, 1);
  assert.equal(formatEditEvidence(external[0]), 'title edited at 2026-09-24T18:00:00.000Z by maintainer: "Old" → "New"');
});

test('the auto-restart loop does not watch the pull request itself as its "issue" (issueNumber === prNumber)', async () => {
  let body = BODY_V1;
  const calls = [];
  const runner = async (strings, ...values) => {
    calls.push(commandText(strings, values));
    return response({ title: 'PR title', body });
  };
  const first = await checkForIssueMetadataChanges(OWNER, 'relative-meta-logic', 184, null, false, runner, { pullRequestNumber: 184 });
  body = BODY_V2; // the AI rewrites its own pull request description
  const second = await checkForIssueMetadataChanges(OWNER, 'relative-meta-logic', 184, first.snapshot, false, runner, { pullRequestNumber: 184 });
  assert.equal(second.changed, false);
  assert.deepEqual(calls, []);
  // A separate linked issue is still watched.
  const baseline = await checkForIssueMetadataChanges(OWNER, 'relative-meta-logic', 183, null, false, runner, { pullRequestNumber: 184 });
  body = BODY_V3;
  const changed = await checkForIssueMetadataChanges(OWNER, 'relative-meta-logic', 183, baseline.snapshot, false, runner, { pullRequestNumber: 184 });
  assert.equal(changed.changed, true);
});
