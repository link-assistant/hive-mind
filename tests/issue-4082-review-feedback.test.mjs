#!/usr/bin/env node
/**
 * Issue #4082, cases 1, 3, 4 and 5: review findings must reach the AI whatever
 * their age or author, and stay listed until their thread is resolved.
 *
 *   1. `chatgpt-codex-connector[bot]` left a P1 finding and a
 *      CHANGES_REQUESTED review, yet "Ready to merge" was posted, because every
 *      `[bot]` login was ignored and reviews were never read.
 *   3. A human review (or a same-account comment without tool markers) after
 *      "Ready to merge" needed a manual restart.
 *   4. Session-start feedback counted only items newer than the last commit, so
 *      a merge of the default branch hid an open finding.
 *   5. Threads got a "Fixed in <sha>" reply but were never resolved, so
 *      answered and unanswered threads looked the same.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4082
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkForNonBotComments, reviewsAsFeedbackComments } from '../src/solve.auto-merge-helpers.lib.mjs';
import { detectAndCountFeedback, selectOutstandingChangeRequests } from '../src/solve.feedback.lib.mjs';
import { RESOLVE_REVIEW_THREAD_COMMAND, buildUnresolvedReviewThreadLines, createReviewThreadTracker, fetchReviewThreads, fetchUnresolvedReviewThreads, formatThreadsForComment, selectUnresolvedReviewThreads } from '../src/review-threads.lib.mjs';

const OWNER = 'link-foundation';
const REPO = 'example';
const PR = 12;
const ISSUE = 11;
const BOT = 'chatgpt-codex-connector[bot]';

const response = (value, code = 0) => ({ code, stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), stderr: Buffer.from(code === 0 ? '' : 'HTTP 502') });
const commandText = (strings, values) => strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');

const threadNode = (id, { isResolved = false, isOutdated = false, author = BOT, body = '**P1** Remote-only commits are dropped', path = 'src/sync.mjs', line = 42, createdAt = '2026-11-10T10:00:00Z' } = {}) => ({
  id,
  isResolved,
  isOutdated,
  path,
  line,
  originalLine: line,
  comments: { totalCount: 1, nodes: [{ databaseId: Number(id.replace(/\D/g, '')) || 1, author: { login: author }, body, url: `https://github.com/${OWNER}/${REPO}/pull/${PR}#discussion_r${id}`, createdAt }] },
});
const threadsPage = (nodes, endCursor = null) => ({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: Boolean(endCursor), endCursor }, nodes } } } } });

const review = (id, login, state, submittedAt, body = '') => ({ id, user: { login }, state, submitted_at: submittedAt, body, html_url: `https://github.com/${OWNER}/${REPO}/pull/${PR}#pullrequestreview-${id}` });

test('case 5: review threads are read page by page and only unresolved ones are kept', async () => {
  const calls = [];
  const runner = async (strings, ...values) => {
    const command = commandText(strings, values);
    calls.push(command);
    if (!command.includes('after=')) return response(threadsPage([threadNode('T1'), threadNode('T2', { isResolved: true })], 'CURSOR1'));
    return response(threadsPage([threadNode('T3', { author: 'maintainer', path: null, line: null })]));
  };
  const all = await fetchReviewThreads({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: runner });
  assert.equal(all.ok, true);
  assert.deepEqual(
    all.threads.map(thread => thread.id),
    ['T1', 'T2', 'T3']
  );
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('after=CURSOR1'), calls[1]);
  assert.ok(calls[0].includes(`-F number=${PR}`), calls[0]);

  const unresolved = await fetchUnresolvedReviewThreads({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: runner });
  assert.deepEqual(
    unresolved.threads.map(thread => thread.id),
    ['T1', 'T3']
  );
});

test('case 5: a failed GraphQL read is reported as unknown, never as "no threads"', async () => {
  const failing = await fetchReviewThreads({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: async () => response('', 1) });
  assert.equal(failing.ok, false);
  assert.match(failing.error, /HTTP 502/);
  const throwing = await fetchReviewThreads({
    owner: OWNER,
    repo: REPO,
    prNumber: PR,
    commandRunner: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(throwing.ok, false);
  const errors = await fetchReviewThreads({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: async () => response({ errors: [{ message: 'Could not resolve to a PullRequest' }] }) });
  assert.deepEqual([errors.ok, errors.error], [false, 'Could not resolve to a PullRequest']);
});

test('case 5: threads opened by hive-mind status comments are not findings', () => {
  const threads = [threadNode('T1'), { ...threadNode('T2'), comments: { totalCount: 1, nodes: [{ author: { login: 'konard' }, body: '## ✅ Ready to merge\n\nThis pull request is now ready to be merged.' }] } }];
  const normalized = threads.map(node => ({ id: node.id, isResolved: false, body: node.comments.nodes[0].body }));
  assert.deepEqual(
    selectUnresolvedReviewThreads(normalized).map(thread => thread.id),
    ['T1']
  );
});

test('case 5: the prompt names each thread with its id and tells the AI to resolve it after a verified fix', () => {
  const lines = buildUnresolvedReviewThreadLines([
    { id: 'PRRT_kwDOA', author: BOT, path: 'src/sync.mjs', line: 42, body: '**P1** Remote-only commits are dropped', url: 'https://example.test/r1', isOutdated: true },
    { id: 'PRRT_kwDOB', author: 'maintainer', path: null, line: null, body: 'Please rename this', url: null, isOutdated: false },
  ]);
  const text = lines.join('\n');
  assert.match(text, /Unresolved review threads on the pull request: 2/);
  assert.match(text, /chatgpt-codex-connector\[bot\] on src\/sync\.mjs:42 \(outdated/);
  assert.match(text, /thread id: PRRT_kwDOA/);
  assert.match(text, /maintainer on the pull request/);
  assert.ok(text.includes(RESOLVE_REVIEW_THREAD_COMMAND), 'the resolve mutation is given verbatim');
  assert.match(text, /A reply alone does not resolve a thread/);
  assert.deepEqual(buildUnresolvedReviewThreadLines([]), []);
});

test('case 5: a thread is restarted on once; later it is only named for a human', () => {
  const tracker = createReviewThreadTracker();
  const first = tracker.split([{ id: 'T1' }, { id: 'T2' }]);
  assert.deepEqual([first.fresh.length, first.alreadyReported.length], [2, 0]);
  tracker.markReported(first.fresh);
  const second = tracker.split([{ id: 'T2' }, { id: 'T3' }]);
  assert.deepEqual(
    second.fresh.map(thread => thread.id),
    ['T3']
  );
  assert.deepEqual(
    second.alreadyReported.map(thread => thread.id),
    ['T2']
  );
  assert.equal(tracker.size, 2);
  assert.deepEqual(formatThreadsForComment([{ author: BOT, path: 'a.mjs', line: 3, url: 'https://example.test/r', isOutdated: false }]), ['- [chatgpt-codex-connector[bot] on `a.mjs:3`](https://example.test/r)']);
});

test('cases 1 and 3: a bot review that requests changes and a human review are feedback; bot comments and approvals are not', () => {
  const isBot = login => /\[bot\]$/.test(login || '');
  const entries = reviewsAsFeedbackComments([review(1, BOT, 'CHANGES_REQUESTED', '2026-11-10T10:00:00Z', ''), review(2, BOT, 'COMMENTED', '2026-11-10T10:01:00Z', 'Codex Review: found 1 issue'), review(3, 'maintainer', 'COMMENTED', '2026-11-10T10:02:00Z', 'BLOCK: the restart path is still wrong'), review(4, 'maintainer', 'APPROVED', '2026-11-10T10:03:00Z', ''), review(5, 'maintainer', 'PENDING', null, 'draft')], isBot);
  assert.deepEqual(
    entries.map(entry => entry.id),
    [1, 3]
  );
  assert.equal(entries[0].countsFromBot, true);
  assert.match(entries[0].body, /CHANGES_REQUESTED/);
  assert.equal(entries[1].countsFromBot, false);
});

const watchGitHub =
  ({ prComments = [], reviewComments = [], reviews = [], currentUser = 'konard' }) =>
  async (strings, ...values) => {
    const command = commandText(strings, values);
    if (command === 'gh api user --jq .login') return response(`${currentUser}\n`);
    if (command === `gh api repos/${OWNER}/${REPO}/issues/${PR}/comments --paginate`) return response(prComments);
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/${PR}/comments --paginate`) return response(reviewComments);
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/${PR}/reviews --paginate`) return response(reviews);
    return response('[]');
  };

test('case 1: the watch loop restarts on a review bot that requests changes after the last check', async () => {
  const lastCheck = new Date('2026-11-10T09:00:00Z');
  const $ = watchGitHub({
    reviewComments: [{ id: 501, user: { login: BOT }, created_at: '2026-11-10T09:30:00Z', body: '**P1** Remote-only commits are dropped' }],
    reviews: [review(77, BOT, 'CHANGES_REQUESTED', '2026-11-10T09:30:05Z')],
  });
  const result = await checkForNonBotComments(OWNER, REPO, PR, ISSUE, lastCheck, false, $, { trustAuthenticatedUserComments: true });
  assert.equal(result.hasNewComments, true);
  assert.deepEqual(
    result.comments.map(comment => comment.id),
    [77],
    'the review counts; the inline bot comment is handled by the unresolved-thread gate'
  );
});

test('case 3: a human review and a same-account comment without tool markers after "Ready to merge" restart the loop', async () => {
  const readyAt = new Date('2026-11-10T12:00:00Z');
  const $ = watchGitHub({
    prComments: [
      { id: 900, user: { login: 'konard' }, created_at: '2026-11-10T11:59:00Z', body: '## ✅ Ready to merge\n\nThis pull request is now ready to be merged.' },
      { id: 901, user: { login: 'konard' }, created_at: '2026-11-10T13:10:00Z', body: 'The restart still drops the last commit, please fix.' },
    ],
    reviews: [review(78, 'reviewer', 'COMMENTED', '2026-11-10T13:20:00Z', 'BLOCK: see inline notes')],
  });
  const result = await checkForNonBotComments(OWNER, REPO, PR, ISSUE, readyAt, false, $, { trustAuthenticatedUserComments: true });
  assert.deepEqual(result.comments.map(comment => comment.id).sort(), [78, 901]);
});

test('cases 1 and 3: an unreadable reviews endpoint does not hide new comments', async () => {
  const base = watchGitHub({ prComments: [{ id: 902, user: { login: 'maintainer' }, created_at: '2026-11-10T13:10:00Z', body: 'Please also handle Windows paths.' }] });
  const $ = async (strings, ...values) => {
    if (commandText(strings, values).includes('/reviews')) throw new Error('HTTP 502');
    return base(strings, ...values);
  };
  const result = await checkForNonBotComments(OWNER, REPO, PR, ISSUE, new Date('2026-11-10T12:00:00Z'), false, $, { trustAuthenticatedUserComments: true });
  assert.deepEqual(
    result.comments.map(comment => comment.id),
    [902]
  );
});

test('case 4: a change request stays outstanding until the same reviewer approves, however old it is', () => {
  const outstanding = selectOutstandingChangeRequests([review(1, 'alice', 'CHANGES_REQUESTED', '2026-01-01T00:00:00Z'), review(2, 'alice', 'COMMENTED', '2026-01-02T00:00:00Z'), review(3, BOT, 'CHANGES_REQUESTED', '2026-01-01T00:00:00Z'), review(4, 'bob', 'CHANGES_REQUESTED', '2026-01-01T00:00:00Z'), review(5, 'bob', 'APPROVED', '2026-01-03T00:00:00Z')]);
  assert.deepEqual(
    outstanding.map(entry => entry.id),
    [1, 3]
  );
});

test('case 4: session-start feedback lists unresolved threads older than the last commit', async () => {
  const LAST_COMMIT = '2026-11-12T00:00:00Z';
  const calls = [];
  const $ = async (strings, ...values) => {
    const command = commandText(strings, values);
    calls.push(command);
    if (command.startsWith('git log')) return response(LAST_COMMIT);
    if (command === 'gh api user --jq .login') return response('konard\n');
    if (command.startsWith('gh api graphql') && command.includes('reviewThreads')) return response(threadsPage([threadNode('PRRT_old', { createdAt: '2026-11-10T10:00:00Z' }), threadNode('PRRT_done', { isResolved: true })]));
    if (command.startsWith('gh api graphql')) return response({ data: { repository: { issueOrPullRequest: { __typename: 'PullRequest', createdAt: '2026-11-01T00:00:00Z', lastEditedAt: null, userContentEdits: { totalCount: 0, nodes: [] }, timelineItems: { nodes: [] } } } } });
    if (command === `gh api repos/${OWNER}/${REPO}`) return response({ default_branch: 'main' });
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/${PR}` || command === `gh api repos/${OWNER}/${REPO}/issues/${ISSUE}`) return response({ updated_at: '2026-11-01T00:00:00Z' });
    return response('[]');
  };
  const logs = [];
  const result = await detectAndCountFeedback({
    prNumber: PR,
    branchName: 'issue-11-abc',
    owner: OWNER,
    repo: REPO,
    issueNumber: ISSUE,
    isContinueMode: true,
    argv: { verbose: false },
    mergeStateStatus: 'CLEAN',
    prState: 'OPEN',
    workStartTime: '2026-11-12T01:00:00Z',
    log: async message => logs.push(String(message)),
    formatAligned: (icon, label, value) => `${icon} ${label} ${value ?? ''}`,
    cleanErrorMessage: error => error.message,
    $,
  });
  const text = result.feedbackLines.join('\n');
  assert.match(text, /Unresolved review threads on the pull request: 1/, text);
  assert.match(text, /thread id: PRRT_old/);
  assert.doesNotMatch(text, /PRRT_done/);
});
