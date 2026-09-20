#!/usr/bin/env node

/**
 * Unit Tests: Issue #1480 - `Ready to merge` posted as false positive
 *
 * Tests verify that:
 * 1. When workflow runs have not appeared in the API yet (0 runs) but the commit is recent
 *    (within grace period), the system waits instead of concluding "CI not triggered"
 * 2. When the commit is old enough (past grace period) and still no workflow runs,
 *    the system correctly concludes "CI not triggered"
 * 3. Workflow file PR trigger parsing correctly identifies PR/push triggers
 * 4. The grace period + workflow file parsing work together for defense in depth
 * 5. Edge cases: null commit date, exactly at grace period boundary
 *
 * Root cause: The fix for issue #1442 assumed that if getWorkflowRunsForSha() returns
 * 0 runs, CI was "definitively NOT triggered". But GitHub Actions workflow runs take
 * 30-120 seconds to appear in the API after a push, causing false positive
 * "Ready to merge" comments when checked within seconds of a push.
 *
 * Run with: node tests/test-false-positive-workflow-run-race-1480.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1480
 * @see https://github.com/link-assistant/hive-mind/issues/1442 (introduced the flawed check)
 * @see https://github.com/link-assistant/hive-mind/issues/1363 (related false positive)
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
console.log('Unit Tests: Issue #1480 - `Ready to merge` posted as false positive');
console.log('================================================================================\n');

// ===== Constants matching the actual implementation =====
const WORKFLOW_RUN_GRACE_PERIOD_SECONDS = 120;

// ===== Simulate the FIXED getMergeBlockers logic for the no_checks + has workflows + 0 runs path =====

/**
 * Simulates the fixed getMergeBlockers logic specifically for the path:
 * no_checks → mergeable → has workflows → 0 workflow runs → multi-layer defense
 *
 * This mirrors the actual logic in src/solve.auto-merge.lib.mjs after the Issue #1480 fix.
 *
 * @param {Object} params
 * @param {Array} params.workflowRuns - Workflow runs returned by getWorkflowRunsForSha
 * @param {{ageSeconds: number|null}} params.commitInfo - Commit age info from getCommitDate
 * @param {{hasPRTriggers: boolean, hasWorkflowFiles: boolean, workflows: Array}} params.prTriggers - PR trigger info from checkWorkflowsHavePRTriggers
 * @param {{hadPreviousCI: boolean, previousCommitsWithCI: number, totalPreviousCommits: number}} [params.previousCI] - Previous commit CI history
 */
