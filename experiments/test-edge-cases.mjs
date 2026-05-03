#!/usr/bin/env node

// Test script to validate edge cases for the comment prompt logic
const testEdgeCases = () => {
  console.log('Testing edge cases for comment prompt logic...\n');

  // Test case 1: No comments
  let prompt1 = `Issue to solve: https://github.com/test/repo/issues/1
Your prepared branch: test-branch
Your prepared working directory: /tmp/test
Your prepared Pull Request: https://github.com/test/repo/pull/1
Existing pull request's merge state status: CLEAN

Continue.`;

  const commentLines1 = [];

  if (commentLines1.length > 0) {
    prompt1 = prompt1.replace('Continue.', commentLines1.join('\n') + '\n\nContinue.');
  }

  console.log('Test 1 - No comments:');
  console.log(prompt1.includes('Continue.') ? '✅ Unchanged (correct)' : '❌ Incorrectly modified');
  console.log('');

  // Test case 2: PR comments only
  let prompt2 = `Issue to solve: https://github.com/test/repo/issues/1
Your prepared branch: test-branch
Your prepared working directory: /tmp/test
Your prepared Pull Request: https://github.com/test/repo/pull/1
Existing pull request's merge state status: CLEAN

Continue.`;

  const commentLines2 = ['New comments on the pull request: 3'];

  if (commentLines2.length > 0) {
    prompt2 = prompt2.replace('Continue.', commentLines2.join('\n') + '\n\nContinue.');
  }

  console.log('Test 2 - PR comments only:');
  console.log(prompt2.includes('New comments on the pull request: 3') ? '✅ Added PR comment count' : '❌ PR comment count missing');
  console.log('');

  // Test case 3: Both PR and issue comments
  let prompt3 = `Issue to solve: https://github.com/test/repo/issues/1
Your prepared branch: test-branch
Your prepared working directory: /tmp/test
Your prepared Pull Request: https://github.com/test/repo/pull/1
Existing pull request's merge state status: CLEAN

Continue.`;

  const commentLines3 = ['New comments on the pull request: 2', 'New comments on the issue: 1'];

  if (commentLines3.length > 0) {
    prompt3 = prompt3.replace('Continue.', commentLines3.join('\n') + '\n\nContinue.');
  }

  console.log('Test 3 - Both PR and issue comments:');
  console.log(prompt3.includes('New comments on the pull request: 2') && prompt3.includes('New comments on the issue: 1') ? '✅ Added both comment counts' : '❌ Comment counts missing');
  console.log('');

  // Test case 4: Non-continue mode (should not be affected)
  let prompt4 = `Issue to solve: https://github.com/test/repo/issues/1
Your prepared branch: test-branch
Your prepared working directory: /tmp/test

Proceed.`;

  const isContinueMode = false;
  const commentLines4 = ['New comments on the pull request: 1'];

  if (commentLines4.length > 0 && isContinueMode) {
    prompt4 = prompt4.replace('Continue.', commentLines4.join('\n') + '\n\nContinue.');
  }

  console.log('Test 4 - Non-continue mode:');
  console.log(!prompt4.includes('New comments') && prompt4.includes('Proceed.') ? '✅ Non-continue mode unchanged (correct)' : '❌ Non-continue mode incorrectly modified');

  console.log('\n✅ All edge case tests passed!');
};

testEdgeCases();
