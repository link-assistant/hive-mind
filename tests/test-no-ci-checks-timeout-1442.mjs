#!/usr/bin/env node

/**
 * Unit Tests: Issue #1442 - `--auto-restart-until-mergeable` stuck on no CI checks
 *
 * Tests verify that:
 * 1. When a repo has CI workflows but no workflow runs were triggered for the commit,
 *    getMergeBlockers returns noCiTriggered=true so the monitoring loop exits immediately
 * 2. When workflow runs exist but check-runs haven't appeared yet, it's a genuine race
 *    condition and a ci_pending blocker is returned
 * 3. Existing behavior for no-workflows repos is preserved (noCiConfigured=true)
 * 4. The workflow runs API check only happens when no_checks + mergeable + hasWorkflows
 *
 * Root cause: Repo has active workflows but CI never starts for the PR (e.g., fork PRs
 * needing maintainer approval, paths-ignore filtering all files, trigger conditions not met).
 * The old code assumed this was always a transient race condition and waited indefinitely.
 *
 * Fix: Use GitHub Actions workflow runs API (repos/{owner}/{repo}/actions/runs?head_sha={sha})
 * to definitively determine if any workflow runs were triggered for the commit. If zero
 * workflow runs exist, CI was not triggered — exit immediately, no timeout needed.
 *
 * Run with: node tests/test-no-ci-checks-timeout-1442.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1442
 * @see https://github.com/link-assistant/hive-mind/issues/1363 (related: false positive detection)
 * @see https://github.com/link-assistant/hive-mind/issues/1335 (related: workflow caching)
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
console.log('Unit Tests: Issue #1442 - No CI checks (workflow runs API detection)');
console.log('================================================================================\n');

// ===== Simulate the getMergeBlockers logic for CI detection =====

/**
 * Simulates the three-way CI detection logic from getMergeBlockers.
 * This mirrors the actual behavior after the fix in src/solve.auto-merge.lib.mjs.
 *
 * The key insight is that instead of using timeout-based detection, we now use
 * the GitHub Actions API to definitively check if workflow runs were triggered
 * for the PR's HEAD SHA. This gives us four distinct states:
 *
 * 1. no_checks + NOT MERGEABLE → pending race condition (wait)
 * 2. no_checks + MERGEABLE + no workflows → no CI configured (exit: noCiConfigured)
 * 3. no_checks + MERGEABLE + has workflows + has workflow runs → genuine race condition (wait)
 * 4. no_checks + MERGEABLE + has workflows + NO workflow runs → CI not triggered (exit: noCiTriggered)
 *
 * @param {Object} params
 * @param {string} params.ciStatusStatus - CI status from getDetailedCIStatus ('no_checks', 'pending', etc.)
 * @param {boolean} params.prMergeable - Whether PR is mergeable
 * @param {boolean} params.repoHasWorkflows - Whether repo has active workflows
 * @param {number} params.workflowRunsCount - Number of workflow runs for this SHA
 * @returns {Object} - { blockers, noCiConfigured, noCiTriggered }
 */
function simulateMergeBlockers({ ciStatusStatus, prMergeable, repoHasWorkflows, workflowRunsCount }) {
  const blockers = [];

  if (ciStatusStatus === 'no_checks') {
    if (prMergeable) {
      if (repoHasWorkflows) {
        if (workflowRunsCount > 0) {
          // Workflow runs exist but check-runs haven't appeared yet — genuine race condition
          blockers.push({
            type: 'ci_pending',
            message: `CI/CD checks have not started yet (${workflowRunsCount} workflow run(s) triggered, waiting for check-runs to appear)`,
          });
        } else {
          // No workflow runs — CI was definitively NOT triggered
          return { blockers, noCiConfigured: false, noCiTriggered: true };
        }
      } else {
        // No workflows — no CI configured
        return { blockers, noCiConfigured: true, noCiTriggered: false };
      }
    } else {
      // PR not mergeable — treat as pending race condition
      blockers.push({
        type: 'ci_pending',
        message: 'CI/CD checks have not started yet (waiting for checks to appear)',
      });
    }
  } else if (ciStatusStatus === 'pending') {
    blockers.push({
      type: 'ci_pending',
      message: 'CI/CD checks are still running or queued',
    });
  } else if (ciStatusStatus === 'success') {
    // No blocker
  }

  return { blockers, noCiConfigured: false, noCiTriggered: false };
}

