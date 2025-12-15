#!/usr/bin/env node
/**
 * Test script for --prompt-plan-sub-agent option
 * Verifies that prompts are correctly generated with and without the option
 */

import { buildUserPrompt, buildSystemPrompt } from '../src/claude.prompts.lib.mjs';

console.log('Testing --prompt-plan-sub-agent option\n');

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

console.log('=== Test 1: Without --prompt-plan-sub-agent ===');
const userPrompt1 = buildUserPrompt(baseParams);
const systemPrompt1 = buildSystemPrompt(baseParams);

console.log('\nUser Prompt (without option):');
console.log(userPrompt1);
console.log('\n--- Contains "Plan sub-agent":', userPrompt1.includes('Plan sub-agent'));

console.log('\nSystem Prompt excerpt (without option):');
const systemLines1 = systemPrompt1.split('\n').slice(0, 5);
console.log(systemLines1.join('\n'));
console.log('--- Contains "Plan sub-agent":', systemPrompt1.includes('Plan sub-agent'));

console.log('\n\n=== Test 2: With --prompt-plan-sub-agent ===');
const paramsWithOption = {
  ...baseParams,
  argv: { promptPlanSubAgent: true }
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

console.log('\n\n=== Test 3: Verify suggestive language in Plan sub-agent section ===');
// Extract just the Plan sub-agent section for checking
const planSubAgentSection = systemPrompt2.includes('Plan sub-agent usage.')
  ? systemPrompt2.substring(systemPrompt2.indexOf('Plan sub-agent usage.'))
  : '';
const hasForcingLanguageInPlanSection = /ALWAYS|FIRST|IMPORTANT/.test(planSubAgentSection);
console.log('Plan section contains forcing language (ALWAYS/FIRST/IMPORTANT):', hasForcingLanguageInPlanSection ? 'YES (FAIL)' : 'NO (PASS)');
const hasConsiderInPlanSection = planSubAgentSection.includes('consider');
console.log('Plan section contains suggestive "consider":', hasConsiderInPlanSection ? 'YES (PASS)' : 'NO (FAIL)');

// Also check user prompt
const userHasForcingLanguage = /ALWAYS|FIRST|IMPORTANT/.test(userPrompt2.substring(userPrompt2.indexOf('Plan sub-agent')));
console.log('User prompt Plan section contains forcing language:', userHasForcingLanguage ? 'YES (FAIL)' : 'NO (PASS)');

console.log('\n\n=== Test 4: Verify Task tool instruction ===');
const taskToolMatch = systemPrompt2.match(/Task tool.*subagent_type.*Plan/i);
console.log('Found Task tool instruction:', taskToolMatch ? 'YES' : 'NO');
if (taskToolMatch) {
  console.log('Match:', taskToolMatch[0]);
}

console.log('\n\n=== Test 5: Verify prompt is after "When x do y" rules ===');
const selfReviewIndex = systemPrompt2.indexOf('Self review.');
const planSubAgentIndex = systemPrompt2.indexOf('Plan sub-agent usage.');
if (planSubAgentIndex > -1) {
  console.log('Plan sub-agent section found after Self review:', planSubAgentIndex > selfReviewIndex ? 'YES (PASS)' : 'NO (FAIL)');
} else {
  console.log('Plan sub-agent section found: NO (expected when option enabled)');
}

console.log('\n\n✅ All tests completed!');
