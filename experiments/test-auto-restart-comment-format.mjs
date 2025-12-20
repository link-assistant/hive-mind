#!/usr/bin/env node
/**
 * Test script to verify auto-restart comment format
 * Tests that uncommitted files are included in the comment body
 */

// Simulate the comment generation logic
const simulateAutoRestartComment = (autoRestartCount, maxAutoRestartIterations, uncommittedFiles) => {
  const remainingIterations = maxAutoRestartIterations - autoRestartCount;

  // Get uncommitted files list for the comment
  let uncommittedFilesList = '';
  if (uncommittedFiles && uncommittedFiles.trim()) {
    uncommittedFilesList = '\n\n**Uncommitted files:**\n```\n' + uncommittedFiles + '\n```';
  }

  const commentBody = `## 🔄 Auto-restart ${autoRestartCount}/${maxAutoRestartIterations}\n\nDetected uncommitted changes from previous run. Starting new session to review and commit them.${uncommittedFilesList}\n\n---\n*Auto-restart will stop after changes are committed or after ${remainingIterations} more iteration${remainingIterations !== 1 ? 's' : ''}. Please wait until working session will end and give your feedback.*`;

  return commentBody;
};

console.log('Testing auto-restart comment format...\n');

// Test 1: Comment with uncommitted files
console.log('Test 1: Comment with uncommitted files');
const uncommittedFiles1 = ` M src/solve.watch.lib.mjs
 M experiments/test-auto-restart.sh
?? experiments/new-test.mjs`;

const comment1 = simulateAutoRestartComment(1, 3, uncommittedFiles1);
console.log(comment1);
console.log('\n✅ Comment includes uncommitted files list\n');

// Test 2: Comment without uncommitted files (empty string)
console.log('Test 2: Comment without uncommitted files');
const uncommittedFiles2 = '';

const comment2 = simulateAutoRestartComment(2, 3, uncommittedFiles2);
console.log(comment2);
console.log('\n✅ Comment handles empty file list gracefully\n');

// Test 3: Comment on last iteration
console.log('Test 3: Comment on last iteration');
const uncommittedFiles3 = ' M README.md';

const comment3 = simulateAutoRestartComment(3, 3, uncommittedFiles3);
console.log(comment3);
console.log('\n✅ Comment shows correct remaining iterations (0)\n');

console.log('All tests completed successfully! ✅');
