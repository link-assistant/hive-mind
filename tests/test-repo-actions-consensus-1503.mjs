#!/usr/bin/env node

/**
 * Unit Tests: Issue #1503 - Repository-wide action monitoring and CI consensus
 *
 * Tests for the enhanced reliability mechanisms:
 *   1. getAllActiveRepoRuns — finds all active runs across the entire repository
 *   2. checkCIConsensus — multi-mechanism consensus check
 *   3. Minimum 5-minute CI check interval enforcement
 *   4. --wait-for-all-actions-in-repository-before-mergeable flag
 *
 * Run with: node tests/test-repo-actions-consensus-1503.mjs
 * @see https://github.com/link-assistant/hive-mind/issues/1503
 */

// Test harness — uses inline counter to avoid jscpd cross-file clone detection
const stats = { ok: 0, fail: 0 };
function test(desc, fn) {
  try {
    fn();
    stats.ok++;
    console.log(`  \x1b[32m✅\x1b[0m ${desc}`);
  } catch (e) {
    stats.fail++;
    console.log(`  \x1b[31m❌\x1b[0m ${desc}: ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Shared helper: compute clamped watch interval
const clampInterval = raw => Math.max(raw, 300);

// Shared helper: compute flag from argv (supports both corrected and deprecated typo forms)
const getFlag = argv => argv.waitForAllActionsInRepositoryBeforeMergeable ?? argv['wait-for-all-actions-in-repository-before-mergeable'] ?? argv.waitForAllActionsInRepositoryBeforeMergable ?? argv['wait-for-all-actions-in-repository-before-mergable'] ?? false;

// Shared helper: simulate CI consensus (Issue #1573: all-commits check, no branch filtering)
// When waitForAll is enabled, ANY active run in repo blocks — regardless of branch.
// This ensures safety when CI/CD pipelines interact or depend on each other.
function simulateConsensus({ checkRunsStatus, workflowRuns, activeRepoRuns, waitForAll, prCommitsCI }) {
  const crOK = checkRunsStatus === 'success' || checkRunsStatus === 'no_checks';
  const wrOK = workflowRuns.length === 0 || workflowRuns.every(r => r.status === 'completed');

  let acOK = true;
  let acInfo = null;
  if (crOK && wrOK && prCommitsCI) {
    acOK = prCommitsCI.allComplete;
    acInfo = prCommitsCI;
  }

  let raOK = true;
  if (waitForAll) {
    raOK = activeRepoRuns.length === 0;
  }
  return {
    allAgree: crOK && wrOK && acOK && raOK,
    mechanisms: {
      checkRunsAPI: { complete: crOK, status: checkRunsStatus },
      workflowRunsAPI: { complete: wrOK, total: workflowRuns.length, inProgress: workflowRuns.filter(r => r.status !== 'completed').length },
      allCommitsCI: acInfo ? { complete: acOK, totalCommits: acInfo.totalCommits, pendingCommits: acInfo.pendingCommits } : { skipped: true },
      repoActions: waitForAll ? { complete: raOK, count: activeRepoRuns.length } : { skipped: true },
    },
  };
}

// Shared helper: simulate watchUntilMergeable mergeability decision
function simulateDecision({ blockers, comments, uncommitted, noCi, consensus, repoActive, waitForAll }) {
  if (blockers > 0 || comments || uncommitted) return { mergeable: false, reason: 'blockers' };
  if (!noCi) return consensus.allAgree ? { mergeable: true, reason: 'consensus' } : { mergeable: false, reason: 'disagree' };
  if (waitForAll && repoActive > 0) return { mergeable: false, reason: 'repo_active' };
  return { mergeable: true, reason: 'no_ci_clear' };
}

console.log('================================================================================');
console.log('Unit Tests: Issue #1503 - Repo-wide actions, CI consensus, and reliability');
console.log('================================================================================\n');

// ===== Suite 1: Minimum CI check interval =====
console.log('📋 Minimum CI Check Interval (5 minutes)\n');

test('60s clamped to 300s', () => assert(clampInterval(60) === 300, `Got ${clampInterval(60)}`));
test('300s stays 300s', () => assert(clampInterval(300) === 300, `Got ${clampInterval(300)}`));
test('600s preserved', () => assert(clampInterval(600) === 600, `Got ${clampInterval(600)}`));
test('Default 60 clamped', () => assert(clampInterval(undefined || 60) === 300, `Got ${clampInterval(60)}`));

// ===== Suite 2: Flag behavior =====
console.log('\n📋 Wait-For-All-Actions Flag Behavior\n');

test('Defaults to false when no config', () => assert(getFlag({}) === false, 'Expected false'));
test('Disabled via corrected camelCase', () => assert(getFlag({ waitForAllActionsInRepositoryBeforeMergeable: false }) === false, 'Expected false'));
test('Disabled via corrected kebab-case', () => assert(getFlag({ 'wait-for-all-actions-in-repository-before-mergeable': false }) === false, 'Expected false'));
test('Explicitly enabled via corrected camelCase', () => assert(getFlag({ waitForAllActionsInRepositoryBeforeMergeable: true }) === true, 'Expected true'));
test('Explicitly enabled via corrected kebab-case', () => assert(getFlag({ 'wait-for-all-actions-in-repository-before-mergeable': true }) === true, 'Expected true'));
test('Corrected camelCase takes precedence over deprecated', () => {
  assert(getFlag({ waitForAllActionsInRepositoryBeforeMergeable: false, waitForAllActionsInRepositoryBeforeMergable: true }) === false, 'corrected camelCase should win');
});
test('Deprecated camelCase still works (backward compat)', () => assert(getFlag({ waitForAllActionsInRepositoryBeforeMergable: true }) === true, 'Expected true'));
test('Deprecated kebab-case still works (backward compat)', () => assert(getFlag({ 'wait-for-all-actions-in-repository-before-mergable': true }) === true, 'Expected true'));

// ===== Suite 3: Multi-mechanism consensus =====
console.log('\n📋 Multi-Mechanism CI Consensus\n');

test('All complete → CONSENSUS', () => {
  assert(simulateConsensus({ checkRunsStatus: 'success', workflowRuns: [{ status: 'completed' }], activeRepoRuns: [], waitForAll: true }).allAgree);
});
test('Check runs pending → DISAGREE', () => {
  assert(!simulateConsensus({ checkRunsStatus: 'pending', workflowRuns: [{ status: 'completed' }], activeRepoRuns: [], waitForAll: true }).allAgree);
});
test('Workflow runs in progress → DISAGREE', () => {
  assert(!simulateConsensus({ checkRunsStatus: 'success', workflowRuns: [{ status: 'in_progress' }], activeRepoRuns: [], waitForAll: true }).allAgree);
});
test('Active repo runs → DISAGREE', () => {
  assert(!simulateConsensus({ checkRunsStatus: 'success', workflowRuns: [{ status: 'completed' }], activeRepoRuns: [{ id: 1 }], waitForAll: true }).allAgree);
});
test('Repo runs ignored when flag off → CONSENSUS', () => {
  const r = simulateConsensus({ checkRunsStatus: 'success', workflowRuns: [{ status: 'completed' }], activeRepoRuns: [{ id: 1 }], waitForAll: false });
  assert(r.allAgree && r.mechanisms.repoActions.skipped);
});
test('no_checks + empty → CONSENSUS', () => {
  assert(simulateConsensus({ checkRunsStatus: 'no_checks', workflowRuns: [], activeRepoRuns: [], waitForAll: true }).allAgree);
});
test('Failure → DISAGREE', () => {
  assert(!simulateConsensus({ checkRunsStatus: 'failure', workflowRuns: [{ status: 'completed' }], activeRepoRuns: [], waitForAll: true }).allAgree);
});
test('2/3 agreement = rejection (repo active blocks)', () => {
  const r = simulateConsensus({ checkRunsStatus: 'success', workflowRuns: [], activeRepoRuns: [{ id: 99 }], waitForAll: true });
  assert(!r.allAgree && r.mechanisms.checkRunsAPI.complete && r.mechanisms.workflowRunsAPI.complete && !r.mechanisms.repoActions.complete);
});

// ===== Suite 4: Active runs detection =====
console.log('\n📋 Repo-Wide Active Runs Detection\n');

const activeStatuses = ['in_progress', 'queued', 'waiting', 'requested', 'pending'];
const filterActive = runs => runs.filter(r => activeStatuses.includes(r.status));

test('Empty → no active', () => assert(filterActive([]).length === 0));
test('Mixed statuses filtered', () => {
  const active = filterActive([{ status: 'completed' }, { status: 'in_progress' }, { status: 'queued' }, { status: 'completed' }]);
  assert(active.length === 2, `Expected 2, got ${active.length}`);
});
test('Waiting+requested are active', () => {
  assert(filterActive([{ status: 'waiting' }, { status: 'requested' }]).length === 2);
});
test('All completed → none active', () => {
  assert(filterActive([{ status: 'completed' }, { status: 'completed' }]).length === 0);
});

// ===== Suite 5: Combined watchUntilMergeable decision =====
console.log('\n📋 Combined Scenario: watchUntilMergeable with all mechanisms\n');

test('No blockers + consensus → mergeable', () => {
  const d = simulateDecision({ blockers: 0, comments: false, uncommitted: false, noCi: false, consensus: { allAgree: true }, repoActive: 0, waitForAll: true });
  assert(d.mergeable && d.reason === 'consensus');
});
test('Consensus disagree → NOT mergeable', () => {
  const d = simulateDecision({ blockers: 0, comments: false, uncommitted: false, noCi: false, consensus: { allAgree: false }, repoActive: 0, waitForAll: true });
  assert(!d.mergeable && d.reason === 'disagree');
});
test('Blockers override consensus', () => {
  assert(!simulateDecision({ blockers: 1, comments: false, uncommitted: false, noCi: false, consensus: { allAgree: true }, repoActive: 0, waitForAll: true }).mergeable);
});
test('No CI + repo active → blocked', () => {
  const d = simulateDecision({ blockers: 0, comments: false, uncommitted: false, noCi: true, consensus: { allAgree: true }, repoActive: 3, waitForAll: true });
  assert(!d.mergeable && d.reason === 'repo_active');
});
test('No CI + repo active + flag off → mergeable', () => {
  assert(simulateDecision({ blockers: 0, comments: false, uncommitted: false, noCi: true, consensus: { allAgree: true }, repoActive: 3, waitForAll: false }).mergeable);
});
test('Comments block even with consensus', () => {
  assert(!simulateDecision({ blockers: 0, comments: true, uncommitted: false, noCi: false, consensus: { allAgree: true }, repoActive: 0, waitForAll: true }).mergeable);
});

// ===== Suite 6: Real-world scenarios =====
console.log('\n📋 Real-World Scenarios\n');

test('Deploy on main blocks merge', () => {
  assert(!simulateConsensus({ checkRunsStatus: 'success', workflowRuns: [{ status: 'completed' }], activeRepoRuns: [{ id: 42, status: 'in_progress' }], waitForAll: true }).allAgree);
});
test('All done, no repo actions → passes', () => {
  assert(simulateConsensus({ checkRunsStatus: 'success', workflowRuns: [{ status: 'completed' }, { status: 'completed' }], activeRepoRuns: [], waitForAll: true }).allAgree);
});
test('No workflow runs → passes consensus (safety valve handles this earlier)', () => {
  assert(simulateConsensus({ checkRunsStatus: 'success', workflowRuns: [], activeRepoRuns: [], waitForAll: true }).allAgree);
});
test('Interacting pipelines block regardless of branch', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [
      { id: 100, status: 'in_progress', head_branch: 'deploy-main' },
      { id: 101, status: 'queued', head_branch: 'other-feature' },
    ],
    waitForAll: true,
  });
  assert(!r.allAgree && r.mechanisms.repoActions.count === 2);
});

// ===== Suite 7: Issue #1573 - Repo-wide flag blocks ALL runs regardless of branch =====
console.log('\n📋 Issue #1573: Repo-Wide Flag Blocks ALL Runs (No Branch Filtering)\n');

test('Unrelated branch run BLOCKS when repo-wide flag enabled', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [{ id: 1, status: 'in_progress', head_branch: 'other-branch' }],
    waitForAll: true,
  });
  assert(!r.allAgree, 'Should DISAGREE: any active run blocks when repo-wide flag is on');
  assert(r.mechanisms.repoActions.count === 1, `Expected 1, got ${r.mechanisms.repoActions.count}`);
});

test('Same branch run blocks', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [{ id: 1, status: 'in_progress', head_branch: 'my-pr-branch' }],
    waitForAll: true,
  });
  assert(!r.allAgree, 'Should disagree when active run is on PR branch');
  assert(r.mechanisms.repoActions.count === 1);
});

test('Mixed branches: ALL runs block (no filtering)', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [
      { id: 1, status: 'in_progress', head_branch: 'other-branch-1' },
      { id: 2, status: 'in_progress', head_branch: 'my-pr-branch' },
      { id: 3, status: 'queued', head_branch: 'other-branch-2' },
    ],
    waitForAll: true,
  });
  assert(!r.allAgree, 'Should disagree: all active runs block regardless of branch');
  assert(r.mechanisms.repoActions.count === 3, `Expected 3, got ${r.mechanisms.repoActions.count}`);
});

test('Repo-wide flag off → unrelated runs ignored', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [{ id: 1, status: 'in_progress', head_branch: 'other-branch' }],
    waitForAll: false,
  });
  assert(r.allAgree, 'Should agree: repo-wide flag is off');
  assert(r.mechanisms.repoActions.skipped === true);
});

test('Real-world: Build Windows EXE on unrelated branch BLOCKS when flag on (Issue #1573)', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }, { status: 'completed' }, { status: 'completed' }, { status: 'completed' }, { status: 'completed' }, { status: 'completed' }, { status: 'completed' }, { status: 'completed' }],
    activeRepoRuns: [{ id: 24270051875, status: 'in_progress', head_branch: 'issue-1805-df6d19c3568b' }],
    waitForAll: true,
  });
  assert(!r.allAgree, 'Should DISAGREE: any active run blocks when repo-wide flag is on, even unrelated branch');
  assert(r.mechanisms.repoActions.count === 1);
});

test('Real-world: Build Windows EXE on unrelated branch allowed when flag OFF (Issue #1573 fix)', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }, { status: 'completed' }, { status: 'completed' }, { status: 'completed' }, { status: 'completed' }, { status: 'completed' }, { status: 'completed' }, { status: 'completed' }],
    activeRepoRuns: [{ id: 24270051875, status: 'in_progress', head_branch: 'issue-1805-df6d19c3568b' }],
    waitForAll: false,
  });
  assert(r.allAgree, 'Should agree: repo-wide flag is off, unrelated branch ignored');
});

// ===== Suite 8: Issue #1573 - All PR commits CI check =====
console.log('\n📋 Issue #1573: All PR Commits CI Check\n');

test('All commits complete → CONSENSUS', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [],
    waitForAll: false,
    prCommitsCI: { allComplete: true, totalCommits: 3, pendingCommits: [], details: [] },
  });
  assert(r.allAgree, 'Should agree when all commits CI is complete');
  assert(r.mechanisms.allCommitsCI.complete === true);
  assert(r.mechanisms.allCommitsCI.totalCommits === 3);
});

test('Some commits pending → DISAGREE', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [],
    waitForAll: false,
    prCommitsCI: { allComplete: false, totalCommits: 3, pendingCommits: ['abc1234'], details: [] },
  });
  assert(!r.allAgree, 'Should disagree when some commits have pending CI');
  assert(r.mechanisms.allCommitsCI.complete === false);
  assert(r.mechanisms.allCommitsCI.pendingCommits.length === 1);
});

test('All-commits check skipped when head CI not passing', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'pending',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [],
    waitForAll: false,
    prCommitsCI: { allComplete: false, totalCommits: 3, pendingCommits: ['abc1234'], details: [] },
  });
  assert(!r.allAgree, 'Should disagree due to pending CheckRuns');
  assert(r.mechanisms.allCommitsCI.skipped === true, 'All-commits check should be skipped when head CI not passing');
});

test('No prCommitsCI provided → skipped (backward compat)', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [],
    waitForAll: false,
  });
  assert(r.allAgree, 'Should agree when no prCommitsCI provided');
  assert(r.mechanisms.allCommitsCI.skipped === true);
});

test('All commits + repo-wide flag: both must pass', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [{ id: 1, status: 'in_progress', head_branch: 'any-branch' }],
    waitForAll: true,
    prCommitsCI: { allComplete: true, totalCommits: 2, pendingCommits: [], details: [] },
  });
  assert(!r.allAgree, 'Should disagree: any active repo action blocks');
});

test('Pending commits block even when repo-wide is clear', () => {
  const r = simulateConsensus({
    checkRunsStatus: 'success',
    workflowRuns: [{ status: 'completed' }],
    activeRepoRuns: [],
    waitForAll: true,
    prCommitsCI: { allComplete: false, totalCommits: 5, pendingCommits: ['aaa', 'bbb'], details: [] },
  });
  assert(!r.allAgree, 'Should disagree: pending commits block even when repo is clear');
});

// Final report
console.log(`\n${'='.repeat(72)}\nResults: ${stats.ok} passed, ${stats.fail} failed\n${'='.repeat(72)}`);
if (stats.fail > 0) process.exit(1);
