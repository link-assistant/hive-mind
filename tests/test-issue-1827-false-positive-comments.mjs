#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression tests for issue #1827: the auto-restart-until-mergeable / watch
 * loops must NOT treat their own session comments as new feedback.
 *
 * Incident: https://github.com/link-foundation/rust-web-box/pull/34 — the AI
 * agent posted free-form status comments ("✅ CI now green", "✅ Verification
 * pass") through the authenticated account during a session. The next watch
 * iteration re-detected them as fresh human feedback and restarted, looping
 * until the auto-restart limit (5) was hit.
 *
 * These tests verify the three defenses:
 *   A. nextMonotonicCheckTime — the check window never moves backwards.
 *   B. trackAuthenticatedUserCommentsSince — the account's own session comments
 *      are registered by ID so they are filtered regardless of timestamps.
 *   C. detectAndCountFeedback (watch mode) excludes tool-generated comments by
 *      marker AND by tracked ID, while still counting genuine human feedback.
 */

import assert from 'node:assert/strict';

import { checkForNonBotComments, trackAuthenticatedUserCommentsSince, nextMonotonicCheckTime } from '../src/solve.auto-merge-helpers.lib.mjs';
import { detectAndCountFeedback } from '../src/solve.feedback.lib.mjs';
import { trackToolCommentId, getTrackedToolCommentIds, resetTrackedToolCommentIds, isToolTrackedCommentId } from '../src/tool-comments.lib.mjs';

const response = value => ({
  code: 0,
  stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  stderr: Buffer.from(''),
});

const commandText = (strings, values) => strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');

const OWNER = 'link-foundation';
const REPO = 'rust-web-box';

// ---------------------------------------------------------------------------
// A. nextMonotonicCheckTime never rewinds the window.
// ---------------------------------------------------------------------------
{
  const earlier = new Date('2026-05-27T09:47:03Z'); // iteration start (before AI ran)
  const later = new Date('2026-05-27T09:57:00Z'); // after AI session

  // Restart branch: lastCheckTime is already past the AI comments; a stale
  // iteration-start candidate must NOT pull it backwards.
  assert.equal(nextMonotonicCheckTime(later, earlier).getTime(), later.getTime(), 'must not move the cutoff backwards after a session');

  // Non-restart branch: a fresh iteration time advances the cutoff forward.
  assert.equal(nextMonotonicCheckTime(earlier, later).getTime(), later.getTime(), 'must advance the cutoff forward when no session ran');

  // Degenerate inputs are handled gracefully.
  assert.equal(nextMonotonicCheckTime(null, later).getTime(), later.getTime());
  assert.equal(nextMonotonicCheckTime(earlier, null).getTime(), earlier.getTime());

  console.log('  ✅ A. nextMonotonicCheckTime keeps the check window monotonic');
}

// ---------------------------------------------------------------------------
// B. trackAuthenticatedUserCommentsSince registers the account's own session
//    comments, and checkForNonBotComments then filters them — even when the
//    check window is (buggily) rewound — while genuine feedback survives.
// ---------------------------------------------------------------------------
{
  resetTrackedToolCommentIds();

  const sessionStart = new Date('2026-05-27T09:47:03Z');

  const aiStatusComment = {
    id: 4553469248,
    created_at: '2026-05-27T09:56:14Z', // posted by the agent during the session
    user: { login: 'konard' },
    body: '## ✅ CI now green on `774f52f`\n\nAll three workflows now pass.',
  };
  const olderOwnComment = {
    id: 4553000000,
    created_at: '2026-05-27T09:40:00Z', // before the session window — not ours to track
    user: { login: 'konard' },
    body: 'A pre-session note from the same account.',
  };
  const otherUserComment = {
    id: 4553999999,
    created_at: '2026-05-27T09:58:00Z',
    user: { login: 'reviewer' },
    body: 'Different human, posted during the window — must NOT be tracked.',
  };

  const fakeGh = async (strings, ...values) => {
    const command = commandText(strings, values);
    if (command === 'gh api user --jq .login') return response('konard\n');
    if (command === `gh api repos/${OWNER}/${REPO}/issues/34/comments --paginate`) {
      return response([olderOwnComment, aiStatusComment, otherUserComment]);
    }
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/34/comments --paginate`) return response([]);
    throw new Error(`Unexpected command in test: ${command}`);
  };

  const tracked = await trackAuthenticatedUserCommentsSince(OWNER, REPO, 34, 34, sessionStart, fakeGh);

  assert.deepEqual(tracked, [String(aiStatusComment.id)], 'only the same-account comment within the window is tracked');
  assert.equal(isToolTrackedCommentId(aiStatusComment.id), true, 'AI status comment is now a tracked tool comment');
  assert.equal(isToolTrackedCommentId(olderOwnComment.id), false, 'a pre-window same-account comment is not tracked');
  assert.equal(isToolTrackedCommentId(otherUserComment.id), false, 'another human user is never tracked');
  assert.equal(getTrackedToolCommentIds().size, 1);

  // Now simulate the buggy backwards window (lastCheckTime before the AI
  // comment) and confirm the tracked ID still suppresses the false positive.
  const buggyLastCheck = sessionStart;
  const checkGh = async (strings, ...values) => {
    const command = commandText(strings, values);
    if (command === 'gh api user --jq .login') return response('konard\n');
    if (command === `gh api repos/${OWNER}/${REPO}/issues/34/comments --paginate`) {
      return response([aiStatusComment, otherUserComment]);
    }
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/34/comments --paginate`) return response([]);
    throw new Error(`Unexpected command in test: ${command}`);
  };
  const result = await checkForNonBotComments(OWNER, REPO, 34, 34, buggyLastCheck, false, checkGh, {
    trustAuthenticatedUserComments: true,
  });

  assert.equal(result.hasNewComments, true, 'a genuine human comment is still detected');
  assert.equal(result.comments.length, 1, 'only the genuine human comment survives filtering');
  assert.equal(result.comments[0].user.login, 'reviewer');
  assert.equal(result.comments[0].id, otherUserComment.id);

  console.log('  ✅ B. trackAuthenticatedUserCommentsSince registers own comments; feedback survives');
}

