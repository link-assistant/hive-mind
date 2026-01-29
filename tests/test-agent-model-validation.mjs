#!/usr/bin/env node
// Test file for issue #1185: Agent model validation
// Tests that all free models are properly supported with --tool agent

import assert from 'assert';

// Import the model validation module
const { AGENT_MODELS, validateModelName, getAvailableModelNames } = await import('../src/model-validation.lib.mjs');
const { mapModelToId } = await import('../src/agent.lib.mjs');

console.log('🧪 Testing Agent Model Validation (Issue #1185)\n');

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
};

// Test 1: AGENT_MODELS should contain opencode/gpt-5-nano
test('AGENT_MODELS contains opencode/gpt-5-nano as key', () => {
  assert('opencode/gpt-5-nano' in AGENT_MODELS, 'opencode/gpt-5-nano should be a valid key in AGENT_MODELS');
});

// Test 2: AGENT_MODELS should map gpt-5-nano to opencode/gpt-5-nano
test('gpt-5-nano short alias maps to opencode/gpt-5-nano', () => {
  assert.strictEqual(AGENT_MODELS['gpt-5-nano'], 'opencode/gpt-5-nano', 'gpt-5-nano should map to opencode/gpt-5-nano (not openai/gpt-5-nano)');
});

// Test 3: AGENT_MODELS should NOT have openai/gpt-5-nano (agent uses OpenCode Zen, not direct OpenAI)
test('AGENT_MODELS does not contain openai/gpt-5-nano (wrong provider)', () => {
  assert(!('openai/gpt-5-nano' in AGENT_MODELS), 'openai/gpt-5-nano should NOT be in AGENT_MODELS - agent uses OpenCode Zen');
});

// Test 4: validateModelName should accept opencode/gpt-5-nano
test('validateModelName accepts opencode/gpt-5-nano for agent tool', () => {
  const result = validateModelName('opencode/gpt-5-nano', 'agent');
  assert(result.valid, `opencode/gpt-5-nano should be valid for agent tool, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'opencode/gpt-5-nano', 'Should map to opencode/gpt-5-nano');
});

// Test 5: validateModelName should accept gpt-5-nano short alias
test('validateModelName accepts gpt-5-nano short alias for agent tool', () => {
  const result = validateModelName('gpt-5-nano', 'agent');
  assert(result.valid, `gpt-5-nano should be valid for agent tool, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'opencode/gpt-5-nano', 'gpt-5-nano should map to opencode/gpt-5-nano');
});

// Test 6: AGENT_MODELS should contain opencode/big-pickle
test('AGENT_MODELS contains opencode/big-pickle as key', () => {
  assert('opencode/big-pickle' in AGENT_MODELS, 'opencode/big-pickle should be a valid key in AGENT_MODELS');
});

// Test 7: validateModelName should accept opencode/big-pickle
test('validateModelName accepts opencode/big-pickle for agent tool', () => {
  const result = validateModelName('opencode/big-pickle', 'agent');
  assert(result.valid, `opencode/big-pickle should be valid for agent tool, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'opencode/big-pickle', 'Should map to opencode/big-pickle');
});

// Test 8: validateModelName should accept big-pickle short alias
test('validateModelName accepts big-pickle short alias for agent tool', () => {
  const result = validateModelName('big-pickle', 'agent');
  assert(result.valid, `big-pickle should be valid for agent tool, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'opencode/big-pickle', 'big-pickle should map to opencode/big-pickle');
});

// Test 9: mapModelToId should map gpt-5-nano to opencode/gpt-5-nano
test('mapModelToId maps gpt-5-nano to opencode/gpt-5-nano', () => {
  const result = mapModelToId('gpt-5-nano');
  assert.strictEqual(result, 'opencode/gpt-5-nano', 'mapModelToId should map gpt-5-nano to opencode/gpt-5-nano');
});

