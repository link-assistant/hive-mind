#!/usr/bin/env node

/**
 * Unit Tests: Issue #1584 - No "Ready to merge" comment after second working session
 *
 * Tests verify that:
 * 1. checkForExistingComment only searches for duplicates AFTER the last session-ending comment
 * 2. A "Ready to merge" comment from a previous session (before a new session-ending comment)
 *    does NOT suppress a new "Ready to merge" comment in the current session
 * 3. A "Ready to merge" comment posted AFTER the last session-ending comment IS correctly
 *    detected as a duplicate (within-session deduplication still works)
 * 4. When no session-ending comment exists, all comments are searched (backward compatibility)
 *
 * Root cause: checkForExistingComment searched the ENTIRE PR comment history for the
 * "## ✅ Ready to merge" signature. When a new working session started after user feedback,
 * the old "Ready to merge" from the previous session was found, and the new one was suppressed.
 *
 * The fix: Narrow the search scope to only look for the signature AFTER the last
 * session-ending comment. Session-ending markers include:
 * - "Now working session is ended" — present in all log upload comments
 * - "AI Work Session Completed" — posted when logs are not attached
 *
 * Real-world case: linksplatform/Numbers PR #143
 * - Session 1: Solution Draft Log at 02:00:21Z, "Ready to merge" at 02:02:43Z
 * - User feedback at 02:26:52Z, new session started at 02:30:18Z
 * - Session 2: Solution Draft Log at 02:38:22Z — but NO "Ready to merge" was posted
 *
 * Run with: node tests/test-ready-to-merge-after-solution-draft-1584.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1584
 * @see https://github.com/linksplatform/Numbers/pull/143
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

/**
 * Simulate the OLD buggy checkForExistingComment behavior (pre-fix).
 * Searches ALL PR comments for the signature.
 * @param {string[]} commentBodies - Array of all PR comment bodies in chronological order
 * @param {string} signature - Signature to search for
 * @returns {boolean} - True if signature found anywhere in comments
 */
function oldCheckForExistingComment(commentBodies, signature) {
  return commentBodies.some(body => body && body.includes(signature));
}

/**
 * Simulate the NEW fixed checkForExistingComment behavior (issue #1584 fix).
 * Only searches for the signature AFTER the last session-ending comment.
 * Session-ending markers include:
 * - "Now working session is ended" — in all log upload comments
 * - "AI Work Session Completed" — posted when logs are not attached
 * @param {string[]} commentBodies - Array of all PR comment bodies in chronological order
 * @param {string} signature - Signature to search for
 * @returns {boolean} - True if signature found after the last session-ending comment
 */
function newCheckForExistingComment(commentBodies, signature) {
  const sessionEndingMarkers = ['Now working session is ended', 'AI Work Session Completed'];
  let searchStartIndex = 0;

  // Find the last session-ending comment
  for (let i = commentBodies.length - 1; i >= 0; i--) {
    if (commentBodies[i] && sessionEndingMarkers.some(marker => commentBodies[i].includes(marker))) {
      searchStartIndex = i + 1;
      break;
    }
  }

  // Only search in comments after the last session-ending comment
  for (let i = searchStartIndex; i < commentBodies.length; i++) {
    if (commentBodies[i] && commentBodies[i].includes(signature)) {
      return true;
    }
  }

  return false;
}

console.log('================================================================================');
console.log('Unit Tests: Issue #1584 - checkForExistingComment scope narrowing');
console.log('================================================================================\n');

// ===== Test: Real-world case from linksplatform/Numbers PR #143 =====
console.log('📋 Real-World Case: linksplatform/Numbers PR #143\n');

test('BUG REPRODUCED: Old logic finds "Ready to merge" from Session 1 and skips Session 2', () => {
  // This reproduces the exact scenario from the issue
  const signature = '## ✅ Ready to merge';

  const commentBodies = [
    // Session 1
    '## 🤖 Solution Draft Log\nThis log file contains the complete execution trace...\nCost: $3.661450\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    '## ✅ Ready to merge\n\nThis pull request is now ready to be merged:\n- All CI checks have passed\n- No merge conflicts\n- No pending changes',
    // User feedback
    'TODO cannot be just removed - we should either implement them...',
    '🤖 **AI Work Session Started**\n\nStarting automated work session at 2026-04-11T02:30:16.870Z',
    // Session 2
    '## 🤖 Solution Draft Log\nThis log file contains the complete execution trace...\nCost: $2.627869\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    // Now watchUntilMergeable runs checkForExistingComment...
  ];

  // OLD: Finds "Ready to merge" from Session 1 → returns true → suppresses new comment
  const oldResult = oldCheckForExistingComment(commentBodies, signature);
  assert(oldResult === true, 'OLD BUG: Should find the old "Ready to merge" comment');
});

