#!/usr/bin/env node

// Test script to verify mergeStateStatus is mentioned in continue mode prompt
// This simulates the conditions where continue mode would be triggered

const testContinueModePrompt = () => {
  // Simulate continue mode variables
  const isContinueMode = true;
  const issueNumber = '71';
  const owner = 'link-assistant';
  const repo = 'hive-mind';
  const branchName = 'issue-71-145a3af2';
  const tempDir = '/tmp/test-dir';
  const prUrl = 'https://github.com/link-assistant/hive-mind/pull/72';
  const mergeStateStatus = 'CLEAN';

  // This is the same logic as in solve.mjs
  let prompt;
  if (isContinueMode) {
    prompt = `Issue to solve: ${issueNumber ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : `Issue linked to PR #${prNumber}`}
Your prepared branch: ${branchName}
Your prepared working directory: ${tempDir}
Your prepared Pull Request: ${prUrl}
Existing pull request's merge state status: ${mergeStateStatus}

Continue.`;
  }

  console.log('Generated continue mode prompt:');
  console.log('=====================================');
  console.log(prompt);
  console.log('=====================================');

  // Verify mergeStateStatus is mentioned with actual value
  const containsMergeStateStatus = prompt.includes("Existing pull request's merge state status: CLEAN");
  console.log(`\nTest result: mergeStateStatus with actual value included = ${containsMergeStateStatus}`);

  return containsMergeStateStatus;
};

// Run the test
const success = testContinueModePrompt();
process.exit(success ? 0 : 1);