// ===== Test: Core four-way discrimination =====
console.log('📋 Four-Way CI Detection (Issue #1442)\n');

test('State 1: no_checks + NOT MERGEABLE → pending race condition (wait)', () => {
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: false,
    repoHasWorkflows: true,
    workflowRunsCount: 0,
  });

  assert(result.blockers.length === 1, `Should have 1 blocker, got ${result.blockers.length}`);
  assert(result.blockers[0].type === 'ci_pending', `Blocker type should be ci_pending, got ${result.blockers[0].type}`);
  assert(result.noCiConfigured === false, 'noCiConfigured should be false');
  assert(result.noCiTriggered === false, 'noCiTriggered should be false');
});

test('State 2: no_checks + MERGEABLE + no workflows → no CI configured (exit)', () => {
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: false,
    workflowRunsCount: 0,
  });

  assert(result.blockers.length === 0, `Should have 0 blockers, got ${result.blockers.length}`);
  assert(result.noCiConfigured === true, 'noCiConfigured should be true');
  assert(result.noCiTriggered === false, 'noCiTriggered should be false');
});

test('State 3: no_checks + MERGEABLE + has workflows + has workflow runs → genuine race condition (wait)', () => {
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRunsCount: 2,
  });

  assert(result.blockers.length === 1, `Should have 1 blocker, got ${result.blockers.length}`);
  assert(result.blockers[0].type === 'ci_pending', `Blocker type should be ci_pending, got ${result.blockers[0].type}`);
  assert(result.blockers[0].message.includes('2 workflow run(s) triggered'), `Message should mention 2 workflow runs, got: ${result.blockers[0].message}`);
  assert(result.noCiConfigured === false, 'noCiConfigured should be false');
  assert(result.noCiTriggered === false, 'noCiTriggered should be false');
});

test('State 4: no_checks + MERGEABLE + has workflows + NO workflow runs → CI not triggered (exit immediately)', () => {
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRunsCount: 0,
  });

  assert(result.blockers.length === 0, `Should have 0 blockers, got ${result.blockers.length}`);
  assert(result.noCiConfigured === false, 'noCiConfigured should be false');
  assert(result.noCiTriggered === true, 'noCiTriggered should be true');
});

// ===== Test: Exact reproduction of issue #1442 scenario =====
console.log('\n📋 Exact Reproduction of Issue #1442\n');

test('BinDiffSynchronizer scenario: fork PR with CI workflow, no workflow runs → exits immediately', () => {
  // Reproduce the exact scenario from the issue:
  // - Repo: netkeep80/BinDiffSynchronizer has 1 active workflow (CI)
  // - PR #149 is a cross-repository (fork) PR
  // - CI never starts (needs maintainer approval for fork PRs)
  // - PR is mergeable (CLEAN state, no required status checks)
  // - GitHub API: GET /repos/.../actions/runs?head_sha=<sha> returns { total_count: 0, workflow_runs: [] }
  // Before fix: infinite loop (22+ minutes). After fix: exits immediately on first check.
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRunsCount: 0, // No workflow runs triggered for this SHA
  });

  assert(result.noCiTriggered === true, 'Should detect CI was not triggered');
  assert(result.blockers.length === 0, 'Should have no blockers (not waiting for anything)');
  assert(result.noCiConfigured === false, 'noCiConfigured should be false (repo has workflows)');
});

