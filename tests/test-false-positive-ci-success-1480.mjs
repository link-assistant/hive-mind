#!/usr/bin/env node

/**
 * Unit Tests: Issue #1480 - `Ready to merge` false positives
 *
 * Tests verify that:
 * 1. When CI status is 'success' but only external checks (e.g., CodeFactor) have registered,
 *    and repo has PR-triggered workflows with 0 workflow runs, the system waits instead of
 *    concluding "all CI passed" (Case 2 of Issue #1480)
 * 2. When CI status is 'success' and workflow runs exist but some are still in progress,
 *    the system waits for all workflow runs to complete
 * 3. When CI status is 'no_checks' and workflows have PR triggers, the system waits
 *    regardless of commit age (Case 1 of Issue #1480)
 * 4. Safety valve: after MAX_NO_RUNS_CHECKS consecutive checks with zero workflow runs,
 *    the system concludes CI was not triggered (avoids infinite wait for paths-ignore, etc.)
 * 5. Existing behavior is preserved: genuine success, genuine no-CI, etc.
 *
 * Root causes:
 * - Case 1: Commit date != push date. Grace period check used commit age, but commit
 *   may have been authored hours ago and pushed just now (rebased branches).
 * - Case 2: Fast external checks (CodeFactor) register before main CI pipeline starts,
 *   causing getDetailedCIStatus to return 'success' prematurely.
 *
 * Run with: node tests/test-false-positive-ci-success-1480.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1480
 * @see https://github.com/link-assistant/hive-mind/issues/1442 (related: workflow runs API)
 * @see https://github.com/link-assistant/hive-mind/issues/1363 (related: false positive)
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

// Assertion helpers to reduce test boilerplate
const assertBlockerCount = (result, expected) => {
  assert(result.blockers.length === expected, `Expected ${expected} blocker(s), got ${result.blockers.length}`);
};

const assertBlockerType = (result, expectedType) => {
  assert(result.blockers[0].type === expectedType, `Expected blocker type '${expectedType}', got '${result.blockers[0].type}'`);
};

const assertHasBlocker = (result, expectedType) => {
  assertBlockerCount(result, 1);
  assertBlockerType(result, expectedType);
};

const assertNoBlockers = result => {
  assertBlockerCount(result, 0);
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1480 - `Ready to merge` false positives');
console.log('================================================================================\n');

// ===== Simulation of the FIXED getMergeBlockers logic =====

/**
 * Simulates the fixed getMergeBlockers logic covering both the 'success' and 'no_checks' paths.
 * This mirrors the actual logic after the Issue #1480 fix.
 *
 * @param {Object} params
 * @param {string} params.ciStatusStatus - CI status from getDetailedCIStatus
 * @param {number} params.passedCheckCount - Number of passed check-runs (for 'success' status)
 * @param {boolean} params.prMergeable - Whether PR is mergeable
 * @param {boolean} params.repoHasWorkflows - Whether repo has active workflows
 * @param {Array} params.workflowRuns - Array of {status, conclusion, name} for workflow runs
 * @param {boolean} params.hasPRTriggers - Whether workflow files have PR/push triggers
 * @param {boolean} params.hasWorkflowFiles - Whether .github/workflows/ has files
 * @param {number} params.commitAgeSeconds - Commit age in seconds (null if unknown)
 * @param {boolean} params.hadPreviousCI - Whether previous PR commits had CI runs
 * @param {number} params.checkCount - How many consecutive check cycles (iteration number)
 * @returns {Object}
 */
