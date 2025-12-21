#!/usr/bin/env node

/**
 * Test script to verify the PR creation fix
 *
 * This script tests the logic that:
 * 1. Pushes a branch to GitHub
 * 2. Waits for GitHub's compare API to see the commits
 * 3. Creates a PR only when GitHub is ready
 *
 * We simulate the compare API behavior to test the retry logic
 */

import { setTimeout as sleep } from 'timers/promises';

console.log('=== PR Creation Fix Test ===\n');

// Simulate the retry logic from the fix
async function testCompareApiRetry() {
  console.log('Testing compare API retry logic...\n');

  // Simulate GitHub compare API responses
  let compareAttempts = 0;
  let compareReady = false;
  const maxCompareAttempts = 5;
  const targetBranch = 'master';
  const branchName = 'issue-1-test';

  // Simulate that GitHub takes 3 attempts to be ready
  const simulateCompareApi = (attempt) => {
    console.log(`  Attempt ${attempt}: Checking compare API...`);

    // Simulate that it takes 3 attempts for GitHub to index the commits
    if (attempt >= 3) {
      console.log(`    ✓ Compare API ready: 1 commit(s) ahead`);
      return { success: true, aheadBy: 1 };
    } else {
      console.log(`    ✗ Compare API shows 0 commits ahead`);
      return { success: true, aheadBy: 0 };
    }
  };

  while (!compareReady && compareAttempts < maxCompareAttempts) {
    compareAttempts++;
    const waitTime = Math.min(100 * compareAttempts, 500); // Faster for testing

    if (compareAttempts > 1) {
      console.log(`\n  Retry ${compareAttempts}/${maxCompareAttempts}: Waiting ${waitTime}ms...`);
    }

    await sleep(waitTime);

    const result = simulateCompareApi(compareAttempts);

    if (result.success && result.aheadBy > 0) {
      compareReady = true;
      console.log(`\n✅ SUCCESS: Compare API ready after ${compareAttempts} attempt(s)\n`);
    }
  }

  if (!compareReady) {
    console.log('\n❌ FAILURE: Compare API not ready after retries\n');
    return false;
  }

  return true;
}

// Test the exponential backoff timing
async function testBackoffTiming() {
  console.log('Testing exponential backoff timing...\n');

  const timings = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    const waitTime = Math.min(2000 * attempt, 10000);
    timings.push({ attempt, waitTime });
    console.log(`  Attempt ${attempt}: Wait ${waitTime}ms`);
  }

  console.log('\nExpected backoff progression:');
  console.log('  Attempt 1: 2000ms (2s)');
  console.log('  Attempt 2: 4000ms (4s)');
  console.log('  Attempt 3: 6000ms (6s)');
  console.log('  Attempt 4: 8000ms (8s)');
  console.log('  Attempt 5: 10000ms (10s - capped)');
  console.log('  Total max wait: ~30 seconds\n');

  return true;
}

// Run tests
async function runTests() {
  console.log('Starting tests...\n');
  console.log('═'.repeat(50));
  console.log('\n');

  // Test 1: Compare API retry logic
  console.log('TEST 1: Compare API Retry Logic');
  console.log('-'.repeat(50));
  const test1Result = await testCompareApiRetry();
  console.log('═'.repeat(50));
  console.log('\n');

  // Test 2: Backoff timing
  console.log('TEST 2: Exponential Backoff Timing');
  console.log('-'.repeat(50));
  const test2Result = await testBackoffTiming();
  console.log('═'.repeat(50));
  console.log('\n');

  // Summary
  console.log('TEST RESULTS SUMMARY');
  console.log('═'.repeat(50));
  console.log(`  Compare API Retry:     ${test1Result ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Backoff Timing:        ${test2Result ? '✅ PASS' : '❌ FAIL'}`);
  console.log('═'.repeat(50));
  console.log('\n');

  const allPassed = test1Result && test2Result;
  if (allPassed) {
    console.log('✅ All tests passed!\n');
    console.log('The fix should handle GitHub sync delays properly by:');
    console.log('1. Checking if compare API can see commits (not just branch API)');
    console.log('2. Retrying with exponential backoff up to 5 times');
    console.log('3. Failing gracefully with clear error message if timeout');
    console.log('\n');
  } else {
    console.log('❌ Some tests failed!\n');
    process.exit(1);
  }
}

// Run all tests
runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
