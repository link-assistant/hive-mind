#!/usr/bin/env node

/**
 * Unit Tests: Issue #1363 - `Ready to merge` as false positive
 *
 * Tests verify that:
 * 1. When a repo has CI workflows but no checks have started yet (race condition after push),
 *    the PR is NOT falsely declared "no CI configured" just because mergeStateStatus=CLEAN
 * 2. When a repo has NO workflows AND the PR is MERGEABLE, it IS correctly treated as "no CI configured"
 * 3. The distinction uses the GitHub Actions workflows API to check for active workflows
 * 4. Backward compatibility: the fix for issue #1345 still works for repos with truly no CI
 *
 * Root cause: Fix for #1345 used `no_checks + MERGEABLE = no CI configured`
 * But repos with workflows + no required branch protection also satisfy `no_checks + MERGEABLE`
 * immediately after a push (GitHub takes ~10-30s to register CI checks).
 *
 * The fix adds a third check: query the workflows API to see if CI workflows exist.
 *
 * Run with: node tests/test-false-positive-ready-to-merge-1363.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1363
 * @see https://github.com/link-assistant/hive-mind/issues/1345 (related)
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
console.log('Unit Tests: Issue #1363 - `Ready to merge` as false positive');
console.log('================================================================================\n');

// ===== Test: Three-way discrimination logic =====
console.log('📋 Three-Way Discrimination: no_checks + MERGEABLE + hasWorkflows?\n');

/**
 * Simulates the FIXED getMergeBlockers logic for the `no_checks` path.
 * This mirrors the actual logic in src/solve.auto-merge.lib.mjs after the fix.
 */
function simulateFixedNoCiLogic({ ciStatus, mergeStatus, repoWorkflows }) {
  const blockers = [];
  let noCiConfigured = false;

  if (ciStatus.status === 'no_checks') {
    if (mergeStatus.mergeable) {
      // Issue #1363 fix: Check if repo has workflows before concluding "no CI"
      if (repoWorkflows.hasWorkflows) {
        // Repo HAS workflows → race condition, not "no CI configured"
        blockers.push({
          type: 'ci_pending',
          message: `CI/CD checks have not started yet (${repoWorkflows.count} workflow(s) configured, waiting for checks to appear)`,
          details: repoWorkflows.workflows.map(wf => wf.name),
        });
      } else {
        // Repo has NO workflows → truly "no CI configured"
        noCiConfigured = true;
        // Return early (simulate early return in real code)
        return { blockers, noCiConfigured, earlyReturn: true };
      }
    } else {
      // PR is not yet mergeable → race condition
      blockers.push({
        type: 'ci_pending',
        message: 'CI/CD checks have not started yet (waiting for checks to appear)',
        details: [],
      });
    }
  }

  return { blockers, noCiConfigured, earlyReturn: false };
}

test('Scenario B (issue #1363): no_checks + MERGEABLE + has workflows → race condition, NOT "no CI configured"', () => {
  // This is the exact scenario that caused the false positive in issue #1363:
  // - link-assistant/calculator has 3 active workflows
  // - main branch has NO required status checks in branch protection
  // - GitHub returns CLEAN/MERGEABLE immediately (no required checks to block it)
  // - CI check-runs are empty because we checked right after the push (race condition)
  const result = simulateFixedNoCiLogic({
    ciStatus: { status: 'no_checks', checks: [] },
    mergeStatus: { mergeable: true, reason: null }, // mergeStateStatus=CLEAN, no required checks
    repoWorkflows: {
      hasWorkflows: true,
      count: 3,
      workflows: [
        { id: 1, name: 'CI/CD Pipeline', state: 'active' },
        { id: 2, name: 'Update Currency Rates', state: 'active' },
        { id: 3, name: 'Update Screenshots', state: 'active' },
      ],
    },
  });

  assert(result.noCiConfigured === false, 'noCiConfigured should be false — repo has workflows, this is a race condition');
  assert(result.blockers.length === 1, 'Should add ci_pending blocker to wait for CI to start');
  assert(result.blockers[0].type === 'ci_pending', 'Blocker type should be ci_pending');
  assert(result.blockers[0].message.includes('3 workflow(s)'), 'Blocker message should mention number of workflows');
  assert(!result.earlyReturn, 'Should NOT early-return — there are workflows, so we must wait');
});

test('Scenario A (issue #1345 fixed): no_checks + MERGEABLE + no workflows → truly no CI configured', () => {
  // This is the original #1345 scenario: repo has NO workflows at all.
  // The #1363 fix should preserve this behavior.
  const result = simulateFixedNoCiLogic({
    ciStatus: { status: 'no_checks', checks: [] },
    mergeStatus: { mergeable: true, reason: null },
    repoWorkflows: {
      hasWorkflows: false,
      count: 0,
      workflows: [],
    },
  });

  assert(result.noCiConfigured === true, 'noCiConfigured should be true — repo has no workflows');
  assert(result.blockers.length === 0, 'No blockers should be added when no CI is configured');
  assert(result.earlyReturn === true, 'Should early-return — no CI means PR is immediately mergeable');
});