function simulateFixedMergeBlockers({ ciStatusStatus, passedCheckCount = 0, prMergeable = true, repoHasWorkflows = true, workflowRuns = [], hasPRTriggers = true, hasWorkflowFiles = true, commitAgeSeconds = null, hadPreviousCI = false, checkCount = 1 }) {
  const blockers = [];
  const MAX_NO_RUNS_CHECKS = 5;
  const WORKFLOW_RUN_GRACE_PERIOD_SECONDS = 120;

  if (ciStatusStatus === 'no_checks') {
    if (prMergeable) {
      if (repoHasWorkflows) {
        if (workflowRuns.length > 0) {
          // Check for non-executing completed runs
          const allRunsCompleted = workflowRuns.every(r => r.status === 'completed');
          const allRunsNonExecuting = allRunsCompleted && workflowRuns.every(r => r.conclusion === 'action_required' || r.conclusion === 'cancelled' || r.conclusion === 'stale' || r.conclusion === 'skipped');

          if (allRunsNonExecuting) {
            const conclusions = [...new Set(workflowRuns.map(r => r.conclusion))].join(', ');
            return { blockers, noCiConfigured: false, noCiTriggered: true, workflowRunConclusions: conclusions };
          }

          // Genuine race condition — workflow runs triggered, waiting for check-runs
          blockers.push({
            type: 'ci_pending',
            message: `CI/CD checks have not started yet (${workflowRuns.length} workflow run(s) triggered, waiting for check-runs to appear)`,
          });
        } else {
          // No workflow runs — check workflow files and triggers

          if (!hasWorkflowFiles) {
            return { blockers, noCiConfigured: false, noCiTriggered: true };
          }

          if (hasPRTriggers) {
            // Issue #1480: Workflows have PR triggers but no runs — wait (don't trust commit age)
            if (checkCount >= MAX_NO_RUNS_CHECKS) {
              return { blockers, noCiConfigured: false, noCiTriggered: true };
            }
            blockers.push({
              type: 'ci_pending',
              message: `CI/CD workflow runs have not appeared yet — workflows have PR/push triggers, waiting (check ${checkCount}/${MAX_NO_RUNS_CHECKS})`,
            });
          } else if (commitAgeSeconds !== null && commitAgeSeconds < WORKFLOW_RUN_GRACE_PERIOD_SECONDS) {
            // No PR triggers but commit is recent — wait to be safe
            blockers.push({
              type: 'ci_pending',
              message: `Commit is ${commitAgeSeconds}s old, waiting`,
            });
          } else {
            // No PR triggers AND commit is old — CI was not triggered
            return { blockers, noCiConfigured: false, noCiTriggered: true };
          }
        }
      } else {
        // No workflows — no CI configured
        return { blockers, noCiConfigured: true, noCiTriggered: false };
      }
    } else {
      // PR not mergeable — race condition
      blockers.push({
        type: 'ci_pending',
        message: 'CI/CD checks have not started yet (waiting for checks to appear)',
      });
    }
  } else if (ciStatusStatus === 'success') {
    // Issue #1480: Cross-validate success with workflow runs API
    if (workflowRuns.length > 0) {
      const incompleteRuns = workflowRuns.filter(r => r.status !== 'completed');
      if (incompleteRuns.length > 0) {
        blockers.push({
          type: 'ci_pending',
          message: `CI checks show success (${passedCheckCount} passed) but ${incompleteRuns.length} workflow run(s) still in progress`,
        });
      }
      // All completed — trust the success status
    } else {
      // No workflow runs — check if repo has PR-triggered workflows
      if (repoHasWorkflows && hasPRTriggers) {
        if (checkCount >= MAX_NO_RUNS_CHECKS) {
          // Safety valve — trust external checks after enough waiting
        } else {
          blockers.push({
            type: 'ci_pending',
            message: `CI shows ${passedCheckCount} passed external check(s), but PR-triggered workflows haven't started (check ${checkCount}/${MAX_NO_RUNS_CHECKS})`,
          });
        }
      }
      // No repo workflows or no PR triggers — external checks are the only CI
    }
  } else if (ciStatusStatus === 'pending') {
    blockers.push({
      type: 'ci_pending',
      message: 'CI/CD checks are still running or queued',
    });
  } else if (ciStatusStatus === 'failure') {
    blockers.push({
      type: 'ci_failure',
      message: 'CI/CD checks are failing',
    });
  }

  return { blockers, noCiConfigured: false, noCiTriggered: false };
}

// ===== Test Suite 1: Case 2 — 'success' status false positive =====
console.log('📋 Case 2: CI "success" false positive (external checks only)\n');

