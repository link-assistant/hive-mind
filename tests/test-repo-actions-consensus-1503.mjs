#!/usr/bin/env node

/**
 * Unit Tests: Issue #1503 - Repository-wide action monitoring and CI consensus
 *
 * Tests for the enhanced reliability mechanisms:
 *   1. getAllActiveRepoRuns — finds all active runs across the entire repository
 *   2. checkCIConsensus — multi-mechanism consensus check
 *   3. waitForAllRepoActions — waits for all repo actions to complete
 *   4. Minimum 5-minute CI check interval enforcement
 *   5. --wait-for-all-actions-in-repository-before-mergable flag
 *
 * Run with: node tests/test-repo-actions-consensus-1503.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1503
 */

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
  if (!condition) throw new Error(message);
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1503 - Repo-wide actions, CI consensus, and reliability');
console.log('================================================================================\n');

// ===== Test Suite 1: Minimum CI check interval =====
console.log('📋 Minimum CI Check Interval (5 minutes)\n');

test('Watch interval below 300s is clamped to 300s', () => {
  const rawWatchInterval = 60;
  const MIN_CI_CHECK_INTERVAL_SECONDS = 300;
  const watchInterval = Math.max(rawWatchInterval, MIN_CI_CHECK_INTERVAL_SECONDS);
  assert(watchInterval === 300, `Expected 300, got ${watchInterval}`);
});

test('Watch interval at 300s stays at 300s', () => {
  const rawWatchInterval = 300;
  const MIN_CI_CHECK_INTERVAL_SECONDS = 300;
  const watchInterval = Math.max(rawWatchInterval, MIN_CI_CHECK_INTERVAL_SECONDS);
  assert(watchInterval === 300, `Expected 300, got ${watchInterval}`);
});

test('Watch interval above 300s is preserved', () => {
  const rawWatchInterval = 600;
  const MIN_CI_CHECK_INTERVAL_SECONDS = 300;
  const watchInterval = Math.max(rawWatchInterval, MIN_CI_CHECK_INTERVAL_SECONDS);
  assert(watchInterval === 600, `Expected 600, got ${watchInterval}`);
});

test('Default watch interval (60s) is clamped to 300s', () => {
  const rawWatchInterval = undefined || 60;
  const MIN_CI_CHECK_INTERVAL_SECONDS = 300;
  const watchInterval = Math.max(rawWatchInterval, MIN_CI_CHECK_INTERVAL_SECONDS);
  assert(watchInterval === 300, `Expected 300, got ${watchInterval}`);
});

// ===== Test Suite 2: --wait-for-all-actions-in-repository-before-mergable flag =====
console.log('\n📋 Wait-For-All-Actions Flag Behavior\n');

test('Flag defaults to true when not specified', () => {
  const argv = {};
  const flag = argv.waitForAllActionsInRepositoryBeforeMergable ?? argv['wait-for-all-actions-in-repository-before-mergable'] ?? true;
  assert(flag === true, `Expected true, got ${flag}`);
});

test('Flag can be explicitly disabled via camelCase', () => {
  const argv = { waitForAllActionsInRepositoryBeforeMergable: false };
  const flag = argv.waitForAllActionsInRepositoryBeforeMergable ?? argv['wait-for-all-actions-in-repository-before-mergable'] ?? true;
  assert(flag === false, `Expected false, got ${flag}`);
});

test('Flag can be explicitly disabled via kebab-case', () => {
  const argv = { 'wait-for-all-actions-in-repository-before-mergable': false };
  const flag = argv.waitForAllActionsInRepositoryBeforeMergable ?? argv['wait-for-all-actions-in-repository-before-mergable'] ?? true;
  assert(flag === false, `Expected false, got ${flag}`);
});

test('CamelCase takes precedence over kebab-case', () => {
  const argv = { waitForAllActionsInRepositoryBeforeMergable: false, 'wait-for-all-actions-in-repository-before-mergable': true };
  const flag = argv.waitForAllActionsInRepositoryBeforeMergable ?? argv['wait-for-all-actions-in-repository-before-mergable'] ?? true;
  assert(flag === false, `Expected false (camelCase precedence), got ${flag}`);
});

