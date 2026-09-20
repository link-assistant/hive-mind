#!/usr/bin/env node

/**
 * Regression tests for Issue #1893.
 *
 * Scenario: a maintainer with write access to the upstream repository continues
 * a fork PR opened by another contributor (e.g. link-assistant/formal-ai#405,
 * head = skulidropek/formal-ai:issue-404, "Allow edits by maintainers" = true).
 *
 * The solver clones the contributor's fork as `origin`, syncs the local default
 * branch with upstream, and then tried to push that default branch back to
 * `origin`. Because the maintainer does NOT own the fork, GitHub rejects the
 * push with `! [remote rejected] main -> main (permission denied)`.
 *
 * Two bugs combined to halt the run:
 *   1. The push to the fork's default branch was attempted at all, even though
 *      the current user cannot push to a fork they don't own.
 *   2. The "permission denied" rejection was misclassified as FORK DIVERGENCE
 *      (the heuristic matched the substring "rejected"), telling the user to
 *      rerun with --allow-fork-divergence-resolution-using-force-push-with-lease
 *      — a flag that cannot possibly help, since force-push also requires write
 *      access to the fork.
 *
 * These tests pin the corrected behaviour of the two pure helpers that drive
 * the decision.
 */

import assert from 'node:assert/strict';
import { isPermissionDeniedPushError, shouldPushDefaultBranchToFork, classifyPushRejection } from '../src/solve.branch-divergence.lib.mjs';

// The exact output observed in the failure log attached to issue #1893.
const permissionDeniedOutput = `To https://github.com/skulidropek/formal-ai.git
 ! [remote rejected]   main -> main (permission denied)
error: failed to push some refs to 'https://github.com/skulidropek/formal-ai.git'`;

const nonFastForwardOutput = `To https://github.com/skulidropek/formal-ai.git
 ! [rejected]        main -> main (non-fast-forward)
error: failed to push some refs to 'https://github.com/skulidropek/formal-ai.git'`;

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

test('isPermissionDeniedPushError detects the real permission-denied rejection', () => {
  assert.equal(isPermissionDeniedPushError(permissionDeniedOutput), true);
});

test('isPermissionDeniedPushError does not flag a genuine non-fast-forward divergence', () => {
  assert.equal(isPermissionDeniedPushError(nonFastForwardOutput), false);
});

test('isPermissionDeniedPushError handles empty / nullish input safely', () => {
  assert.equal(isPermissionDeniedPushError(''), false);
  assert.equal(isPermissionDeniedPushError(undefined), false);
  assert.equal(isPermissionDeniedPushError(null), false);
});

test('classifyPushRejection still reports remote-rejected for the same output (unchanged)', () => {
  // The permission-denied case is also a "remote rejected" line; the divergence
  // path must rely on isPermissionDeniedPushError() to override this, so this
  // classification staying stable confirms we did not regress existing callers.
  assert.equal(classifyPushRejection(permissionDeniedOutput), 'remote-rejected');
});

test('shouldPushDefaultBranchToFork skips the push when the user does not own the fork', () => {
  const decision = shouldPushDefaultBranchToFork({
    currentUser: 'konard',
    forkedRepo: 'skulidropek/formal-ai',
  });
  assert.equal(decision.shouldPush, false);
  assert.equal(decision.reason, 'not-fork-owner');
  assert.equal(decision.forkOwner, 'skulidropek');
});

test('shouldPushDefaultBranchToFork pushes when the user owns the fork', () => {
  const decision = shouldPushDefaultBranchToFork({
    currentUser: 'skulidropek',
    forkedRepo: 'skulidropek/formal-ai',
  });
  assert.equal(decision.shouldPush, true);
  assert.equal(decision.reason, 'owns-fork');
});

test('shouldPushDefaultBranchToFork is case-insensitive on the owner comparison', () => {
  const decision = shouldPushDefaultBranchToFork({
    currentUser: 'SkuliDropek',
    forkedRepo: 'skulidropek/formal-ai',
  });
  assert.equal(decision.shouldPush, true);
  assert.equal(decision.reason, 'owns-fork');
});

test('shouldPushDefaultBranchToFork falls back to pushing when user is unknown', () => {
  const decision = shouldPushDefaultBranchToFork({
    currentUser: null,
    forkedRepo: 'skulidropek/formal-ai',
  });
  assert.equal(decision.shouldPush, true);
  assert.equal(decision.reason, 'current-user-unknown');
});

test('shouldPushDefaultBranchToFork falls back to pushing when fork owner cannot be parsed', () => {
  const decision = shouldPushDefaultBranchToFork({
    currentUser: 'konard',
    forkedRepo: 'not-a-slug',
  });
  assert.equal(decision.shouldPush, true);
  assert.equal(decision.reason, 'fork-owner-unknown');
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll issue #1893 regression tests passed');