function simulateFixedWorkflowRunCheck({ workflowRuns, commitInfo, prTriggers, previousCI }) {
  const blockers = [];

  // Default previousCI for backward compatibility with existing tests
  if (!previousCI) {
    previousCI = { hadPreviousCI: false, previousCommitsWithCI: 0, totalPreviousCommits: 0 };
  }

  if (workflowRuns.length > 0) {
    // Issue #1466: Check if ALL workflow runs completed without producing check-runs
    const allRunsCompleted = workflowRuns.every(r => r.status === 'completed');
    const allRunsNonExecuting = allRunsCompleted && workflowRuns.every(r => r.conclusion === 'action_required' || r.conclusion === 'cancelled' || r.conclusion === 'stale' || r.conclusion === 'skipped');

    if (allRunsNonExecuting) {
      const conclusions = [...new Set(workflowRuns.map(r => r.conclusion))].join(', ');
      return { blockers, noCiTriggered: true, workflowRunConclusions: conclusions, raceCondition: false };
    }

    // Some workflow runs are still in progress — genuine race condition
    blockers.push({
      type: 'ci_pending',
      message: `CI/CD checks have not started yet (${workflowRuns.length} workflow run(s) triggered, waiting for check-runs to appear)`,
      details: workflowRuns.map(r => r.name),
    });
    return { blockers, noCiTriggered: false, workflowRunConclusions: undefined, raceCondition: true };
  }

  // No workflow runs for this SHA — Issue #1480 multi-layer defense

  // Layer 1: If no workflow files exist at all, no CI will execute
  if (!prTriggers.hasWorkflowFiles) {
    return { blockers, noCiTriggered: true, workflowRunConclusions: undefined, raceCondition: false };
  }

  // Layer 2: Grace period check
  if (commitInfo.ageSeconds !== null && commitInfo.ageSeconds < WORKFLOW_RUN_GRACE_PERIOD_SECONDS) {
    // Commit is recent — workflow runs may not have appeared in the API yet
    if (prTriggers.hasPRTriggers) {
      blockers.push({
        type: 'ci_pending',
        message: `CI/CD workflow runs have not appeared yet — commit is ${commitInfo.ageSeconds}s old, waiting for GitHub to register workflow runs (grace period: ${WORKFLOW_RUN_GRACE_PERIOD_SECONDS}s)`,
        details: prTriggers.workflows.map(w => w.name),
      });
    } else {
      blockers.push({
        type: 'ci_pending',
        message: `CI/CD workflow runs have not appeared yet — commit is ${commitInfo.ageSeconds}s old, waiting for GitHub to register workflow runs (grace period: ${WORKFLOW_RUN_GRACE_PERIOD_SECONDS}s)`,
        details: [],
      });
    }
    return { blockers, noCiTriggered: false, workflowRunConclusions: undefined, raceCondition: true };
  }

  // Layer 3: Previous commit CI history check (after grace period)
  if (previousCI.hadPreviousCI && prTriggers.hasPRTriggers) {
    blockers.push({
      type: 'ci_pending',
      message: `CI/CD workflow runs missing for HEAD — previous PR commits had CI (${previousCI.previousCommitsWithCI} of ${previousCI.totalPreviousCommits}), workflows have PR triggers, possible API delay`,
      details: prTriggers.workflows.map(w => w.name),
    });
    return { blockers, noCiTriggered: false, workflowRunConclusions: undefined, raceCondition: true };
  }

  // Layer 4: Definitive conclusion — CI was NOT triggered
  return { blockers, noCiTriggered: true, workflowRunConclusions: undefined, raceCondition: false };
}

// ===== Test Suite 1: The exact false positive scenario from PR #1479 =====
console.log('📋 Test Suite 1: Exact false positive scenario from PR #1479\n');

test('PR #1479 scenario: 0 workflow runs + commit only 17s old + has PR triggers → wait (NOT "CI not triggered")', () => {
  // This is the exact scenario that caused the false positive:
  // - Commit 9ed29b7 pushed at 09:53:33Z
  // - getMergeBlockers called at ~09:53:50Z (17 seconds later)
  // - getWorkflowRunsForSha returned [] (not yet registered)
  // - CI actually started at 09:55:18Z and FAILED
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 17 },
    prTriggers: {
      hasPRTriggers: true,
      hasWorkflowFiles: true,
      workflows: [{ name: 'release.yml', triggers: ['push'] }],
    },
  });

  assert(result.noCiTriggered === false, 'Should NOT conclude CI is not triggered — commit is too recent');
  assert(result.raceCondition === true, 'Should treat as race condition');
  assert(result.blockers.length === 1, 'Should add ci_pending blocker');
  assert(result.blockers[0].type === 'ci_pending', 'Blocker type should be ci_pending');
  assert(result.blockers[0].message.includes('17s old'), 'Message should include commit age');
  assert(result.blockers[0].message.includes('grace period'), 'Message should mention grace period');
  assert(result.blockers[0].details.length === 1, 'Details should include workflow file name');
  assert(result.blockers[0].details[0] === 'release.yml', 'Details should include release.yml');
});

// ===== Test Suite 2: Grace period boundary tests =====
console.log('\n📋 Test Suite 2: Grace period boundary conditions\n');

test('Commit is 0 seconds old → wait (within grace period)', () => {
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 0 },
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [{ name: 'ci.yml', triggers: ['pull_request'] }] },
  });

  assert(result.noCiTriggered === false, 'Should NOT conclude CI is not triggered');
  assert(result.blockers.length === 1, 'Should add ci_pending blocker');
});

