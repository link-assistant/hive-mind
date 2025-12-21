#!/usr/bin/env node

/**
 * Simple test to verify the PR state checking logic
 * Tests that merged/closed PRs prevent branch reuse
 */

console.log('=== Testing PR State Check Logic ===\n');

// Test data: different PR scenarios
const testCases = [
  {
    name: 'Issue #423 scenario (MERGED + OPEN PR)',
    prs: [
      { number: 425, state: 'OPEN' },
      { number: 424, state: 'MERGED' }
    ],
    expectedReuse: false,
    expectedReason: 'Has MERGED PR'
  },
  {
    name: 'Only OPEN PR',
    prs: [{ number: 100, state: 'OPEN' }],
    expectedReuse: true,
    expectedReason: 'Only OPEN PR'
  },
  {
    name: 'No PRs',
    prs: [],
    expectedReuse: true,
    expectedReason: 'No PRs exist'
  },
  {
    name: 'Only CLOSED PR',
    prs: [{ number: 200, state: 'CLOSED' }],
    expectedReuse: false,
    expectedReason: 'Has CLOSED PR'
  },
  {
    name: 'Only MERGED PR',
    prs: [{ number: 300, state: 'MERGED' }],
    expectedReuse: false,
    expectedReason: 'Has MERGED PR'
  },
  {
    name: 'Multiple OPEN PRs',
    prs: [
      { number: 400, state: 'OPEN' },
      { number: 401, state: 'OPEN' }
    ],
    expectedReuse: true,
    expectedReason: 'All PRs are OPEN'
  }
];

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  console.log(`Test: ${testCase.name}`);
  console.log(`  PRs: ${JSON.stringify(testCase.prs)}`);
  console.log(`  Expected: ${testCase.expectedReuse ? 'REUSE' : 'DO NOT REUSE'} (${testCase.expectedReason})`);

  // Apply the logic from our fix
  let shouldReuse = true;
  let openPr = null;
  let mergedOrClosedPr = null;

  if (testCase.prs.length > 0) {
    // Check if any PR is MERGED or CLOSED
    mergedOrClosedPr = testCase.prs.find(pr => pr.state === 'MERGED' || pr.state === 'CLOSED');
    if (mergedOrClosedPr) {
      shouldReuse = false;
    } else {
      // All PRs are OPEN - find the first open PR
      openPr = testCase.prs.find(pr => pr.state === 'OPEN');
      if (openPr) {
        shouldReuse = true;
      }
    }
  } else {
    // No PRs - can reuse branch
    shouldReuse = true;
  }

  const result = shouldReuse === testCase.expectedReuse;
  console.log(`  Result: ${shouldReuse ? 'REUSE' : 'DO NOT REUSE'} - ${result ? '✅ PASS' : '❌ FAIL'}`);

  if (result) {
    passed++;
  } else {
    failed++;
  }

  console.log();
}

console.log('=== Summary ===');
console.log(`Passed: ${passed}/${testCases.length}`);
console.log(`Failed: ${failed}/${testCases.length}`);
console.log(`\n${failed === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

process.exit(failed === 0 ? 0 : 1);
