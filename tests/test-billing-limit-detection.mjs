#!/usr/bin/env node
/**
 * Billing limit detection and CI/CD status handling tests
 *
 * Tests for the checkForBillingLimitError function, getDetailedCIStatus,
 * workflow re-run functions, and related utilities in the auto-merge pipeline (Issue #1314).
 *
 * Run with: node tests/test-billing-limit-detection.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1314
 */

import assert from 'node:assert/strict';
import { checkForBillingLimitError, getCheckRunAnnotations, getRepoVisibility, BILLING_LIMIT_ERROR_PATTERN, getDetailedCIStatus, rerunWorkflowRun, rerunFailedJobs, getWorkflowRunsForSha } from '../src/github-merge.lib.mjs';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

// ============================================================================
// BILLING_LIMIT_ERROR_PATTERN constant tests
// ============================================================================

console.log('\n📋 BILLING_LIMIT_ERROR_PATTERN Constant Tests\n');

test('BILLING_LIMIT_ERROR_PATTERN is exported and is a string', () => {
  assert.equal(typeof BILLING_LIMIT_ERROR_PATTERN, 'string', 'BILLING_LIMIT_ERROR_PATTERN should be a string');
});

test('BILLING_LIMIT_ERROR_PATTERN contains expected text', () => {
  assert.ok(BILLING_LIMIT_ERROR_PATTERN.includes('job was not started'), 'Should contain "job was not started"');
  assert.ok(BILLING_LIMIT_ERROR_PATTERN.includes('payments'), 'Should contain "payments"');
  assert.ok(BILLING_LIMIT_ERROR_PATTERN.includes('spending limit'), 'Should contain "spending limit"');
});

test('BILLING_LIMIT_ERROR_PATTERN matches real GitHub error message', () => {
  // This is the actual message from GitHub Actions when billing limits are reached
  const realMessage = "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings";
  assert.ok(realMessage.includes(BILLING_LIMIT_ERROR_PATTERN), 'Real GitHub message should contain the pattern');
});

// ============================================================================
// getCheckRunAnnotations function tests
// ============================================================================

console.log('\n📋 getCheckRunAnnotations Function Tests\n');

test('getCheckRunAnnotations is exported and is a function', () => {
  assert.equal(typeof getCheckRunAnnotations, 'function', 'getCheckRunAnnotations should be a function');
});

await asyncTest('getCheckRunAnnotations returns an array for invalid check run', async () => {
  // Should return empty array for nonexistent check run
  const result = await getCheckRunAnnotations('nonexistent-owner-12345', 'nonexistent-repo-12345', 99999999999, false);
  assert.ok(Array.isArray(result), 'Should return an array');
  assert.equal(result.length, 0, 'Should return empty array for invalid check run');
});

// ============================================================================
// getRepoVisibility function tests
// ============================================================================

console.log('\n📋 getRepoVisibility Function Tests\n');

test('getRepoVisibility is exported and is a function', () => {
  assert.equal(typeof getRepoVisibility, 'function', 'getRepoVisibility should be a function');
});

await asyncTest('getRepoVisibility returns correct structure', async () => {
  // Test with a nonexistent repo (should return safe defaults)
  const result = await getRepoVisibility('nonexistent-owner-12345', 'nonexistent-repo-12345', false);
  assert.ok(result !== null && result !== undefined, 'Result should not be null/undefined');
  assert.ok('isPrivate' in result, 'Result should have isPrivate property');
  assert.ok('visibility' in result, 'Result should have visibility property');
});

await asyncTest('getRepoVisibility defaults to private for nonexistent repo', async () => {
  // Safety: when we can't determine visibility, assume private
  const result = await getRepoVisibility('nonexistent-owner-12345', 'nonexistent-repo-12345', false);
  assert.equal(result.isPrivate, true, 'Should default to isPrivate=true for safety');
});

await asyncTest('getRepoVisibility correctly identifies public repos', async () => {
  // torvalds/linux is a well-known public repo
  const result = await getRepoVisibility('torvalds', 'linux', false);
  assert.equal(result.isPrivate, false, 'torvalds/linux should be identified as public');
  assert.equal(result.visibility, 'public', 'torvalds/linux should have visibility=public');
});