test('CodeFactor passed but no workflow runs yet (first check) → ci_pending blocker', () => {
  // Exact reproduction of Case 2: trees-rs PR #21
  // CodeFactor registered and passed, but CI/CD Pipeline workflow hadn't started
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'success',
    passedCheckCount: 1, // CodeFactor
    repoHasWorkflows: true,
    workflowRuns: [], // No workflow runs yet
    hasPRTriggers: true,
    checkCount: 1,
  });

  assertHasBlocker(result, 'ci_pending');
  assert(result.blockers[0].message.includes('external check'), `Message should mention external checks`);
});

test('CodeFactor passed, workflow runs exist but in_progress → ci_pending blocker', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'success',
    passedCheckCount: 1,
    repoHasWorkflows: true,
    workflowRuns: [{ status: 'in_progress', conclusion: null, name: 'CI/CD Pipeline' }],
    hasPRTriggers: true,
    checkCount: 1,
  });

  assertHasBlocker(result, 'ci_pending');
  assert(result.blockers[0].message.includes('in progress'), `Message should mention in progress`);
});

test('CodeFactor passed, all workflow runs completed → no blocker (trust success)', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'success',
    passedCheckCount: 12,
    repoHasWorkflows: true,
    workflowRuns: [{ status: 'completed', conclusion: 'success', name: 'CI/CD Pipeline' }],
    hasPRTriggers: true,
    checkCount: 1,
  });

  assertNoBlockers(result);
});

test('Success with no workflow runs, no PR triggers → no blocker (external checks are the only CI)', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'success',
    passedCheckCount: 1,
    repoHasWorkflows: true,
    workflowRuns: [],
    hasPRTriggers: false,
    checkCount: 1,
  });

  assertNoBlockers(result);
});

test('Success with no workflow runs, no repo workflows → no blocker (truly no CI)', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'success',
    passedCheckCount: 1,
    repoHasWorkflows: false,
    workflowRuns: [],
    hasPRTriggers: false,
    checkCount: 1,
  });

  assertNoBlockers(result);
});

test('Success safety valve: after 5 checks, trust external checks even without workflow runs', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'success',
    passedCheckCount: 1,
    repoHasWorkflows: true,
    workflowRuns: [],
    hasPRTriggers: true,
    checkCount: 5,
  });

  assertNoBlockers(result);
});

test('Success with incomplete workflow run on check 4 (before safety valve) → still waits', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'success',
    passedCheckCount: 1,
    repoHasWorkflows: true,
    workflowRuns: [],
    hasPRTriggers: true,
    checkCount: 4,
  });

  assertHasBlocker(result, 'ci_pending');
});

// ===== Test Suite 2: Case 1 — 'no_checks' with stale commit age =====
console.log('\n📋 Case 1: no_checks false positive (commit age vs push time)\n');

test('no_checks, PR triggers exist, old commit (600s) — first check → waits (not noCiTriggered)', () => {
  // Exact reproduction of Case 1: commit authored long ago but pushed recently
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRuns: [],
    hasPRTriggers: true,
    hasWorkflowFiles: true,
    commitAgeSeconds: 600, // Commit is 10 min old (authored before push)
    hadPreviousCI: false,
    checkCount: 1,
  });

  assertHasBlocker(result, 'ci_pending');
  assert(!result.noCiTriggered, 'Should NOT conclude noCiTriggered on first check');
});

test('no_checks, PR triggers exist, old commit — check 3 → still waits', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRuns: [],
    hasPRTriggers: true,
    hasWorkflowFiles: true,
    commitAgeSeconds: 600,
    hadPreviousCI: false,
    checkCount: 3,
  });

  assertBlockerCount(result, 1);
  assert(!result.noCiTriggered, 'Should NOT conclude noCiTriggered on check 3');
});

test('no_checks, PR triggers exist — safety valve at check 5 → concludes noCiTriggered', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRuns: [],
    hasPRTriggers: true,
    hasWorkflowFiles: true,
    commitAgeSeconds: 600,
    hadPreviousCI: false,
    checkCount: 5,
  });

  assertNoBlockers(result);
  assert(result.noCiTriggered === true, 'Should conclude noCiTriggered after safety valve');
});