test('Commit is 119 seconds old → wait (still within grace period)', () => {
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 119 },
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [{ name: 'ci.yml', triggers: ['pull_request'] }] },
  });

  assert(result.noCiTriggered === false, 'Should NOT conclude CI is not triggered');
  assert(result.blockers.length === 1, 'Should add ci_pending blocker');
});

test('Commit is exactly 120 seconds old → conclude CI not triggered (grace period elapsed)', () => {
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 120 },
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [{ name: 'ci.yml', triggers: ['pull_request'] }] },
  });

  assert(result.noCiTriggered === true, 'Should conclude CI is not triggered — grace period elapsed');
  assert(result.blockers.length === 0, 'Should NOT add blockers');
});

test('Commit is 300 seconds old → conclude CI not triggered (well past grace period)', () => {
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 300 },
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [] },
  });

  assert(result.noCiTriggered === true, 'Should conclude CI is not triggered');
  assert(result.blockers.length === 0, 'Should NOT add blockers');
});

// ===== Test Suite 3: Commit date unavailable (null) =====
console.log('\n📋 Test Suite 3: Commit date unavailable edge cases\n');

test('Commit date unknown (ageSeconds=null) → conclude CI not triggered (fail-safe for old behavior)', () => {
  // If we can't determine commit age, fall through to the old behavior
  // (conclude CI not triggered) to avoid infinite waiting
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: null },
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [{ name: 'ci.yml', triggers: ['pull_request'] }] },
  });

  assert(result.noCiTriggered === true, 'Should conclude CI is not triggered when date is unknown');
  assert(result.blockers.length === 0, 'Should NOT add blockers');
});

// ===== Test Suite 4: Workflow file PR trigger analysis =====
console.log('\n📋 Test Suite 4: Workflow file PR trigger analysis impact\n');

test('Recent commit + no PR triggers in workflow files → still wait (be safe)', () => {
  // Even if workflow files don't seem to have PR triggers, if the commit is recent
  // we should still wait because our parsing might not catch all trigger patterns
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 30 },
    prTriggers: { hasPRTriggers: false, hasWorkflowFiles: true, workflows: [] },
  });

  assert(result.noCiTriggered === false, 'Should NOT conclude CI is not triggered — commit is recent');
  assert(result.blockers.length === 1, 'Should add ci_pending blocker');
  assert(result.blockers[0].details.length === 0, 'Details should be empty (no PR trigger workflows found)');
});

test('Recent commit + has PR triggers → wait with workflow details', () => {
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 45 },
    prTriggers: {
      hasPRTriggers: true,
      hasWorkflowFiles: true,
      workflows: [
        { name: 'ci.yml', triggers: ['pull_request'] },
        { name: 'tests.yml', triggers: ['push', 'pull_request'] },
      ],
    },
  });

  assert(result.noCiTriggered === false, 'Should NOT conclude CI is not triggered');
  assert(result.blockers.length === 1, 'Should add ci_pending blocker');
  assert(result.blockers[0].details.length === 2, 'Details should have 2 workflow names');
  assert(result.blockers[0].details.includes('ci.yml'), 'Should include ci.yml');
  assert(result.blockers[0].details.includes('tests.yml'), 'Should include tests.yml');
});

// ===== Test Suite 5: Backward compatibility with existing behaviors =====
console.log('\n📋 Test Suite 5: Backward compatibility with existing behaviors\n');

test('Workflow runs exist + action_required → still treat as CI not triggered (issue #1466)', () => {
  // The issue #1466 fix must still work correctly
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [{ id: 1, name: 'CI', status: 'completed', conclusion: 'action_required' }],
    commitInfo: { ageSeconds: 10 },
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [] },
  });

  assert(result.noCiTriggered === true, 'Should treat as CI not triggered (action_required)');
  assert(result.workflowRunConclusions === 'action_required', 'Should report conclusion');
});

