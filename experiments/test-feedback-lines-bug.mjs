#!/usr/bin/env node

// Test script to reproduce the feedback lines bug
// Issue: Feedback lines are not being added to the prompt correctly

console.log('🧪 Testing feedback lines bug reproduction...\n');

// Simulate the bug scenario
function simulateFeedbackLinesBug() {
  console.log('📋 Simulating feedback lines processing...');

  // Simulate variables from solve.mjs around line 1596+
  let feedbackLines = [];
  let isContinueMode = true;

  // Simulate adding feedback lines (lines 1688-1693)
  const newPrComments = 2;
  const newIssueComments = 1;

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

  // Simulate system prompt building (line 1925) - THIS IS WHERE THE BUG IS
  const systemPrompt = `You are AI issue solver.${feedbackLines && feedbackLines.length > 0 ? '\n\n' + feedbackLines.join('\n') + '\n' : ''}

General guidelines.
   - When you execute commands, always save their logs to files for easy reading if the output gets large.`;

  console.log('\n📤 RESULTS:');
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
  console.log(`  Feedback lines in system prompt: ${feedbackInSystemPrompt ? '⚠️  YES (WRONG!)' : '✅ NO'}`);

  if (feedbackInPrompt && feedbackInSystemPrompt) {
    console.log('  🐛 BUG DETECTED: Feedback lines appear in BOTH prompts (duplication)');
    console.log('  📝 Expected: Feedback should only be in main prompt, not system prompt');
  } else if (!feedbackInPrompt && !feedbackInSystemPrompt) {
    console.log('  🐛 BUG DETECTED: Feedback lines missing from both prompts');
  } else if (feedbackInPrompt && !feedbackInSystemPrompt) {
    console.log('  ✅ CORRECT: Feedback lines only in main prompt');
  } else {
    console.log('  🐛 BUG DETECTED: Feedback lines only in system prompt (should be in main prompt)');
  }

  return { feedbackInPrompt, feedbackInSystemPrompt, prompt, systemPrompt };
}

// Run the test
const result = simulateFeedbackLinesBug();

console.log('\n🎯 CONCLUSION:');
console.log('The current code incorrectly adds feedback lines to the system prompt.');
console.log('System prompts should contain instructions, not dynamic content like comment counts.');
console.log('The feedback lines should ONLY appear in the main user prompt.');

console.log('\n🔧 FIX NEEDED:');
console.log('Remove the feedbackLines interpolation from the systemPrompt on line 1925');
console.log('Keep only the main prompt logic on lines 1904-1908');
