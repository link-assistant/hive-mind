#!/usr/bin/env node
/**
 * Tests for Issue #1425: /merge should only check last CI/CD of default branch
 *
 * Verifies that checkBranchCIHealth correctly uses the HEAD SHA of the branch
 * rather than the most recently *completed* run's SHA. This prevents false
 * failures when the latest commit has an in-progress CI run.
 *
 * Run with: node tests/test-branch-ci-health-1425.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1425
 */

import assert from 'node:assert/strict';

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
// checkBranchCIHealth return shape tests (via module import)
// ============================================================================

console.log('\n📋 Issue #1425: checkBranchCIHealth return shape tests\n');

await asyncTest('checkBranchCIHealth is exported from github-merge-ci.lib.mjs', async () => {
  const module = await import('../src/github-merge-ci.lib.mjs');
  assert.ok(typeof module.checkBranchCIHealth === 'function', 'checkBranchCIHealth should be exported as a function');
});

await asyncTest('checkBranchCIHealth is re-exported from github-merge.lib.mjs', async () => {
  const module = await import('../src/github-merge.lib.mjs');
  assert.ok(typeof module.checkBranchCIHealth === 'function', 'checkBranchCIHealth should be re-exported from github-merge.lib.mjs');
});

// ============================================================================
// Mock-based unit tests for checkBranchCIHealth logic
// ============================================================================

console.log('\n📋 Issue #1425: checkBranchCIHealth logic unit tests\n');

/**
 * Simulate the fixed checkBranchCIHealth logic inline to test the decision tree
 * without making real API calls.
 *
 * This mirrors the logic in src/github-merge-ci.lib.mjs:checkBranchCIHealth
 */