test('Workflow runs exist + in_progress → genuine race condition (not affected by grace period)', () => {
  // When workflow runs exist, the existing behavior should be preserved regardless of commit age
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [{ id: 1, name: 'CI', status: 'in_progress', conclusion: null }],
    commitInfo: { ageSeconds: 5 },
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [] },
  });

  assert(result.noCiTriggered === false, 'Should NOT conclude CI is not triggered');
  assert(result.raceCondition === true, 'Should treat as genuine race condition');
  assert(result.blockers.length === 1, 'Should have ci_pending blocker');
});

test('Workflow runs exist + completed success → no change needed (this path has check-runs)', () => {
  // When workflow runs have success conclusion, check-runs should exist too
  // This path actually wouldn't reach our code (getDetailedCIStatus would return success/failure)
  // But test it for completeness
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [{ id: 1, name: 'CI', status: 'completed', conclusion: 'success' }],
    commitInfo: { ageSeconds: 60 },
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [] },
  });

  // Completed with success is NOT a non-executing conclusion, so it's a genuine race condition
  // (check-runs should exist but haven't been registered yet)
  assert(result.noCiTriggered === false, 'Success run should be treated as race condition');
  assert(result.raceCondition === true, 'Should be a genuine race condition');
});

// ===== Test Suite 6: Workflow file PR trigger parsing logic =====
console.log('\n📋 Test Suite 6: Workflow file PR trigger parsing patterns\n');

/**
 * Simulates checkWorkflowsHavePRTriggers parsing logic for a single workflow content
 */
function checkContentForPRTriggers(content) {
  const prTriggerPatterns = [/\bon:\s*\n\s+pull_request/m, /\bon:\s*\[.*pull_request.*\]/m, /\bon:\s*pull_request\b/m, /\bpull_request_target\b/m];
  const pushTriggerPatterns = [/\bon:\s*\n\s+push/m, /\bon:\s*\[.*push.*\]/m, /\bon:\s*push\b/m];

  const triggers = [];
  if (prTriggerPatterns.some(p => p.test(content))) triggers.push('pull_request');
  if (pushTriggerPatterns.some(p => p.test(content))) triggers.push('push');
  return triggers;
}

test('Detects standard multi-line pull_request trigger', () => {
  const content = `name: CI
on:
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest`;
  const triggers = checkContentForPRTriggers(content);
  assert(triggers.includes('pull_request'), `Should detect pull_request trigger, got: [${triggers}]`);
});

test('Detects inline array pull_request trigger', () => {
  const content = `name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest`;
  const triggers = checkContentForPRTriggers(content);
  assert(triggers.includes('pull_request'), 'Should detect inline pull_request');
  assert(triggers.includes('push'), 'Should also detect push');
});

test('Detects simple on: push trigger', () => {
  const content = `name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest`;
  const triggers = checkContentForPRTriggers(content);
  assert(triggers.includes('push'), 'Should detect simple push trigger');
  assert(!triggers.includes('pull_request'), 'Should NOT detect pull_request');
});

test('Detects pull_request_target trigger', () => {
  const content = `name: CI
on:
  pull_request_target:
    types: [opened, synchronize]
jobs:
  test:
    runs-on: ubuntu-latest`;
  const triggers = checkContentForPRTriggers(content);
  assert(triggers.includes('pull_request'), 'Should detect pull_request_target as a PR trigger');
});

test('Detects multi-line push trigger', () => {
  const content = `name: Checks and release
on:
  push:
    branches: ['**']
  workflow_dispatch:
jobs:
  detect-changes:
    runs-on: ubuntu-latest`;
  const triggers = checkContentForPRTriggers(content);
  assert(triggers.includes('push'), 'Should detect multi-line push trigger');
});

test('Does NOT detect workflow_dispatch-only workflow as PR trigger', () => {
  const content = `name: Manual Deploy
on:
  workflow_dispatch:
    inputs:
      environment:
        description: Target environment
jobs:
  deploy:
    runs-on: ubuntu-latest`;
  const triggers = checkContentForPRTriggers(content);
  assert(triggers.length === 0, `Should not detect any PR/push triggers, got: [${triggers}]`);
});

