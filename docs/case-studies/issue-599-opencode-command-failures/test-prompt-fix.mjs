#!/usr/bin/env node
/**
 * Test script to verify that OpenCode prompts contain correct gh CLI guidelines
 */

import { buildSystemPrompt } from '../../src/opencode.prompts.lib.mjs';

const testParams = {
  owner: 'test-owner',
  repo: 'test-repo',
  issueNumber: 123,
  prNumber: 456,
  branchName: 'issue-123-test',
  argv: {}
};

console.log('Testing OpenCode System Prompt...\n');

// Build the prompt
const systemPrompt = buildSystemPrompt(testParams);

// Define what we're checking for
const checks = [
  {
    name: 'Contains correct gh api pattern for PR comments',
    pattern: /gh api repos\/.*\/pulls\/.*\/comments/,
    shouldMatch: true
  },
  {
    name: 'Contains correct gh api pattern for issue comments',
    pattern: /gh api repos\/.*\/issues\/.*\/comments/,
    shouldMatch: true
  },
  {
    name: 'Contains warning about "gh pr comments" being wrong',
    pattern: /WRONG:.*gh pr comments/,
    shouldMatch: true
  },
  {
    name: 'Contains warning about "gh pr comment list" being wrong',
    pattern: /WRONG:.*gh pr comment list/,
    shouldMatch: true
  },
  {
    name: 'Contains guidance about singular "comment"',
    pattern: /comment.*singular/i,
    shouldMatch: true
  },
  {
    name: 'Does NOT use incorrect "gh pr comments" as example',
    pattern: /gh pr comments \d+ --repo/,
    shouldMatch: false
  },
  {
    name: 'Contains GitHub CLI Command Guidelines section',
    pattern: /GitHub CLI Command Guidelines/,
    shouldMatch: true
  },
  {
    name: 'Contains example with jq filter',
    pattern: /--jq.*reverse/,
    shouldMatch: true
  }
];

let passedCount = 0;
let failedCount = 0;

console.log('Running checks...\n');

checks.forEach((check, index) => {
  const matches = check.pattern.test(systemPrompt);
  const passed = matches === check.shouldMatch;

  const status = passed ? '✓ PASS' : '✗ FAIL';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';

  console.log(`${color}${status}${reset} ${index + 1}. ${check.name}`);

  if (!passed && check.shouldMatch && !matches) {
    console.log(`     Expected to find pattern: ${check.pattern}`);
  } else if (!passed && !check.shouldMatch && matches) {
    console.log(`     Expected NOT to find pattern: ${check.pattern}`);
  }

  if (passed) {
    passedCount++;
  } else {
    failedCount++;
  }
});

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passedCount} passed, ${failedCount} failed`);
console.log('='.repeat(60) + '\n');

if (failedCount === 0) {
  console.log('\x1b[32m✓ All checks passed! The prompts have been correctly updated.\x1b[0m');
  process.exit(0);
} else {
  console.log('\x1b[31m✗ Some checks failed. Please review the prompts.\x1b[0m');
  console.log('\nTo debug, you can uncomment the following line to see the full prompt:');
  console.log('// console.log(systemPrompt);');
  process.exit(1);
}
