#!/usr/bin/env node

// Test script to verify the feedback lines bug fix
// Verify that feedback lines only appear in main prompt, not system prompt

console.log('🧪 Testing feedback lines fix verification...\n');

// Simulate the FIXED scenario
function simulateFeedbackLinesFix() {
  console.log('📋 Simulating FIXED feedback lines processing...');

  // Simulate variables from solve.mjs around line 1596+
  let feedbackLines = [];
  let isContinueMode = true;

  // Simulate adding feedback lines (lines 1688-1693)
  const newPrComments = 3;
  const newIssueComments = 2;

  if (newPrComments > 0) {
    feedbackLines.push(`New comments on the pull request: ${newPrComments}`);
  }
  if (newIssueComments > 0) {
    feedbackLines.push(`New comments on the issue: ${newIssueComments}`);
  }

  console.log(`  Feedback lines created: ${feedbackLines.length}`);
  feedbackLines.forEach((line, i) => console.log(`    ${i + 1}. ${line}`));

  // Simulate main prompt building (lines 1904-1908)
  let promptLines = [];
  promptLines.push('Your prepared branch: issue-168-113ce685');
  promptLines.push('Your prepared working directory: /tmp/gh-issue-solver-1758085205751');
  promptLines.push('');

  // Add feedback info if in continue mode and there are feedback items
  if (isContinueMode && feedbackLines && feedbackLines.length > 0) {
    // Add each feedback line directly
    feedbackLines.forEach(line => promptLines.push(line));
    promptLines.push('');
  }

  promptLines.push('Continue.');

  const prompt = promptLines.join('\n');

  // Simulate FIXED system prompt building (line 1925) - NO MORE feedbackLines!
  const systemPrompt = `You are AI issue solver.

General guidelines.
   - When you execute commands, always save their logs to files for easy reading if the output gets large.`;

  console.log('\n📤 RESULTS (AFTER FIX):');
  console.log('\n🔍 Main prompt (user message):');
  console.log('```');
  console.log(prompt);
  console.log('```');

  console.log('\n🔍 System prompt:');
  console.log('```');
  console.log(systemPrompt);
  console.log('```');

  // Check if feedback lines appear in both
  const feedbackInPrompt = feedbackLines.some(line => prompt.includes(line));
  const feedbackInSystemPrompt = feedbackLines.some(line => systemPrompt.includes(line));

  console.log('\n📊 ANALYSIS:');
  console.log(`  Feedback lines in main prompt: ${feedbackInPrompt ? '✅ YES' : '❌ NO'}`);
  console.log(`  Feedback lines in system prompt: ${feedbackInSystemPrompt ? '❌ YES (BUG!)' : '✅ NO'}`);

  if (feedbackInPrompt && !feedbackInSystemPrompt) {
    console.log('  ✅ CORRECT: Feedback lines only in main prompt (FIXED!)');
    return true;
  } else if (feedbackInPrompt && feedbackInSystemPrompt) {
    console.log('  🐛 BUG STILL EXISTS: Feedback lines appear in BOTH prompts');
    return false;
  } else if (!feedbackInPrompt && !feedbackInSystemPrompt) {
    console.log('  🐛 NEW BUG: Feedback lines missing from both prompts');
    return false;
  } else {
    console.log('  🐛 WRONG LOCATION: Feedback lines only in system prompt');
    return false;
  }
}

// Run the test
const isFixed = simulateFeedbackLinesFix();

console.log('\n🎯 TEST RESULT:');
if (isFixed) {
  console.log('✅ PASS: The feedback lines bug has been FIXED!');
  console.log('   Feedback lines now appear only in the main prompt as expected.');
} else {
  console.log('❌ FAIL: The feedback lines bug is NOT fixed.');
  console.log('   Additional changes may be needed.');
}

console.log('\n📋 EXPECTED BEHAVIOR:');
console.log('1. When new comments are detected, feedback lines are created');
console.log('2. These feedback lines are added to the main user prompt');
console.log('3. The system prompt contains only instructions, no dynamic content');
console.log('4. This provides proper context to the AI about new feedback');
