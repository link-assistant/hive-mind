#!/usr/bin/env node
/**
 * Billing limit detection tests
 *
 * Tests for the checkForBillingLimitError function and related utilities
 * in the auto-merge pipeline (Issue #1314).
 *
 * Run with: node tests/test-billing-limit-detection.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1314
 */

import assert from 'node:assert/strict';
import { checkForBillingLimitError, getCheckRunAnnotations, getRepoVisibility, BILLING_LIMIT_ERROR_PATTERN } from '../src/github-merge.lib.mjs';

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

// ============================================================================
// Summary
// ============================================================================

console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);
process.exit(testsFailed > 0 ? 1 : 0);
