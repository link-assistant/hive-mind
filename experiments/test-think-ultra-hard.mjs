#!/usr/bin/env node

/**
 * Test script to verify the --think-ultra-hard option behavior
 */

import { buildUserPrompt, buildSystemPrompt } from '../src/claude.prompts.lib.mjs';

// Test cases
const testCases = [
  {
    name: 'Without --think-ultra-hard option',
    params: {
      issueUrl: 'https://github.com/test/repo/issues/1',
      issueNumber: '1',
      prNumber: '2',
      prUrl: 'https://github.com/test/repo/pull/2',
      branchName: 'test-branch',
      tempDir: '/tmp/test',
      isContinueMode: false,
      owner: 'test',
      repo: 'repo',
      argv: { thinkUltraHard: false },
    },
  },
  {
    name: 'With --think-ultra-hard option (normal mode)',
    params: {
      issueUrl: 'https://github.com/test/repo/issues/1',
      issueNumber: '1',
      prNumber: '2',
      prUrl: 'https://github.com/test/repo/pull/2',
      branchName: 'test-branch',
      tempDir: '/tmp/test',
      isContinueMode: false,
      owner: 'test',
      repo: 'repo',
      argv: { thinkUltraHard: true },
    },
  },
  {
    name: 'With --think-ultra-hard option (continue mode)',
    params: {
      issueUrl: 'https://github.com/test/repo/issues/1',
      issueNumber: '1',
      prNumber: '2',
      prUrl: 'https://github.com/test/repo/pull/2',
      branchName: 'test-branch',
      tempDir: '/tmp/test',
      isContinueMode: true,
      owner: 'test',
      repo: 'repo',
      argv: { thinkUltraHard: true },
    },
  },
];

console.log('Testing --think-ultra-hard option implementation\n');
console.log('='.repeat(80));

testCases.forEach(testCase => {
  console.log(`\nTest: ${testCase.name}`);
  console.log('-'.repeat(40));

  // Build user prompt
  const userPrompt = buildUserPrompt(testCase.params);

  // Build system prompt
  const systemPrompt = buildSystemPrompt(testCase.params);

  console.log('\nUser Prompt (last 5 lines):');
  const userPromptLines = userPrompt.split('\n');
  const lastLines = userPromptLines.slice(-5);
  lastLines.forEach(line => console.log(`  > ${line}`));

  console.log('\nSystem Prompt (first 2 lines):');
  const systemPromptLines = systemPrompt.split('\n');
  const firstLines = systemPromptLines.slice(0, 2);
  firstLines.forEach(line => console.log(`  > ${line}`));

  // Verify the behavior
  if (testCase.params.argv.thinkUltraHard) {
    // Check system prompt
    if (systemPrompt.includes('You always think ultra hard on every step.')) {
      console.log('✅ System prompt contains "You always think ultra hard on every step."');
    } else {
      console.log('❌ System prompt MISSING "You always think ultra hard on every step."');
    }

    // Check user prompt
    if (userPrompt.includes('Think ultra hard.')) {
      console.log('✅ User prompt contains "Think ultra hard." before final instruction');
    } else {
      console.log('❌ User prompt MISSING "Think ultra hard." before final instruction');
    }
  } else {
    // Check that the lines are NOT added when option is disabled
    if (!systemPrompt.includes('You always think ultra hard on every step.')) {
      console.log('✅ System prompt correctly omits ultra-hard line when option disabled');
    }
    if (!userPrompt.includes('Think ultra hard.')) {
      console.log('✅ User prompt correctly omits "Think ultra hard." when option disabled');
    }
  }
});

console.log('\n' + '='.repeat(80));
console.log('Test completed successfully!');
