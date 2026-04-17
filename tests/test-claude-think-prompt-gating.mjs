#!/usr/bin/env node
// Test: thinking prompt instructions should only be added for models without effort support
// Models with effort support (Opus 4.7, Opus 4.6, Sonnet 4.6, Opus 4.5, Mythos) use CLAUDE_CODE_EFFORT_LEVEL,
// so "Think.", "Think hard.", etc. should NOT appear in the prompt for those models.

import assert from 'assert';

const { buildUserPrompt } = await import('../src/claude.prompts.lib.mjs');

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
  ['sonnet', 'Sonnet alias (maps to Sonnet 4.6)'],
  ['sonnet-4-6', 'Sonnet 4.6 short alias'],
  ['claude-sonnet-4-6', 'Sonnet 4.6 full ID'],
  ['opus-4-5', 'Opus 4.5 short alias'],
];

for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
  for (const [model, desc] of effortModels) {
    test(`${desc} (${model}) + --think ${level}: no think prompt instruction`, () => {
      const prompt = buildUserPrompt({ ...baseParams, argv: { model, think: level } });
      assert(!containsThinkInstruction(prompt), `Prompt should NOT contain think instruction for ${model} with --think ${level}, got:\n${prompt}`);
    });
  }
}

// Models without effort support — SHOULD get think prompt instructions
console.log('\n=== Models without effort support (SHOULD get think prompt instructions) ===');

const noEffortModels = [
  ['haiku', 'Haiku alias'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5 full ID'],
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
    test(`${desc} (${model}) + --think ${level}: includes "${expectedMessages[level]}"`, () => {
      const prompt = buildUserPrompt({ ...baseParams, argv: { model, think: level } });
      assert(prompt.includes(expectedMessages[level]), `Prompt should contain "${expectedMessages[level]}" for ${model} with --think ${level}`);
    });
  }
}

// No model specified — should still get think prompt instructions (backward compat)
console.log('\n=== No model specified (should get think prompt instructions) ===');

for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
  test(`No model + --think ${level}: includes "${expectedMessages[level]}"`, () => {
    const prompt = buildUserPrompt({ ...baseParams, argv: { think: level } });
    assert(prompt.includes(expectedMessages[level]), `Prompt should contain "${expectedMessages[level]}" when no model specified`);
  });
}

// No --think flag — should never have think prompt instructions
console.log('\n=== No --think flag (should never have think prompt instructions) ===');

test('opus with no --think: no think prompt instruction', () => {
  const prompt = buildUserPrompt({ ...baseParams, argv: { model: 'opus' } });
  assert(!containsThinkInstruction(prompt), 'Prompt should not contain think instruction when --think is not set');
});

test('haiku with no --think: no think prompt instruction', () => {
  const prompt = buildUserPrompt({ ...baseParams, argv: { model: 'haiku' } });
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