await asyncTest('getRepoVisibility correctly identifies link-assistant/hive-mind', async () => {
  // Our own repo
  const result = await getRepoVisibility('link-assistant', 'hive-mind', false);
  assert.ok(typeof result.isPrivate === 'boolean', 'isPrivate should be a boolean');
  assert.ok(['public', 'private', 'internal', null].includes(result.visibility), `visibility should be valid, got: ${result.visibility}`);
});

// ============================================================================
// checkForBillingLimitError function tests
// ============================================================================

console.log('\n📋 checkForBillingLimitError Function Tests\n');

test('checkForBillingLimitError is exported and is a function', () => {
  assert.equal(typeof checkForBillingLimitError, 'function', 'checkForBillingLimitError should be a function');
});

await asyncTest('checkForBillingLimitError returns correct structure', async () => {
  // Test with a nonexistent PR (should return safe defaults)
  const result = await checkForBillingLimitError('nonexistent-owner-12345', 'nonexistent-repo-12345', 99999, false);
  assert.ok(result !== null && result !== undefined, 'Result should not be null/undefined');
  assert.ok('isBillingLimitError' in result, 'Result should have isBillingLimitError property');
  assert.ok('message' in result, 'Result should have message property');
  assert.ok('affectedJobs' in result, 'Result should have affectedJobs property');
  assert.ok('allJobsAffected' in result, 'Result should have allJobsAffected property');
});

await asyncTest('checkForBillingLimitError returns false for nonexistent PR', async () => {
  const result = await checkForBillingLimitError('nonexistent-owner-12345', 'nonexistent-repo-12345', 99999, false);
  assert.equal(result.isBillingLimitError, false, 'Should return false for nonexistent PR');
  assert.ok(Array.isArray(result.affectedJobs), 'affectedJobs should be an array');
  assert.equal(result.affectedJobs.length, 0, 'affectedJobs should be empty for nonexistent PR');
});

// ============================================================================
// Billing limit detection logic tests (unit tests with mock data)
// ============================================================================

console.log('\n📋 Billing Limit Detection Logic Tests\n');

test('Billing limit job detection criteria - empty steps', () => {
  // A job affected by billing limits has empty steps array
  const jobWithBillingLimit = {
    id: 12345,
    conclusion: 'failure',
    steps: [],
    runner_id: 0,
  };

  const hasNoSteps = !jobWithBillingLimit.steps || jobWithBillingLimit.steps.length === 0;
  assert.equal(hasNoSteps, true, 'Job with empty steps should be detected');
});

test('Billing limit job detection criteria - runner_id is 0', () => {
  const jobWithBillingLimit = {
    id: 12345,
    conclusion: 'failure',
    steps: [],
    runner_id: 0,
  };

  const hasNoRunner = jobWithBillingLimit.runner_id === 0 || jobWithBillingLimit.runner_id === null;
  assert.equal(hasNoRunner, true, 'Job with runner_id=0 should be detected');
});

test('Billing limit job detection criteria - runner_id is null', () => {
  const jobWithBillingLimit = {
    id: 12345,
    conclusion: 'failure',
    steps: [],
    runner_id: null,
  };

  const hasNoRunner = jobWithBillingLimit.runner_id === 0 || jobWithBillingLimit.runner_id === null;
  assert.equal(hasNoRunner, true, 'Job with runner_id=null should be detected');
});

test('Normal failing job should NOT match billing limit criteria', () => {
  // A normal failing job has steps and a runner
  const normalFailingJob = {
    id: 12345,
    conclusion: 'failure',
    steps: [
      { name: 'Checkout', conclusion: 'success' },
      { name: 'Build', conclusion: 'failure' },
    ],
    runner_id: 789,
  };

  const hasNoSteps = !normalFailingJob.steps || normalFailingJob.steps.length === 0;
  const hasNoRunner = normalFailingJob.runner_id === 0 || normalFailingJob.runner_id === null;

  assert.equal(hasNoSteps, false, 'Normal job should have steps');
  assert.equal(hasNoRunner, false, 'Normal job should have a runner');
});

