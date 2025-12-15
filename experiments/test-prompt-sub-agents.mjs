#!/usr/bin/env node
/**
 * Test script for --prompt-sub-agents option
 * Verifies that prompts are correctly generated with and without the option
 */

import { buildUserPrompt, buildSystemPrompt } from '../src/claude.prompts.lib.mjs';

console.log('Testing --prompt-sub-agents option\n');

const baseParams = {
  issueUrl: 'https://github.com/test/repo/issues/123',
  issueNumber: '123',
  prNumber: '456',
  prUrl: 'https://github.com/test/repo/pull/456',
  branchName: 'test-branch',
  tempDir: '/tmp/test',
  isContinueMode: false,
  owner: 'test',
  repo: 'repo',
  argv: {}
};

console.log('=== Test 1: Without --prompt-sub-agents ===');
const userPrompt1 = buildUserPrompt(baseParams);
const systemPrompt1 = buildSystemPrompt(baseParams);

console.log('\nUser Prompt (without option):');
console.log(userPrompt1);
console.log('\n--- Contains "Plan sub-agent":', userPrompt1.includes('Plan sub-agent'));

console.log('\nSystem Prompt excerpt (without option):');
const systemLines1 = systemPrompt1.split('\n').slice(0, 5);
console.log(systemLines1.join('\n'));
console.log('--- Contains "Plan sub-agent":', systemPrompt1.includes('Plan sub-agent'));

console.log('\n\n=== Test 2: With --prompt-sub-agents ===');
const paramsWithOption = {
  ...baseParams,
  argv: { promptSubAgents: true }
};

const userPrompt2 = buildUserPrompt(paramsWithOption);
const systemPrompt2 = buildSystemPrompt(paramsWithOption);

console.log('\nUser Prompt (with option):');
console.log(userPrompt2);
console.log('\n--- Contains "Plan sub-agent":', userPrompt2.includes('Plan sub-agent'));

console.log('\nSystem Prompt excerpt (with option):');
const systemLines2 = systemPrompt2.split('\n').slice(0, 10);
console.log(systemLines2.join('\n'));
console.log('--- Contains "Plan sub-agent":', systemPrompt2.includes('Plan sub-agent'));

console.log('\n\n=== Test 3: Verify FIRST item instruction in system prompt ===');
const firstItemMatch = systemPrompt2.match(/FIRST item.*Plan sub-agent/i);
console.log('Found FIRST item instruction:', firstItemMatch ? 'YES' : 'NO');
if (firstItemMatch) {
  console.log('Match:', firstItemMatch[0]);
}

console.log('\n\n=== Test 4: Verify Task tool instruction ===');
const taskToolMatch = systemPrompt2.match(/Task tool.*subagent_type.*Plan/i);
console.log('Found Task tool instruction:', taskToolMatch ? 'YES' : 'NO');
if (taskToolMatch) {
  console.log('Match:', taskToolMatch[0]);
}

console.log('\n\n✅ All tests completed successfully!');
