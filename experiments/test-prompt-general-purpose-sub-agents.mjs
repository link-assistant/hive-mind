#!/usr/bin/env node
/**
 * Test script for --prompt-general-purpose-sub-agent option
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { buildSystemPrompt } from '../src/claude.prompts.lib.mjs';
import { createYargsConfig } from '../src/solve.config.lib.mjs';

// Initialize use-m
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing --prompt-general-purpose-sub-agent option\n');

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

console.log('\n🎉 All tests passed!');
