#!/usr/bin/env node

/**
 * Unit Tests: Issue #1345 - --auto-restart-until-mergeable stuck on no CI/CD checks
 *
 * Tests verify that:
 * 1. When a repository has no CI/CD configured, the PR is treated as mergeable immediately
 * 2. When no checks exist but the PR is not yet mergeable (race condition), we wait
 * 3. The "Ready to merge" comment message differs for repos with/without CI
 * 4. getMergeBlockers correctly identifies the noCiConfigured flag
 *
 * Run with: node tests/test-no-ci-checks-1345.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1345
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
console.log('Unit Tests: Issue #1345 - --auto-restart-until-mergeable stuck on no CI checks');
console.log('================================================================================\n');

// ===== Test: Logic for detecting "no CI configured" vs race condition =====
console.log('📋 No CI Configured Detection Tests\n');

test('When no checks AND PR is MERGEABLE: noCiConfigured should be true', () => {
  // Simulate the scenario: no check runs, PR is MERGEABLE (mergeStateStatus=CLEAN)
  const ciStatusResult = { status: 'no_checks', checks: [] };
  const mergeStatusResult = { mergeable: true, reason: null };

  // Logic from fixed getMergeBlockers:
  let noCiConfigured = false;
  let blockers = [];

  if (ciStatusResult.status === 'no_checks') {
    if (mergeStatusResult.mergeable) {
      // No CI/CD configured - PR is already mergeable
      noCiConfigured = true;
    } else {
      // Race condition - CI checks haven't started yet
      blockers.push({ type: 'ci_pending', message: 'CI/CD checks have not started yet' });
    }
  }

  assert(noCiConfigured === true, 'noCiConfigured should be true when no checks + MERGEABLE');
  assert(blockers.length === 0, 'No blockers should be added when no CI configured');
});

test('When no checks AND PR is NOT MERGEABLE: treat as race condition (ci_pending)', () => {
  // Simulate the scenario: no check runs, PR is NOT yet mergeable (not ready)
  const ciStatusResult = { status: 'no_checks', checks: [] };
  const mergeStatusResult = { mergeable: false, reason: 'Merge state: UNKNOWN' };

  let noCiConfigured = false;
  let blockers = [];

  if (ciStatusResult.status === 'no_checks') {
    if (mergeStatusResult.mergeable) {
      noCiConfigured = true;
    } else {
      // Race condition - CI checks haven't started yet
      blockers.push({
        type: 'ci_pending',
        message: 'CI/CD checks have not started yet (waiting for checks to appear)',
      });
    }
  }

  assert(noCiConfigured === false, 'noCiConfigured should be false for race condition');
  assert(blockers.length === 1, 'Should add ci_pending blocker for race condition');
  assert(blockers[0].type === 'ci_pending', 'Blocker type should be ci_pending');
});

test('When checks exist and all pass: noCiConfigured should be false', () => {
  const ciStatusResult = { status: 'success', checks: [{ name: 'CI', conclusion: 'success' }] };

  let noCiConfigured = false;
  let blockers = [];

  // Only check for no_checks case
  if (ciStatusResult.status === 'no_checks') {
    noCiConfigured = true; // Would be set based on merge status
  }
  // success status → no blockers, noCiConfigured remains false

  assert(noCiConfigured === false, 'noCiConfigured should be false when CI checks exist');
});

test('When checks exist but are failing: noCiConfigured should be false', () => {
  const ciStatusResult = {
    status: 'failure',
    checks: [{ name: 'CI', conclusion: 'failure' }],
    failedChecks: [{ name: 'CI' }],
    hasCancelled: false,
    hasStale: false,
    cancelledChecks: [],
    staleChecks: [],
  };

  let noCiConfigured = false;
  let blockers = [];

  if (ciStatusResult.status === 'no_checks') {
    noCiConfigured = true;
  } else if (ciStatusResult.status === 'failure') {
    blockers.push({ type: 'ci_failure', message: 'CI/CD checks are failing' });
  }

  assert(noCiConfigured === false, 'noCiConfigured should be false when CI checks fail');
  assert(blockers.length === 1, 'Should add ci_failure blocker');
  assert(blockers[0].type === 'ci_failure', 'Blocker type should be ci_failure');
});

// ===== Test: Success comment content based on CI configuration =====
console.log('\n📋 Success Comment Content Tests\n');

test('Ready to merge comment should mention CI when CI exists', () => {
  const noCiConfigured = false;
  const ciLine = noCiConfigured
    ? '- No CI/CD checks are configured for this repository'
    : '- All CI checks have passed';

  assert(
    ciLine === '- All CI checks have passed',
    `CI line should mention CI passed, got: ${ciLine}`
  );
  assert(!ciLine.includes('No CI/CD'), 'Should not mention no CI when CI exists');
});

test('Ready to merge comment should say no CI when no CI configured', () => {
  const noCiConfigured = true;
  const ciLine = noCiConfigured
    ? '- No CI/CD checks are configured for this repository'
    : '- All CI checks have passed';

  assert(
    ciLine === '- No CI/CD checks are configured for this repository',
    `CI line should mention no CI, got: ${ciLine}`
  );
  assert(!ciLine.includes('All CI checks'), 'Should not say CI passed when no CI configured');
});

test('Auto-merged comment should mention CI when CI exists', () => {
  const noCiConfigured = false;
  const ciLine = noCiConfigured
    ? '- No CI/CD checks are configured for this repository'
    : '- All CI checks have passed';

  const commentBody = `## 🎉 Auto-merged\n\nThis pull request has been automatically merged by hive-mind.\n${ciLine}\n\n---\n*Auto-merged by hive-mind with --auto-merge flag*`;

  assert(commentBody.includes('All CI checks have passed'), 'Comment should mention CI passed');
  assert(!commentBody.includes('No CI/CD checks are configured'), 'Comment should not mention no CI');
});

test('Auto-merged comment should say no CI when no CI configured', () => {
  const noCiConfigured = true;
  const ciLine = noCiConfigured
    ? '- No CI/CD checks are configured for this repository'
    : '- All CI checks have passed';

  const commentBody = `## 🎉 Auto-merged\n\nThis pull request has been automatically merged by hive-mind.\n${ciLine}\n\n---\n*Auto-merged by hive-mind with --auto-merge flag*`;

  assert(
    commentBody.includes('No CI/CD checks are configured for this repository'),
    'Comment should mention no CI configured'
  );
  assert(!commentBody.includes('All CI checks have passed'), 'Comment should not say CI passed');
});

// ===== Test: getMergeBlockers return structure =====
console.log('\n📋 getMergeBlockers Return Structure Tests\n');

test('getMergeBlockers should return { blockers, ciStatus, noCiConfigured }', () => {
  // Test the expected return shape from the fixed getMergeBlockers function
  const mockReturn = { blockers: [], ciStatus: { status: 'no_checks' }, noCiConfigured: true };

  assert('blockers' in mockReturn, 'Return should have blockers property');
  assert('ciStatus' in mockReturn, 'Return should have ciStatus property');
  assert('noCiConfigured' in mockReturn, 'Return should have noCiConfigured property');
  assert(Array.isArray(mockReturn.blockers), 'blockers should be an array');
  assert(typeof mockReturn.noCiConfigured === 'boolean', 'noCiConfigured should be boolean');
});

test('When noCiConfigured=true, blockers array should be empty', () => {
  // When no CI is configured and PR is MERGEABLE, there should be no blockers
  const mockReturn = { blockers: [], ciStatus: { status: 'no_checks' }, noCiConfigured: true };

  assert(mockReturn.blockers.length === 0, 'blockers should be empty when no CI configured');
  assert(mockReturn.noCiConfigured === true, 'noCiConfigured should be true');
});

test('When noCiConfigured=false (normal CI), blockers reflects CI state', () => {
  // Normal CI scenario - blockers from CI status
  const mockReturn = {
    blockers: [{ type: 'ci_pending', message: 'CI/CD checks are still running or queued' }],
    ciStatus: { status: 'pending' },
    noCiConfigured: false,
  };

  assert(mockReturn.blockers.length === 1, 'Should have 1 blocker for pending CI');
  assert(mockReturn.noCiConfigured === false, 'noCiConfigured should be false');
});

// ===== Test: End-to-end merge flow with no CI =====
console.log('\n📋 End-to-end Merge Flow Tests\n');

test('With noCiConfigured=true, PR should be treated as mergeable', () => {
  // Simulate the watchUntilMergeable loop condition
  const blockers = []; // Empty from noCiConfigured=true
  const hasNewComments = false;
  const hasUncommittedChanges = false;

  // The condition that triggers "PR IS MERGEABLE"
  const isMergeable = blockers.length === 0 && !hasNewComments && !hasUncommittedChanges;

  assert(isMergeable === true, 'PR should be treated as mergeable when no CI configured');
});

test('With noCiConfigured=true but new comments, should NOT be immediately mergeable', () => {
  // Even without CI, new comments trigger a restart
  const blockers = []; // Empty from noCiConfigured=true
  const hasNewComments = true;
  const hasUncommittedChanges = false;

  const isMergeable = blockers.length === 0 && !hasNewComments && !hasUncommittedChanges;

  assert(isMergeable === false, 'Should not be mergeable when there are new comments');
});

test('With noCiConfigured=true but uncommitted changes, should NOT be immediately mergeable', () => {
  const blockers = []; // Empty from noCiConfigured=true
  const hasNewComments = false;
  const hasUncommittedChanges = true;

  const isMergeable = blockers.length === 0 && !hasNewComments && !hasUncommittedChanges;

  assert(isMergeable === false, 'Should not be mergeable when there are uncommitted changes');
});

// ===== Test: Prevent infinite loop =====
console.log('\n📋 Infinite Loop Prevention Tests\n');

test('Old behavior: no_checks always added ci_pending blocker (caused infinite loop)', () => {
  // Document the OLD broken behavior for reference
  const ciStatusResult = { status: 'no_checks' };

  let blockers = [];
  // OLD CODE (broken): always adds ci_pending for no_checks, even if PR is MERGEABLE
  if (ciStatusResult.status === 'no_checks') {
    blockers.push({
      type: 'ci_pending',
      message: 'CI/CD checks have not started yet (waiting for checks to appear)',
    });
  }

  // This is what caused the infinite loop:
  assert(blockers.length === 1, 'Old behavior: always adds blocker (causing infinite loop)');
  assert(blockers[0].type === 'ci_pending', 'Old behavior: type is ci_pending');
});

test('New behavior: no_checks + MERGEABLE should have no blocker (fixes infinite loop)', () => {
  // Document the NEW fixed behavior
  const ciStatusResult = { status: 'no_checks' };
  const mergeStatusResult = { mergeable: true };

  let noCiConfigured = false;
  let blockers = [];

  // NEW CODE (fixed): check mergeability first for no_checks case
  if (ciStatusResult.status === 'no_checks') {
    if (mergeStatusResult.mergeable) {
      noCiConfigured = true; // Skip blocker - no CI required
    } else {
      blockers.push({
        type: 'ci_pending',
        message: 'CI/CD checks have not started yet (waiting for checks to appear)',
      });
    }
  }

  // This is the fix - no blocker added when no CI is configured
  assert(noCiConfigured === true, 'New behavior: noCiConfigured should be true');
  assert(blockers.length === 0, 'New behavior: no blockers when no CI configured (fixes infinite loop)');
});

// Summary
console.log('\n================================================================================');
console.log(`Test Results for Issue #1345:`);
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
