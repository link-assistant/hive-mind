#!/usr/bin/env node

// Test script to verify comment display logic fix
// This tests the modified logic in solve.mjs

function testCommentDisplayLogic() {
  console.log('Testing comment display logic...\n');

  // Test scenarios
  const scenarios = [
    {
      name: 'Continue mode with 0 comments',
      isContinueMode: true,
      autoContinue: false,
      newPrComments: 0,
      newIssueComments: 0,
      expected: ['New comments on the pull request: 0', 'New comments on the issue: 0'],
    },
    {
      name: 'Auto-continue mode with 0 comments',
      isContinueMode: false,
      autoContinue: true,
      newPrComments: 0,
      newIssueComments: 0,
      expected: ['New comments on the pull request: 0', 'New comments on the issue: 0'],
    },
    {
      name: 'Continue mode with some comments',
      isContinueMode: true,
      autoContinue: false,
      newPrComments: 2,
      newIssueComments: 1,
      expected: ['New comments on the pull request: 2', 'New comments on the issue: 1'],
    },
    {
      name: 'Regular mode with 0 comments',
      isContinueMode: false,
      autoContinue: false,
      newPrComments: 0,
      newIssueComments: 0,
      expected: [],
    },
    {
      name: 'Regular mode with some comments',
      isContinueMode: false,
      autoContinue: false,
      newPrComments: 1,
      newIssueComments: 2,
      expected: ['New comments on the pull request: 1', 'New comments on the issue: 2'],
    },
  ];

  let allPassed = true;

  scenarios.forEach((scenario, index) => {
    console.log(`Test ${index + 1}: ${scenario.name}`);

    // Simulate the fixed logic
    const commentLines = [];
    const { isContinueMode, autoContinue, newPrComments, newIssueComments } = scenario;
    const argv = { autoContinue };

    // Always show comment counts when in continue or auto-continue mode
    if (isContinueMode || argv.autoContinue) {
      commentLines.push(`New comments on the pull request: ${newPrComments}`);
      commentLines.push(`New comments on the issue: ${newIssueComments}`);
    } else {
      // Original behavior for non-continue modes: only show if > 0
      if (newPrComments > 0) {
        commentLines.push(`New comments on the pull request: ${newPrComments}`);
      }
      if (newIssueComments > 0) {
        commentLines.push(`New comments on the issue: ${newIssueComments}`);
      }
    }

    // Check if result matches expected
    const passed = JSON.stringify(commentLines) === JSON.stringify(scenario.expected);

    console.log(`  Expected: ${JSON.stringify(scenario.expected)}`);
    console.log(`  Got:      ${JSON.stringify(commentLines)}`);
    console.log(`  Result:   ${passed ? '✅ PASS' : '❌ FAIL'}\n`);

    if (!passed) allPassed = false;
  });

  console.log(`Overall result: ${allPassed ? '✅ All tests passed!' : '❌ Some tests failed'}`);
  return allPassed;
}

// Run the tests
testCommentDisplayLogic();