// Test 10: mapModelToId should pass through opencode/gpt-5-nano unchanged
test('mapModelToId passes through opencode/gpt-5-nano unchanged', () => {
  const result = mapModelToId('opencode/gpt-5-nano');
  assert.strictEqual(result, 'opencode/gpt-5-nano', 'Full model ID should pass through unchanged');
});

// Test 11: mapModelToId should map big-pickle to opencode/big-pickle
test('mapModelToId maps big-pickle to opencode/big-pickle', () => {
  const result = mapModelToId('big-pickle');
  assert.strictEqual(result, 'opencode/big-pickle', 'mapModelToId should map big-pickle to opencode/big-pickle');
});

// Test 12: Verify all free models are properly mapped
test('All free OpenCode Zen models use opencode/ prefix in AGENT_MODELS', () => {
  const freeModels = ['grok-code', 'big-pickle', 'gpt-5-nano'];
  for (const model of freeModels) {
    const mapped = AGENT_MODELS[model];
    assert(mapped, `${model} should be in AGENT_MODELS`);
    assert(mapped.startsWith('opencode/'), `${model} should map to opencode/ prefix, got: ${mapped}`);
  }
});

// Test 13: getAvailableModelNames includes gpt-5-nano in short names
test('getAvailableModelNames includes gpt-5-nano for agent tool', () => {
  const names = getAvailableModelNames('agent');
  assert(names.includes('gpt-5-nano'), `gpt-5-nano should be in available model names: ${names.join(', ')}`);
});

// Test 14: getAvailableModelNames includes big-pickle in short names
test('getAvailableModelNames includes big-pickle for agent tool', () => {
  const names = getAvailableModelNames('agent');
  assert(names.includes('big-pickle'), `big-pickle should be in available model names: ${names.join(', ')}`);
});

// Test 15: Case-insensitive validation for gpt-5-nano
test('validateModelName handles case-insensitive input for gpt-5-nano', () => {
  const result = validateModelName('GPT-5-NANO', 'agent');
  assert(result.valid, `GPT-5-NANO (uppercase) should be valid for agent tool`);
  assert.strictEqual(result.mappedModel, 'opencode/gpt-5-nano', 'Should map to opencode/gpt-5-nano');
});

// Test 16: Case-insensitive validation for opencode/gpt-5-nano
test('validateModelName handles case-insensitive input for opencode/gpt-5-nano', () => {
  const result = validateModelName('OPENCODE/GPT-5-NANO', 'agent');
  assert(result.valid, `OPENCODE/GPT-5-NANO (uppercase) should be valid for agent tool`);
  assert.strictEqual(result.mappedModel, 'opencode/gpt-5-nano', 'Should map to opencode/gpt-5-nano');
});

// Test 17: Verify grok models still work (regression test)
test('grok models still work correctly (regression test)', () => {
  const grokResult = validateModelName('grok', 'agent');
  assert(grokResult.valid, 'grok should still be valid');
  assert.strictEqual(grokResult.mappedModel, 'opencode/grok-code', 'grok should map to opencode/grok-code');

  const grokCodeResult = validateModelName('grok-code', 'agent');
  assert(grokCodeResult.valid, 'grok-code should still be valid');
  assert.strictEqual(grokCodeResult.mappedModel, 'opencode/grok-code', 'grok-code should map to opencode/grok-code');
});

// Test 18: Verify premium models still work (regression test)
test('Premium models still work correctly (regression test)', () => {
  const sonnetResult = validateModelName('sonnet', 'agent');
  assert(sonnetResult.valid, 'sonnet should still be valid');
  assert.strictEqual(sonnetResult.mappedModel, 'anthropic/claude-3-5-sonnet', 'sonnet should map correctly');

  const haikuResult = validateModelName('haiku', 'agent');
  assert(haikuResult.valid, 'haiku should still be valid');
  assert.strictEqual(haikuResult.mappedModel, 'anthropic/claude-3-5-haiku', 'haiku should map correctly');
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