test('FIX VERIFIED: New logic does NOT find "Ready to merge" after Session 2 Solution Draft Log', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = [
    // Session 1
    '## 🤖 Solution Draft Log\nThis log file contains the complete execution trace...\nCost: $3.661450\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    '## ✅ Ready to merge\n\nThis pull request is now ready to be merged:\n- All CI checks have passed',
    // User feedback
    'TODO cannot be just removed...',
    '🤖 **AI Work Session Started**',
    // Session 2
    '## 🤖 Solution Draft Log\nThis log file contains the complete execution trace...\nCost: $2.627869\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    // No "Ready to merge" after this Solution Draft Log
  ];

  // NEW: Only searches after last session-ending comment (index 4) → no match → returns false → posts new comment
  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'FIX: Should NOT find "Ready to merge" after the latest session-ending comment');
});

test('BUG vs FIX: Old approach suppresses, new approach allows posting', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = ['## 🤖 Solution Draft Log\nSession 1 log...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*', '## ✅ Ready to merge\n\nSession 1 ready...', 'User feedback...', '## 🤖 Solution Draft Log\nSession 2 log...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*'];

  const oldResult = oldCheckForExistingComment(commentBodies, signature);
  const newResult = newCheckForExistingComment(commentBodies, signature);

  assert(oldResult === true, 'OLD: Incorrectly finds old "Ready to merge"');
  assert(newResult === false, 'NEW: Correctly ignores old "Ready to merge" before latest session-ending comment');
  assert(oldResult !== newResult, 'The two approaches must differ — demonstrates the bug and fix');
});

// ===== Test: Within-session deduplication still works =====
console.log('\n📋 Within-Session Deduplication\n');

test('Within-session: "Ready to merge" posted AFTER last session-ending comment IS detected as duplicate', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = [
    '## 🤖 Solution Draft Log\nSession 1...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    '## ✅ Ready to merge\nSession 1 ready...',
    'User feedback...',
    '## 🤖 Solution Draft Log\nSession 2...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    '## ✅ Ready to merge\nSession 2 ready...', // ← Already posted for this session
  ];

  // Both old and new should detect this as a duplicate
  const oldResult = oldCheckForExistingComment(commentBodies, signature);
  const newResult = newCheckForExistingComment(commentBodies, signature);

  assert(oldResult === true, 'OLD: Correctly finds duplicate');
  assert(newResult === true, 'NEW: Correctly finds duplicate after latest session-ending comment');
});

test('Duplicate detection works when "Ready to merge" is posted by another concurrent process', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = ['## 🤖 Solution Draft Log\nCurrent session...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*', '## ✅ Ready to merge\nPosted by concurrent process...'];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === true, 'Should detect duplicate posted by concurrent process after session-ending comment');
});

// ===== Test: Backward compatibility =====
console.log('\n📋 Backward Compatibility\n');

test('When no Solution Draft Log exists, all comments are searched', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = ['Some initial comment...', '## ✅ Ready to merge\n\nPR is ready...', 'Another comment...'];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === true, 'Should find signature when no Solution Draft Log exists (searchStartIndex=0)');
});

test('When no Solution Draft Log and no matching comment, returns false', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = ['Some comment...', 'Another comment...'];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'Should return false when no matching comment exists');
});

test('Empty comment array returns false', () => {
  const signature = '## ✅ Ready to merge';

  const newResult = newCheckForExistingComment([], signature);
  assert(newResult === false, 'Should return false for empty comment array');
});

// ===== Test: Edge cases =====
console.log('\n📋 Edge Cases\n');

test('Multiple session-ending comments: only searches after the LAST one', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = [
    '## 🤖 Solution Draft Log\nSession 1...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    '## ✅ Ready to merge\nSession 1...',
    '## 🤖 Solution Draft Log\nSession 2...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    '## ✅ Ready to merge\nSession 2...',
    '## 🤖 Solution Draft Log\nSession 3...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*', // ← LAST
    // No "Ready to merge" after this
  ];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'Should only search after the LAST session-ending comment');
});

test('Solution Draft Log variants: "(Resumed)" and "(Truncated)" are recognized via session-ending text', () => {
  const signature = '## ✅ Ready to merge';

  // Test with "Solution Draft Log (Resumed)" variant — it contains the session-ending text
  const commentBodiesResumed = ['## 🤖 Solution Draft Log\nSession 1...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*', '## ✅ Ready to merge\nSession 1...', '## 🔄 Solution Draft Log (Resumed)\nSession 2...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*'];

  // The "Resumed" variant contains "Now working session is ended", so it IS recognized as session-ending
  const newResult = newCheckForExistingComment(commentBodiesResumed, signature);
  assert(newResult === false, 'Resumed variant is recognized via "Now working session is ended" text');
});

test('Solution Draft Log (Truncated) variant is recognized as session-ending', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = ['## 🤖 Solution Draft Log\nSession 1...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*', '## ✅ Ready to merge\nSession 1...', '## 🤖 Solution Draft Log (Truncated)\nSession 2...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*'];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'Truncated variant is recognized via "Now working session is ended" text');
});

