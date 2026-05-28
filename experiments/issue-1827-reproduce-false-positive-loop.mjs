#!/usr/bin/env node
/**
 * Issue #1827 — reproduce the auto-restart-until-mergeable false-positive loop.
 *
 * Incident: https://github.com/link-foundation/rust-web-box/pull/34
 *
 * The AI agent posts a free-form status comment during a working session (e.g.
 * "✅ CI now green"). On the NEXT watch iteration, checkForNonBotComments
 * re-reads that comment as fresh human feedback and triggers another restart.
 * Each restart posts another status comment, so the loop runs until the
 * auto-restart limit (5) is hit.
 *
 * This script reproduces the time-bookkeeping that caused the loop, using the
 * REAL checkForNonBotComments + tool-comment tracking, and then shows the two
 * fixes (monotonic lastCheckTime and tracked-comment-ID) suppress it while
 * still detecting a genuine human comment.
 *
 * Run: node experiments/issue-1827-reproduce-false-positive-loop.mjs
 */

import { checkForNonBotComments } from '../src/solve.auto-merge-helpers.lib.mjs';
import { trackToolCommentId, resetTrackedToolCommentIds } from '../src/tool-comments.lib.mjs';

const response = value => ({
  code: 0,
  stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  stderr: Buffer.from(''),
});

const commandText = (strings, values) => strings.reduce((acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ''), '');

const makeGh = comments => {
  const fakeGh = async (strings, ...values) => {
    const command = commandText(strings, values);
    if (command === 'gh api user --jq .login') return response('konard\n');
    if (command === 'gh api repos/link-foundation/rust-web-box/issues/34/comments --paginate') return response(comments);
    if (command === 'gh api repos/link-foundation/rust-web-box/pulls/34/comments --paginate') return response([]);
    throw new Error(`Unexpected command: ${command}`);
  };
  return fakeGh;
};

// Reconstructed from the real PR #34 incident timeline.
const aiStatusComment = {
  id: 4553469248,
  created_at: '2026-05-27T09:56:14Z',
  user: { login: 'konard' }, // same authenticated account the AI tool posts through
  body: '## ✅ CI now green on `774f52f`\n\nAll three workflows now pass.',
};

const check = async (lastCheckTime, comments) =>
  checkForNonBotComments('link-foundation', 'rust-web-box', 34, 34, lastCheckTime, false, makeGh(comments), {
    trustAuthenticatedUserComments: true,
  });

let failures = 0;
const expect = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${actual} (expected ${expected})`);
  if (!ok) failures++;
};

console.log('Issue #1827 reproduction\n========================\n');

// --- Iteration 1: AI session runs and posts the status comment. ---
// currentTime is captured at the START of the iteration (before the AI ran).
const iter1Start = new Date('2026-05-27T09:47:03Z'); // "currentTime" for iteration 1
// AI posts aiStatusComment at 09:56:14 during the session.
const afterSession = new Date('2026-05-27T09:57:00Z'); // local time right after the session ends

console.log('--- BUGGY bookkeeping: lastCheckTime = currentTime (start of iteration) ---');
{
  resetTrackedToolCommentIds();
  // The bug: after the AI session, lastCheckTime is reset to iter1Start (before the AI comment).
  const lastCheckTime = iter1Start;
  const { hasNewComments, comments } = await check(lastCheckTime, [aiStatusComment]);
  expect('next iteration re-detects the AI status comment (FALSE POSITIVE)', hasNewComments, true);
  expect('  detected comment count', comments.length, 1);
}

console.log('\n--- FIX A: monotonic lastCheckTime (advanced to after the session) ---');
{
  resetTrackedToolCommentIds();
  // After the session, lastCheckTime advances to afterSession (after the AI comment).
  const lastCheckTime = afterSession;
  const { hasNewComments } = await check(lastCheckTime, [aiStatusComment]);
  expect('AI status comment is NOT re-detected', hasNewComments, false);
}

console.log('\n--- FIX B: tracked comment ID (robust to clock skew) ---');
{
  resetTrackedToolCommentIds();
  // Even with the buggy (backwards) lastCheckTime, tracking the AI comment's ID filters it.
  trackToolCommentId(aiStatusComment.id);
  const lastCheckTime = iter1Start; // still buggy window
  const { hasNewComments } = await check(lastCheckTime, [aiStatusComment]);
  expect('AI status comment filtered by tracked ID', hasNewComments, false);
}

console.log('\n--- Regression guard: a genuine human comment still triggers a restart ---');
{
  resetTrackedToolCommentIds();
  trackToolCommentId(aiStatusComment.id); // AI comment tracked (Fix B in effect)
  const humanComment = {
    id: 4553999999,
    created_at: '2026-05-27T10:30:00Z',
    user: { login: 'reviewer' },
    body: 'Please also handle the empty-input case.',
  };
  const lastCheckTime = afterSession; // Fix A in effect too
  const { hasNewComments, comments } = await check(lastCheckTime, [aiStatusComment, humanComment]);
  expect('genuine human comment IS detected', hasNewComments, true);
  expect('  only the human comment remains', comments.length, 1);
  expect('  detected author', comments[0].user.login === 'reviewer', true);
}

console.log('');
if (failures === 0) {
  console.log('✅ Reproduction confirms the bug and both fixes.');
  process.exit(0);
} else {
  console.log(`❌ ${failures} expectation(s) failed.`);
  process.exit(1);
}
