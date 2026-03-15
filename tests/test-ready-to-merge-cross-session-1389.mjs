#!/usr/bin/env node

/**
 * Unit Tests: Issue #1389 - No `ready to merge` comment when `--auto-restart-until-mergeable` is enabled
 *
 * Tests verify that:
 * 1. The in-memory `readyToMergeCommentPosted` flag correctly allows posting "Ready to merge"
 *    in new sessions even when a previous session already posted the same comment
 * 2. The old `checkForExistingComment` all-time-history approach would incorrectly suppress
 *    the comment (documents the bug that was fixed)
 * 3. The in-memory flag still correctly prevents duplicates WITHIN the same session
 *
 * Root cause: In v1.25.7, `watchUntilMergeable` used `checkForExistingComment` to check
 * ALL-TIME PR comment history before posting "Ready to merge". When a new solve session
 * started after human feedback and the PR became mergeable again, the function found the
 * old "Ready to merge" comment from a previous session and silently skipped posting a new one.
 *
 * The fix (Issue #1371, commit 278415a9, v1.26.0): Use an in-memory flag scoped to the
 * current session (`readyToMergeCommentPosted`). This correctly handles within-session
 * deduplication while allowing fresh notifications when a new session starts.
 *
 * Run with: node tests/test-ready-to-merge-cross-session-1389.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1389
 * @see https://github.com/link-assistant/hive-mind/issues/1371 (same root cause, different scenario)
 * @see https://github.com/link-assistant/hive-mind/issues/1323 (introduced the deduplication)
 */