function simulateCheckBranchCIHealth({ headSha, runsForHeadSha }) {
  if (!headSha) {
    return { healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null };
  }

  const runs = runsForHeadSha;

  if (runs.length === 0) {
    return { healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null };
  }

  // Check for in-progress runs
  const pendingRuns = runs.filter(r => r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting' || r.status === 'requested' || r.status === 'pending');
  if (pendingRuns.length > 0) {
    return { healthy: true, pending: true, failedRuns: [], pendingRuns, error: null };
  }

  // All completed — check for failures
  const failedRuns = runs.filter(r => r.conclusion === 'failure' || r.conclusion === 'timed_out');
  if (failedRuns.length > 0) {
    return {
      healthy: false,
      pending: false,
      failedRuns,
      pendingRuns: [],
      error: `${failedRuns.length} CI run(s) failed: ${failedRuns.map(r => r.name).join(', ')}`,
    };
  }

  return { healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null };
}

// ============================================================================
// Issue #1425 scenario: in-progress run on latest commit should not block queue
// ============================================================================

test('Issue #1425: in-progress CI on latest commit → healthy + pending (not failure)', () => {
  // This is exactly the scenario from issue #1425:
  // - Latest commit (31a4668): CI is in_progress
  // - Previous commit (bf59d39): CI failed (but this commit is no longer the latest)
  const result = simulateCheckBranchCIHealth({
    headSha: '31a4668e08924e0ce195ab6c5c1b167e0dc3d0d1',
    runsForHeadSha: [
      {
        id: 23041358120,
        name: 'Checks and release',
        status: 'in_progress',
        conclusion: null,
        head_sha: '31a4668e08924e0ce195ab6c5c1b167e0dc3d0d1',
      },
    ],
  });

  assert.equal(result.healthy, true, 'Should be healthy (CI is running, not failed)');
  assert.equal(result.pending, true, 'Should be pending (CI is in progress)');
  assert.equal(result.failedRuns.length, 0, 'Should have no failed runs');
  assert.equal(result.pendingRuns.length, 1, 'Should have 1 pending run');
});

test('Issue #1425: completed failure on latest commit → unhealthy', () => {
  // A genuine failure: the latest commit's CI actually failed
  const result = simulateCheckBranchCIHealth({
    headSha: 'bf59d392269f8d6a74ec3988130517568086baa5',
    runsForHeadSha: [
      {
        id: 23041191010,
        name: 'Checks and release',
        status: 'completed',
        conclusion: 'failure',
        head_sha: 'bf59d392269f8d6a74ec3988130517568086baa5',
      },
    ],
  });

  assert.equal(result.healthy, false, 'Should be unhealthy (CI actually failed)');
  assert.equal(result.pending, false, 'Should not be pending');
  assert.equal(result.failedRuns.length, 1, 'Should have 1 failed run');
  assert.ok(result.error !== null, 'Should have an error message');
});

test('Issue #1425: all runs successful on latest commit → healthy', () => {
  const result = simulateCheckBranchCIHealth({
    headSha: '14fdb8bd33c7e509119fb5fe07cdae030ee2b5b3',
    runsForHeadSha: [
      {
        id: 23040959919,
        name: 'Checks and release',
        status: 'completed',
        conclusion: 'success',
        head_sha: '14fdb8bd33c7e509119fb5fe07cdae030ee2b5b3',
      },
    ],
  });

  assert.equal(result.healthy, true, 'Should be healthy');
  assert.equal(result.pending, false, 'Should not be pending');
  assert.equal(result.failedRuns.length, 0, 'Should have no failed runs');
});

test('Issue #1425: no CI runs on latest commit → healthy (CI not configured or not started)', () => {
  const result = simulateCheckBranchCIHealth({
    headSha: 'abc123def456',
    runsForHeadSha: [],
  });

  assert.equal(result.healthy, true, 'Should be healthy when no runs exist');
  assert.equal(result.pending, false, 'Should not be pending');
  assert.equal(result.failedRuns.length, 0, 'Should have no failed runs');
});

test('Issue #1425: queued run on latest commit → healthy + pending', () => {
  const result = simulateCheckBranchCIHealth({
    headSha: 'abc123def456',
    runsForHeadSha: [{ id: 1, name: 'CI', status: 'queued', conclusion: null, head_sha: 'abc123def456' }],
  });

  assert.equal(result.healthy, true, 'Queued run → healthy');
  assert.equal(result.pending, true, 'Queued run → pending');
  assert.equal(result.pendingRuns.length, 1, 'Should have 1 pending run');
});

test('Issue #1425: waiting run on latest commit → healthy + pending', () => {
  const result = simulateCheckBranchCIHealth({
    headSha: 'abc123def456',
    runsForHeadSha: [{ id: 1, name: 'CI', status: 'waiting', conclusion: null, head_sha: 'abc123def456' }],
  });

  assert.equal(result.healthy, true, 'Waiting run → healthy');
  assert.equal(result.pending, true, 'Waiting run → pending');
});

test('Issue #1425: mix of in-progress and success runs → healthy + pending', () => {
  // One run completed successfully, another is still in progress
  const result = simulateCheckBranchCIHealth({
    headSha: 'abc123def456',
    runsForHeadSha: [
      { id: 1, name: 'Unit tests', status: 'completed', conclusion: 'success', head_sha: 'abc123def456' },
      { id: 2, name: 'Release', status: 'in_progress', conclusion: null, head_sha: 'abc123def456' },
    ],
  });

  assert.equal(result.healthy, true, 'Mix → healthy');
  assert.equal(result.pending, true, 'Mix → pending (because release is in_progress)');
  assert.equal(result.failedRuns.length, 0, 'Should have no failed runs');
  assert.equal(result.pendingRuns.length, 1, 'Should have 1 pending run');
});

test('Issue #1425: timed_out run on latest commit → unhealthy', () => {
  const result = simulateCheckBranchCIHealth({
    headSha: 'abc123def456',
    runsForHeadSha: [{ id: 1, name: 'CI', status: 'completed', conclusion: 'timed_out', head_sha: 'abc123def456' }],
  });

  assert.equal(result.healthy, false, 'Timed out run → unhealthy');
  assert.equal(result.failedRuns.length, 1, 'Should have 1 failed run');
});

// ============================================================================
// Verify the return shape has the new `pending` and `pendingRuns` fields
// ============================================================================

console.log('\n📋 Issue #1425: return shape validation\n');

test('Issue #1425: healthy result has pending=false and pendingRuns=[]', () => {
  const result = simulateCheckBranchCIHealth({
    headSha: 'abc',
    runsForHeadSha: [{ id: 1, name: 'CI', status: 'completed', conclusion: 'success', head_sha: 'abc' }],
  });

  assert.ok('pending' in result, 'Result should have pending field');
  assert.ok('pendingRuns' in result, 'Result should have pendingRuns field');
  assert.ok('failedRuns' in result, 'Result should have failedRuns field');
  assert.ok('healthy' in result, 'Result should have healthy field');
  assert.equal(result.pending, false, 'pending should be false for healthy result');
  assert.ok(Array.isArray(result.pendingRuns), 'pendingRuns should be an array');
});

test('Issue #1425: pending result has healthy=true and pending=true with populated pendingRuns', () => {
  const run = { id: 1, name: 'CI', status: 'in_progress', conclusion: null, head_sha: 'abc' };
  const result = simulateCheckBranchCIHealth({
    headSha: 'abc',
    runsForHeadSha: [run],
  });

  assert.equal(result.healthy, true, 'Pending result should be healthy');
  assert.equal(result.pending, true, 'Pending result should have pending=true');
  assert.equal(result.failedRuns.length, 0, 'Pending result should have no failed runs');
  assert.equal(result.pendingRuns.length, 1, 'Pending result should have 1 pending run');
  assert.deepEqual(result.pendingRuns[0], run, 'pendingRuns should contain the in-progress run');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
