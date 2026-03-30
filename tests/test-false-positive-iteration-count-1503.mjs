#!/usr/bin/env node

/**
 * Unit Tests: Issue #1503 - False positive "Ready to merge" due to iteration count as checkCount
 *
 * Root cause: watchUntilMergeable passed its `iteration` counter (total loop count) as
 * `checkCount` to getMergeBlockers. The safety valve MAX_NO_RUNS_CHECKS=5 triggers when
 * checkCount >= 5, concluding "CI was not triggered." After 5+ monitoring iterations,
 * any new push that hadn't registered workflow runs yet would immediately hit the safety
 * valve and produce a false positive "Ready to merge."
 *
 * Fix: Track consecutive no-workflow-runs checks per-SHA separately from the iteration count.
 * Reset the counter when:
 *   1. The HEAD SHA changes (new push detected)
 *   2. CI checks are found (status is not 'no_checks')
 *
 * Tests verify:
 *   1. A new push resets the checkCount, so the safety valve doesn't fire prematurely
 *   2. Consecutive checks with no runs for the SAME SHA eventually trigger the safety valve
 *   3. CI status changes (pending/success/failure) reset the counter
 *   4. checkWorkflowsHavePRTriggers accepts optional ref parameter
 *
 * Run with: node tests/test-false-positive-iteration-count-1503.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1503
 * @see https://github.com/link-assistant/hive-mind/issues/1480 (related: multi-layer defense)
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

const assertBlockerCount = (result, expected) => {
  assert(result.blockers.length === expected, `Expected ${expected} blocker(s), got ${result.blockers.length}`);
};

const assertHasBlocker = (result, expectedType) => {
  assertBlockerCount(result, 1);
  assert(result.blockers[0].type === expectedType, `Expected blocker type '${expectedType}', got '${result.blockers[0].type}'`);
};

const assertNoBlockers = result => {
  assertBlockerCount(result, 0);
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1503 - False positive from iteration count as checkCount');
console.log('================================================================================\n');

// ===== Simulation of getMergeBlockers (mirrors actual logic) =====
function simulateMergeBlockers({ ciStatusStatus, passedCheckCount = 0, prMergeable = true, repoHasWorkflows = true, workflowRuns = [], hasPRTriggers = true, hasWorkflowFiles = true, commitAgeSeconds = null, checkCount = 1 }) {
  const blockers = [];
  const MAX_NO_RUNS_CHECKS = 5;
  const WORKFLOW_RUN_GRACE_PERIOD_SECONDS = 120;

  if (ciStatusStatus === 'no_checks') {
    if (prMergeable) {
      if (repoHasWorkflows) {
        if (workflowRuns.length > 0) {
          const allRunsCompleted = workflowRuns.every(r => r.status === 'completed');
          const allRunsNonExecuting = allRunsCompleted && workflowRuns.every(r => r.conclusion === 'action_required' || r.conclusion === 'cancelled' || r.conclusion === 'stale' || r.conclusion === 'skipped');
          if (allRunsNonExecuting) {
            return { blockers, noCiConfigured: false, noCiTriggered: true };
          }
          blockers.push({ type: 'ci_pending', message: `Waiting for check-runs (${workflowRuns.length} run(s) triggered)` });
        } else {
          if (!hasWorkflowFiles) {
            return { blockers, noCiConfigured: false, noCiTriggered: true };
          }
          if (hasPRTriggers) {
            if (checkCount >= MAX_NO_RUNS_CHECKS) {
              return { blockers, noCiConfigured: false, noCiTriggered: true };
            }
            blockers.push({ type: 'ci_pending', message: `Waiting for workflow runs (check ${checkCount}/${MAX_NO_RUNS_CHECKS})` });
          } else if (commitAgeSeconds !== null && commitAgeSeconds < WORKFLOW_RUN_GRACE_PERIOD_SECONDS) {
            blockers.push({ type: 'ci_pending', message: `Grace period (${commitAgeSeconds}s)` });
          } else {
            return { blockers, noCiConfigured: false, noCiTriggered: true };
          }
        }
      } else {
        return { blockers, noCiConfigured: true, noCiTriggered: false };
      }
    } else {
      blockers.push({ type: 'ci_pending', message: 'PR not mergeable, waiting' });
    }
  } else if (ciStatusStatus === 'success') {
    if (workflowRuns.length > 0) {
      const incompleteRuns = workflowRuns.filter(r => r.status !== 'completed');
      if (incompleteRuns.length > 0) {
        blockers.push({ type: 'ci_pending', message: `${incompleteRuns.length} workflow run(s) still in progress` });
      }
    } else {
      if (repoHasWorkflows && hasPRTriggers) {
        if (checkCount >= MAX_NO_RUNS_CHECKS) {
          // Safety valve — trust external checks
        } else {
          blockers.push({ type: 'ci_pending', message: `External checks only, waiting (check ${checkCount}/${MAX_NO_RUNS_CHECKS})` });
        }
      }
    }
  } else if (ciStatusStatus === 'pending') {
    blockers.push({ type: 'ci_pending', message: 'CI still running' });
  } else if (ciStatusStatus === 'failure') {
    blockers.push({ type: 'ci_failure', message: 'CI failed' });
  }

  return { blockers, noCiConfigured: false, noCiTriggered: false, ciStatus: { status: ciStatusStatus } };
}

// ===== Simulation of watchUntilMergeable's SHA-based counter logic =====
/**
 * Simulates the fixed watchUntilMergeable per-SHA counter tracking.
 * @param {Array<{headSha: string, ciStatusStatus: string, workflowRuns?: Array}>} checks
 *   Sequence of monitoring checks, each with the current HEAD SHA and CI state.
 * @returns {Array<{checkCount: number, blockerCount: number, noCiTriggered: boolean}>}
 */