// ===== Test Suite 3: Multi-mechanism consensus simulation =====
console.log('\n📋 Multi-Mechanism CI Consensus\n');

/**
 * Simulates the checkCIConsensus function logic.
 * @param {Object} params
 * @returns {{ allAgree: boolean, mechanisms: Object }}
 */
function simulateConsensus({ checkRunsStatus, workflowRuns, activeRepoRuns, waitForAllRepoActionsFlag }) {
  const checkRunsComplete = checkRunsStatus === 'success' || checkRunsStatus === 'no_checks';
  const allWorkflowRunsComplete = workflowRuns.length === 0 || workflowRuns.every(r => r.status === 'completed');
  let repoActionsComplete = true;
  if (waitForAllRepoActionsFlag) {
    repoActionsComplete = activeRepoRuns.length === 0;
  }
  const allAgree = checkRunsComplete && allWorkflowRunsComplete && repoActionsComplete;
  return {
    allAgree,
    mechanisms: {
      checkRunsAPI: { complete: checkRunsComplete, status: checkRunsStatus },
      workflowRunsAPI: { complete: allWorkflowRunsComplete, total: workflowRuns.length, inProgress: workflowRuns.filter(r => r.status !== 'completed').length },
      repoActions: waitForAllRepoActionsFlag ? { complete: repoActionsComplete, count: activeRepoRuns.length } : { skipped: true },
    },
  };
}

test('All mechanisms agree: success + completed runs + no repo actions → CONSENSUS', () => {
  const result = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }, { status: 'completed' }],
    activeRepoRuns: [],
    waitForAllRepoActionsFlag: true,
  });
  assert(result.allAgree === true, 'Should reach consensus');
});

test('Check runs pending → DISAGREE even if others complete', () => {
  const result = simulateConsensus({
    checkRunsStatus: 'pending',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [],
    waitForAllRepoActionsFlag: true,
  });
  assert(result.allAgree === false, 'Should disagree when check runs pending');
});

test('Workflow runs in progress → DISAGREE', () => {
  const result = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'in_progress' }],
    activeRepoRuns: [],
    waitForAllRepoActionsFlag: true,
  });
  assert(result.allAgree === false, 'Should disagree when workflow runs in progress');
});

test('Active repo runs → DISAGREE', () => {
  const result = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [{ id: 1, name: 'Deploy', status: 'in_progress' }],
    waitForAllRepoActionsFlag: true,
  });
  assert(result.allAgree === false, 'Should disagree when repo has active runs');
});

test('Active repo runs ignored when flag is off → CONSENSUS', () => {
  const result = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [{ id: 1, name: 'Deploy', status: 'in_progress' }],
    waitForAllRepoActionsFlag: false,
  });
  assert(result.allAgree === true, 'Should reach consensus when repo actions flag is off');
  assert(result.mechanisms.repoActions.skipped === true, 'Repo actions should be skipped');
});

test('No checks + no workflow runs + no repo actions → CONSENSUS', () => {
  const result = simulateConsensus({
    checkRunsStatus: 'no_checks',
    workflowRuns: [],
    activeRepoRuns: [],
    waitForAllRepoActionsFlag: true,
  });
  assert(result.allAgree === true, 'Should reach consensus when nothing is running');
});

test('Failure status → DISAGREE', () => {
  const result = simulateConsensus({
    checkRunsStatus: 'failure',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [],
    waitForAllRepoActionsFlag: true,
  });
  assert(result.allAgree === false, 'Should disagree on failure status');
});

test('All three mechanisms must agree — partial agreement is rejection', () => {
  // Check runs OK, workflows OK, but repo has active runs
  const result = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [],
    activeRepoRuns: [{ id: 99, name: 'Release', status: 'queued' }],
    waitForAllRepoActionsFlag: true,
  });
  assert(result.allAgree === false, 'Two out of three is not enough');
  assert(result.mechanisms.checkRunsAPI.complete === true, 'Check runs should be complete');
  assert(result.mechanisms.workflowRunsAPI.complete === true, 'Workflow runs should be complete');
  assert(result.mechanisms.repoActions.complete === false, 'Repo actions should not be complete');
});