test('Does NOT detect schedule-only workflow as PR trigger', () => {
  const content = `name: Nightly Build
on:
  schedule:
    - cron: '0 2 * * *'
jobs:
  build:
    runs-on: ubuntu-latest`;
  const triggers = checkContentForPRTriggers(content);
  assert(triggers.length === 0, `Should not detect any PR/push triggers, got: [${triggers}]`);
});

// ===== Test Suite 7: Combined end-to-end scenario tests =====
console.log('\n📋 Test Suite 7: End-to-end scenario tests\n');

test('Scenario: Repo with only schedule/dispatch workflows + recent commit → wait to be safe', () => {
  // Even without PR triggers, a recent commit should still wait
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 15 },
    prTriggers: { hasPRTriggers: false, hasWorkflowFiles: true, workflows: [] },
  });

  assert(result.noCiTriggered === false, 'Should wait even without PR triggers — commit is recent');
  assert(result.blockers.length === 1, 'Should have blocker');
});

test('Scenario: Repo with only schedule/dispatch workflows + old commit → CI not triggered', () => {
  // Old commit + no PR triggers → definitely no CI expected
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 300 },
    prTriggers: { hasPRTriggers: false, hasWorkflowFiles: true, workflows: [] },
  });

  assert(result.noCiTriggered === true, 'Should conclude CI not triggered');
  assert(result.blockers.length === 0, 'No blockers');
});

test('Scenario: Fork PR with paths-ignore + old commit → CI not triggered', () => {
  // This is the legitimate "CI not triggered" case from issue #1442
  // paths-ignore filtering means no workflow runs, even after grace period
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 200 },
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [{ name: 'ci.yml', triggers: ['pull_request'] }] },
  });

  assert(result.noCiTriggered === true, 'Should conclude CI not triggered — grace period passed');
  assert(result.blockers.length === 0, 'No blockers');
});

// ===== Test Suite 8: Empty workflows folder detection (Layer 1) =====
console.log('\n📋 Test Suite 8: Empty workflows folder detection (no .github/workflows files)\n');

test('No workflow files at all + recent commit → immediately conclude no CI (skip grace period)', () => {
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 5 }, // Very recent commit
    prTriggers: { hasPRTriggers: false, hasWorkflowFiles: false, workflows: [] },
  });

  assert(result.noCiTriggered === true, 'Should immediately conclude CI not triggered — no workflow files');
  assert(result.blockers.length === 0, 'Should NOT add blockers — no files means no CI');
});

test('No workflow files + old commit → conclude no CI', () => {
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 300 },
    prTriggers: { hasPRTriggers: false, hasWorkflowFiles: false, workflows: [] },
  });

  assert(result.noCiTriggered === true, 'Should conclude CI not triggered');
  assert(result.blockers.length === 0, 'No blockers');
});

test('No workflow files + null commit date → conclude no CI', () => {
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: null },
    prTriggers: { hasPRTriggers: false, hasWorkflowFiles: false, workflows: [] },
  });

  assert(result.noCiTriggered === true, 'Should conclude CI not triggered — no files regardless of date');
  assert(result.blockers.length === 0, 'No blockers');
});

// ===== Test Suite 9: Previous commit CI history (Layer 3) =====
console.log('\n📋 Test Suite 9: Previous commit CI history detection\n');

test('Grace period elapsed + previous commits had CI + PR triggers → wait (safety measure)', () => {
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 150 }, // Past grace period
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [{ name: 'ci.yml', triggers: ['push'] }] },
    previousCI: { hadPreviousCI: true, previousCommitsWithCI: 2, totalPreviousCommits: 3 },
  });

  assert(result.noCiTriggered === false, 'Should NOT conclude CI not triggered — previous commits had CI');
  assert(result.blockers.length === 1, 'Should add ci_pending blocker');
  assert(result.blockers[0].message.includes('previous PR commits had CI'), 'Message should mention previous CI');
  assert(result.blockers[0].message.includes('2 of 3'), 'Message should include commit counts');
});

