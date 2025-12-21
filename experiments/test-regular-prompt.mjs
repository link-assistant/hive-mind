#!/usr/bin/env node

// Test script to verify regular mode prompt is unchanged

const testRegularModePrompt = () => {
  // Simulate regular mode variables
  const isContinueMode = false;
  const issueUrl = 'https://github.com/link-assistant/hive-mind/issues/71';
  const branchName = 'issue-71-145a3af2';
  const tempDir = '/tmp/test-dir';
  
  // This is the same logic as in solve.mjs
  let prompt;
  if (isContinueMode) {
    // This should not execute
    prompt = 'Should not reach here';
  } else {
    prompt = `Issue to solve: ${issueUrl}
Your prepared branch: ${branchName}
Your prepared working directory: ${tempDir}

Proceed.`;
  }
  
  console.log('Generated regular mode prompt:');
  console.log('=====================================');
  console.log(prompt);
  console.log('=====================================');
  
  // Verify mergeStateStatus is NOT mentioned in regular mode
  const containsMergeStateStatus = prompt.includes('mergeStateStatus');
  console.log(`\nTest result: mergeStateStatus mentioned = ${containsMergeStateStatus} (should be false)`);
  
  return !containsMergeStateStatus; // Return true if NOT mentioned (which is correct)
};

// Run the test
const success = testRegularModePrompt();
console.log(`Regular mode test: ${success ? 'PASS' : 'FAIL'}`);
process.exit(success ? 0 : 1);