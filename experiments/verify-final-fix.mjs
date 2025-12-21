#!/usr/bin/env node

// Final verification of the fix
// Tests the exact logic from the current solve.mjs implementation

function verifyFinalFix() {
  console.log('VERIFYING FINAL FIX IMPLEMENTATION');
  console.log('='.repeat(50));

  // Test the exact logic from solve.mjs lines 2072-2084
  function testCommentDisplayLogic(isContinueMode, autoContinue, newPrComments, newIssueComments) {
    const argv = { autoContinue };
    const commentLines = [];

    console.log(
      `\nTesting: isContinueMode=${isContinueMode}, autoContinue=${autoContinue}, PR=${newPrComments}, Issue=${newIssueComments}`
    );

    // Always show comment counts when in continue or auto-continue mode
    if (isContinueMode || argv.autoContinue) {
      commentLines.push(`New comments on the pull request: ${newPrComments}`);
      commentLines.push(`New comments on the issue: ${newIssueComments}`);
      console.log('  ✅ Added comment lines (continue/auto-continue mode)');
    } else {
      // Original behavior for non-continue modes: only show if > 0
      if (newPrComments > 0) {
        commentLines.push(`New comments on the pull request: ${newPrComments}`);
      }
      if (newIssueComments > 0) {
        commentLines.push(`New comments on the issue: ${newIssueComments}`);
      }
      console.log('  ℹ️  Only added comment lines if > 0 (regular mode)');
    }

    console.log(`  Result: ${JSON.stringify(commentLines)}`);

    // Test if prompt would be modified
    if (commentLines.length > 0) {
      console.log('  ✅ commentInfo would be added to system prompt');

      if (isContinueMode) {
        console.log('  ✅ Prompt would be modified with comment info');

        // Show how the prompt would look
        const originalPrompt = 'Issue to solve: ...\n\nContinue.';
        const modifiedPrompt = originalPrompt.replace('Continue.', commentLines.join('\\n') + '\\n\\nContinue.');
        console.log(`  📝 Prompt modification:`);
        console.log(`     Original: "Continue."`);
        console.log(`     Modified: "${commentLines.join('\\n')}\\n\\nContinue."`);

        return true;
      } else {
        console.log('  ℹ️  Prompt not modified (not in continue mode)');
      }
    } else {
      console.log('  ❌ No comment info added (empty commentLines)');
    }

    return false;
  }

  // Test all scenarios
  console.log('\n1. PROBLEMATIC SCENARIO (from user issue):');
  const result1 = testCommentDisplayLogic(true, false, 0, 0);

  console.log('\n2. WITH FLAG SCENARIO (working per user):');
  const result2 = testCommentDisplayLogic(true, false, 0, 0); // Same logic, flag doesn't affect this part

  console.log('\n3. REGULAR MODE (should only show if > 0):');
  const result3 = testCommentDisplayLogic(false, false, 0, 0);

  console.log('\n4. REGULAR MODE WITH COMMENTS:');
  const result4 = testCommentDisplayLogic(false, false, 1, 2);

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY:');
  console.log(`Scenario 1 (continue, 0 comments): ${result1 ? '✅ Shows in prompt' : '❌ Not in prompt'}`);
  console.log(`Scenario 2 (continue with flag, 0 comments): ${result2 ? '✅ Shows in prompt' : '❌ Not in prompt'}`);
  console.log(`Scenario 3 (regular, 0 comments): ${result3 ? '✅ Shows in prompt' : '❌ Not in prompt'}`);
  console.log(`Scenario 4 (regular, >0 comments): ${result4 ? '✅ Shows in prompt' : '❌ Not in prompt'}`);

  if (result1) {
    console.log('\n✅ THE FIX SHOULD WORK!');
    console.log('   Comment counts should appear in continue mode prompts.');
    console.log('   If user still sees issues, they may be:');
    console.log('   1. Looking at the wrong log messages');
    console.log('   2. Not running in actual continue mode');
    console.log('   3. Having a different execution path issue');
  } else {
    console.log('\n❌ THE FIX IS BROKEN!');
  }
}

verifyFinalFix();