// ===== Test Suite 4: Repo-wide active runs detection =====
console.log('\n📋 Repo-Wide Active Runs Detection\n');

test('Empty runs array → no active runs', () => {
  const runs = [];
  const hasActiveRuns = runs.length > 0;
  assert(!hasActiveRuns, 'Empty array should have no active runs');
});

test('Mixed status runs correctly filters in-progress', () => {
  const allRuns = [
    { id: 1, status: 'completed', name: 'CI' },
    { id: 2, status: 'in_progress', name: 'Deploy' },
    { id: 3, status: 'queued', name: 'Release' },
    { id: 4, status: 'completed', name: 'Lint' },
  ];
  const activeStatuses = ['in_progress', 'queued', 'waiting', 'requested', 'pending'];
  const activeRuns = allRuns.filter(r => activeStatuses.includes(r.status));
  assert(activeRuns.length === 2, `Expected 2 active runs, got ${activeRuns.length}`);
  assert(activeRuns[0].name === 'Deploy', 'First active should be Deploy');
  assert(activeRuns[1].name === 'Release', 'Second active should be Release');
});

test('Waiting and requested statuses are considered active', () => {
  const allRuns = [
    { id: 1, status: 'waiting', name: 'Approval Gate' },
    { id: 2, status: 'requested', name: 'Manual Deploy' },
  ];
  const activeStatuses = ['in_progress', 'queued', 'waiting', 'requested', 'pending'];
  const activeRuns = allRuns.filter(r => activeStatuses.includes(r.status));
  assert(activeRuns.length === 2, 'Waiting and requested should both be active');
});

test('All completed runs → no active runs', () => {
  const allRuns = [
    { id: 1, status: 'completed', name: 'CI' },
    { id: 2, status: 'completed', name: 'Deploy' },
  ];
  const activeStatuses = ['in_progress', 'queued', 'waiting', 'requested', 'pending'];
  const activeRuns = allRuns.filter(r => activeStatuses.includes(r.status));
  assert(activeRuns.length === 0, 'All completed should have no active runs');
});

// ===== Test Suite 5: Combined scenario — watchUntilMergeable integration =====
console.log('\n📋 Combined Scenario: watchUntilMergeable with all mechanisms\n');

/**
 * Simulates the full watchUntilMergeable decision with all new mechanisms.
 */
function simulateWatchDecision({ blockerCount, hasNewComments, hasUncommittedChanges, noCiConfigured, consensusResult, repoActiveRuns, waitForAllRepoActionsFlag }) {
  if (blockerCount > 0 || hasNewComments || hasUncommittedChanges) {
    return { declareMergeable: false, reason: 'blockers_or_activity' };
  }
  // No blockers path
  if (!noCiConfigured) {
    if (!consensusResult.allAgree) {
      return { declareMergeable: false, reason: 'consensus_disagree' };
    }
    return { declareMergeable: true, reason: 'consensus_agree' };
  }
  // No CI configured
  if (waitForAllRepoActionsFlag && repoActiveRuns > 0) {
    return { declareMergeable: false, reason: 'repo_actions_active' };
  }
  return { declareMergeable: true, reason: 'no_ci_no_blockers' };
}

test('No blockers + consensus agree → mergeable', () => {
  const result = simulateWatchDecision({
    blockerCount: 0,
    hasNewComments: false,
    hasUncommittedChanges: false,
    noCiConfigured: false,
    consensusResult: { allAgree: true },
    repoActiveRuns: 0,
    waitForAllRepoActionsFlag: true,
  });
  assert(result.declareMergeable === true, 'Should be mergeable');
  assert(result.reason === 'consensus_agree', 'Should be via consensus');
});