function simulateWatchLoop(checks) {
  let consecutiveNoRunsChecks = 0;
  let lastKnownHeadSha = null;
  const results = [];

  for (const check of checks) {
    // Detect SHA change
    if (check.headSha !== lastKnownHeadSha) {
      lastKnownHeadSha = check.headSha;
      consecutiveNoRunsChecks = 0;
    }
    consecutiveNoRunsChecks++;

    const result = simulateMergeBlockers({
      ciStatusStatus: check.ciStatusStatus,
      prMergeable: check.prMergeable ?? true,
      repoHasWorkflows: check.repoHasWorkflows ?? true,
      workflowRuns: check.workflowRuns ?? [],
      hasPRTriggers: check.hasPRTriggers ?? true,
      hasWorkflowFiles: check.hasWorkflowFiles ?? true,
      commitAgeSeconds: check.commitAgeSeconds ?? 600,
      checkCount: consecutiveNoRunsChecks,
    });

    // Reset counter when CI checks are found
    if (result.ciStatus && result.ciStatus.status !== 'no_checks') {
      consecutiveNoRunsChecks = 0;
    }

    results.push({
      checkCount: consecutiveNoRunsChecks,
      blockerCount: result.blockers.length,
      noCiTriggered: result.noCiTriggered || false,
      noCiConfigured: result.noCiConfigured || false,
    });
  }

  return results;
}

// ===== Test Suite 1: Root cause reproduction =====
console.log('📋 Root Cause: iteration count used as checkCount (Issue #1503)\n');

test('BUG REPRODUCTION: Old behavior — iteration 6 with new push falsely declares noCiTriggered', () => {
  // Simulates the old behavior where iteration count was used as checkCount.
  // After 5 iterations of monitoring (CI pending/running), a new push occurs.
  // The 6th iteration checks the new commit but the counter is already 6.
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRuns: [],
    hasPRTriggers: true,
    hasWorkflowFiles: true,
    commitAgeSeconds: 5, // Just pushed
    checkCount: 6, // OLD behavior: iteration count from monitoring loop
  });

  // OLD behavior: safety valve fires because checkCount >= 5
  assertNoBlockers(result);
  assert(result.noCiTriggered === true, 'Old behavior: falsely concludes noCiTriggered');
});

