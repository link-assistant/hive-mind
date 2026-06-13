#!/usr/bin/env node

/**
 * Unit Tests: Issue #1918 - /merge watch loop stuck for over an hour
 *
 * Root cause: The auto-merge watch loop reset its consecutive "no workflow runs" counter
 * (`consecutiveNoRunsChecks`) on every iteration whenever `ciStatus.status !== 'no_checks'`.
 * For a fork PR whose only workflow triggers on `push` (which never fires for fork commits
 * in the base repo), an external check (e.g. CodeRabbit) reported status 'success' while the
 * repo's own PR-triggered workflows produced 0 workflow runs. getMergeBlockers kept emitting
 * the "no workflow runs, check 1/5" wait, but because `ciStatus.status === 'success'`, the
 * caller reset the counter to 0 every iteration. The safety valve (MAX_NO_RUNS_CHECKS=5)
 * therefore NEVER fired, so the loop hung indefinitely (observed > 1 hour).
 *
 * Fix: getMergeBlockers now exports a `noWorkflowRunsForCommit` flag that is true whenever it
 * is still inside the "waiting for PR-triggered workflow runs" path, and the new pure helper
 * `shouldResetNoRunsCounter(ciStatus, noWorkflowRunsForCommit)` returns false in that case so
 * the counter keeps climbing toward the safety valve regardless of ciStatus.
 *
 * Tests verify:
 *   1. shouldResetNoRunsCounter does NOT reset while still waiting for workflow runs,
 *      even when ciStatus.status === 'success' (the exact #1918 scenario).
 *   2. shouldResetNoRunsCounter DOES reset when genuine CI checks exist and we are not waiting.
 *   3. shouldResetNoRunsCounter does NOT reset for 'no_checks' (existing behavior preserved).
 *   4. A simulated watch loop over repeated success + 0-runs checks for the SAME SHA reaches
 *      the safety valve (counter >= 5) instead of being pinned at "check 1/5" forever.
 *   5. The OLD buggy reset logic is shown to hang (counter never exceeds 1) — proving the test
 *      actually reproduces the bug before the fix.
 *
 * Run with: node tests/test-merge-stuck-no-workflow-runs-1918.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1918
 * @see https://github.com/link-assistant/hive-mind/issues/1503 (related: per-SHA counter)
 * @see https://github.com/link-assistant/hive-mind/issues/1480 (related: multi-layer defense)
 */

import { shouldResetNoRunsCounter } from '../src/solve.auto-merge-helpers.lib.mjs';

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
console.log('Unit Tests: Issue #1918 - /merge watch loop stuck for over an hour');
console.log('================================================================================\n');

// ===== Test Suite 1: shouldResetNoRunsCounter pure helper =====
console.log('📋 shouldResetNoRunsCounter pure helper\n');

test('Does NOT reset while waiting for workflow runs even when status is success (#1918)', () => {
  // The exact #1918 scenario: external check reports 'success', repo has PR-triggered
  // workflows with 0 runs, getMergeBlockers signals it is still waiting.
  const ciStatus = { status: 'success' };
  assert(shouldResetNoRunsCounter(ciStatus, true) === false, 'Must NOT reset while waiting for workflow runs');
});

test('Does NOT reset while waiting for workflow runs when status is no_checks', () => {
  const ciStatus = { status: 'no_checks' };
  assert(shouldResetNoRunsCounter(ciStatus, true) === false, 'Must NOT reset while waiting (no_checks)');
});

test('DOES reset when genuine CI checks exist and not waiting (success)', () => {
  const ciStatus = { status: 'success' };
  assert(shouldResetNoRunsCounter(ciStatus, false) === true, 'Should reset when real checks exist');
});

test('DOES reset when genuine CI checks exist and not waiting (pending)', () => {
  const ciStatus = { status: 'pending' };
  assert(shouldResetNoRunsCounter(ciStatus, false) === true, 'Should reset for pending checks');
});

test('DOES reset for failure status when not waiting', () => {
  const ciStatus = { status: 'failure' };
  assert(shouldResetNoRunsCounter(ciStatus, false) === true, 'Should reset for failure checks');
});

test('Does NOT reset for no_checks status when not waiting (existing behavior)', () => {
  const ciStatus = { status: 'no_checks' };
  assert(shouldResetNoRunsCounter(ciStatus, false) === false, 'no_checks should not reset');
});

test('Does NOT reset for null/undefined ciStatus when not waiting', () => {
  assert(shouldResetNoRunsCounter(null, false) === false, 'null ciStatus should not reset');
  assert(shouldResetNoRunsCounter(undefined, false) === false, 'undefined ciStatus should not reset');
});

test('noWorkflowRunsForCommit defaults to false', () => {
  // Called with a single argument — should behave as not-waiting.
  assert(shouldResetNoRunsCounter({ status: 'success' }) === true, 'Default arg: real checks reset');
  assert(shouldResetNoRunsCounter({ status: 'no_checks' }) === false, 'Default arg: no_checks does not reset');
});

// ===== Test Suite 2: Simulated watch loop — fixed vs buggy reset logic =====
console.log('\n📋 Simulated watch loop: success + 0 workflow runs + same SHA\n');

const MAX_NO_RUNS_CHECKS = 5;

