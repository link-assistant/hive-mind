#!/usr/bin/env node

/**
 * Test script for --prefix-fork-name-with-owner-name option
 *
 * This script tests the fork name generation logic for the new option.
 */

// Test scenarios
const testCases = [
  {
    name: 'Standard fork naming (option disabled)',
    argv: { prefixForkNameWithOwnerName: false },
    owner: 'emirmensitov-afk',
    repo: '-',
    currentUser: 'konard',
    expected: {
      expectedForkName: 'konard/-',
      alternateForkName: 'konard/emirmensitov-afk--',
      defaultForkName: '-',
      actualForkName: 'konard/-'
    }
  },
  {
    name: 'Prefixed fork naming (option enabled)',
    argv: { prefixForkNameWithOwnerName: true },
    owner: 'emirmensitov-afk',
    repo: '-',
    currentUser: 'konard',
    expected: {
      expectedForkName: 'konard/emirmensitov-afk--',
      alternateForkName: 'konard/-',
      defaultForkName: 'emirmensitov-afk--',
      actualForkName: 'konard/emirmensitov-afk--'
    }
  },
  {
    name: 'Standard fork for regular repo',
    argv: { prefixForkNameWithOwnerName: false },
    owner: 'microsoft',
    repo: 'vscode',
    currentUser: 'konard',
    expected: {
      expectedForkName: 'konard/vscode',
      alternateForkName: 'konard/microsoft-vscode',
      defaultForkName: 'vscode',
      actualForkName: 'konard/vscode'
    }
  },
  {
    name: 'Prefixed fork for regular repo',
    argv: { prefixForkNameWithOwnerName: true },
    owner: 'microsoft',
    repo: 'vscode',
    currentUser: 'konard',
    expected: {
      expectedForkName: 'konard/microsoft-vscode',
      alternateForkName: 'konard/vscode',
      defaultForkName: 'microsoft-vscode',
      actualForkName: 'konard/microsoft-vscode'
    }
  }
];

// Test logic (extracted from solve.repository.lib.mjs)
function testForkNaming(argv, owner, repo, currentUser) {
  const standardForkName = `${currentUser}/${repo}`;
  const prefixedForkName = `${currentUser}/${owner}-${repo}`;

  // Determine expected fork name based on --prefix-fork-name-with-owner-name option
  const expectedForkName = argv.prefixForkNameWithOwnerName ? prefixedForkName : standardForkName;
  const alternateForkName = argv.prefixForkNameWithOwnerName ? standardForkName : prefixedForkName;

  // For fork creation
  const defaultForkName = argv.prefixForkNameWithOwnerName ? `${owner}-${repo}` : repo;
  const actualForkName = `${currentUser}/${defaultForkName}`;

  return {
    expectedForkName,
    alternateForkName,
    defaultForkName,
    actualForkName
  };
}

// Run tests
console.log('Testing --prefix-fork-name-with-owner-name option\n');
console.log('='.repeat(80));

let passedTests = 0;
let failedTests = 0;

for (const testCase of testCases) {
  console.log(`\nTest: ${testCase.name}`);
  console.log('-'.repeat(80));

  const result = testForkNaming(
    testCase.argv,
    testCase.owner,
    testCase.repo,
    testCase.currentUser
  );

  let testPassed = true;

  for (const key of Object.keys(testCase.expected)) {
    const expected = testCase.expected[key];
    const actual = result[key];
    const match = expected === actual;

    if (!match) {
      testPassed = false;
    }

    console.log(`  ${key}:`);
    console.log(`    Expected: ${expected}`);
    console.log(`    Actual:   ${actual}`);
    console.log(`    Status:   ${match ? '✅ PASS' : '❌ FAIL'}`);
  }

  if (testPassed) {
    passedTests++;
    console.log(`\n  Result: ✅ PASS`);
  } else {
    failedTests++;
    console.log(`\n  Result: ❌ FAIL`);
  }
}

console.log('\n' + '='.repeat(80));
console.log(`\nTest Summary:`);
console.log(`  Total:  ${testCases.length}`);
console.log(`  Passed: ${passedTests}`);
console.log(`  Failed: ${failedTests}`);

if (failedTests > 0) {
  console.log(`\n❌ Some tests failed!`);
  process.exit(1);
} else {
  console.log(`\n✅ All tests passed!`);
  process.exit(0);
}