// ---------------------------------------------------------------------------
// B2. With nothing tracked and no marker, the agent's own free-form comment
//     would be counted — this is the gap Fix B closes (documents the cause).
// ---------------------------------------------------------------------------
{
  resetTrackedToolCommentIds();
  const buggyLastCheck = new Date('2026-05-27T09:47:03Z');
  const aiStatusComment = {
    id: 4553469248,
    created_at: '2026-05-27T09:56:14Z',
    user: { login: 'konard' },
    body: '## ✅ CI now green\n\nAll workflows pass.', // free-form: no tool marker
  };
  const checkGh = async (strings, ...values) => {
    const command = commandText(strings, values);
    if (command === 'gh api user --jq .login') return response('konard\n');
    if (command === `gh api repos/${OWNER}/${REPO}/issues/34/comments --paginate`) return response([aiStatusComment]);
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/34/comments --paginate`) return response([]);
    throw new Error(`Unexpected command in test: ${command}`);
  };
  const before = await checkForNonBotComments(OWNER, REPO, 34, 34, buggyLastCheck, false, checkGh, { trustAuthenticatedUserComments: true });
  assert.equal(before.hasNewComments, true, 'untracked free-form same-account comment would falsely trigger (the bug)');

  // Apply Fix B: track it, then the same check is clean.
  trackToolCommentId(aiStatusComment.id);
  const after = await checkForNonBotComments(OWNER, REPO, 34, 34, buggyLastCheck, false, checkGh, { trustAuthenticatedUserComments: true });
  assert.equal(after.hasNewComments, false, 'after tracking, the false positive is gone');

  console.log('  ✅ B2. tracking the free-form session comment removes the false positive');
}

// ---------------------------------------------------------------------------
// C. detectAndCountFeedback (watch mode, workStartTime: null) excludes
//    tool-generated comments by marker AND by tracked ID, counts real feedback.
// ---------------------------------------------------------------------------
{
  resetTrackedToolCommentIds();

  const lastCommitISO = '2026-05-27T09:30:00Z';
  const trackedFreeFormId = 8881111;
  // Register the agent's free-form session comment as a tracked tool comment,
  // exactly as trackAuthenticatedUserCommentsSince would after a session.
  trackToolCommentId(trackedFreeFormId);

  const prConversationComments = [
    {
      id: 7001,
      created_at: '2026-05-27T09:47:03Z',
      user: { login: 'konard' },
      body: '## 🔄 Auto-restart triggered (iteration 1)\n\nReason: CI failures detected', // tool marker
    },
    {
      id: trackedFreeFormId,
      created_at: '2026-05-27T09:56:14Z',
      user: { login: 'konard' },
      body: '## ✅ CI now green\n\nfree-form status, no marker', // excluded by tracked ID
    },
    {
      id: 7003,
      created_at: '2026-05-27T10:00:00Z',
      user: { login: 'reviewer' },
      body: 'Please also cover the empty-input case.', // genuine human feedback
    },
  ];

  const fakeDollar = async (strings, ...values) => {
    const command = commandText(strings, values);
    if (command.startsWith('git log')) return response(lastCommitISO);
    if (command === 'gh api user --jq .login') return response('konard\n');
    if (command === `gh api repos/${OWNER}/${REPO}/issues/34/comments --paginate`) return response(prConversationComments);
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/34/comments --paginate`) return response([]);
    if (command === `gh api repos/${OWNER}/${REPO}/issues/33/comments --paginate`) return response([]);
    // Everything else (PR/issue details, default branch, commits, check-runs,
    // reviews) returns a benign empty payload so no other feedback source fires.
    return response('[]');
  };

  const noop = async () => {};
  const result = await detectAndCountFeedback({
    prNumber: 34,
    branchName: 'main',
    owner: OWNER,
    repo: REPO,
    issueNumber: 33,
    isContinueMode: true,
    argv: { verbose: false },
    mergeStateStatus: 'CLEAN',
    prState: 'OPEN',
    workStartTime: null, // watch mode counts all comments as potential feedback
    log: noop,
    formatAligned: (..._args) => '',
    cleanErrorMessage: e => (e && e.message ? e.message : String(e)),
    $: fakeDollar,
    repositoryPath: null,
  });

  assert.equal(result.newPrComments, 1, 'only the genuine human comment counts; marker + tracked-ID comments are excluded');
  assert.equal(result.newIssueComments, 0);
  assert.ok(
    result.feedbackLines.some(line => line === 'New comments on the pull request: 1'),
    'feedbackLines reflects exactly one real PR comment'
  );
  assert.ok(!result.feedbackLines.some(line => /Auto-restart|CI now green/.test(line)), 'no tool comment leaks into feedbackLines');

  console.log('  ✅ C. detectAndCountFeedback excludes tool comments (marker + tracked ID)');
}

console.log('Issue #1827 false-positive comment regression tests passed');