/**
 * Simulates the auto-merge watch loop's per-SHA counter over a sequence of checks.
 * Each check mirrors a getMergeBlockers() result.
 *
 * @param {Array<{headSha: string, ciStatus: {status: string}, noWorkflowRunsForCommit: boolean}>} checks
 * @param {(ciStatus: object, noWorkflowRunsForCommit: boolean) => boolean} resetFn
 *   Reset decision function (the fixed helper, or a buggy stand-in).
 * @returns {Array<{checkCount: number, safetyValveFired: boolean}>}
 */
function simulateWatchLoop(checks, resetFn) {
  let consecutiveNoRunsChecks = 0;
  let lastKnownHeadSha = null;
  const results = [];

  for (const check of checks) {
    // SHA-change reset (Issue #1503) — independent of CI status.
    if (check.headSha !== lastKnownHeadSha) {
      lastKnownHeadSha = check.headSha;
      consecutiveNoRunsChecks = 0;
    }
    // getMergeBlockers receives the incremented counter as checkCount (Issue #1503).
    consecutiveNoRunsChecks++;

    // The safety valve fires inside getMergeBlockers when checkCount >= MAX_NO_RUNS_CHECKS
    // while still in the no-workflow-runs path.
    const safetyValveFired = check.noWorkflowRunsForCommit && consecutiveNoRunsChecks >= MAX_NO_RUNS_CHECKS;

    // Caller-side reset decision (the code under test).
    if (resetFn(check.ciStatus, check.noWorkflowRunsForCommit)) {
      consecutiveNoRunsChecks = 0;
    }

    results.push({ checkCount: consecutiveNoRunsChecks, safetyValveFired });
  }

  return results;
}

// Build the #1918 reproduction: 6 consecutive checks, same SHA, external 'success' with
// 0 workflow runs (still waiting for PR-triggered runs that never appear).
const stuckChecks = Array.from({ length: 6 }, () => ({
  headSha: 'forkpr-sha-aaaaaaa',
  ciStatus: { status: 'success' },
  noWorkflowRunsForCommit: true,
}));

test('FIX: counter climbs to safety valve over repeated success + 0-runs checks', () => {
  const results = simulateWatchLoop(stuckChecks, shouldResetNoRunsCounter);
  // Counter must climb 1,2,3,4,5,... — never reset.
  assert(results[0].checkCount === 1, `check 1: expected 1, got ${results[0].checkCount}`);
  assert(results[3].checkCount === 4, `check 4: expected 4, got ${results[3].checkCount}`);
  assert(results[4].checkCount === 5, `check 5: expected 5, got ${results[4].checkCount}`);
  assert(results[4].safetyValveFired === true, 'check 5: safety valve MUST fire (>= MAX_NO_RUNS_CHECKS)');
});

test('BUG REPRODUCTION: old reset logic pins counter at 1 forever — valve never fires', () => {
  // The old logic: reset whenever ciStatus.status !== 'no_checks' (ignores the waiting flag).
  const buggyReset = ciStatus => Boolean(ciStatus && ciStatus.status !== 'no_checks');
  const results = simulateWatchLoop(stuckChecks, buggyReset);
  // The counter increments to 1 then resets to 0 every iteration, so checkCount passed to
  // getMergeBlockers is always 1 — it never climbs toward MAX_NO_RUNS_CHECKS and the safety
  // valve NEVER fires. This is the infinite-loop bug that hung /merge for over an hour.
  for (let i = 0; i < results.length; i++) {
    assert(results[i].checkCount <= 1, `old logic check ${i + 1}: expected counter stuck low, got ${results[i].checkCount}`);
    assert(results[i].safetyValveFired === false, `old logic check ${i + 1}: valve should NEVER fire (this is the bug)`);
  }
});

test('FIX: real CI checks (pending) still reset the counter as before', () => {
  const checks = [
    { headSha: 'aaa', ciStatus: { status: 'no_checks' }, noWorkflowRunsForCommit: true },
    { headSha: 'aaa', ciStatus: { status: 'no_checks' }, noWorkflowRunsForCommit: true },
    // Real workflow runs appear → pending, no longer waiting.
    { headSha: 'aaa', ciStatus: { status: 'pending' }, noWorkflowRunsForCommit: false },
  ];
  const results = simulateWatchLoop(checks, shouldResetNoRunsCounter);
  assert(results[1].checkCount === 2, `check 2: expected 2, got ${results[1].checkCount}`);
  assert(results[2].checkCount === 0, `check 3 (pending): expected reset to 0, got ${results[2].checkCount}`);
});

test('FIX: SHA change still resets the counter (regression guard for #1503)', () => {
  const checks = [
    { headSha: 'aaa', ciStatus: { status: 'success' }, noWorkflowRunsForCommit: true },
    { headSha: 'aaa', ciStatus: { status: 'success' }, noWorkflowRunsForCommit: true },
    { headSha: 'aaa', ciStatus: { status: 'success' }, noWorkflowRunsForCommit: true },
    // New push → counter resets even though we are still in the waiting path.
    { headSha: 'bbb', ciStatus: { status: 'success' }, noWorkflowRunsForCommit: true },
  ];
  const results = simulateWatchLoop(checks, shouldResetNoRunsCounter);
  assert(results[2].checkCount === 3, `check 3: expected 3, got ${results[2].checkCount}`);
  assert(results[3].checkCount === 1, `check 4 (new SHA): expected 1, got ${results[3].checkCount}`);
});

// ===== Summary =====
console.log('\n================================================================================');
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ''}${failed} failed${RESET}`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