test('Similar scenario but PR is BLOCKED → waits (pending race condition)', () => {
  // If the repo has required status checks in branch protection,
  // the PR won't be mergeable — we wait since CI might still start
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: false,
    repoHasWorkflows: true,
    workflowRunsCount: 0,
  });

  assert(result.noCiTriggered === false, 'noCiTriggered should be false (PR not mergeable)');
  assert(result.blockers.length === 1, 'Should have 1 blocker');
  assert(result.blockers[0].type === 'ci_pending', 'Should be a ci_pending blocker');
});

// ===== Test: Existing behavior preservation =====
console.log('\n📋 Existing Behavior Preservation\n');

test('No-workflows still exits immediately (existing behavior from #1335 preserved)', () => {
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: false,
    workflowRunsCount: 0,
  });

  assert(result.noCiConfigured === true, 'noCiConfigured should be true');
  assert(result.noCiTriggered === false, 'noCiTriggered should be false');
  assert(result.blockers.length === 0, 'Should have no blockers');
});

test('CI success status returns no blockers (normal flow)', () => {
  const result = simulateMergeBlockers({
    ciStatusStatus: 'success',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRunsCount: 1,
  });

  assert(result.blockers.length === 0, 'Should have no blockers');
  assert(result.noCiConfigured === false, 'noCiConfigured should be false');
  assert(result.noCiTriggered === false, 'noCiTriggered should be false');
});

test('CI pending status returns blocker (normal flow)', () => {
  const result = simulateMergeBlockers({
    ciStatusStatus: 'pending',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRunsCount: 1,
  });

  assert(result.blockers.length === 1, 'Should have 1 blocker');
  assert(result.blockers[0].type === 'ci_pending', 'Should be ci_pending');
  assert(result.noCiTriggered === false, 'noCiTriggered should be false');
});

// ===== Test: Workflow runs count edge cases =====
console.log('\n📋 Workflow Runs Edge Cases\n');

test('Single workflow run → genuine race condition (wait for check-runs)', () => {
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRunsCount: 1,
  });

  assert(result.blockers.length === 1, 'Should have 1 blocker');
  assert(result.blockers[0].message.includes('1 workflow run(s) triggered'), `Message should mention 1 workflow run`);
  assert(result.noCiTriggered === false, 'Should not flag noCiTriggered');
});

test('Multiple workflow runs → genuine race condition (wait for check-runs)', () => {
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRunsCount: 5,
  });

  assert(result.blockers.length === 1, 'Should have 1 blocker');
  assert(result.blockers[0].message.includes('5 workflow run(s) triggered'), `Message should mention 5 workflow runs`);
  assert(result.noCiTriggered === false, 'Should not flag noCiTriggered');
});

test('Zero workflow runs with multiple workflows → CI not triggered', () => {
  // Repo has 3 workflows but none triggered for this commit
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRunsCount: 0,
  });

  assert(result.noCiTriggered === true, 'Should flag noCiTriggered');
  assert(result.blockers.length === 0, 'Should have no blockers');
});

// ===== Test: Advantage over timeout approach =====
console.log('\n📋 Advantage Over Timeout Approach\n');

test('Detection is immediate — no need to wait 10 iterations', () => {
  // With the old timeout approach, this would wait 10 iterations (~10 minutes).
  // With the new approach, it exits on the very first check.
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRunsCount: 0,
  });

  assert(result.noCiTriggered === true, 'Should detect immediately, not after timeout');
  assert(result.blockers.length === 0, 'No need to add blockers and wait');
});

test('Genuine race condition still waits (no false positives)', () => {
  // When workflow runs ARE triggered but check-runs haven't appeared yet,
  // we correctly identify this as a race condition and wait
  const result = simulateMergeBlockers({
    ciStatusStatus: 'no_checks',
    prMergeable: true,
    repoHasWorkflows: true,
    workflowRunsCount: 1,
  });

  assert(result.noCiTriggered === false, 'Should NOT flag as not triggered');
  assert(result.blockers.length === 1, 'Should wait for check-runs to appear');
});

// Summary
console.log('\n================================================================================');
console.log(`Test Results for Issue #1442:`);
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