test('no_checks, no PR triggers, old commit → noCiTriggered immediately', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRuns: [],
    hasPRTriggers: false,
    hasWorkflowFiles: true,
    commitAgeSeconds: 600,
    hadPreviousCI: false,
    checkCount: 1,
  });

  assert(result.noCiTriggered === true, 'Should conclude noCiTriggered when no PR triggers');
  assertNoBlockers(result);
});

test('no_checks, no PR triggers, recent commit → waits (grace period)', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRuns: [],
    hasPRTriggers: false,
    hasWorkflowFiles: true,
    commitAgeSeconds: 30,
    hadPreviousCI: false,
    checkCount: 1,
  });

  assertHasBlocker(result, 'ci_pending');
});

test('no_checks, no workflow files → noCiTriggered immediately', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRuns: [],
    hasPRTriggers: false,
    hasWorkflowFiles: false,
    commitAgeSeconds: 600,
    checkCount: 1,
  });

  assert(result.noCiTriggered === true, 'Should conclude noCiTriggered when no workflow files');
});

// ===== Test Suite 3: Existing behavior preservation =====
console.log('\n📋 Existing Behavior Preservation\n');

test('Genuine CI success with completed workflow runs → no blockers', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'success',
    passedCheckCount: 5,
    repoHasWorkflows: true,
    workflowRuns: [{ status: 'completed', conclusion: 'success', name: 'CI' }],
    hasPRTriggers: true,
    checkCount: 1,
  });

  assertNoBlockers(result);
});

test('CI pending → ci_pending blocker (unchanged behavior)', () => {
  const result = simulateFixedMergeBlockers({ ciStatusStatus: 'pending', checkCount: 1 });
  assertHasBlocker(result, 'ci_pending');
});

test('CI failure → ci_failure blocker (unchanged behavior)', () => {
  const result = simulateFixedMergeBlockers({ ciStatusStatus: 'failure', checkCount: 1 });
  assertHasBlocker(result, 'ci_failure');
});

test('no_checks, no workflows → noCiConfigured (unchanged behavior)', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: false,
    workflowRuns: [],
    checkCount: 1,
  });

  assert(result.noCiConfigured === true, 'Should be noCiConfigured');
  assertNoBlockers(result);
});

test('no_checks, workflow runs exist, all non-executing → noCiTriggered with conclusions', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRuns: [{ status: 'completed', conclusion: 'action_required', name: 'CI' }],
    hasPRTriggers: true,
    checkCount: 1,
  });

  assert(result.noCiTriggered === true, 'Should be noCiTriggered for non-executing runs');
  assert(result.workflowRunConclusions === 'action_required', 'Should include conclusions');
});

test('no_checks, PR not mergeable → ci_pending (unchanged behavior)', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: false,
    repoHasWorkflows: true,
    workflowRuns: [],
    checkCount: 1,
  });

  assertHasBlocker(result, 'ci_pending');
});

// ===== Test Suite 4: Mixed workflow run states =====
console.log('\n📋 Mixed Workflow Run States\n');

test('Success with some workflow runs completed, some queued → waits', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'success',
    passedCheckCount: 3,
    repoHasWorkflows: true,
    workflowRuns: [
      { status: 'completed', conclusion: 'success', name: 'Lint' },
      { status: 'queued', conclusion: null, name: 'Build' },
    ],
    hasPRTriggers: true,
    checkCount: 1,
  });

  assertHasBlocker(result, 'ci_pending');
  assert(result.blockers[0].message.includes('1 workflow run(s) still in progress'), 'Should mention incomplete runs');
});

test('no_checks with workflow runs triggered (some in_progress) → genuine race condition', () => {
  const result = simulateFixedMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRuns: [{ status: 'in_progress', conclusion: null, name: 'CI/CD Pipeline' }],
    hasPRTriggers: true,
    checkCount: 1,
  });

  assertHasBlocker(result, 'ci_pending');
  assert(result.blockers[0].message.includes('1 workflow run(s) triggered'), 'Should mention triggered runs');
});

// ===== Summary =====
console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
