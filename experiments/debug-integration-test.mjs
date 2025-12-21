#!/usr/bin/env node

/**
 * Debug script to understand why integration test isn't finding feedback lines
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to run command
function $(command, options = {}) {
  try {
    const result = execSync(command, { encoding: 'utf8', ...options });
    return { success: true, output: result, code: 0 };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || '',
      stderr: error.stderr || error.message,
      code: error.status || 1
    };
  }
}

console.log('🔍 Debugging integration test behavior...\n');

// Test with the test repository that was created
const testPrUrl = 'https://github.com/konard/test-feedback-lines-c6f7a3d1/pull/2';
console.log(`Testing with: ${testPrUrl}\n`);

// Run solve.mjs with verbose and dry-run
const solvePath = path.join(__dirname, '..', 'solve.mjs');
const result = $(`node "${solvePath}" "${testPrUrl}" --dry-run --verbose 2>&1`, { maxBuffer: 10 * 1024 * 1024 });

console.log('Exit code:', result.code);
console.log('\n=== Checking output patterns ===\n');

// Save full output
fs.writeFileSync('/tmp/debug-integration-output.txt', result.output);
console.log('Full output saved to: /tmp/debug-integration-output.txt');

// Check various patterns
const patterns = [
  { name: 'Feedback lines', pattern: /New comments on the pull request:/ },
  { name: 'Comment count', pattern: /New comments on the pull request: \d+/ },
  { name: 'User prompt marker', pattern: /User prompt:|---END USER PROMPT---/ },
  { name: 'System prompt marker', pattern: /System prompt:|---END SYSTEM PROMPT---/ },
  { name: 'Continue mode', pattern: /Continue mode.*ACTIVE|Continue\./ },
  { name: 'Comment counting', pattern: /Counting comments:|Comment counting conditions:/ },
  { name: 'Issue to solve', pattern: /Issue to solve:/ }
];

patterns.forEach(({ name, pattern }) => {
  const found = pattern.test(result.output);
  console.log(`${found ? '✅' : '❌'} ${name}: ${found ? 'Found' : 'Not found'}`);
});

// Look for the actual prompt content
console.log('\n=== Extracting prompt content ===\n');

// Try to find the user prompt section
const userPromptMatch = result.output.match(/Issue to solve:.*?(?=---END USER PROMPT---|$)/s);
if (userPromptMatch) {
  const promptLines = userPromptMatch[0].split('\n').slice(0, 20);
  console.log('User prompt content (first 20 lines):');
  promptLines.forEach(line => console.log('  ', line));

  // Check if feedback lines are in the prompt
  const hasFeedback = userPromptMatch[0].includes('New comments on the pull request:');
  console.log(`\n${hasFeedback ? '✅' : '❌'} Feedback lines in prompt: ${hasFeedback ? 'YES' : 'NO'}`);
} else {
  console.log('❌ Could not extract user prompt content');
}

// Check for error patterns
console.log('\n=== Checking for errors ===\n');
const errorPatterns = [/Error:|Failed to|Could not/i, /git log.*failed/i, /API.*failed/i];

errorPatterns.forEach((pattern, i) => {
  if (pattern.test(result.output)) {
    const matches = result.output.match(new RegExp(`.{0,100}${pattern.source}.{0,100}`, 'gi'));
    if (matches) {
      console.log(`⚠️  Error pattern ${i + 1} found:`);
      matches.slice(0, 3).forEach(match => console.log('   ', match.trim()));
    }
  }
});

console.log('\n=== Summary ===\n');
if (result.code === 0) {
  console.log('✅ solve.mjs exited successfully');
} else {
  console.log(`❌ solve.mjs exited with code ${result.code}`);
}
