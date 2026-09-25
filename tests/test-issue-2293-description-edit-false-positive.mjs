#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression tests for issue #2293: "Auto-restart triggered, yet no actual
 * issue description was edited".
 *
 * Incidents (timestamps below are the real ones):
 *   - link-foundation/meta-language#196: at 2026-09-24T18:30Z the solver told
 *     the AI "Pull request description was edited after last commit". The only
 *     edit after the last commit (02:41:14Z) was made at 02:56:07Z by the
 *     previous AI work session (started 2026-09-23T20:34:20Z, "Ready to merge"
 *     at 03:16:27Z) - the solver and the human share the `konard` login.
 *   - link-foundation/relative-meta-logic#184: the PR had no "Fixes #N", so
 *     solve fell back to issueNumber = prNumber, wrote "Fixes #184" into the
 *     PR body, and from then on reported the PR's own AI-made title/description
 *     edits as "Issue description was edited" (issue #183 itself has 0 edits;
 *     its `updated_at` only moves with comments and cross-references).
 *
 * Covered:
 *   A. a PR body edit made by the solver (inside its session window) -> no feedback;
 *   B. a real human edit -> feedback, with evidence (timestamp, editor, diff excerpt);
 *   C. an issue whose updated_at was bumped but has 0 userContentEdits -> no feedback;
 *   D. issueNumber === prNumber -> the PR is not checked a second time as "the issue",
 *      no "Fixes #<own number>" self-link is written;
 *   E. session windows: PR creation opens the first session, "limit reached" does not
 *      open one, a different human editing inside a window is still feedback, bots never are;
 *   F. restart comments carry evidence: failing check names and run URLs.
 */

import assert from 'node:assert/strict';

import { buildSolverSessionWindows, classifyContentEdits, parseContentEdits, summarizeBodyDiff } from '../src/description-edits.lib.mjs';
import { buildAutoRestartCommentBody, buildCiEvidence, buildIssueEditEvidence, ciFailureSignature } from '../src/restart-evidence.lib.mjs';
import { detectAndCountFeedback } from '../src/solve.feedback.lib.mjs';
import { ensurePullRequestIssueLink } from '../src/solve.results.lib.mjs';
import { resetTrackedToolCommentIds } from '../src/tool-comments.lib.mjs';

const response = value => ({
  code: 0,
  stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  stderr: Buffer.from(''),
});
const commandText = (strings, values) => strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');
const noop = async () => {};

const OWNER = 'link-foundation';
const REPO = 'meta-language';
const PR = 196;
const ISSUE = 195;

// Real comment timeline of meta-language#196 around the incident.
const comment = (id, createdAt, body, login = 'konard') => ({ id, created_at: createdAt, body, user: { login }, html_url: `https://github.com/${OWNER}/${REPO}/pull/${PR}#issuecomment-${id}` });
const PR_196_COMMENTS = [comment(1, '2026-09-23T20:21:17Z', '## Maintainer directive: complete the entire scope in this PR'), comment(2, '2026-09-23T20:34:20Z', '🤖 **AI Work Session Started**\n\nStarting automated work session at 2026-09-23T20:34:18.000Z'), comment(3, '2026-09-24T03:12:04Z', '<!-- hive-mind:working-session-summary -->\n## Working session summary'), comment(4, '2026-09-24T03:13:38Z', '## 🤖 Solution Draft Log\n\nThis log file contains the complete execution trace'), comment(5, '2026-09-24T03:16:27Z', '## ✅ Ready to merge\n\nThis pull request is now ready to be merged'), comment(6, '2026-09-24T18:24:36Z', '## Required correction: deliver the actual capabilities, not a green report')];
const LAST_COMMIT = '2026-09-24T02:41:14Z';
const WORK_START = '2026-09-24T18:30:11Z';

const BODY_V1 = '## Summary\n\nImplements the CST pipeline.\n\nFixes #195';
const BODY_V2 = '## Summary\n\nImplements the CST pipeline.\n\n### Verification\n- 189 requirement checks\n\nFixes #195';
const BODY_V3 = `${BODY_V2}\n\nPlease also support Kotlin.`;

