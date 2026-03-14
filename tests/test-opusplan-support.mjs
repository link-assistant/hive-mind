#!/usr/bin/env node
// Test file for issue #1223: opusplan model support and --plan-model option
// Tests opusplan alias, --plan-model validation, config settings, and backward compatibility

import assert from 'assert';

// Import the model validation module
const { CLAUDE_MODELS, validateModelName, getAvailableModelNames } = await import('../src/model-validation.lib.mjs');
const { mapModelToId, availableModels } = await import('../src/claude.lib.mjs');
const { claudeModels, isModelCompatibleWithTool } = await import('../src/model-mapping.lib.mjs');
const { isOpus46OrLater, getMaxOutputTokensForModel, getDefaultMaxThinkingBudgetForModel, getClaudeEnv } = await import('../src/config.lib.mjs');

console.log('Testing opusplan Model Support (Issue #1223)\n');

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`  ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
};

// ============================================================
// Section 1: opusplan Alias Tests
// ============================================================
console.log('\n=== 1. opusplan Alias Tests ===');

test('opusplan alias exists in CLAUDE_MODELS', () => {
  assert.strictEqual(CLAUDE_MODELS['opusplan'], 'opusplan', 'opusplan should map to opusplan (passthrough)');
});

test('opusplan alias exists in availableModels (claude.lib.mjs)', () => {
  assert.strictEqual(availableModels['opusplan'], 'opusplan', 'opusplan should map to opusplan');
});

test('opusplan alias exists in claudeModels (model-mapping.lib.mjs)', () => {
  assert.strictEqual(claudeModels['opusplan'], 'opusplan', 'opusplan should map to opusplan');
});

// ============================================================
// Section 2: opusplan Validation Tests
// ============================================================
console.log('\n=== 2. opusplan Validation Tests ===');

test('validateModelName accepts opusplan', () => {
  const result = validateModelName('opusplan', 'claude');
  assert(result.valid, `opusplan should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'opusplan', 'opusplan should map to opusplan');
});

test('validateModelName accepts OPUSPLAN (case-insensitive)', () => {
  const result = validateModelName('OPUSPLAN', 'claude');
  assert(result.valid, `OPUSPLAN should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'opusplan', 'OPUSPLAN should map to opusplan');
});

test('validateModelName accepts OpusPlan (mixed case)', () => {
  const result = validateModelName('OpusPlan', 'claude');
  assert(result.valid, `OpusPlan should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'opusplan', 'OpusPlan should map to opusplan');
});

// ============================================================
// Section 3: mapModelToId Tests
// ============================================================
console.log('\n=== 3. mapModelToId Tests ===');

test('mapModelToId maps opusplan to opusplan (passthrough)', () => {
  const result = mapModelToId('opusplan');
  assert.strictEqual(result, 'opusplan', 'mapModelToId should pass through opusplan');
});

test('mapModelToId does not alter opusplan (it is not a claude- prefixed model)', () => {
  const result = mapModelToId('opusplan');
  assert(!result.startsWith('claude-'), 'opusplan should not be mapped to a claude- prefixed model');
});

// ============================================================
// Section 4: Model Compatibility Tests
// ============================================================
console.log('\n=== 4. Model Compatibility Tests ===');

test('opusplan is compatible with claude tool', () => {
  assert.strictEqual(isModelCompatibleWithTool('claude', 'opusplan'), true, 'opusplan should be compatible with claude tool');
});

test('opusplan is NOT compatible with opencode tool', () => {
  assert.strictEqual(isModelCompatibleWithTool('opencode', 'opusplan'), false, 'opusplan should not be compatible with opencode');
});

test('opusplan is NOT compatible with codex tool', () => {
  assert.strictEqual(isModelCompatibleWithTool('codex', 'opusplan'), false, 'opusplan should not be compatible with codex');
});

// ============================================================
// Section 5: Config Settings for opusplan
// ============================================================
console.log('\n=== 5. Config Settings for opusplan ===');

test('isOpus46OrLater returns true for opusplan', () => {
  assert.strictEqual(isOpus46OrLater('opusplan'), true, 'opusplan should be treated as Opus 4.6+ for config purposes');
});

test('getMaxOutputTokensForModel returns 128000 for opusplan', () => {
  assert.strictEqual(getMaxOutputTokensForModel('opusplan'), 128000, 'opusplan should have 128K max output tokens (Opus-level)');
});

test('getDefaultMaxThinkingBudgetForModel returns 31999 for opusplan', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('opusplan'), 31999, 'opusplan should have 31999 thinking budget (aligned with standard, Issue #1238)');
});

// ============================================================
// Section 6: getClaudeEnv with planModel and executionModel
// ============================================================
console.log('\n=== 6. getClaudeEnv with planModel and executionModel ===');