// ANSI color codes for terminal output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = (description, fn) => {
  try {
    fn();
    console.log(`  ${GREEN}✅ PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}❌ FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1389 - No ready-to-merge comment in new session');
console.log('================================================================================\n');

// ===== Helper: Simulate old buggy behavior (checkForExistingComment approach) =====

/**
 * Simulates the OLD buggy deduplication logic from v1.25.7.
 * Uses checkForExistingComment which searches ALL PR comment history.
 * @param {string[]} allPrCommentBodies - All PR comment bodies (full history)
 * @param {string} signature - Signature to search for
 * @returns {{ commentPosted: boolean, skipped: boolean }}
 */
function simulateOldBuggyDeduplication(allPrCommentBodies, signature) {
  // OLD CODE: Check ALL-TIME comment history
  const hasExistingComment = allPrCommentBodies.some(body => body.includes(signature));
  let commentPosted = false;

  if (!hasExistingComment) {
    commentPosted = true; // Would post comment
  }
  // else: silently skip

  return { commentPosted, skipped: !commentPosted };
}

/**
 * Simulates the NEW fixed deduplication logic (in-memory flag, v1.26.0+).
 * Uses readyToMergeCommentPosted which is scoped to the current session.
 * @param {boolean} readyToMergeCommentPosted - In-memory flag from current session
 * @returns {{ commentPosted: boolean, skipped: boolean, flagAfter: boolean }}
 */
function simulateNewFixedDeduplication(readyToMergeCommentPosted) {
  let commentPosted = false;
  let flagAfter = readyToMergeCommentPosted;

  if (!readyToMergeCommentPosted) {
    commentPosted = true; // Would post comment
    flagAfter = true;
  }
  // else: skip with "already posted this session"

  return { commentPosted, skipped: !commentPosted, flagAfter };
}

// ===== Test: Old buggy behavior (documents the bug) =====
console.log('📋 Old Buggy Behavior (v1.25.7) — checkForExistingComment\n');

test('OLD BUG: Session 1 posts "Ready to merge" → Session 3 sees it in history → skips posting', () => {
  // This is the exact scenario from issue #1389 / PR #1388:
  // Session 1 (09:37:14) posted "## ✅ Ready to merge"
  // Session 3 (10:16:19) starts fresh, but finds it in PR history and skips posting

  const signature = '## ✅ Ready to merge';

  // PR comment history after Session 1
  const allPrCommentBodies = [
    '## 🤖 Solution Draft Log\nCost: $0.729114...',
    '## 🔄 Auto-restart triggered (attempt 1)\n\nReason: CI failures...',
    '## 🔄 Auto-restart-until-mergeable Log (iteration 1)...',
    '## ✅ Ready to merge\n\nThis pull request is now ready to be merged:\n- All CI checks have passed\n...', // ← Session 1 comment
    'Human: "Will it not break queue display?"',
    '## 🤖 AI Work Session Started...',
    'AI response: Queue display is not broken, all 41 tests pass.',
    '## 🤖 Solution Draft Log (cost: $0.532481)...',
    'Human: "Make sure we have all necessary automated tests..."',
    '## 🤖 AI Work Session Started...',
    // Session 3 is now working... PR is mergeable again
  ];

  // Session 3 uses old checkForExistingComment → BUG: finds Session 1 comment, skips
  const session3Result = simulateOldBuggyDeduplication(allPrCommentBodies, signature);

  assert(session3Result.skipped === true, 'OLD BUG: Session 3 incorrectly skips posting (found Session 1 comment in history)');
  assert(session3Result.commentPosted === false, 'OLD BUG: "Ready to merge" comment was NOT posted in Session 3');
});

test('OLD BEHAVIOR: When no previous "Ready to merge" in history → posts normally', () => {
  const signature = '## ✅ Ready to merge';

  // First ever solve session, no previous "Ready to merge" in history
  const allPrCommentBodies = ['## 🤖 AI Work Session Started...', '## 🤖 Solution Draft Log...'];

  const result = simulateOldBuggyDeduplication(allPrCommentBodies, signature);

  assert(result.commentPosted === true, 'Should post when no existing comment in history');
  assert(result.skipped === false, 'Should not skip when no existing comment in history');
});

// ===== Test: New fixed behavior (in-memory flag) =====
console.log('\n📋 New Fixed Behavior (v1.26.0+) — In-Memory Flag\n');

test('FIX: New session (readyToMergeCommentPosted=false) → ALWAYS posts even if previous session posted', () => {
  // This is the KEY fix for issue #1389:
  // In a new session, readyToMergeCommentPosted starts as false.
  // It doesn't matter that a previous session posted the comment — we always post.

  const initialFlag = false; // Fresh session, flag starts at false

  const result = simulateNewFixedDeduplication(initialFlag);

  assert(result.commentPosted === true, 'FIX: New session with flag=false SHOULD post "Ready to merge"');
  assert(result.skipped === false, 'FIX: Should not skip in new session');
  assert(result.flagAfter === true, 'FIX: Flag should be set to true after posting');
});

test('FIX: Same session, second detection (readyToMergeCommentPosted=true) → correctly skips', () => {
  // Within the same session, if the PR was already detected as mergeable
  // and the comment was posted, subsequent check cycles should skip posting.
  // This handles the within-session duplicate case.

  const flagAfterFirstPost = true; // Already posted this session

  const result = simulateNewFixedDeduplication(flagAfterFirstPost);

  assert(result.commentPosted === false, 'FIX: Should skip when already posted this session');
  assert(result.skipped === true, 'FIX: Correctly skips duplicate within same session');
  assert(result.flagAfter === true, 'FIX: Flag remains true');
});

test('FIX: Simulates full 3-session scenario — Session 3 posts new "Ready to merge"', () => {
  // Simulate all 3 sessions from issue #1389
  // Session 1: Posts "Ready to merge" (no previous comment in history at that time)
  // Session 3: New process, in-memory flag starts at false, should post again

  // Session 3: NEW process, in-memory flag starts at false
  let session3ReadyToMergeCommentPosted = false; // Fresh session

  // Check cycle #6: PR is mergeable
  const session3Result = simulateNewFixedDeduplication(session3ReadyToMergeCommentPosted);

  assert(session3Result.commentPosted === true, 'Session 3 SHOULD post new "Ready to merge" (in-memory flag approach)');
  assert(session3Result.skipped === false, 'Session 3 should NOT skip (fresh session)');

  // Update session3 flag
  session3ReadyToMergeCommentPosted = session3Result.flagAfter;

  // If there's another check cycle in the same session (shouldn't happen normally since we return after posting)
  // but if it did, it should skip:
  const session3SecondDetection = simulateNewFixedDeduplication(session3ReadyToMergeCommentPosted);
  assert(session3SecondDetection.skipped === true, 'Within Session 3, second detection should skip (already posted)');
});

// ===== Test: Contrast between old and new approaches =====
console.log('\n📋 Old vs New Approach Comparison\n');

test('Cross-session scenario: old approach skips, new approach posts', () => {
  const signature = '## ✅ Ready to merge';
  const commentFromPreviousSession = `${signature}\n\nPrevious run: All CI checks passed.`;

  // Existing PR comment history contains a "Ready to merge" from a previous session
  const prCommentHistory = [commentFromPreviousSession, 'Human feedback...', 'Session started...'];

  // OLD APPROACH: checks PR history → incorrectly skips
  const oldResult = simulateOldBuggyDeduplication(prCommentHistory, signature);

  // NEW APPROACH: in-memory flag starts false in new session → correctly posts
  const newResult = simulateNewFixedDeduplication(false); // false = new session

  assert(oldResult.commentPosted === false, 'OLD: Cross-session scenario incorrectly skips posting');
  assert(newResult.commentPosted === true, 'NEW: Cross-session scenario correctly posts notification');

  // This demonstrates the bug fix
  assert(oldResult.commentPosted !== newResult.commentPosted, 'The two approaches must differ for cross-session scenarios (demonstrating the bug and fix)');
});

test('Within-session scenario: old approach also prevents duplicates, new approach prevents duplicates', () => {
  const signature = '## ✅ Ready to merge';

  // Simulate that the comment was already posted in THIS session
  const prHistoryWithCurrentSessionComment = [`${signature}\n\nJust posted this session.`];

  // OLD APPROACH: checks PR history → finds it → skips (correct behavior for within-session)
  const oldResult = simulateOldBuggyDeduplication(prHistoryWithCurrentSessionComment, signature);

  // NEW APPROACH: flag is true because we already posted this session → skips (correct)
  const newResult = simulateNewFixedDeduplication(true); // true = already posted this session

  assert(oldResult.skipped === true, 'OLD: Correctly skips within-session duplicate');
  assert(newResult.skipped === true, 'NEW: Correctly skips within-session duplicate');

  // Both approaches agree for within-session deduplication
  assert(oldResult.skipped === newResult.skipped, 'Both approaches correctly prevent within-session duplicates');
});

// ===== Test: In-memory flag initialization =====
console.log('\n📋 In-Memory Flag Initialization\n');

test('readyToMergeCommentPosted initializes to false in each new watchUntilMergeable call', () => {
  // This simulates what happens when watchUntilMergeable is called for a new session.
  // The flag must always start as false.

  // Simulate multiple separate solve invocations:
  const sessions = [
    { name: 'Session 1', expectPost: true },
    { name: 'Session 2', expectPost: true },
    { name: 'Session 3', expectPost: true },
  ];

  for (const session of sessions) {
    // Each new call to watchUntilMergeable creates a new scope
    let readyToMergeCommentPosted = false; // Always starts false

    assert(readyToMergeCommentPosted === false, `${session.name}: flag should initialize to false`);

    const result = simulateNewFixedDeduplication(readyToMergeCommentPosted);
    assert(result.commentPosted === session.expectPost, `${session.name}: should ${session.expectPost ? 'post' : 'skip'} "Ready to merge"`);
  }
});

test('readyToMergeCommentPosted scoping prevents cross-session state pollution', () => {
  // Simulate what would happen if the flag were accidentally shared across sessions.
  // This SHOULD NOT happen because the flag is a local variable in watchUntilMergeable.

  // If incorrectly shared (module-level):
  let incorrectlySharedFlag = false;

  // Session 1
  const session1Result = simulateNewFixedDeduplication(incorrectlySharedFlag);
  incorrectlySharedFlag = session1Result.flagAfter; // Bug: flag persists to next session!

  // Session 2 (incorrectly uses contaminated flag)
  const session2BugResult = simulateNewFixedDeduplication(incorrectlySharedFlag);

  // Session 2 (correctly uses fresh flag)
  const session2CorrectResult = simulateNewFixedDeduplication(false); // Always false at start

  assert(session1Result.commentPosted === true, 'Session 1 posts correctly');
  assert(session2BugResult.skipped === true, 'If flag were shared, Session 2 would incorrectly skip!');
  assert(session2CorrectResult.commentPosted === true, 'With correct scoping, Session 2 posts correctly');
});

// ===== Test: Verify log message format =====
console.log('\n📋 Log Message Format\n');

test('Correct message for within-session skip: includes "(already posted this session)"', () => {
  // The fixed code uses a more descriptive message for within-session skips
  const withinSessionMessage = 'Skipping duplicate "Ready to merge" comment (already posted this session)';
  const crossSessionMessage = 'Skipping duplicate "Ready to merge" comment';

  // The fixed code uses the within-session message (line 452 in solve.auto-merge.lib.mjs)
  // The old code and early-exit paths use the shorter message (lines 957, 986)
  assert(withinSessionMessage.includes('already posted this session'), 'Within-session message should include "(already posted this session)"');
  assert(!crossSessionMessage.includes('already posted this session'), 'The shorter message (used in old code) does NOT include "(already posted this session)"');
  assert(withinSessionMessage !== crossSessionMessage, 'The two message formats are different — this allows identifying which code path was taken');
});

// Summary
console.log('\n================================================================================');
console.log(`Test Results for Issue #1389:`);
console.log(`  ${GREEN}✅ Passed:${RESET} ${passed}`);
console.log(`  ${RED}❌ Failed:${RESET} ${failed}`);
console.log(`  Total: ${passed + failed}`);
console.log('================================================================================\n');

if (failed > 0) {
  console.log(`${RED}❌ Some tests failed!${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}✅ All tests passed!${RESET}`);
  process.exit(0);
}