const editsNode = ({ createdAt, edits = [], renames = [] }) => ({
  data: {
    repository: {
      issueOrPullRequest: {
        __typename: 'PullRequest',
        createdAt,
        lastEditedAt: edits[0]?.editedAt || null,
        userContentEdits: { totalCount: edits.length, nodes: edits },
        timelineItems: { nodes: renames },
      },
    },
  },
});
const edit = (editedAt, diff, login = 'konard', typename = 'User') => ({ editedAt, diff, editor: { __typename: typename, login } });

/**
 * Minimal GitHub for detectAndCountFeedback. `updatedAt` values are what the
 * REST API reports - bumped by the human comment at 18:24:36Z - so the old
 * `updated_at > last commit` check would fire for both PR and issue.
 */
const createGitHub = ({ prEdits, issueEdits = editsNode({ createdAt: '2026-09-23T09:00:00Z' }), comments = PR_196_COMMENTS, prNumber = PR, issueNumber = ISSUE }) => {
  const calls = [];
  const $ = async (strings, ...values) => {
    const command = commandText(strings, values);
    calls.push(command);
    if (command.startsWith('git log')) return response(LAST_COMMIT);
    if (command === 'gh api user --jq .login') return response('konard\n');
    if (command === `gh api repos/${OWNER}/${REPO}/issues/${prNumber}/comments --paginate`) return response(comments);
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/${prNumber}/comments --paginate`) return response([]);
    if (command === `gh api repos/${OWNER}/${REPO}/issues/${issueNumber}/comments --paginate`) return response([]);
    if (command.startsWith('gh api graphql')) {
      if (command.endsWith(`-F number=${prNumber}`)) return response(prEdits);
      if (command.endsWith(`-F number=${issueNumber}`)) return response(issueEdits);
    }
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/${prNumber}`) return response({ updated_at: '2026-09-24T18:24:36Z' });
    if (command === `gh api repos/${OWNER}/${REPO}/issues/${issueNumber}`) return response({ updated_at: '2026-09-24T18:24:36Z' });
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
    formatAligned: (_icon, label, value) => `${label} ${value ?? ''}`,
    cleanErrorMessage: error => error?.message || String(error),
    $,
    repositoryPath: null,
  });

const editFeedback = lines => lines.filter(line => /description|title/i.test(line));

// ---------------------------------------------------------------------------
// A. meta-language#196: the solver's own PR body edit is not human feedback.
// ---------------------------------------------------------------------------
{
  resetTrackedToolCommentIds();
  const prEdits = editsNode({
    createdAt: '2026-09-23T09:16:00Z',
    edits: [edit('2026-09-24T02:56:07Z', BODY_V2), edit('2026-09-23T09:16:00Z', BODY_V1)],
  });
  const { $ } = createGitHub({ prEdits });
  const logs = [];
  const result = await runFeedback({ $, logs });

  assert.deepEqual(editFeedback(result.feedbackLines), [], `solver-made PR edit must not be reported, got: ${JSON.stringify(result.feedbackLines)}`);
  assert.ok(result.feedbackLines.includes('New comments on the pull request: 1'), 'the real human comment is still reported');
  assert.ok(
    logs.some(line => line.includes('Ignored PR #196 description edited at 2026-09-24T02:56:07.000Z by konard') && line.includes('solver session')),
    `verbose log explains why the edit was ignored, got:\n${logs.join('\n')}`
  );
  console.log('  ✅ A. solver-made PR description edit (meta-language#196) produces no feedback');
}

// ---------------------------------------------------------------------------
// B. A real human edit (outside any solver session) is reported with evidence.
// ---------------------------------------------------------------------------
{
  resetTrackedToolCommentIds();
  const prEdits = editsNode({
    createdAt: '2026-09-23T09:16:00Z',
    edits: [edit('2026-09-24T18:20:00Z', BODY_V3), edit('2026-09-24T02:56:07Z', BODY_V2), edit('2026-09-23T09:16:00Z', BODY_V1)],
    renames: [{ createdAt: '2026-09-24T18:21:00Z', actor: { __typename: 'User', login: 'konard' }, previousTitle: 'Add CST pipeline', currentTitle: 'Add CST pipeline for all languages' }],
  });
  const { $ } = createGitHub({ prEdits });
  const logs = [];
  const result = await runFeedback({ $, logs });

  const lines = editFeedback(result.feedbackLines);
  assert.match(lines[0], /^Pull request (title and description|description and title) was edited after last commit:$/, `got: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes('  - description edited at 2026-09-24T18:20:00.000Z by konard: +2/-0 lines (+ Please also support Kotlin.)'), `evidence has timestamp, editor and diff excerpt, got: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes('  - title edited at 2026-09-24T18:21:00.000Z by konard: "Add CST pipeline" → "Add CST pipeline for all languages"'), `title evidence, got: ${JSON.stringify(lines)}`);
  assert.ok(!lines.some(line => line.includes('02:56:07')), 'the solver edit is still not reported');
  assert.ok(
    logs.some(line => line.includes('✏️') && line.includes('18:20:00')),
    'evidence is logged'
  );
  console.log('  ✅ B. real human edit produces feedback with timestamp, editor and diff excerpt');
}