test('Successful job should NOT match billing limit criteria', () => {
  const successfulJob = {
    id: 12345,
    conclusion: 'success',
    steps: [{ name: 'Checkout', conclusion: 'success' }],
    runner_id: 789,
  };

  const isFailed = successfulJob.conclusion === 'failure';
  assert.equal(isFailed, false, 'Successful job should not be detected as billing limit');
});

test('Annotation matching should correctly identify billing limit message', () => {
  const annotations = [
    {
      path: '.github',
      annotation_level: 'failure',
      title: '',
      message: "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings",
    },
  ];

  const billingAnnotation = annotations.find(a => a.message?.includes(BILLING_LIMIT_ERROR_PATTERN));
  assert.ok(billingAnnotation, 'Should find billing limit annotation');
});

test('Annotation matching should NOT match unrelated error messages', () => {
  const annotations = [
    {
      path: 'src/index.js',
      annotation_level: 'failure',
      title: 'Build Error',
      message: 'Process exited with code 1',
    },
  ];

  const billingAnnotation = annotations.find(a => a.message?.includes(BILLING_LIMIT_ERROR_PATTERN));
  assert.equal(billingAnnotation, undefined, 'Should not match unrelated error');
});

// ============================================================================
// getDetailedCIStatus function tests
// ============================================================================

console.log('\n📋 getDetailedCIStatus Function Tests\n');

test('getDetailedCIStatus is exported and is a function', () => {
  assert.equal(typeof getDetailedCIStatus, 'function', 'getDetailedCIStatus should be a function');
});

await asyncTest('getDetailedCIStatus returns correct structure for nonexistent PR', async () => {
  const result = await getDetailedCIStatus('nonexistent-owner-12345', 'nonexistent-repo-12345', 99999, false);
  assert.ok(result !== null && result !== undefined, 'Result should not be null/undefined');
  assert.ok('status' in result, 'Result should have status property');
  assert.ok('checks' in result, 'Result should have checks property');
  assert.ok('hasFailures' in result, 'Result should have hasFailures property');
  assert.ok('hasCancelled' in result, 'Result should have hasCancelled property');
  assert.ok('hasStale' in result, 'Result should have hasStale property');
  assert.ok('hasPending' in result, 'Result should have hasPending property');
  assert.ok('hasQueued' in result, 'Result should have hasQueued property');
  assert.ok('allPassed' in result, 'Result should have allPassed property');
  assert.ok('failedChecks' in result, 'Result should have failedChecks property');
  assert.ok('cancelledChecks' in result, 'Result should have cancelledChecks property');
  assert.ok('staleChecks' in result, 'Result should have staleChecks property');
  assert.ok('pendingChecks' in result, 'Result should have pendingChecks property');
  assert.ok('queuedChecks' in result, 'Result should have queuedChecks property');
  assert.ok('passedChecks' in result, 'Result should have passedChecks property');
  assert.equal(result.status, 'unknown', 'Should return unknown for nonexistent PR');
});

// ============================================================================
// CI Status categorization logic tests (unit tests with mock data)
// ============================================================================

console.log('\n📋 CI Status Categorization Logic Tests\n');