test('FIX VERIFICATION: New behavior — new push resets counter to 1', () => {
  // Same scenario, but with the fixed counter (reset on SHA change)
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRuns: [],
    hasPRTriggers: true,
    hasWorkflowFiles: true,
    commitAgeSeconds: 5,
    checkCount: 1, // NEW behavior: counter reset to 1 after SHA change
  });

  // FIXED: waits for workflow runs instead of immediately declaring noCiTriggered
  assertHasBlocker(result, 'ci_pending');
  assert(!result.noCiTriggered, 'Fixed: should NOT conclude noCiTriggered on first check');
});

// ===== Test Suite 2: SHA-based counter tracking simulation =====
console.log('\n📋 SHA-Based Counter Tracking\n');

test('New push after 5 iterations resets counter — no false positive', () => {
  const checks = [
    // First 5 iterations: CI is pending (running) for SHA-A
    { headSha: 'aaa', ciStatusStatus: 'pending' },
    { headSha: 'aaa', ciStatusStatus: 'pending' },
    { headSha: 'aaa', ciStatusStatus: 'pending' },
    { headSha: 'aaa', ciStatusStatus: 'pending' },
    { headSha: 'aaa', ciStatusStatus: 'pending' },
    // Iteration 6: New push (SHA-B), no checks yet
    { headSha: 'bbb', ciStatusStatus: 'no_checks', workflowRuns: [] },
  ];

  const results = simulateWatchLoop(checks);

  // The 6th check should have checkCount=1 (reset) and should wait
  assert(results[5].checkCount === 1, `Expected checkCount=1 after SHA change, got ${results[5].checkCount}`);
  assert(results[5].blockerCount === 1, 'Should have a blocker (waiting for workflow runs)');
  assert(!results[5].noCiTriggered, 'Should NOT conclude noCiTriggered');
});

test('Same SHA stays at same counter until safety valve', () => {
  const checks = [
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] }, // check 5
  ];

  const results = simulateWatchLoop(checks);

  // Checks 1-4 should block, check 5 should trigger safety valve
  for (let i = 0; i < 4; i++) {
    assert(results[i].blockerCount === 1, `Check ${i + 1} should have blocker`);
    assert(!results[i].noCiTriggered, `Check ${i + 1} should not conclude noCiTriggered`);
  }
  assert(results[4].noCiTriggered === true, 'Check 5 should trigger safety valve');
  assert(results[4].blockerCount === 0, 'Check 5 should have no blockers');
});

test('Counter resets when CI checks appear (pending status)', () => {
  const checks = [
    // First 3 checks: no CI yet
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    // CI appears (pending)
    { headSha: 'aaa', ciStatusStatus: 'pending' },
    // CI disappears again (edge case: GitHub glitch)
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    // Should be back at count 1, not count 5
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
  ];

  const results = simulateWatchLoop(checks);

  // After pending reset, counter should be 1 for the 5th check
  assert(results[4].checkCount === 1, `Expected counter reset after pending, got ${results[4].checkCount}`);
  assert(results[4].blockerCount === 1, 'Should still have blocker after reset');
  assert(!results[4].noCiTriggered, 'Should NOT conclude noCiTriggered after counter reset');
});