test('Session-ending comment as the very last comment: searches zero comments after it', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = ['## ✅ Ready to merge\nOld...', '## 🤖 Solution Draft Log\nLatest session...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*'];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'No comments after session-ending comment → no duplicate found');
});

test('"Ready to merge" appears in user text but not as a heading', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = [
    '## 🤖 Solution Draft Log\nSession...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    'I think the PR is ready to merge now. Let me know.', // ← NOT a heading
  ];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'Should not match partial signature — requires full "## ✅ Ready to merge"');
});

test('Only session-ending comments in PR, no "Ready to merge" ever posted', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = ['## 🤖 Solution Draft Log\nSession 1...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*', 'User feedback...', '## 🤖 Solution Draft Log\nSession 2...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*', 'More feedback...', '## 🤖 Solution Draft Log\nSession 3...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*'];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'No "Ready to merge" has ever been posted → should return false');
});

// ===== Test: Fork mode paths also benefit from the fix =====
console.log('\n📋 Fork Mode Paths\n');

test('Fork mode: old "Ready to merge" before new session-ending comment should not suppress new one', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = ['## 🤖 Solution Draft Log\nSession 1...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*', '## ✅ Ready to merge\n\nThis pull request is ready to be merged. Auto-merge was requested (`--auto-merge`) but cannot be performed because this PR was created from a fork', 'User feedback...', '## 🤖 Solution Draft Log\nSession 2...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*'];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'Fork mode: old "Ready to merge" should not suppress new one after new session-ending comment');
});

// ===== Test: Auto-restart-until-mergeable Log as session boundary =====
console.log('\n📋 Auto-restart-until-mergeable Log as Session Boundary\n');

test('Auto-restart-until-mergeable Log ends a session and resets deduplication scope', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = [
    '## 🤖 Solution Draft Log\nSession 1...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    '## ✅ Ready to merge\nSession 1 ready...',
    '## 🔄 Auto-restart triggered (iteration 1)\n\n**Reason:** CI failures detected',
    '## 🔄 Auto-restart-until-mergeable Log (iteration 1)\nThis log file contains the complete execution trace...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    // No "Ready to merge" after Auto-restart-until-mergeable Log
  ];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'Auto-restart-until-mergeable Log should reset deduplication — old "Ready to merge" ignored');
});

test('Auto-restart Log (watch mode) ends a session and resets deduplication scope', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = [
    '## 🤖 Solution Draft Log\nSession 1...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    '## ✅ Ready to merge\nSession 1 ready...',
    '## 🔄 Auto-restart 1/3 Log\nThis log file contains the complete execution trace...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    // No "Ready to merge" after Auto-restart Log
  ];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'Auto-restart Log should reset deduplication — old "Ready to merge" ignored');
});

test('Auto-restart Failure Log ends a session and resets deduplication scope', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = ['## 🤖 Solution Draft Log\nSession 1...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*', '## ✅ Ready to merge\nSession 1 ready...', '## ⚠️ Auto-restart 1/3 Failure Log\nThis log file contains the complete execution trace...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*'];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'Auto-restart Failure Log should reset deduplication — old "Ready to merge" ignored');
});

// ===== Test: AI Work Session Completed as session boundary =====
console.log('\n📋 AI Work Session Completed as Session Boundary\n');

test('AI Work Session Completed ends a session and resets deduplication scope', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = [
    '## ✅ Ready to merge\nSession 1 ready...',
    '🤖 **AI Work Session Completed**\n\nWork session ended at 2026-04-11T03:00:00Z\n\nThe PR will be converted back to ready for review.',
    // New session starts, no "Ready to merge" yet
  ];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'AI Work Session Completed should reset deduplication — old "Ready to merge" ignored');
});

test('AI Work Session Completed followed by new "Ready to merge" is detected as duplicate', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = [
    '## ✅ Ready to merge\nOld session...',
    '🤖 **AI Work Session Completed**\n\nWork session ended at 2026-04-11T03:00:00Z',
    '## ✅ Ready to merge\nNew session ready...', // Already posted for new session
  ];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === true, 'Should detect duplicate after AI Work Session Completed');
});

test('Mixed session-ending markers: latest one determines scope', () => {
  const signature = '## ✅ Ready to merge';

  const commentBodies = [
    '## 🤖 Solution Draft Log\nSession 1...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    '## ✅ Ready to merge\nSession 1...',
    '## 🔄 Auto-restart-until-mergeable Log (iteration 1)\nLog...\n\n*Now working session is ended, feel free to review and add any feedback on the solution draft.*',
    '## ✅ Ready to merge\nIteration 1...',
    '🤖 **AI Work Session Completed**\n\nWork session ended at 2026-04-11T04:00:00Z', // ← LATEST session-ending
    // No "Ready to merge" after this
  ];

  const newResult = newCheckForExistingComment(commentBodies, signature);
  assert(newResult === false, 'Latest session-ending marker (AI Work Session Completed) should determine scope');
});

// Summary
console.log('\n================================================================================');
console.log(`Test Results for Issue #1584:`);
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