test('getClaudeEnv sets ANTHROPIC_DEFAULT_OPUS_MODEL when planModel is provided', () => {
  const env = getClaudeEnv({ planModel: 'claude-opus-4-6' });
  assert.strictEqual(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-opus-4-6', 'Should set ANTHROPIC_DEFAULT_OPUS_MODEL');
});

test('getClaudeEnv does not set ANTHROPIC_DEFAULT_OPUS_MODEL when planModel is not provided', () => {
  const env = getClaudeEnv({});
  const hasKey = 'ANTHROPIC_DEFAULT_OPUS_MODEL' in env && !('ANTHROPIC_DEFAULT_OPUS_MODEL' in process.env);
  assert.strictEqual(hasKey, false, 'Should not set ANTHROPIC_DEFAULT_OPUS_MODEL when planModel is not provided');
});

test('getClaudeEnv sets both model and planModel correctly', () => {
  const env = getClaudeEnv({ model: 'opusplan', planModel: 'claude-opus-4-6' });
  assert.strictEqual(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-opus-4-6', 'Should set ANTHROPIC_DEFAULT_OPUS_MODEL');
  assert.strictEqual(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '128000', 'opusplan should get 128K max output tokens');
});

test('getClaudeEnv sets ANTHROPIC_DEFAULT_SONNET_MODEL when executionModel is provided', () => {
  const env = getClaudeEnv({ executionModel: 'claude-haiku-4-5-20251001' });
  assert.strictEqual(env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'claude-haiku-4-5-20251001', 'Should set ANTHROPIC_DEFAULT_SONNET_MODEL');
});

test('getClaudeEnv does not set ANTHROPIC_DEFAULT_SONNET_MODEL when executionModel is not provided', () => {
  const env = getClaudeEnv({});
  const hasKey = 'ANTHROPIC_DEFAULT_SONNET_MODEL' in env && !('ANTHROPIC_DEFAULT_SONNET_MODEL' in process.env);
  assert.strictEqual(hasKey, false, 'Should not set ANTHROPIC_DEFAULT_SONNET_MODEL when executionModel is not provided');
});

test('getClaudeEnv configures full plan/execution split (--plan-model opus --model haiku)', () => {
  // This simulates: --plan-model opus --model haiku
  // The code auto-switches to opusplan and sets both env vars
  const env = getClaudeEnv({
    model: 'opusplan',
    planModel: 'claude-opus-4-6',
    executionModel: 'claude-haiku-4-5-20251001',
  });
  assert.strictEqual(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-opus-4-6', 'Plan model should be opus');
  assert.strictEqual(env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'claude-haiku-4-5-20251001', 'Execution model should be haiku');
  assert.strictEqual(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '128000', 'opusplan should get 128K max output tokens');
});

test('getClaudeEnv configures --plan-model sonnet --model haiku', () => {
  // Verifies the reviewer-requested combination works
  const env = getClaudeEnv({
    model: 'opusplan',
    planModel: 'claude-sonnet-4-5-20250929',
    executionModel: 'claude-haiku-4-5-20251001',
  });
  assert.strictEqual(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-sonnet-4-5-20250929', 'Plan model should be sonnet');
  assert.strictEqual(env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'claude-haiku-4-5-20251001', 'Execution model should be haiku');
});

// ============================================================
// Section 7: Available Model Names Tests
// ============================================================
console.log('\n=== 7. Available Model Names Tests ===');

test('getAvailableModelNames includes opusplan for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('opusplan'), `opusplan should be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames still includes opus for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('opus'), `opus should still be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames still includes sonnet for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('sonnet'), `sonnet should still be in available model names: ${names.join(', ')}`);
});

// ============================================================
// Section 8: Backward Compatibility Tests
// ============================================================
console.log('\n=== 8. Backward Compatibility Tests ===');

test('opus alias still works after adding opusplan', () => {
  const result = validateModelName('opus', 'claude');
  assert(result.valid, `opus should still be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101', 'opus should still map to claude-opus-4-5-20251101 (Issue #1238)');
});

test('sonnet alias still works after adding opusplan', () => {
  const result = validateModelName('sonnet', 'claude');
  assert(result.valid, `sonnet should still be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6', 'sonnet should map to claude-sonnet-4-6 (Issue #1329)');
});

test('haiku alias still works after adding opusplan', () => {
  const result = validateModelName('haiku', 'claude');
  assert(result.valid, `haiku should still be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-haiku-4-5-20251001', 'haiku should still map correctly');
});

test('opus[1m] still works after adding opusplan', () => {
  const result = validateModelName('opus[1m]', 'claude');
  assert(result.valid, `opus[1m] should still be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101[1m]', 'opus[1m] should still map correctly');
});

// ============================================================
// Section 9: opusplan with [1m] suffix Tests
// ============================================================
console.log('\n=== 9. opusplan with [1m] suffix Tests ===');

test('opusplan[1m] is rejected (opusplan is a special mode, not a direct model)', () => {
  // opusplan is not in MODELS_SUPPORTING_1M_CONTEXT, so [1m] suffix should be rejected
  const result = validateModelName('opusplan[1m]', 'claude');
  assert.strictEqual(result.valid, false, 'opusplan[1m] should be invalid (opusplan is a meta-model, not a real model)');
});

// ============================================================
// Section 10: Fuzzy Matching Tests
// ============================================================
console.log('\n=== 10. Fuzzy Matching Tests ===');

test('opuspan (typo) suggests opusplan', () => {
  const result = validateModelName('opuspan', 'claude');
  assert.strictEqual(result.valid, false, 'opuspan should be invalid');
  assert(result.suggestions && result.suggestions.length > 0, 'Should provide suggestions');
  assert(result.suggestions.includes('opusplan') || result.suggestions.includes('opus'), `Suggestions should include opusplan or opus: ${result.suggestions.join(', ')}`);
});

// ============================================================
// Section 11: --worker-model Alias Tests
// ============================================================
console.log('\n=== 11. --worker-model Alias Tests ===');

test('SOLVE_OPTION_DEFINITIONS includes worker-model option', async () => {
  const { SOLVE_OPTION_DEFINITIONS } = await import('../src/solve.config.lib.mjs');
  assert('worker-model' in SOLVE_OPTION_DEFINITIONS, 'SOLVE_OPTION_DEFINITIONS should include worker-model');
  assert.strictEqual(SOLVE_OPTION_DEFINITIONS['worker-model'].type, 'string', 'worker-model should be a string option');
});

test('SOLVE_OPTION_DEFINITIONS includes plan-model option', async () => {
  const { SOLVE_OPTION_DEFINITIONS } = await import('../src/solve.config.lib.mjs');
  assert('plan-model' in SOLVE_OPTION_DEFINITIONS, 'SOLVE_OPTION_DEFINITIONS should include plan-model');
  assert.strictEqual(SOLVE_OPTION_DEFINITIONS['plan-model'].type, 'string', 'plan-model should be a string option');
});

// ============================================================
// Section 12: Plan/Worker Model Combination Tests
// ============================================================
console.log('\n=== 12. Plan/Worker Model Combination Tests ===');

test('getClaudeEnv configures --plan-model opus --model sonnet (default opusplan usage)', () => {
  const env = getClaudeEnv({
    model: 'opusplan',
    planModel: 'claude-opus-4-5-20251101',
    executionModel: 'claude-sonnet-4-6',
  });
  assert.strictEqual(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-opus-4-5-20251101', 'Plan model should be opus 4.5');
  assert.strictEqual(env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'claude-sonnet-4-6', 'Execution model should be sonnet 4.6');
});

test('getClaudeEnv configures --plan-model sonnet --model haiku (cost-optimized)', () => {
  const env = getClaudeEnv({
    model: 'opusplan',
    planModel: 'claude-sonnet-4-6',
    executionModel: 'claude-haiku-4-5-20251001',
  });
  assert.strictEqual(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-sonnet-4-6', 'Plan model should be sonnet');
  assert.strictEqual(env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'claude-haiku-4-5-20251001', 'Execution model should be haiku');
});

test('getClaudeEnv configures --plan-model haiku --model haiku (cheapest)', () => {
  const env = getClaudeEnv({
    model: 'opusplan',
    planModel: 'claude-haiku-4-5-20251001',
    executionModel: 'claude-haiku-4-5-20251001',
  });
  assert.strictEqual(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-haiku-4-5-20251001', 'Plan model should be haiku');
  assert.strictEqual(env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'claude-haiku-4-5-20251001', 'Execution model should be haiku');
});

test('Any valid Claude model can be used as plan model', () => {
  // Test with all major model families
  for (const model of ['claude-opus-4-6', 'claude-opus-4-5-20251101', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']) {
    const env = getClaudeEnv({ model: 'opusplan', planModel: model });
    assert.strictEqual(env.ANTHROPIC_DEFAULT_OPUS_MODEL, model, `Should accept ${model} as plan model`);
  }
});

test('Any valid Claude model can be used as execution/worker model', () => {
  // Test with all major model families
  for (const model of ['claude-opus-4-6', 'claude-opus-4-5-20251101', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']) {
    const env = getClaudeEnv({ model: 'opusplan', executionModel: model });
    assert.strictEqual(env.ANTHROPIC_DEFAULT_SONNET_MODEL, model, `Should accept ${model} as execution model`);
  }
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\nSome tests failed!');
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