test('Grace period elapsed + previous commits had CI + NO PR triggers → conclude no CI', () => {
  // Previous commits had CI but workflow files don't have PR triggers anymore
  // (maybe triggers were changed) — conclude no CI
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 150 },
    prTriggers: { hasPRTriggers: false, hasWorkflowFiles: true, workflows: [] },
    previousCI: { hadPreviousCI: true, previousCommitsWithCI: 1, totalPreviousCommits: 2 },
  });

  assert(result.noCiTriggered === true, 'Should conclude CI not triggered — no PR triggers in current files');
  assert(result.blockers.length === 0, 'No blockers');
});

test('Grace period elapsed + no previous CI + PR triggers → conclude no CI', () => {
  // First commit in PR, no previous CI history, grace period passed
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 200 },
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [{ name: 'ci.yml', triggers: ['pull_request'] }] },
    previousCI: { hadPreviousCI: false, previousCommitsWithCI: 0, totalPreviousCommits: 0 },
  });

  assert(result.noCiTriggered === true, 'Should conclude CI not triggered — no previous CI evidence');
  assert(result.blockers.length === 0, 'No blockers');
});

test('Grace period elapsed + no previous CI + no PR triggers → conclude no CI', () => {
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 300 },
    prTriggers: { hasPRTriggers: false, hasWorkflowFiles: true, workflows: [] },
    previousCI: { hadPreviousCI: false, previousCommitsWithCI: 0, totalPreviousCommits: 0 },
  });

  assert(result.noCiTriggered === true, 'Should conclude CI not triggered');
  assert(result.blockers.length === 0, 'No blockers');
});

// ===== Test Suite 10: Multi-layer defense interaction tests =====
console.log('\n📋 Test Suite 10: Multi-layer defense interaction tests\n');

test('Layer priority: no workflow files overrides recent commit (Layer 1 > Layer 2)', () => {
  // Even though commit is very recent (would normally wait), no workflow files = no CI
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 1 },
    prTriggers: { hasPRTriggers: false, hasWorkflowFiles: false, workflows: [] },
    previousCI: { hadPreviousCI: true, previousCommitsWithCI: 1, totalPreviousCommits: 1 },
  });

  assert(result.noCiTriggered === true, 'Layer 1 (no files) should take priority over everything');
  assert(result.blockers.length === 0, 'No blockers');
});

test('Layer priority: grace period overrides previous CI (Layer 2 > Layer 3)', () => {
  // During grace period, we wait regardless of previous CI history
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 30 },
    prTriggers: { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [{ name: 'ci.yml', triggers: ['push'] }] },
    previousCI: { hadPreviousCI: false, previousCommitsWithCI: 0, totalPreviousCommits: 5 },
  });

  assert(result.noCiTriggered === false, 'Should wait during grace period regardless of previous CI');
  assert(result.blockers.length === 1, 'Should have ci_pending blocker');
  assert(result.blockers[0].message.includes('30s old'), 'Should mention commit age from grace period');
});

test('Full pipeline: PR #1479 exact scenario with all layers (enhanced)', () => {
  // Exact reproduction: commit 17s old, has workflows with push triggers, previous commits had CI
  const result = simulateFixedWorkflowRunCheck({
    workflowRuns: [],
    commitInfo: { ageSeconds: 17 },
    prTriggers: {
      hasPRTriggers: true,
      hasWorkflowFiles: true,
      workflows: [{ name: 'release.yml', triggers: ['push'] }],
    },
    previousCI: { hadPreviousCI: true, previousCommitsWithCI: 4, totalPreviousCommits: 4 },
  });

  assert(result.noCiTriggered === false, 'Must NOT conclude CI not triggered');
  assert(result.raceCondition === true, 'Should detect race condition');
  assert(result.blockers.length === 1, 'Should have exactly 1 blocker');
  assert(result.blockers[0].type === 'ci_pending', 'Blocker type should be ci_pending');
});

// ===== Summary =====
console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