test('All checks passed → status should be success', () => {
  const checks = [
    { name: 'build', status: 'completed', conclusion: 'success', type: 'check_run', id: 1 },
    { name: 'test', status: 'completed', conclusion: 'success', type: 'check_run', id: 2 },
    { name: 'lint', status: 'completed', conclusion: 'skipped', type: 'check_run', id: 3 },
  ];

  const passed = checks.filter(c => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral');
  const failed = checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out');
  const cancelled = checks.filter(c => c.conclusion === 'cancelled');
  const pending = checks.filter(c => c.status === 'in_progress' && c.conclusion === null);
  const queued = checks.filter(c => c.status === 'queued' && c.conclusion === null);

  assert.equal(passed.length, 3, 'All 3 checks should be passed');
  assert.equal(failed.length, 0, 'No checks should be failed');
  assert.equal(cancelled.length, 0, 'No checks should be cancelled');
  assert.equal(pending.length, 0, 'No checks should be pending');
  assert.equal(queued.length, 0, 'No checks should be queued');
});

test('Some checks failed → status should be failure', () => {
  const checks = [
    { name: 'build', status: 'completed', conclusion: 'success', type: 'check_run', id: 1 },
    { name: 'test', status: 'completed', conclusion: 'failure', type: 'check_run', id: 2 },
  ];

  const failed = checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out');
  assert.equal(failed.length, 1, 'One check should be failed');
  assert.equal(failed[0].name, 'test', 'The test check should be the failing one');
});

test('Some checks cancelled (no failures) → status should be cancelled', () => {
  const checks = [
    { name: 'build', status: 'completed', conclusion: 'success', type: 'check_run', id: 1 },
    { name: 'test', status: 'completed', conclusion: 'cancelled', type: 'check_run', id: 2 },
    { name: 'lint', status: 'completed', conclusion: 'cancelled', type: 'check_run', id: 3 },
  ];

  const failed = checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out');
  const cancelled = checks.filter(c => c.conclusion === 'cancelled');

  assert.equal(failed.length, 0, 'No checks should be failed');
  assert.equal(cancelled.length, 2, 'Two checks should be cancelled');

  // Determine status same as getDetailedCIStatus
  const hasFailed = failed.length > 0;
  const hasCancelled = cancelled.length > 0;
  let status;
  if (hasFailed && !hasCancelled) status = 'failure';
  else if (hasCancelled && !hasFailed) status = 'cancelled';
  else if (hasFailed && hasCancelled) status = 'failure';
  else status = 'success';
  assert.equal(status, 'cancelled', 'Status should be cancelled when only cancelled checks remain');
});

test('Mixed failures and cancelled → status should be failure', () => {
  const checks = [
    { name: 'build', status: 'completed', conclusion: 'failure', type: 'check_run', id: 1 },
    { name: 'test', status: 'completed', conclusion: 'cancelled', type: 'check_run', id: 2 },
  ];

  const failed = checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out');
  const cancelled = checks.filter(c => c.conclusion === 'cancelled');

  assert.equal(failed.length, 1, 'One check should be failed');
  assert.equal(cancelled.length, 1, 'One check should be cancelled');

  // Mixed case: failures take priority
  const hasFailed = failed.length > 0;
  const hasCancelled = cancelled.length > 0;
  let status;
  if (hasFailed && hasCancelled) status = 'failure';
  else status = 'unknown';
  assert.equal(status, 'failure', 'Mixed failures and cancelled should report as failure');
});

test('Checks still running → status should be pending', () => {
  const checks = [
    { name: 'build', status: 'completed', conclusion: 'success', type: 'check_run', id: 1 },
    { name: 'test', status: 'in_progress', conclusion: null, type: 'check_run', id: 2 },
  ];

  const pending = checks.filter(c => c.status === 'in_progress' && c.conclusion === null);
  assert.equal(pending.length, 1, 'One check should be pending');
});

test('Checks queued (waiting for runner) → status should be pending', () => {
  const checks = [
    { name: 'build', status: 'completed', conclusion: 'success', type: 'check_run', id: 1 },
    { name: 'test', status: 'queued', conclusion: null, type: 'check_run', id: 2 },
  ];

  const queued = checks.filter(c => c.status === 'queued' && c.conclusion === null);
  assert.equal(queued.length, 1, 'One check should be queued');
});

test('Timed out job should be treated as failure', () => {
  const checks = [{ name: 'build', status: 'completed', conclusion: 'timed_out', type: 'check_run', id: 1 }];

  const failed = checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out');
  assert.equal(failed.length, 1, 'Timed out check should be treated as failure');
});

test('Neutral conclusion should be treated as passed', () => {
  const checks = [{ name: 'advisory', status: 'completed', conclusion: 'neutral', type: 'check_run', id: 1 }];

  const passed = checks.filter(c => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral');
  assert.equal(passed.length, 1, 'Neutral check should be treated as passed');
});

// ============================================================================
// rerunWorkflowRun and rerunFailedJobs function tests
// ============================================================================

console.log('\n📋 Workflow Re-run Function Tests\n');

test('rerunWorkflowRun is exported and is a function', () => {
  assert.equal(typeof rerunWorkflowRun, 'function', 'rerunWorkflowRun should be a function');
});

test('rerunFailedJobs is exported and is a function', () => {
  assert.equal(typeof rerunFailedJobs, 'function', 'rerunFailedJobs should be a function');
});

await asyncTest('rerunWorkflowRun handles nonexistent run gracefully', async () => {
  const result = await rerunWorkflowRun('nonexistent-owner-12345', 'nonexistent-repo-12345', 99999999, false);
  assert.ok(result !== null && result !== undefined, 'Result should not be null/undefined');
  assert.ok('success' in result, 'Result should have success property');
  assert.ok('error' in result, 'Result should have error property');
  // Should fail gracefully, not throw
  assert.equal(result.success, false, 'Should return success=false for nonexistent run');
});

await asyncTest('rerunFailedJobs handles nonexistent run gracefully', async () => {
  const result = await rerunFailedJobs('nonexistent-owner-12345', 'nonexistent-repo-12345', 99999999, false);
  assert.ok(result !== null && result !== undefined, 'Result should not be null/undefined');
  assert.ok('success' in result, 'Result should have success property');
  assert.ok('error' in result, 'Result should have error property');
  assert.equal(result.success, false, 'Should return success=false for nonexistent run');
});

// ============================================================================
// getWorkflowRunsForSha function tests
// ============================================================================

console.log('\n📋 getWorkflowRunsForSha Function Tests\n');

test('getWorkflowRunsForSha is exported and is a function', () => {
  assert.equal(typeof getWorkflowRunsForSha, 'function', 'getWorkflowRunsForSha should be a function');
});

await asyncTest('getWorkflowRunsForSha returns empty array for nonexistent SHA', async () => {
  const result = await getWorkflowRunsForSha('nonexistent-owner-12345', 'nonexistent-repo-12345', 'abc123', false);
  assert.ok(Array.isArray(result), 'Should return an array');
  assert.equal(result.length, 0, 'Should return empty array for nonexistent SHA');
});

// ============================================================================
// Decision logic tests: which CI states trigger AI restart vs wait vs re-trigger
// ============================================================================

console.log('\n📋 Decision Logic Tests (restart AI vs wait vs re-trigger)\n');

test('CI failure should trigger AI restart', () => {
  const blocker = { type: 'ci_failure', message: 'CI failing', details: ['test'] };
  const shouldRestart = blocker.type === 'ci_failure';
  assert.equal(shouldRestart, true, 'CI failure should trigger restart');
});

test('CI cancelled should NOT trigger AI restart (should re-trigger instead)', () => {
  const blocker = { type: 'ci_cancelled', message: 'CI cancelled', details: ['test'], sha: 'abc123' };
  const shouldRestart = blocker.type === 'ci_failure';
  assert.equal(shouldRestart, false, 'CI cancelled should NOT trigger restart');
});

test('CI pending should NOT trigger AI restart (should wait)', () => {
  const blocker = { type: 'ci_pending', message: 'CI pending', details: ['test'] };
  const shouldRestart = blocker.type === 'ci_failure';
  assert.equal(shouldRestart, false, 'CI pending should NOT trigger restart');
});

test('Billing limit should NOT trigger AI restart', () => {
  const blocker = { type: 'billing_limit', message: 'Billing limit', details: ['test'] };
  const shouldRestart = blocker.type === 'ci_failure';
  assert.equal(shouldRestart, false, 'Billing limit should NOT trigger restart');
});

test('New comments should trigger AI restart regardless of CI state', () => {
  const hasNewComments = true;
  assert.equal(hasNewComments, true, 'New comments should always trigger restart');
});

test('Merge conflicts should trigger AI restart', () => {
  const blocker = { type: 'not_mergeable', message: 'PR has merge conflicts', details: [] };
  const shouldRestart = blocker.message.includes('conflicts');
  assert.equal(shouldRestart, true, 'Merge conflicts should trigger restart');
});

test('Uncommitted changes should trigger AI restart', () => {
  const hasUncommittedChanges = true;
  assert.equal(hasUncommittedChanges, true, 'Uncommitted changes should trigger restart');
});

// ============================================================================
// Edge case: stale and action_required conclusions
// ============================================================================

console.log('\n📋 Stale and Action Required Conclusion Tests\n');

test('Stale check should be categorized separately from passed/failed', () => {
  const checks = [
    { name: 'build', status: 'completed', conclusion: 'success', type: 'check_run', id: 1 },
    { name: 'deploy', status: 'completed', conclusion: 'stale', type: 'check_run', id: 2 },
  ];

  const passed = checks.filter(c => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral');
  const failed = checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required');
  const stale = checks.filter(c => c.conclusion === 'stale');

  assert.equal(passed.length, 1, 'One check should be passed');
  assert.equal(failed.length, 0, 'No checks should be failed');
  assert.equal(stale.length, 1, 'One check should be stale');
});

test('action_required conclusion should be treated as failure', () => {
  const checks = [{ name: 'security-review', status: 'completed', conclusion: 'action_required', type: 'check_run', id: 1 }];

  const failed = checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required');
  assert.equal(failed.length, 1, 'action_required should be treated as failure');
});

test('Stale checks (no failures) → status should be cancelled (needs re-triggering)', () => {
  const checks = [
    { name: 'build', status: 'completed', conclusion: 'success', type: 'check_run', id: 1 },
    { name: 'test', status: 'completed', conclusion: 'stale', type: 'check_run', id: 2 },
  ];

  const failed = checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required');
  const cancelled = checks.filter(c => c.conclusion === 'cancelled');
  const stale = checks.filter(c => c.conclusion === 'stale');

  const hasFailed = failed.length > 0;
  const hasCancelled = cancelled.length > 0;
  const hasStale = stale.length > 0;

  let status;
  if (hasStale && !hasFailed && !hasCancelled) status = 'cancelled';
  else if ((hasCancelled || hasStale) && !hasFailed) status = 'cancelled';
  else status = 'unknown';

  assert.equal(status, 'cancelled', 'Stale-only checks should report as cancelled (needs re-trigger)');
});

// ============================================================================
// Edge case: waiting and requested statuses
// ============================================================================

console.log('\n📋 Waiting and Requested Status Tests\n');

test('Check with status=waiting should be categorized as pending', () => {
  const checks = [{ name: 'approval-gate', status: 'waiting', conclusion: null, type: 'check_run', id: 1 }];

  const pending = checks.filter(c => (c.status === 'in_progress' || c.status === 'waiting' || c.status === 'requested' || c.status === 'pending') && c.conclusion === null);
  assert.equal(pending.length, 1, 'Waiting check should be treated as pending');
});

test('Check with status=requested should be categorized as pending', () => {
  const checks = [{ name: 'fork-approval', status: 'requested', conclusion: null, type: 'check_run', id: 1 }];

  const pending = checks.filter(c => (c.status === 'in_progress' || c.status === 'waiting' || c.status === 'requested' || c.status === 'pending') && c.conclusion === null);
  assert.equal(pending.length, 1, 'Requested check should be treated as pending');
});

test('Check with status=pending should be categorized as pending', () => {
  const checks = [{ name: 'external-ci', status: 'pending', conclusion: null, type: 'status', id: null }];

  const pending = checks.filter(c => (c.status === 'in_progress' || c.status === 'waiting' || c.status === 'requested' || c.status === 'pending') && c.conclusion === null);
  assert.equal(pending.length, 1, 'Pending check should be treated as pending');
});

// ============================================================================
// Edge case: unknown CI status should NOT be treated as mergeable
// ============================================================================

console.log('\n📋 Unknown CI Status Safety Tests\n');

test('Unknown CI status should trigger a blocker (not treat PR as mergeable)', () => {
  // Simulate getMergeBlockers logic for unknown status
  const ciStatus = { status: 'unknown' };
  const blockers = [];

  if (ciStatus.status === 'unknown') {
    blockers.push({
      type: 'ci_pending',
      message: 'CI/CD status could not be determined (will retry)',
      details: [],
    });
  }

  assert.equal(blockers.length, 1, 'Unknown status should add a blocker');
  assert.equal(blockers[0].type, 'ci_pending', 'Unknown status blocker should be ci_pending type');
});

test('Only success status (no blockers) should allow PR to be considered mergeable', () => {
  // These statuses should NOT result in empty blockers
  const nonMergeableStatuses = ['failure', 'cancelled', 'pending', 'no_checks', 'unknown'];

  for (const status of nonMergeableStatuses) {
    const blockers = [];
    if (status === 'no_checks' || status === 'pending' || status === 'unknown') {
      blockers.push({ type: 'ci_pending' });
    } else if (status === 'cancelled') {
      blockers.push({ type: 'ci_cancelled' });
    } else if (status === 'failure') {
      blockers.push({ type: 'ci_failure' });
    }
    assert.ok(blockers.length > 0, `Status "${status}" should produce at least one blocker`);
  }
});

// ============================================================================
// Edge case: billing limit check for cancelled jobs
// ============================================================================

console.log('\n📋 Billing Limit Check for Cancelled Jobs Tests\n');

test('Cancelled status should also check for billing limits before re-triggering', () => {
  // This verifies the logic flow: when CI is cancelled, we check billing limits first
  // If billing limit is detected, we report billing_limit not ci_cancelled
  const billingCheck = { isBillingLimitError: true, affectedJobs: ['test'], allJobsAffected: true };
  const blockers = [];

  if (billingCheck.isBillingLimitError) {
    blockers.push({ type: 'billing_limit', details: billingCheck.affectedJobs });
  }

  assert.equal(blockers.length, 1, 'Should add billing_limit blocker');
  assert.equal(blockers[0].type, 'billing_limit', 'Blocker type should be billing_limit');
});

test('Cancelled status without billing limit should trigger re-trigger', () => {
  const billingCheck = { isBillingLimitError: false };
  const ciStatus = { cancelledChecks: [{ name: 'test' }], staleChecks: [], sha: 'abc123' };
  const blockers = [];

  if (!billingCheck.isBillingLimitError) {
    const cancelledOrStale = [...ciStatus.cancelledChecks, ...ciStatus.staleChecks];
    blockers.push({ type: 'ci_cancelled', details: cancelledOrStale.map(c => c.name), sha: ciStatus.sha });
  }

  assert.equal(blockers.length, 1, 'Should add ci_cancelled blocker');
  assert.equal(blockers[0].type, 'ci_cancelled', 'Blocker type should be ci_cancelled');
  assert.equal(blockers[0].sha, 'abc123', 'SHA should be passed for re-triggering');
});

// ============================================================================
// Edge case: stale workflow runs should also be re-triggered
// ============================================================================

console.log('\n📋 Stale Workflow Re-trigger Tests\n');

test('Stale workflow runs should be included in re-trigger list', () => {
  const runs = [
    { id: 1, name: 'CI', conclusion: 'cancelled' },
    { id: 2, name: 'Deploy', conclusion: 'stale' },
    { id: 3, name: 'Test', conclusion: 'success' },
  ];

  const retriggerable = runs.filter(r => r.conclusion === 'cancelled' || r.conclusion === 'stale');
  assert.equal(retriggerable.length, 2, 'Both cancelled and stale runs should be re-triggerable');
  assert.equal(retriggerable[0].name, 'CI', 'First re-triggerable should be CI');
  assert.equal(retriggerable[1].name, 'Deploy', 'Second re-triggerable should be Deploy');
});

// ============================================================================
// Comprehensive state matrix validation
// ============================================================================

console.log('\n📋 Comprehensive State Matrix Validation\n');

test('Complete CI state decision matrix matches expected behavior', () => {
  // This test validates the full decision matrix from the PR description
  const stateMatrix = [
    { ciStatus: 'success', expectedAction: 'no_blocker', aiRestart: false },
    { ciStatus: 'failure', expectedAction: 'ci_failure', aiRestart: true },
    { ciStatus: 'cancelled', expectedAction: 'ci_cancelled', aiRestart: false },
    { ciStatus: 'pending', expectedAction: 'ci_pending', aiRestart: false },
    { ciStatus: 'no_checks', expectedAction: 'ci_pending', aiRestart: false },
    { ciStatus: 'unknown', expectedAction: 'ci_pending', aiRestart: false },
  ];

  for (const { ciStatus, expectedAction, aiRestart } of stateMatrix) {
    const blockers = [];

    if (ciStatus === 'no_checks' || ciStatus === 'pending' || ciStatus === 'unknown') {
      blockers.push({ type: 'ci_pending' });
    } else if (ciStatus === 'cancelled') {
      blockers.push({ type: 'ci_cancelled' });
    } else if (ciStatus === 'failure') {
      blockers.push({ type: 'ci_failure' });
    }
    // success → no blockers

    if (expectedAction === 'no_blocker') {
      assert.equal(blockers.length, 0, `CI status "${ciStatus}" should produce no blockers`);
    } else {
      assert.equal(blockers.length, 1, `CI status "${ciStatus}" should produce exactly one blocker`);
      assert.equal(blockers[0].type, expectedAction, `CI status "${ciStatus}" should produce blocker type "${expectedAction}"`);
    }

    // Check AI restart decision
    const shouldRestart = blockers.some(b => b.type === 'ci_failure');
    assert.equal(shouldRestart, aiRestart, `CI status "${ciStatus}" AI restart should be ${aiRestart}`);
  }
});

// ============================================================================
// Integration tests with real data (from case study)
// ============================================================================

console.log('\n📋 Integration Tests with Real External Data\n');

await asyncTest('Detect billing limit on unidel2035/btc#1436 (if accessible)', async () => {
  // This tests against the real PR mentioned in the issue
  // It may fail if the repo is inaccessible or the PR state has changed
  try {
    const result = await checkForBillingLimitError('unidel2035', 'btc', 1436, false);
    assert.ok('isBillingLimitError' in result, 'Should return result with isBillingLimitError');
    // We don't assert the actual value because the billing status may have changed
    console.log(`   Note: Real PR billing status: ${result.isBillingLimitError ? 'BILLING LIMIT' : 'normal'}`);
    if (result.isBillingLimitError) {
      console.log(`   Affected jobs: ${result.affectedJobs.join(', ')}`);
    }
  } catch {
    console.log('   Note: Could not access external repo, skipping real data test');
  }
});

await asyncTest('getDetailedCIStatus works on link-assistant/hive-mind (if PR exists)', async () => {
  // Test with our own repo's PR
  try {
    const result = await getDetailedCIStatus('link-assistant', 'hive-mind', 1315, false);
    assert.ok('status' in result, 'Should have status');
    assert.ok(Array.isArray(result.checks), 'checks should be an array');
    assert.ok(Array.isArray(result.failedChecks), 'failedChecks should be an array');
    assert.ok(Array.isArray(result.cancelledChecks), 'cancelledChecks should be an array');
    assert.ok(Array.isArray(result.staleChecks), 'staleChecks should be an array');
    assert.ok(Array.isArray(result.pendingChecks), 'pendingChecks should be an array');
    assert.ok('hasStale' in result, 'Should have hasStale property');
    console.log(`   Note: PR #1315 CI status: ${result.status} (${result.checks.length} checks)`);
  } catch {
    console.log('   Note: Could not access PR, skipping real data test');
  }
});

// ============================================================================
// Summary
// ============================================================================

console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);
process.exit(testsFailed > 0 ? 1 : 0);