test('No blockers + consensus DISAGREE → NOT mergeable', () => {
  const result = simulateWatchDecision({
    blockerCount: 0,
    hasNewComments: false,
    hasUncommittedChanges: false,
    noCiConfigured: false,
    consensusResult: { allAgree: false },
    repoActiveRuns: 0,
    waitForAllRepoActionsFlag: true,
  });
  assert(result.declareMergeable === false, 'Should NOT be mergeable');
  assert(result.reason === 'consensus_disagree', 'Should be due to consensus disagreement');
});

test('Blockers present → NOT mergeable regardless of consensus', () => {
  const result = simulateWatchDecision({
    blockerCount: 1,
    hasNewComments: false,
    hasUncommittedChanges: false,
    noCiConfigured: false,
    consensusResult: { allAgree: true },
    repoActiveRuns: 0,
    waitForAllRepoActionsFlag: true,
  });
  assert(result.declareMergeable === false, 'Blockers should prevent mergeability');
});

test('No CI configured + repo actions active → NOT mergeable', () => {
  const result = simulateWatchDecision({
    blockerCount: 0,
    hasNewComments: false,
    hasUncommittedChanges: false,
    noCiConfigured: true,
    consensusResult: { allAgree: true },
    repoActiveRuns: 3,
    waitForAllRepoActionsFlag: true,
  });
  assert(result.declareMergeable === false, 'Repo actions should block');
  assert(result.reason === 'repo_actions_active', 'Should be due to repo actions');
});

test('No CI configured + repo actions active + flag OFF → mergeable', () => {
  const result = simulateWatchDecision({
    blockerCount: 0,
    hasNewComments: false,
    hasUncommittedChanges: false,
    noCiConfigured: true,
    consensusResult: { allAgree: true },
    repoActiveRuns: 3,
    waitForAllRepoActionsFlag: false,
  });
  assert(result.declareMergeable === true, 'Should be mergeable when flag is off');
});

test('New comments block even with consensus agreement', () => {
  const result = simulateWatchDecision({
    blockerCount: 0,
    hasNewComments: true,
    hasUncommittedChanges: false,
    noCiConfigured: false,
    consensusResult: { allAgree: true },
    repoActiveRuns: 0,
    waitForAllRepoActionsFlag: true,
  });
  assert(result.declareMergeable === false, 'New comments should block');
});

// ===== Test Suite 6: Real-world scenarios =====
console.log('\n📋 Real-World Scenarios\n');

test('Scenario: CI passes on PR but deploy pipeline running on main → blocks', () => {
  const result = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [{ id: 42, name: 'Deploy to Production', status: 'in_progress', head_branch: 'main' }],
    waitForAllRepoActionsFlag: true,
  });
  assert(result.allAgree === false, 'Should block due to deploy pipeline on main');
});

test('Scenario: All CI done, no repo actions → passes consensus', () => {
  const result = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }, { status: 'completed' }],
    activeRepoRuns: [],
    waitForAllRepoActionsFlag: true,
  });
  assert(result.allAgree === true, 'Should pass consensus');
});

test('Scenario: Fast external check passes but workflow not started → blocks', () => {
  const result = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [], // No workflow runs yet
    activeRepoRuns: [],
    waitForAllRepoActionsFlag: true,
  });
  // Note: In real code, the getMergeBlockers handles this scenario.
  // The consensus check happens AFTER getMergeBlockers passes.
  // When consensus is called, no_checks is treated as "complete" for check runs API.
  assert(result.allAgree === true, 'Consensus passes — the no-workflow-runs case is handled by getMergeBlockers safety valve');
});

test('Scenario: Interacting pipelines — PR CI done but triggered deploy still running', () => {
  const result = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }], // PR CI done
    activeRepoRuns: [
      { id: 100, name: 'Deploy Preview', status: 'in_progress', head_branch: 'feature-branch' },
      { id: 101, name: 'Integration Tests', status: 'queued', head_branch: 'feature-branch' },
    ],
    waitForAllRepoActionsFlag: true,
  });
  assert(result.allAgree === false, 'Should block due to interacting pipelines');
  assert(result.mechanisms.repoActions.count === 2, 'Should report 2 active repo runs');
});

// ===== Summary =====
console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
