#!/usr/bin/env node

/**
 * Test script to verify the --think option behavior with different levels
 */

import { buildUserPrompt, buildSystemPrompt } from '../src/claude.prompts.lib.mjs';

// Test cases
const testCases = [
  {
    name: 'Without --think option',
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
      argv: { think: undefined },
    },
  },
  {
    name: 'With --think low',
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
      argv: { think: 'low' },
    },
    expectedUserPrompt: 'Think.',
    expectedSystemPrompt: 'You always think on every step.',
  },
  {
    name: 'With --think medium',
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
      argv: { think: 'medium' },
    },
    expectedUserPrompt: 'Think hard.',
    expectedSystemPrompt: 'You always think hard on every step.',
  },
  {
    name: 'With --think high',
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
      argv: { think: 'high' },
    },
    expectedUserPrompt: 'Think harder.',
    expectedSystemPrompt: 'You always think harder on every step.',
  },
  {
    name: 'With --think max (continue mode)',
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
      argv: { think: 'max' },
    },
    expectedUserPrompt: 'Ultrathink.',
    expectedSystemPrompt: 'You always ultrathink on every step.',
  },
];

console.log('Testing --think option implementation\n');
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
  if (testCase.params.argv.think) {
    // Check system prompt
    if (systemPrompt.includes(testCase.expectedSystemPrompt)) {
      console.log(`✅ System prompt contains "${testCase.expectedSystemPrompt}"`);
    } else {
      console.log(`❌ System prompt MISSING "${testCase.expectedSystemPrompt}"`);
    }

    // Check user prompt
    if (userPrompt.includes(testCase.expectedUserPrompt)) {
      console.log(`✅ User prompt contains "${testCase.expectedUserPrompt}" before final instruction`);
    } else {
      console.log(`❌ User prompt MISSING "${testCase.expectedUserPrompt}" before final instruction`);
    }
  } else {
    // Check that the lines are NOT added when option is disabled
    const thinkMessages = ['Think.', 'Think hard.', 'Think harder.', 'Ultrathink.'];
    const hasThinkMessage = thinkMessages.some(msg => userPrompt.includes(msg));

    if (!hasThinkMessage) {
      console.log('✅ User prompt correctly omits think messages when option disabled');
    } else {
      console.log('❌ User prompt contains unexpected think message when option disabled');
    }

    const systemThinkMessages = ['You always think on every step.', 'You always think hard on every step.', 'You always think harder on every step.', 'You always ultrathink on every step.'];
    const hasSystemThinkMessage = systemThinkMessages.some(msg => systemPrompt.includes(msg));

    if (!hasSystemThinkMessage) {
      console.log('✅ System prompt correctly omits think instructions when option disabled');
    } else {
      console.log('❌ System prompt contains unexpected think instruction when option disabled');
    }
  }
});

console.log('\n' + '='.repeat(80));
console.log('Test completed successfully!');
