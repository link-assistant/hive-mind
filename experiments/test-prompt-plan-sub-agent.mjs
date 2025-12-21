#!/usr/bin/env node
/**
 * Test script for --prompt-plan-sub-agent option
 */

import { test } from 'node:test';
import assert from 'node:assert';
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
  argv: {},
};

test('prompt-plan-sub-agent: Without option', async () => {
  const userPrompt = buildUserPrompt(baseParams);
  const systemPrompt = buildSystemPrompt(baseParams);

  assert.ok(!userPrompt.includes('Plan sub-agent'), 'User prompt should not contain "Plan sub-agent"');
  assert.ok(!systemPrompt.includes('Plan sub-agent'), 'System prompt should not contain "Plan sub-agent"');
  console.log('✅ Test passed: No Plan sub-agent content without option');
});

test('prompt-plan-sub-agent: With option enabled', async () => {
  const paramsWithOption = {
    ...baseParams,
    argv: { promptPlanSubAgent: true },
  };

  const userPrompt = buildUserPrompt(paramsWithOption);
  const systemPrompt = buildSystemPrompt(paramsWithOption);

  assert.ok(!userPrompt.includes('Plan sub-agent'), 'User prompt should NOT contain Plan sub-agent additions');
  assert.ok(systemPrompt.includes('Plan sub-agent'), 'System prompt should contain "Plan sub-agent"');
  console.log('✅ Test passed: Plan sub-agent content appears in system prompt when enabled');
});

test('prompt-plan-sub-agent: Verify suggestive language', async () => {
  const paramsWithOption = {
    ...baseParams,
    argv: { promptPlanSubAgent: true },
  };

  const systemPrompt = buildSystemPrompt(paramsWithOption);
  const planSubAgentSection = systemPrompt.includes('Plan sub-agent usage.') ? systemPrompt.substring(systemPrompt.indexOf('Plan sub-agent usage.')) : '';

  const hasForcingLanguageInPlanSection = /ALWAYS|FIRST|IMPORTANT/.test(planSubAgentSection);
  assert.ok(!hasForcingLanguageInPlanSection, 'Plan section should not contain forcing language (ALWAYS/FIRST/IMPORTANT)');

  const hasConsiderInPlanSection = planSubAgentSection.includes('consider');
  assert.ok(hasConsiderInPlanSection, 'Plan section should contain suggestive "consider"');
  console.log('✅ Test passed: Plan sub-agent uses suggestive language');
});

test('prompt-plan-sub-agent: Verify Task tool instruction', async () => {
  const paramsWithOption = {
    ...baseParams,
    argv: { promptPlanSubAgent: true },
  };

  const systemPrompt = buildSystemPrompt(paramsWithOption);
  const taskToolMatch = systemPrompt.match(/Task tool.*subagent_type.*Plan/i);
  assert.ok(taskToolMatch, 'Should find Task tool instruction for Plan sub-agent');
  console.log('✅ Test passed: Task tool instruction present');
});

test('prompt-plan-sub-agent: Verify prompt is after "When x do y" rules', async () => {
  const paramsWithOption = {
    ...baseParams,
    argv: { promptPlanSubAgent: true },
  };

  const systemPrompt = buildSystemPrompt(paramsWithOption);
  const selfReviewIndex = systemPrompt.indexOf('Self review.');
  const planSubAgentIndex = systemPrompt.indexOf('Plan sub-agent usage.');

  assert.ok(planSubAgentIndex > -1, 'Plan sub-agent section should be found');
  assert.ok(planSubAgentIndex > selfReviewIndex, 'Plan sub-agent section should be after Self review (after "When x do y" rules)');
  console.log('✅ Test passed: Plan sub-agent prompt is after "When x do y" rules');
});

console.log('\n🎉 All tests passed!');