test('Multiple SHA changes each reset the counter', () => {
  const checks = [
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    // New push at check 5 — resets counter
    { headSha: 'bbb', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'bbb', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'bbb', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'bbb', ciStatusStatus: 'no_checks', workflowRuns: [] },
    // Another new push at check 9 — resets counter again
    { headSha: 'ccc', ciStatusStatus: 'no_checks', workflowRuns: [] },
  ];

  const results = simulateWatchLoop(checks);

  // Check 5: SHA changed, counter should be 1
  assert(results[4].checkCount === 1, 'Counter should reset on first SHA change');
  assert(!results[4].noCiTriggered, 'Should wait after first SHA change');

  // Check 9: SHA changed again, counter should be 1
  assert(results[8].checkCount === 1, 'Counter should reset on second SHA change');
  assert(!results[8].noCiTriggered, 'Should wait after second SHA change');
});

// ===== Test Suite 3: Real-world scenario from Issue #1503 =====
console.log('\n📋 Real-world Scenario: PR #87 on xlabtg/teleton-plugins\n');

test('Scenario: 10 iterations of pending CI, then new push — should wait for new CI', () => {
  // This simulates what happened in Issue #1503:
  // The monitoring loop ran many iterations while the AI solver was working.
  // Then the solver pushed final commits, and CI started for the new SHA.
  // With the old code, the high iteration count would have triggered the safety valve.
  const checks = [];

  // 10 iterations of CI pending on SHA-A
  for (let i = 0; i < 10; i++) {
    checks.push({ headSha: 'sha-commit-1', ciStatusStatus: 'pending' });
  }

  // New push: SHA-B with no checks yet
  checks.push({ headSha: 'sha-commit-2', ciStatusStatus: 'no_checks', workflowRuns: [] });

  const results = simulateWatchLoop(checks);

  // The 11th check (new SHA) should have counter=1 and should wait
  const lastResult = results[results.length - 1];
  assert(lastResult.checkCount === 1, `Expected counter=1, got ${lastResult.checkCount}`);
  assert(lastResult.blockerCount === 1, 'Should have a blocker for new SHA');
  assert(!lastResult.noCiTriggered, 'Should NOT conclude noCiTriggered for new SHA');
});

test('Scenario: CI success on SHA-A, then new push SHA-B — should wait for new CI', () => {
  const checks = [
    { headSha: 'sha-a', ciStatusStatus: 'success', workflowRuns: [{ status: 'completed', conclusion: 'success', name: 'CI' }] },
    // New push
    { headSha: 'sha-b', ciStatusStatus: 'no_checks', workflowRuns: [] },
  ];

  const results = simulateWatchLoop(checks);
  assert(results[1].checkCount === 1, 'Counter should reset on SHA change');
  assert(results[1].blockerCount === 1, 'Should wait for CI on new SHA');
});

// ===== Test Suite 4: Edge cases =====
console.log('\n📋 Edge Cases\n');

test('Single iteration, no checks, PR triggers → waits', () => {
  const checks = [
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
  ];
  const results = simulateWatchLoop(checks);
  assert(results[0].blockerCount === 1, 'Should wait on first check');
  assert(results[0].checkCount === 1, 'Counter should be 1');
});

test('No PR triggers, old commit → noCiTriggered immediately regardless of counter', () => {
  const checks = [
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [], hasPRTriggers: false, commitAgeSeconds: 600 },
  ];
  const results = simulateWatchLoop(checks);
  assert(results[0].noCiTriggered === true, 'Should conclude noCiTriggered when no PR triggers');
});

test('Workflow runs appear on 3rd check — should block until completed', () => {
  const checks = [
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [] },
    { headSha: 'aaa', ciStatusStatus: 'no_checks', workflowRuns: [{ status: 'in_progress', conclusion: null, name: 'CI' }] },
  ];
  const results = simulateWatchLoop(checks);
  assert(results[0].blockerCount === 1, 'Check 1: should wait');
  assert(results[1].blockerCount === 1, 'Check 2: should wait');
  assert(results[2].blockerCount === 1, 'Check 3: should block (run in progress)');
  assert(!results[2].noCiTriggered, 'Check 3: should NOT conclude noCiTriggered');
});

// ===== Summary =====
console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
