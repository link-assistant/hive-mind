#!/usr/bin/env node

// Verify the actual behavior described in the issue
// Test both scenarios with the exact logic from solve.mjs

function testScenario(
  scenarioName,
  isContinueMode,
  autoContinue,
  autoContinueOnlyOnNewComments,
  newPrComments,
  newIssueComments
) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TESTING: ${scenarioName}`);
  console.log(`${'='.repeat(60)}`);

  console.log('Conditions:');
  console.log(`- isContinueMode: ${isContinueMode}`);
  console.log(`- autoContinue: ${autoContinue}`);
  console.log(`- autoContinueOnlyOnNewComments: ${autoContinueOnlyOnNewComments}`);
  console.log(`- newPrComments: ${newPrComments}`);
  console.log(`- newIssueComments: ${newIssueComments}`);

  // Simulate the argv object
  const argv = {
    autoContinue: autoContinue,
    autoContinueOnlyOnNewComments: autoContinueOnlyOnNewComments
  };

  console.log('\nStep 1: Comment counts would be logged');
  console.log(`💬 New PR comments: ${newPrComments}`);
  console.log(`💬 New issue comments: ${newIssueComments}`);

  console.log('\nStep 2: Check auto-continue-only-on-new-comments logic');
  let processWouldExit = false;
  if (argv.autoContinueOnlyOnNewComments && (isContinueMode || argv.autoContinue)) {
    const totalNewComments = newPrComments + newIssueComments;
    if (totalNewComments === 0) {
      console.log('❌ Process would EXIT (no comments found)');
      processWouldExit = true;
    } else {
      console.log(`✅ Process would CONTINUE (${totalNewComments} comments found)`);
    }
  } else {
    console.log('ℹ️  No auto-continue-only check (flag not used)');
  }

  if (processWouldExit) {
    console.log('\n❌ RESULT: Process exits, prompt is NEVER modified');
    console.log('   User sees comment counts in logs but NOT in prompt');
    return false;
  }

  console.log('\nStep 3: Build comment lines for prompt');
  const commentLines = [];

  // Always show comment counts when in continue or auto-continue mode
  if (isContinueMode || argv.autoContinue) {
    commentLines.push(`New comments on the pull request: ${newPrComments}`);
    commentLines.push(`New comments on the issue: ${newIssueComments}`);
    console.log('✅ Comment lines added (continue/auto-continue mode)');
  } else {
    // Original behavior for non-continue modes: only show if > 0
    if (newPrComments > 0) {
      commentLines.push(`New comments on the pull request: ${newPrComments}`);
    }
    if (newIssueComments > 0) {
      commentLines.push(`New comments on the issue: ${newIssueComments}`);
    }
    console.log('ℹ️  Comment lines only added if > 0 (regular mode)');
  }

  console.log(`commentLines: ${JSON.stringify(commentLines)}`);

  console.log('\nStep 4: Modify prompt');
  let promptModified = false;
  if (commentLines.length > 0) {
    console.log('✅ commentInfo would be added to system prompt');

    // Also add the comment info to the visible prompt for user
    if (isContinueMode) {
      console.log('✅ Prompt would be modified with comment info');
      promptModified = true;
    } else {
      console.log('ℹ️  Prompt not modified (not in continue mode)');
    }
  } else {
    console.log('❌ No comment info added (empty commentLines)');
  }

  console.log(`\n🎯 FINAL RESULT: Comment info in prompt? ${promptModified ? '✅ YES' : '❌ NO'}`);
  return promptModified;
}

console.log('COMPREHENSIVE BEHAVIOR VERIFICATION');
console.log('Testing the exact scenarios from the user issue\n');

// Scenario 1: Continue mode WITHOUT --auto-continue-only-on-new-comments, 0 comments
const scenario1 = testScenario(
  'Continue mode WITHOUT flag, 0 comments',
  true, // isContinueMode
  false, // autoContinue
  false, // autoContinueOnlyOnNewComments
  0, // newPrComments
  0 // newIssueComments
);

// Scenario 2: Continue mode WITH --auto-continue-only-on-new-comments, 0 comments
const scenario2 = testScenario(
  'Continue mode WITH flag, 0 comments',
  true, // isContinueMode
  false, // autoContinue
  true, // autoContinueOnlyOnNewComments
  0, // newPrComments
  0 // newIssueComments
);

// Scenario 3: Continue mode WITH --auto-continue-only-on-new-comments, some comments
const scenario3 = testScenario(
  'Continue mode WITH flag, some comments',
  true, // isContinueMode
  false, // autoContinue
  true, // autoContinueOnlyOnNewComments
  1, // newPrComments
  0 // newIssueComments
);

console.log('\n' + '='.repeat(80));
console.log('SUMMARY:');
console.log(`Scenario 1 (no flag, 0 comments): ${scenario1 ? '✅ Shows in prompt' : '❌ Not in prompt'}`);
console.log(`Scenario 2 (with flag, 0 comments): ${scenario2 ? '✅ Shows in prompt' : '❌ Not in prompt'}`);
console.log(`Scenario 3 (with flag, some comments): ${scenario3 ? '✅ Shows in prompt' : '❌ Not in prompt'}`);

console.log('\nUser complaint analysis:');
if (!scenario1 && !scenario2) {
  console.log('❌ Neither scenario shows comment info in prompt - both broken!');
} else if (scenario1 && !scenario2) {
  console.log('🤔 WITHOUT flag works, WITH flag does not - opposite of user claim!');
} else if (!scenario1 && scenario2) {
  console.log('🤔 WITH flag works, WITHOUT flag does not - matches user claim but scenario 2 should exit!');
} else {
  console.log('✅ Both scenarios should work - user might be testing wrong scenarios');
}