// ---------------------------------------------------------------------------
// C. relative-meta-logic#183: updated_at bumped, 0 userContentEdits -> no feedback.
// ---------------------------------------------------------------------------
{
  resetTrackedToolCommentIds();
  const prEdits = editsNode({ createdAt: '2026-09-23T09:16:00Z', edits: [edit('2026-09-23T09:16:00Z', BODY_V1)] });
  const issueEdits = editsNode({ createdAt: '2026-09-20T14:31:31Z' });
  const { $ } = createGitHub({ prEdits, issueEdits });
  const result = await runFeedback({ $ });
  assert.deepEqual(editFeedback(result.feedbackLines), [], `no edits in history means no edit feedback, got: ${JSON.stringify(result.feedbackLines)}`);
  console.log('  ✅ C. issue with bumped updated_at but 0 userContentEdits produces no feedback');
}

// ---------------------------------------------------------------------------
// D. relative-meta-logic#184: issueNumber === prNumber (no separate linked issue).
// ---------------------------------------------------------------------------
{
  resetTrackedToolCommentIds();
  const selfComments = [comment(10, '2026-09-23T14:25:14Z', '🤖 **AI Work Session Started**'), comment(11, '2026-09-23T15:40:24Z', '## Slotwise self-incidence classification delivered'), comment(12, '2026-09-23T15:41:32Z', '## 🤖 Solution Draft Log')];
  // Real: last commit 15:34:12Z, one PR edit at 15:41:07Z (inside the 14:25:14Z session), next run 17:00:26Z.
  const prEdits = editsNode({ createdAt: '2026-09-20T14:32:54Z', edits: [edit('2026-09-23T15:41:07Z', BODY_V2), edit('2026-09-23T15:23:07Z', BODY_V1)] });
  const { $, calls } = createGitHub({ prEdits, comments: selfComments, prNumber: 184, issueNumber: 184 });
  const result = await runFeedback({ $, prNumber: 184, issueNumber: 184 });
  assert.deepEqual(editFeedback(result.feedbackLines), [], `got: ${JSON.stringify(result.feedbackLines)}`);
  assert.equal(calls.filter(command => command.startsWith('gh api graphql')).length, 1, 'the PR is checked once, not again as "the issue"');

  const pullRequestBody = '## Summary\n\nAdvances #183';
  const linkCalls = [];
  const linkCommand = async (strings, ...values) => {
    const command = commandText(strings, values);
    linkCalls.push(command);
    if (command.startsWith('gh pr view')) return response(pullRequestBody);
    throw new Error(`self-link must not edit the PR: ${command}`);
  };
  const link = await ensurePullRequestIssueLink({ prNumber: 184, issueNumber: 184, owner: OWNER, repo: 'relative-meta-logic', command: linkCommand, logger: noop });
  assert.equal(link.updated, false, 'no "Fixes #184" is written into PR #184');
  assert.equal(link.skipped, 'self-reference');
  assert.equal(link.body, pullRequestBody, 'the PR body is still returned for placeholder checks');
  assert.equal(linkCalls.length, 1);
  console.log('  ✅ D. issueNumber === prNumber: no double check of the PR, no self-referencing "Fixes #N"');
}

