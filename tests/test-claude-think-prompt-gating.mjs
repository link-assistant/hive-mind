#!/usr/bin/env node
// Test: thinking prompt instructions should only be added for legacy Claude models
// that have neither model effort support nor tool token-budget support.

import assert from 'assert';

const { buildUserPrompt: buildClaudeUserPrompt } = await import('../src/claude.prompts.lib.mjs');
const { buildUserPrompt: buildAgentUserPrompt } = await import('../src/agent.prompts.lib.mjs');
const { buildUserPrompt: buildCodexUserPrompt } = await import('../src/codex.prompts.lib.mjs');
const { buildUserPrompt: buildOpenCodeUserPrompt } = await import('../src/opencode.prompts.lib.mjs');

console.log('Testing Claude Think Prompt Gating\n');

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`  ${name}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
};

const baseParams = {
  issueUrl: 'https://github.com/test/repo/issues/1',
  issueNumber: 1,
  branchName: 'test-branch',
  tempDir: '/tmp/test',
  owner: 'test',
  repo: 'repo',
  isContinueMode: false,
};

const thinkKeywords = ['Think.', 'Think hard.', 'Think harder.', 'Ultrathink.'];

const containsThinkInstruction = prompt => thinkKeywords.some(k => prompt.includes(k));

// Models that support effort levels — should NOT get think prompt instructions
console.log('=== Models with effort support (should NOT get think prompt instructions) ===');

const effortModels = [
  ['opus', 'Opus alias (maps to Opus 4.7)'],
  ['opus-4-7', 'Opus 4.7 short alias'],
  ['claude-opus-4-7', 'Opus 4.7 full ID'],
  ['opus-4-6', 'Opus 4.6 short alias'],
  ['claude-opus-4-6', 'Opus 4.6 full ID'],
  ['sonnet', 'Sonnet alias (maps to Sonnet 5)'],
  ['sonnet-4-6', 'Sonnet 4.6 short alias'],
  ['claude-sonnet-4-6', 'Sonnet 4.6 full ID'],
  ['opus-4-5', 'Opus 4.5 short alias'],
];

for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
  for (const [model, desc] of effortModels) {
    test(`${desc} (${model}) + --think ${level}: no think prompt instruction`, () => {
      const prompt = buildClaudeUserPrompt({ ...baseParams, claudeVersion: '2.1.111', argv: { model, think: level } });
      assert(!containsThinkInstruction(prompt), `Prompt should NOT contain think instruction for ${model} with --think ${level}, got:\n${prompt}`);
    });
  }
}

// Models without effort support but with token-budget support — should NOT get prompt keywords
console.log('\n=== Models with token-budget support (should NOT get think prompt instructions) ===');

const noEffortModels = [
  ['haiku', 'Haiku alias'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5 full ID'],
  ['claude-3-haiku-20240307', 'Haiku 3 full ID'],
];

const expectedMessages = {
  low: 'Think.',
  medium: 'Think hard.',
  high: 'Think harder.',
  xhigh: 'Ultrathink.',
  max: 'Ultrathink.',
};

for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
  for (const [model, desc] of noEffortModels) {
    test(`${desc} (${model}) + --think ${level} + Claude Code 2.1.12: no think prompt instruction`, () => {
      const prompt = buildClaudeUserPrompt({ ...baseParams, claudeVersion: '2.1.12', argv: { model, think: level } });
      assert(!containsThinkInstruction(prompt), `Prompt should NOT contain think instruction for ${model} with --think ${level}, got:\n${prompt}`);
    });
  }
}

// Legacy Claude Code without effort or token-budget support — SHOULD get think prompt instructions
console.log('\n=== Legacy Claude Code fallback (SHOULD get think prompt instructions) ===');

for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
  for (const [model, desc] of noEffortModels) {
    test(`${desc} (${model}) + --think ${level} + Claude Code 2.1.11: includes "${expectedMessages[level]}"`, () => {
      const prompt = buildClaudeUserPrompt({ ...baseParams, claudeVersion: '2.1.11', argv: { model, think: level } });
      assert(prompt.includes(expectedMessages[level]), `Prompt should contain "${expectedMessages[level]}" for ${model} with --think ${level}`);
    });
  }
}

// No model specified — defaults should not add prompt keywords
console.log('\n=== No model specified (should NOT get think prompt instructions) ===');

for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
  test(`No model + --think ${level}: no think prompt instruction`, () => {
    const prompt = buildClaudeUserPrompt({ ...baseParams, claudeVersion: '2.1.111', argv: { think: level } });
    assert(!containsThinkInstruction(prompt), `Prompt should NOT contain think instruction when no model is specified, got:\n${prompt}`);
  });
}

console.log('\n=== Non-Claude tools and structured reasoning (should NOT get think prompt instructions) ===');

for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
  test(`Agent default model + --think ${level}: no think prompt instruction`, () => {
    const prompt = buildAgentUserPrompt({ ...baseParams, argv: { model: 'nemotron-3-super-free', think: level } });
    assert(!containsThinkInstruction(prompt), `Agent prompt should not contain think instruction for non-Claude model, got:\n${prompt}`);
  });

  test(`OpenCode default model + --think ${level}: no think prompt instruction`, () => {
    const prompt = buildOpenCodeUserPrompt({ ...baseParams, argv: { model: 'grok-code-fast-1', think: level } });
    assert(!containsThinkInstruction(prompt), `OpenCode prompt should not contain think instruction for non-Claude model, got:\n${prompt}`);
  });

  test(`Codex + --think ${level}: no think prompt instruction`, () => {
    const prompt = buildCodexUserPrompt({ ...baseParams, argv: { model: 'gpt-5.4', think: level } });
    assert(!containsThinkInstruction(prompt), `Codex prompt should not contain think instruction because --think maps to reasoning effort, got:\n${prompt}`);
  });
}

console.log('\n=== Legacy Claude models through non-Claude tools (SHOULD get think prompt instructions) ===');

for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
  test(`Agent Claude 3 Opus + --think ${level}: includes "${expectedMessages[level]}"`, () => {
    const prompt = buildAgentUserPrompt({ ...baseParams, argv: { model: 'opus', think: level } });
    assert(prompt.includes(expectedMessages[level]), `Agent prompt should contain "${expectedMessages[level]}" for legacy Claude model`);
  });

  test(`OpenCode Claude 3.5 Sonnet + --think ${level}: includes "${expectedMessages[level]}"`, () => {
    const prompt = buildOpenCodeUserPrompt({ ...baseParams, argv: { model: 'claude', think: level } });
    assert(prompt.includes(expectedMessages[level]), `OpenCode prompt should contain "${expectedMessages[level]}" for legacy Claude model`);
  });
}

// No --think flag — should never have think prompt instructions
console.log('\n=== No --think flag (should never have think prompt instructions) ===');

test('opus with no --think: no think prompt instruction', () => {
  const prompt = buildClaudeUserPrompt({ ...baseParams, argv: { model: 'opus' } });
  assert(!containsThinkInstruction(prompt), 'Prompt should not contain think instruction when --think is not set');
});

test('haiku with no --think: no think prompt instruction', () => {
  const prompt = buildClaudeUserPrompt({ ...baseParams, argv: { model: 'haiku' } });
  assert(!containsThinkInstruction(prompt), 'Prompt should not contain think instruction when --think is not set');
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
}