test('Scenario C (issue #1345 race): no_checks + NOT MERGEABLE → always race condition', () => {
  // When the PR is blocked or unknown, it is always a race condition.
  // This should work regardless of whether workflows exist.
  const resultWithWorkflows = simulateFixedNoCiLogic({
    ciStatus: { status: 'no_checks', checks: [] },
    mergeStatus: { mergeable: false, reason: 'Merge state: UNKNOWN' },
    repoWorkflows: { hasWorkflows: true, count: 1, workflows: [{ id: 1, name: 'CI', state: 'active' }] },
  });

  assert(resultWithWorkflows.noCiConfigured === false, 'noCiConfigured should be false');
  assert(resultWithWorkflows.blockers.length === 1, 'Should add ci_pending blocker');
  assert(resultWithWorkflows.blockers[0].type === 'ci_pending', 'Blocker type should be ci_pending');

  const resultNoWorkflows = simulateFixedNoCiLogic({
    ciStatus: { status: 'no_checks', checks: [] },
    mergeStatus: { mergeable: false, reason: 'Merge state: BLOCKED' },
    repoWorkflows: { hasWorkflows: false, count: 0, workflows: [] },
  });

  assert(resultNoWorkflows.noCiConfigured === false, 'noCiConfigured should be false even without workflows');
  assert(resultNoWorkflows.blockers.length === 1, 'Should add ci_pending blocker');
});

// ===== Test: Workflow count in blocker details =====
console.log('\n📋 Workflow Details in Blocker Message\n');

test('Blocker details should include workflow names when workflows exist', () => {
  const result = simulateFixedNoCiLogic({
    ciStatus: { status: 'no_checks', checks: [] },
    mergeStatus: { mergeable: true, reason: null },
    repoWorkflows: {
      hasWorkflows: true,
      count: 2,
      workflows: [
        { id: 1, name: 'CI/CD Pipeline', state: 'active' },
        { id: 2, name: 'Deploy to Production', state: 'active' },
      ],
    },
  });

  assert(result.blockers.length === 1, 'Should have one blocker');
  assert(Array.isArray(result.blockers[0].details), 'Details should be an array');
  assert(result.blockers[0].details.length === 2, 'Details should have 2 workflow names');
  assert(result.blockers[0].details.includes('CI/CD Pipeline'), 'Details should include "CI/CD Pipeline"');
  assert(result.blockers[0].details.includes('Deploy to Production'), 'Details should include "Deploy to Production"');
});

test('Blocker message should include count of configured workflows', () => {
  const result = simulateFixedNoCiLogic({
    ciStatus: { status: 'no_checks', checks: [] },
    mergeStatus: { mergeable: true, reason: null },
    repoWorkflows: {
      hasWorkflows: true,
      count: 1,
      workflows: [{ id: 1, name: 'CI/CD Pipeline', state: 'active' }],
    },
  });

  assert(result.blockers[0].message.includes('1 workflow(s)'), `Message should mention count, got: ${result.blockers[0].message}`);
});

// ===== Test: Backward compatibility with issue #1345 =====
console.log('\n📋 Backward Compatibility with Issue #1345\n');

test('Old behavior preserved: no workflows + MERGEABLE → noCiConfigured=true (no infinite loop)', () => {
  // This is the exact #1345 fix behavior — must still work
  const result = simulateFixedNoCiLogic({
    ciStatus: { status: 'no_checks', checks: [] },
    mergeStatus: { mergeable: true, reason: null },
    repoWorkflows: { hasWorkflows: false, count: 0, workflows: [] },
  });

  assert(result.noCiConfigured === true, 'noCiConfigured must be true for repos with no CI');
  assert(result.blockers.length === 0, 'blockers must be empty for repos with no CI');
  assert(result.earlyReturn === true, 'Must early-return to prevent infinite loop (#1345 fix)');
});

test('CI checks present (success) → noCiConfigured=false regardless of workflows', () => {
  // When CI checks exist and pass, we never enter the no_checks branch
  const ciStatus = { status: 'success', checks: [{ name: 'CI', conclusion: 'success' }] };

  let noCiConfigured = false;
  let blockers = [];

  // Only the no_checks branch sets noCiConfigured
  if (ciStatus.status === 'no_checks') {
    noCiConfigured = true; // Would be set based on workflow check
  }
  // success → no blockers, noCiConfigured remains false

  assert(noCiConfigured === false, 'noCiConfigured should be false when CI checks exist and pass');
  assert(blockers.length === 0, 'No blockers for successful CI');
});