// ---------------------------------------------------------------------------
// E. Session windows and classification rules.
// ---------------------------------------------------------------------------
{
  const comments = [comment(20, '2026-09-23T10:22:42Z', '<!-- hive-mind:working-session-summary -->\n## Working session summary'), comment(21, '2026-09-23T10:25:33Z', '## ✅ Ready to merge'), comment(22, '2026-09-23T18:53:39Z', '## 🔄 Auto-restart 5/5\n\n**Reason:** CI failures detected'), comment(23, '2026-09-23T18:59:47Z', '## 🔄 Auto-restart-until-mergeable Log 5/5'), comment(24, '2026-09-23T19:04:31Z', '## ❌ Auto-restart 5/5 - limit reached'), comment(25, '2026-09-23T19:05:06Z', '## 🚨 Solution Draft Failed'), comment(26, '2026-09-23T20:21:17Z', '## Maintainer directive (human, same login)')];
  const windows = buildSolverSessionWindows(comments, { openedAt: '2026-09-23T09:16:00Z' });
  assert.equal(windows.length, 2, `PR creation session + one auto-restart session, got ${JSON.stringify(windows)}`);
  assert.equal(windows[0].startedBy, 'pull request created');
  assert.equal(new Date(windows[1].end).toISOString(), '2026-09-23T19:10:06.000Z', '"limit reached"/"Solution Draft Failed" end the session (+5 min grace), they do not open one');

  const edits = [
    { field: 'body', editedAt: '2026-09-23T10:20:00Z', editor: 'konard', isBot: false }, // first session (PR creator)
    { field: 'body', editedAt: '2026-09-23T18:55:00Z', editor: 'reviewer', isBot: false }, // other human during a session
    { field: 'body', editedAt: '2026-09-23T18:56:00Z', editor: 'github-actions', isBot: true }, // CI workflow
    { field: 'body', editedAt: '2026-09-23T20:25:00Z', editor: 'konard', isBot: false }, // human, between sessions
  ];
  const { external, ignored } = classifyContentEdits({ edits, since: '2026-09-23T09:00:00Z', windows, currentUser: 'konard' });
  assert.deepEqual(
    external.map(e => e.editedAt),
    ['2026-09-23T18:55:00Z', '2026-09-23T20:25:00Z']
  );
  assert.equal(ignored.length, 2);

  // parseContentEdits: the oldest node is the original body, not an edit.
  const parsed = parseContentEdits(editsNode({ createdAt: '2026-09-23T09:16:00Z', edits: [edit('2026-09-24T02:56:07Z', BODY_V2), edit('2026-09-23T09:16:00Z', BODY_V1)] }).data.repository.issueOrPullRequest);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].diffSummary, { added: 3, removed: 0, excerpt: '+ ### Verification' });
  assert.deepEqual(summarizeBodyDiff('a\nb', 'a\nc'), { added: 1, removed: 1, excerpt: '+ c' });
  console.log('  ✅ E. session windows: PR creation opens one, limit-reached does not; other humans and bots classified correctly');
}

// ---------------------------------------------------------------------------
// F. Restart comments carry evidence (failing checks + run URLs).
// ---------------------------------------------------------------------------
{
  const ciBlocker = {
    type: 'ci_failure',
    message: 'CI/CD checks are failing',
    details: ['Full Requirements Aggregate — https://github.com/link-foundation/meta-language/actions/runs/1/job/2'],
    checks: [{ name: 'Full Requirements Aggregate', conclusion: 'failure', html_url: 'https://github.com/link-foundation/meta-language/actions/runs/1/job/2' }],
  };
  const evidence = [...buildCiEvidence(ciBlocker), ...buildIssueEditEvidence(195, [{ field: 'body', from: BODY_V1, to: BODY_V2 }])];
  const body = buildAutoRestartCommentBody({ marker: 'Auto-restart', label: '2/5', reason: 'CI failures detected', evidence, limitText: 'This run will stop after 5 restart iterations in total.', repeatedCiFailures: 2 });
  assert.ok(body.startsWith('## 🔄 Auto-restart 2/5\n\n**Reason:** CI failures detected'), body);
  assert.ok(body.includes('- Failing check: Full Requirements Aggregate — https://github.com/link-foundation/meta-language/actions/runs/1/job/2'), body);
  assert.ok(body.includes('- Issue #195 description changed: +3/-0 lines, + ### Verification'), body);
  assert.ok(body.includes('same checks have been failing for 2 restarts in a row'), body);
  assert.ok(body.includes('Starting new session to address the issues.'), 'existing wording is kept');
  assert.equal(ciFailureSignature(ciBlocker), 'Full Requirements Aggregate');
  assert.equal(ciFailureSignature({ details: ['b — url', 'a'] }), 'a | b');
  console.log('  ✅ F. restart comment lists failing checks with run URLs and issue edit diffs');
}

console.log('Issue #2293 description-edit false-positive regression tests passed');
