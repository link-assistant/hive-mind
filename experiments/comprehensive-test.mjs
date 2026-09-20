#!/usr/bin/env node

// Comprehensive test to understand the exact issue
// This will test the exact scenario where comment counting might fail

function testCommentCountingScenario() {
  console.log('Testing comprehensive comment counting scenario...\n');

  // Simulate the exact conditions from the user's logs
  const prNumber = 109; // From the user's log
  const branchName = 'issue-108-33029b6d'; // From the user's log
  const isContinueMode = true;
  const argv = {
    autoContinue: false,
    autoContinueOnlyOnNewComments: false,
  };

  console.log('Test conditions:');
  console.log(`- prNumber: ${prNumber}`);
  console.log(`- branchName: ${branchName}`);
  console.log(`- isContinueMode: ${isContinueMode}`);
  console.log(`- argv.autoContinue: ${argv.autoContinue}`);
  console.log(`- argv.autoContinueOnlyOnNewComments: ${argv.autoContinueOnlyOnNewComments}`);
  console.log('\n');

  // Check if the comment counting block would execute
  const shouldCountComments = prNumber && branchName;
  console.log(`Should comment counting block execute? ${shouldCountComments ? '✅ YES' : '❌ NO'}`);

  if (!shouldCountComments) {
    console.log('❌ PROBLEM IDENTIFIED: Comment counting block would not execute!');
    console.log('   This means prNumber or branchName is falsy.');
    return false;
  }

  // Simulate comment counting results
  const newPrComments = 0;
  const newIssueComments = 0;

  console.log('\nSimulated comment counting results:');
  console.log(`- newPrComments: ${newPrComments}`);
  console.log(`- newIssueComments: ${newIssueComments}`);

  // Test the comment display logic
  const commentLines = [];

  // Always show comment counts when in continue or auto-continue mode
  if (isContinueMode || argv.autoContinue) {
    commentLines.push(`New comments on the pull request: ${newPrComments}`);
    commentLines.push(`New comments on the issue: ${newIssueComments}`);
    console.log('\n✅ Comment lines would be added (continue/auto-continue mode)');
  } else {
    // Original behavior for non-continue modes: only show if > 0
    if (newPrComments > 0) {
      commentLines.push(`New comments on the pull request: ${newPrComments}`);
    }
    if (newIssueComments > 0) {
      commentLines.push(`New comments on the issue: ${newIssueComments}`);
    }
    console.log('\n⚠️  Comment lines only added if > 0 (regular mode)');
  }

  console.log(`commentLines: ${JSON.stringify(commentLines)}`);
  console.log(`commentLines.length: ${commentLines.length}`);

  // Check if logs would be shown
  const wouldLog = commentLines.length > 0;
  console.log(`\nWould logs show comment counts? ${wouldLog ? '✅ YES' : '❌ NO'}`);

  // Check if prompt would be modified
  const wouldModifyPrompt = commentLines.length > 0 && isContinueMode;
  console.log(`Would prompt be modified with comment info? ${wouldModifyPrompt ? '✅ YES' : '❌ NO'}`);

  return wouldLog && wouldModifyPrompt;
}

// Also test the autoContinueOnlyOnNewComments scenario
function testAutoContinueOnlyOnNewCommentsScenario() {
  console.log('\n' + '='.repeat(60));
  console.log('Testing --auto-continue-only-on-new-comments scenario...\n');

  const prNumber = 109;
  const branchName = 'issue-108-33029b6d';
  const isContinueMode = true;
  const argv = {
    autoContinue: false,
    autoContinueOnlyOnNewComments: true, // This flag is enabled
  };

  console.log('Test conditions:');
  console.log(`- prNumber: ${prNumber}`);
  console.log(`- branchName: ${branchName}`);
  console.log(`- isContinueMode: ${isContinueMode}`);
  console.log(`- argv.autoContinue: ${argv.autoContinue}`);
  console.log(`- argv.autoContinueOnlyOnNewComments: ${argv.autoContinueOnlyOnNewComments}`);

  // Comment counting would happen the same way
  const newPrComments = 0;
  const newIssueComments = 0;

  console.log('\nSimulated comment counting results:');
  console.log(`- newPrComments: ${newPrComments}`);
  console.log(`- newIssueComments: ${newIssueComments}`);

  // The comment display logic should be the same
  const commentLines = [];

  if (isContinueMode || argv.autoContinue) {
    commentLines.push(`New comments on the pull request: ${newPrComments}`);
    commentLines.push(`New comments on the issue: ${newIssueComments}`);
  }

  console.log(`commentLines: ${JSON.stringify(commentLines)}`);

  // The difference would be in the autoContinueOnlyOnNewComments check
  if (argv.autoContinueOnlyOnNewComments && (isContinueMode || argv.autoContinue)) {
    const totalNewComments = newPrComments + newIssueComments;
    if (totalNewComments === 0) {
      console.log('\n❌ Would exit with error: No new comments found');
      console.log('   But this would happen AFTER the comment counts are logged');
      return false;
    }
  }

  return true;
}

// Run both tests
console.log('COMPREHENSIVE COMMENT COUNTING TEST');
console.log('='.repeat(60));

const regularResult = testCommentCountingScenario();
const autoOnlyResult = testAutoContinueOnlyOnNewCommentsScenario();

console.log('\n' + '='.repeat(60));
console.log('SUMMARY:');
console.log(`Regular continue mode: ${regularResult ? '✅ Should work' : '❌ Problem detected'}`);
console.log(`Auto-continue-only mode: ${autoOnlyResult ? '✅ Should work' : '❌ Problem detected'}`);

if (regularResult && autoOnlyResult) {
  console.log('\n🤔 Both scenarios should work according to the current logic.');
  console.log('   The issue might be elsewhere or in a different condition.');
} else {
  console.log('\n❌ Problem identified in the logic!');
}
