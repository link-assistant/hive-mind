#!/usr/bin/env node

// Debug script to identify the actual problem with comment display
// This simulates the real scenario more closely

function debugCommentDisplay() {
  console.log('Debugging the actual comment display issue...\n');

  // Test scenario: Continue mode with 0 comments (the problematic case from the issue)
  const isContinueMode = true;
  const argv = { autoContinue: false }; // No auto-continue flag
  const newPrComments = 0;
  const newIssueComments = 0;
  
  let prompt = `Issue to solve: https://github.com/link-assistant/hive-mind/issues/108
Your prepared branch: issue-108-33029b6d
Your prepared working directory: /tmp/gh-issue-solver-1757833169610
Your prepared Pull Request: https://github.com/link-assistant/hive-mind/pull/109
Existing pull request's merge state status: CLEAN

Continue.`;

  console.log('Initial prompt:');
  console.log(prompt);
  console.log('\n' + '='.repeat(50) + '\n');

  // Current fix logic from the PR
  const commentLines = [];
  
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
  
  console.log('commentLines:', commentLines);
  console.log('commentLines.length:', commentLines.length);
  
  if (commentLines.length > 0) {
    const commentInfo = '\n\n' + commentLines.join('\n') + '\n';
    console.log('commentInfo would be added to system prompt:', JSON.stringify(commentInfo));
    
    // Also add the comment info to the visible prompt for user
    if (isContinueMode) {
      prompt = prompt.replace('Continue.', commentLines.join('\n') + '\n\nContinue.');
    }
  }
  
  console.log('\nFinal prompt after modification:');
  console.log(prompt);
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Check if the comment info appears in the prompt
  const hasCommentInfo = prompt.includes('New comments on the pull request:');
  console.log(`Does the prompt contain comment information? ${hasCommentInfo ? '✅ YES' : '❌ NO'}`);
  
  return hasCommentInfo;
}

// Run the debug test
const result = debugCommentDisplay();

if (!result) {
  console.log('\n❌ The fix is not working! The comment information is not appearing in the prompt.');
} else {
  console.log('\n✅ The fix appears to be working correctly.');
}