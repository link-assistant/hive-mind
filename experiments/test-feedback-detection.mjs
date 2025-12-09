#!/usr/bin/env node

/**
 * Test to understand the feedback detection issue
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to run command
function $(command) {
  try {
    const result = execSync(command, { encoding: 'utf8' });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, output: error.stdout || error.message };
  }
}

console.log('Testing feedback detection with real PR...\n');

// Test with the hive-mind repo PR #199 which has comments
const testPrUrl = 'https://github.com/link-assistant/hive-mind/pull/199';
console.log(`Testing PR: ${testPrUrl}\n`);

// Run solve.mjs with --dry-run and --verbose
const solvePath = path.join(__dirname, '..', 'solve.mjs');
const result = $(`node "${solvePath}" "${testPrUrl}" --dry-run --verbose 2>&1`);

console.log('=== Output Analysis ===\n');

// Check for feedback lines
const hasFeedbackLines = result.output.includes('New comments on the pull request:');
const hasCommentCount = /New comments on the pull request: \d+/.test(result.output);

console.log(`Feedback lines detected: ${hasFeedbackLines ? 'YES' : 'NO'}`);
console.log(`Comment count included: ${hasCommentCount ? 'YES' : 'NO'}`);

// Check where feedback appears
const lines = result.output.split('\n');
let inUserPrompt = false;
let inSystemPrompt = false;
let feedbackInUser = false;
let feedbackInSystem = false;

for (const line of lines) {
  if (line.includes('User prompt:')) {
    inUserPrompt = true;
    inSystemPrompt = false;
  } else if (line.includes('System prompt:')) {
    inSystemPrompt = true;
    inUserPrompt = false;
  }

  if (line.includes('New comments on the pull request:')) {
    if (inUserPrompt) feedbackInUser = true;
    if (inSystemPrompt) feedbackInSystem = true;
  }
}

console.log(`Feedback in user prompt: ${feedbackInUser ? 'YES' : 'NO'}`);
console.log(`Feedback in system prompt: ${feedbackInSystem ? 'YES' : 'NO'}`);

// Also check for the comment counting debug output
const hasCommentCounting = result.output.includes('Counting comments:');
console.log(`\nComment counting section found: ${hasCommentCounting ? 'YES' : 'NO'}`);

// Check for verbose mode debug output
const hasVerboseDebug = result.output.includes('Comment counting conditions:');
console.log(`Verbose debug output found: ${hasVerboseDebug ? 'YES' : 'NO'}`);

// Look for the actual prompt lines
console.log('\n=== Looking for prompt content ===\n');
const promptMatch = result.output.match(/Issue to solve:.*?(?=\n\n|$)/s);
if (promptMatch) {
  console.log('Found prompt content:');
  console.log(promptMatch[0].substring(0, 500) + '...');
} else {
  console.log('Could not find prompt content in output');
}

// Save full output for debugging
const outputFile = '/tmp/feedback-test-output.txt';
require('fs').writeFileSync(outputFile, result.output);
console.log(`\nFull output saved to: ${outputFile}`);