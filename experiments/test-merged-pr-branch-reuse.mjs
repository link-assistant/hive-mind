#!/usr/bin/env node

/**
 * Test script to verify that branches from merged/closed PRs are not reused
 * This simulates the scenario from issue #426 where issue #423 was reopened
 * and the branch from the merged PR was incorrectly reused.
 */

// Mock the use function
globalThis.use = async module => {
  if (module === 'command-stream') {
    return {
      $: async (strings, ...values) => {
        // Build the command string
        let cmd = strings[0];
        for (let i = 0; i < values.length; i++) {
          cmd += values[i] + strings[i + 1];
        }

        console.log(`[MOCK] Command: ${cmd}`);

        // Mock gh pr list --head --state all responses for different scenarios
        if (cmd.includes('gh pr list') && cmd.includes('--head issue-423-f335e81f') && cmd.includes('--state all')) {
          // Simulate the issue #423 scenario: branch has both MERGED and OPEN PR
          return {
            code: 0,
            stdout: JSON.stringify([
              { number: 425, state: 'OPEN' },
              { number: 424, state: 'MERGED' },
            ]),
          };
        }

        if (cmd.includes('gh pr list') && cmd.includes('--head issue-999-abc123') && cmd.includes('--state all')) {
          // Simulate a branch with only OPEN PR (should be reused)
          return {
            code: 0,
            stdout: JSON.stringify([{ number: 100, state: 'OPEN' }]),
          };
        }

        if (cmd.includes('gh pr list') && cmd.includes('--head issue-888-def456') && cmd.includes('--state all')) {
          // Simulate a branch with no PRs (should be reused)
          return {
            code: 0,
            stdout: JSON.stringify([]),
          };
        }

        if (cmd.includes('gh pr list') && cmd.includes('--head issue-777-ghi789') && cmd.includes('--state all')) {
          // Simulate a branch with only CLOSED PR (should NOT be reused)
          return {
            code: 0,
            stdout: JSON.stringify([{ number: 200, state: 'CLOSED' }]),
          };
        }

        return { code: 0, stdout: '[]' };
      },
    };
  }
  return {};
};

// Mock log function
const logs = [];
globalThis.log = async msg => {
  logs.push(msg);
  console.log(msg);
};

// Mock reportError
globalThis.reportError = () => {};

// Import the module to test
const autoContinueLib = await import('../src/solve.auto-continue.lib.mjs');
const { processAutoContinueForIssue } = autoContinueLib;

// Test scenarios
console.log('\n=== TEST 1: Branch with MERGED PR (issue #423 scenario) ===');
logs.length = 0;
const test1Result = await testScenario({
  issueNumber: 423,
  existingBranches: ['issue-423-f335e81f'],
  expectedBehavior: 'Should NOT reuse branch (has merged PR)',
});

console.log('\n=== TEST 2: Branch with only OPEN PR ===');
logs.length = 0;
const test2Result = await testScenario({
  issueNumber: 999,
  existingBranches: ['issue-999-abc123'],
  expectedBehavior: 'Should reuse branch and PR',
});

console.log('\n=== TEST 3: Branch with no PRs ===');
logs.length = 0;
const test3Result = await testScenario({
  issueNumber: 888,
  existingBranches: ['issue-888-def456'],
  expectedBehavior: 'Should reuse branch (no PR yet)',
});

console.log('\n=== TEST 4: Branch with CLOSED PR ===');
logs.length = 0;
const test4Result = await testScenario({
  issueNumber: 777,
  existingBranches: ['issue-777-ghi789'],
  expectedBehavior: 'Should NOT reuse branch (has closed PR)',
});

// Summary
console.log('\n=== TEST SUMMARY ===');
console.log(`Test 1 (Merged PR): ${test1Result ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Test 2 (Open PR): ${test2Result ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Test 3 (No PR): ${test3Result ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Test 4 (Closed PR): ${test4Result ? '✅ PASS' : '❌ FAIL'}`);

const allPassed = test1Result && test2Result && test3Result && test4Result;
console.log(`\nOverall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

process.exit(allPassed ? 0 : 1);

async function testScenario({ issueNumber, existingBranches, expectedBehavior }) {
  console.log(`\nExpected: ${expectedBehavior}`);

  // Mock the branch listing to return our test branches
  const originalUse = globalThis.use;
  globalThis.use = async module => {
    const baseResult = await originalUse(module);
    if (module === 'command-stream') {
      const original$ = baseResult.$;
      baseResult.$ = async (strings, ...values) => {
        let cmd = strings[0];
        for (let i = 0; i < values.length; i++) {
          cmd += values[i] + strings[i + 1];
        }

        // Mock branch listing
        if (cmd.includes('gh api --paginate repos/') && cmd.includes('/branches')) {
          return {
            code: 0,
            stdout: existingBranches.join('\n'),
          };
        }

        return original$(strings, ...values);
      };
    }
    return baseResult;
  };

  const argv = { autoContinue: true, fork: false };
  const result = await processAutoContinueForIssue(argv, true, issueNumber, 'link-assistant', 'hive-mind');

  console.log(`Result: isContinueMode=${result.isContinueMode}, prNumber=${result.prNumber}, prBranch=${result.prBranch}`);

  // Verify results based on scenario
  if (issueNumber === 423) {
    // Should NOT reuse branch (has merged PR)
    return result.isContinueMode === false;
  } else if (issueNumber === 999) {
    // Should reuse branch and PR
    return result.isContinueMode === true && result.prNumber === 100;
  } else if (issueNumber === 888) {
    // Should reuse branch but no PR
    return result.isContinueMode === true && result.prNumber === null;
  } else if (issueNumber === 777) {
    // Should NOT reuse branch (has closed PR)
    return result.isContinueMode === false;
  }

  return false;
}