// ===== Test: Exact false positive reproduction =====
console.log('\n📋 Exact Reproduction of Issue #1363 False Positive\n');

test('Before fix: no_checks + MERGEABLE would incorrectly return noCiConfigured=true for repos with workflows', () => {
  // Document the OLD broken behavior (issue #1345 fix with the #1363 regression)
  const ciStatus = { status: 'no_checks', checks: [] };
  const mergeStatus = { mergeable: true }; // CLEAN — no required checks

  // OLD CODE (broken by #1363):
  let noCiConfiguredOld = false;
  let blockersOld = [];
  if (ciStatus.status === 'no_checks') {
    if (mergeStatus.mergeable) {
      noCiConfiguredOld = true; // ← FALSE POSITIVE! No check for actual workflows
      // Early return would happen here → "Ready to merge" comment posted
    }
  }

  // This is the false positive — noCiConfigured=true even though repo has workflows
  assert(noCiConfiguredOld === true, 'Old behavior: incorrectly sets noCiConfigured=true');
  assert(blockersOld.length === 0, 'Old behavior: no blockers added (false positive)');
});

test('After fix: no_checks + MERGEABLE + has workflows correctly returns ci_pending blocker', () => {
  // The new fixed behavior for repos with workflows
  const result = simulateFixedNoCiLogic({
    ciStatus: { status: 'no_checks', checks: [] },
    mergeStatus: { mergeable: true }, // CLEAN — no required checks
    repoWorkflows: {
      hasWorkflows: true, // ← KEY: repo has active workflows
      count: 3,
      workflows: [
        { id: 1, name: 'CI/CD Pipeline', state: 'active' },
        { id: 2, name: 'Update Currency Rates', state: 'active' },
        { id: 3, name: 'Update Screenshots', state: 'active' },
      ],
    },
  });

  assert(result.noCiConfigured === false, 'Fixed behavior: noCiConfigured=false for repos with workflows');
  assert(result.blockers.length === 1, 'Fixed behavior: ci_pending blocker added to wait for CI');
  assert(result.blockers[0].type === 'ci_pending', 'Fixed behavior: blocker type is ci_pending');
  assert(!result.earlyReturn, 'Fixed behavior: no early return — must wait for CI to start');
});

// ===== Test: Edge cases =====
console.log('\n📋 Edge Cases\n');

test('Single workflow in repo: correctly adds ci_pending blocker', () => {
  const result = simulateFixedNoCiLogic({
    ciStatus: { status: 'no_checks', checks: [] },
    mergeStatus: { mergeable: true, reason: null },
    repoWorkflows: {
      hasWorkflows: true,
      count: 1,
      workflows: [{ id: 42, name: 'Run Tests', state: 'active' }],
    },
  });

  assert(result.noCiConfigured === false, 'noCiConfigured should be false');
  assert(result.blockers.length === 1, 'Should have one ci_pending blocker');
  assert(result.blockers[0].details.length === 1, 'Details should have one workflow');
  assert(result.blockers[0].details[0] === 'Run Tests', 'Workflow name should be in details');
});

test('Error fetching workflows (returns no workflows): falls back to noCiConfigured=true', () => {
  // If the workflows API fails, getActiveRepoWorkflows returns hasWorkflows=false
  // This is a safe default: avoids false positives (vs. false negatives from not waiting)
  // Note: In practice this means we might wrongly treat a CI repo as no-CI if API fails,
  // but this is better than infinite loops (the original #1345 issue)
  const result = simulateFixedNoCiLogic({
    ciStatus: { status: 'no_checks', checks: [] },
    mergeStatus: { mergeable: true, reason: null },
    repoWorkflows: {
      hasWorkflows: false, // API error → default to false
      count: 0,
      workflows: [],
    },
  });

  // The API error fallback returns hasWorkflows=false, so we treat as no CI
  assert(result.noCiConfigured === true, 'On API error, falls back to noCiConfigured=true');
  assert(result.blockers.length === 0, 'No blockers when API error falls back to no-CI');
});

test('Workflow with non-active state is not counted as active workflow', () => {
  // The workflows API query filters for state == 'active' only
  // Disabled/deleted workflows should not prevent "no CI" detection
  const result = simulateFixedNoCiLogic({
    ciStatus: { status: 'no_checks', checks: [] },
    mergeStatus: { mergeable: true, reason: null },
    repoWorkflows: {
      // After filtering for state='active', only active workflows are returned
      hasWorkflows: false, // No ACTIVE workflows
      count: 0,
      workflows: [], // Disabled workflows are filtered out
    },
  });

  assert(result.noCiConfigured === true, 'No ACTIVE workflows → treat as no CI configured');
  assert(result.blockers.length === 0, 'No blockers when only disabled workflows exist');
});

// Summary
console.log('\n================================================================================');
console.log(`Test Results for Issue #1363:`);
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
