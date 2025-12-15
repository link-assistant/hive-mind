#!/usr/bin/env node
/**
 * Test script for sub-agent prompt options
 * Tests both --prompt-plan-sub-agent and --prompt-general-purpose-sub-agent
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { buildUserPrompt, buildSystemPrompt } from '../src/claude.prompts.lib.mjs';
import { createYargsConfig } from '../src/solve.config.lib.mjs';

// Initialize use-m
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing sub-agent prompt options\n');

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

// ============================================================================
// Tests for --prompt-plan-sub-agent
// ============================================================================

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
    argv: { promptPlanSubAgent: true }
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
    argv: { promptPlanSubAgent: true }
  };

  const systemPrompt = buildSystemPrompt(paramsWithOption);
  const planSubAgentSection = systemPrompt.includes('Plan sub-agent usage.')
    ? systemPrompt.substring(systemPrompt.indexOf('Plan sub-agent usage.'))
    : '';

  const hasForcingLanguageInPlanSection = /ALWAYS|FIRST|IMPORTANT/.test(planSubAgentSection);
  assert.ok(!hasForcingLanguageInPlanSection, 'Plan section should not contain forcing language (ALWAYS/FIRST/IMPORTANT)');

  const hasConsiderInPlanSection = planSubAgentSection.includes('consider');
  assert.ok(hasConsiderInPlanSection, 'Plan section should contain suggestive "consider"');
  console.log('✅ Test passed: Plan sub-agent uses suggestive language');
});

test('prompt-plan-sub-agent: Verify Task tool instruction', async () => {
  const paramsWithOption = {
    ...baseParams,
    argv: { promptPlanSubAgent: true }
  };

  const systemPrompt = buildSystemPrompt(paramsWithOption);
  const taskToolMatch = systemPrompt.match(/Task tool.*subagent_type.*Plan/i);
  assert.ok(taskToolMatch, 'Should find Task tool instruction for Plan sub-agent');
  console.log('✅ Test passed: Task tool instruction present');
});

test('prompt-plan-sub-agent: Verify prompt is after "When x do y" rules', async () => {
  const paramsWithOption = {
    ...baseParams,
    argv: { promptPlanSubAgent: true }
  };

  const systemPrompt = buildSystemPrompt(paramsWithOption);
  const selfReviewIndex = systemPrompt.indexOf('Self review.');
  const planSubAgentIndex = systemPrompt.indexOf('Plan sub-agent usage.');

  assert.ok(planSubAgentIndex > -1, 'Plan sub-agent section should be found');
  assert.ok(planSubAgentIndex > selfReviewIndex, 'Plan sub-agent section should be after Self review (after "When x do y" rules)');
  console.log('✅ Test passed: Plan sub-agent prompt is after "When x do y" rules');
});

// ============================================================================
// Tests for --prompt-general-purpose-sub-agent
// ============================================================================

test('prompt-general-purpose-sub-agent: Flag parsing - default disabled', async () => {
  const argv = await createYargsConfig(yargs()).strict(false).demandCommand(0).parse([
    'https://github.com/test/repo/issues/1'
  ]);

  assert.strictEqual(argv.promptGeneralPurposeSubAgent, false, 'Default value should be false');
  console.log('✅ Test passed: Default value is false');
});

test('prompt-general-purpose-sub-agent: Flag parsing - explicitly enabled', async () => {
  const argv = await createYargsConfig(yargs()).strict(false).demandCommand(0).parse([
    'https://github.com/test/repo/issues/1',
    '--prompt-general-purpose-sub-agent'
  ]);

  assert.strictEqual(argv.promptGeneralPurposeSubAgent, true, 'Flag should be enabled when specified');
  console.log('✅ Test passed: Flag is enabled when specified');
});

test('prompt-general-purpose-sub-agent: Flag parsing - explicitly disabled', async () => {
  const argv = await createYargsConfig(yargs()).strict(false).demandCommand(0).parse([
    'https://github.com/test/repo/issues/1',
    '--no-prompt-general-purpose-sub-agent'
  ]);

  assert.strictEqual(argv.promptGeneralPurposeSubAgent, false, 'Flag should be disabled when negated');
  console.log('✅ Test passed: Flag is disabled when negated');
});

test('prompt-general-purpose-sub-agent: System prompt without flag', async () => {
  const systemPrompt = buildSystemPrompt({
    owner: 'test',
    repo: 'repo',
    issueNumber: 1,
    prNumber: 2,
    branchName: 'test-branch',
    argv: { promptGeneralPurposeSubAgent: false }
  });

  assert.ok(!systemPrompt.includes('general-purpose'), 'Should not mention general-purpose sub agents');
  assert.ok(!systemPrompt.includes('delegate work'), 'Should not mention delegating work');
  console.log('✅ Test passed: System prompt does not include general-purpose sub-agent instructions when disabled');
});

test('prompt-general-purpose-sub-agent: System prompt with flag enabled', async () => {
  const systemPrompt = buildSystemPrompt({
    owner: 'test',
    repo: 'repo',
    issueNumber: 1,
    prNumber: 2,
    branchName: 'test-branch',
    argv: { promptGeneralPurposeSubAgent: true }
  });

  assert.ok(systemPrompt.includes('general-purpose'), 'Should mention general-purpose sub agents');
  assert.ok(systemPrompt.includes('delegate work'), 'Should mention delegating work');
  assert.ok(systemPrompt.includes('lots of files or folders'), 'Should mention when to use sub agents');

  // Verify the prompt is placed AFTER "When x do y" rules, not in personality section
  const personalityEndIndex = systemPrompt.indexOf('General guidelines.');
  const subAgentIndex = systemPrompt.indexOf('general-purpose');
  assert.ok(subAgentIndex > personalityEndIndex,
    'Sub-agent prompt should appear after personality section (after "General guidelines.")');

  // Verify it's in the "Initial research" section (after the "When" rules start)
  const initialResearchIndex = systemPrompt.indexOf('Initial research.');
  assert.ok(subAgentIndex > initialResearchIndex,
    'Sub-agent prompt should appear in or after "Initial research" section');

  console.log('✅ Test passed: System prompt includes general-purpose sub-agent instructions when enabled in correct location');
});

test('prompt-general-purpose-sub-agent: Verify help text', async () => {
  const helpOutput = await createYargsConfig(yargs()).getHelp();

  assert.ok(helpOutput.includes('--prompt-general-purpose-sub-agent'), 'Help should include --prompt-general-purpose-sub-agent flag');
  assert.ok(helpOutput.includes('Prompt AI to use'), 'Help should describe the flag purpose');
  console.log('✅ Test passed: Help text includes flag description');
});

// ============================================================================
// Tests for both options together
// ============================================================================

test('Both options: Can be enabled simultaneously', async () => {
  const paramsWithBoth = {
    ...baseParams,
    argv: {
      promptPlanSubAgent: true,
      promptGeneralPurposeSubAgent: true
    }
  };

  const systemPrompt = buildSystemPrompt(paramsWithBoth);

  assert.ok(systemPrompt.includes('Plan sub-agent'), 'System prompt should contain Plan sub-agent');
  assert.ok(systemPrompt.includes('general-purpose'), 'System prompt should contain general-purpose sub agents');
  console.log('✅ Test passed: Both options can be enabled simultaneously');
});

console.log('\n🎉 All tests passed!');
