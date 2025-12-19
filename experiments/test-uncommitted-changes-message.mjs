#!/usr/bin/env node
/**
 * Test script for Issue #895 fix: Uncommitted changes message clarity
 *
 * This tests that the feedback message for uncommitted changes is clear and explicit
 * about requiring the model to either COMMIT or REVERT the changes.
 */

// Simulate the feedback message generation for uncommitted changes
function generateUncommittedChangesFeedback(uncommittedFiles, autoRestartCount, maxAutoRestartIterations) {
  const feedbackLines = [];

  feedbackLines.push('');
  feedbackLines.push(`⚠️ UNCOMMITTED CHANGES DETECTED (Auto-restart ${autoRestartCount}/${maxAutoRestartIterations}):`);
  feedbackLines.push('The following uncommitted changes were found in the repository:');
  feedbackLines.push('');

  for (const file of uncommittedFiles) {
    feedbackLines.push(`  ${file}`);
  }

  feedbackLines.push('');
  feedbackLines.push('IMPORTANT: You MUST handle these uncommitted changes by either:');
  feedbackLines.push('1. COMMITTING them if they are part of the solution (git add + git commit + git push)');
  feedbackLines.push('2. REVERTING them if they are not needed (git checkout -- <file> or git clean -fd)');
  feedbackLines.push('');
  feedbackLines.push('DO NOT leave uncommitted changes behind. The session will auto-restart until all changes are resolved.');

  return feedbackLines;
}

// Test scenarios
console.log('Testing Issue #895 Fix: Uncommitted Changes Message Clarity\n');
console.log('='.repeat(70));

// Test 1: Verify message contains explicit COMMIT instruction
console.log('\nTest 1: Message contains explicit COMMIT instruction');
console.log('-'.repeat(70));

const testFiles = [' M src/solve.watch.lib.mjs', '?? solve-log.txt'];
const feedback = generateUncommittedChangesFeedback(testFiles, 1, 3);
const feedbackText = feedback.join('\n');

const hasCommitInstruction = feedbackText.includes('COMMITTING them if they are part of the solution');
console.log(`  Contains COMMIT instruction: ${hasCommitInstruction ? '✅ PASS' : '❌ FAIL'}`);

// Test 2: Verify message contains explicit REVERT instruction
console.log('\nTest 2: Message contains explicit REVERT instruction');
console.log('-'.repeat(70));

const hasRevertInstruction = feedbackText.includes('REVERTING them if they are not needed');
console.log(`  Contains REVERT instruction: ${hasRevertInstruction ? '✅ PASS' : '❌ FAIL'}`);

// Test 3: Verify message contains git commands
console.log('\nTest 3: Message contains git commands for clarity');
console.log('-'.repeat(70));

const hasGitAddCommitPush = feedbackText.includes('git add + git commit + git push');
const hasGitCheckout = feedbackText.includes('git checkout --');
const hasGitClean = feedbackText.includes('git clean -fd');

console.log(`  Contains 'git add + git commit + git push': ${hasGitAddCommitPush ? '✅ PASS' : '❌ FAIL'}`);
console.log(`  Contains 'git checkout --': ${hasGitCheckout ? '✅ PASS' : '❌ FAIL'}`);
console.log(`  Contains 'git clean -fd': ${hasGitClean ? '✅ PASS' : '❌ FAIL'}`);

// Test 4: Verify message emphasizes not leaving changes behind
console.log('\nTest 4: Message emphasizes not leaving uncommitted changes');
console.log('-'.repeat(70));

const hasNoLeaveInstruction = feedbackText.includes('DO NOT leave uncommitted changes behind');
console.log(`  Contains 'DO NOT leave uncommitted changes behind': ${hasNoLeaveInstruction ? '✅ PASS' : '❌ FAIL'}`);

// Test 5: Verify auto-restart counter is included
console.log('\nTest 5: Auto-restart counter is visible in message');
console.log('-'.repeat(70));

const hasRestartCounter = feedbackText.includes('Auto-restart 1/3');
console.log(`  Contains 'Auto-restart 1/3': ${hasRestartCounter ? '✅ PASS' : '❌ FAIL'}`);

// Test 6: Verify subsequent restart counter
console.log('\nTest 6: Subsequent restart counter is different');
console.log('-'.repeat(70));

const feedback2 = generateUncommittedChangesFeedback(testFiles, 2, 3);
const feedback2Text = feedback2.join('\n');
const hasRestartCounter2 = feedback2Text.includes('Auto-restart 2/3');
console.log(`  Contains 'Auto-restart 2/3': ${hasRestartCounter2 ? '✅ PASS' : '❌ FAIL'}`);

// Summary
console.log('\n' + '='.repeat(70));
const allPassed = hasCommitInstruction && hasRevertInstruction && hasGitAddCommitPush &&
                  hasGitCheckout && hasGitClean && hasNoLeaveInstruction &&
                  hasRestartCounter && hasRestartCounter2;

if (allPassed) {
  console.log('✅ All tests passed!');
  console.log('='.repeat(70));
  console.log('\nSample feedback message:');
  console.log('-'.repeat(70));
  console.log(feedbackText);
  process.exit(0);
} else {
  console.log('❌ Some tests failed!');
  process.exit(1);
}
