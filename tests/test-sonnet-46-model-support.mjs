#!/usr/bin/env node
// Test file for issue #1329: Claude Sonnet 4.6 model support
// Tests model aliases, [1m] suffix support, and backward compatibility

import assert from 'assert';

// Import the model validation module
const { CLAUDE_MODELS, MODELS_SUPPORTING_1M_CONTEXT, validateModelName, parseModelWith1mSuffix, supports1mContext, getAvailableModelNames } = await import('../src/model-validation.lib.mjs');
const { mapModelToId, availableModels } = await import('../src/claude.lib.mjs');
const { claudeModels } = await import('../src/model-mapping.lib.mjs');
const { getMaxOutputTokensForModel, getDefaultMaxThinkingBudgetForModel, claudeCode } = await import('../src/config.lib.mjs');

console.log('Testing Claude Sonnet 4.6 Model Support (Issue #1329)\n');

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
// Section 1: Sonnet 4.6 Default Model Tests (Issue #1329)
// ============================================================
console.log('\n=== 1. Sonnet 4.6 Default Model Tests (Issue #1329) ===');

test('sonnet alias maps to claude-sonnet-4-6 in CLAUDE_MODELS', () => {
  assert.strictEqual(CLAUDE_MODELS['sonnet'], 'claude-sonnet-4-6', 'sonnet should map to claude-sonnet-4-6');
});

test('sonnet alias maps to claude-sonnet-4-6 in availableModels (claude.lib.mjs)', () => {
  assert.strictEqual(availableModels['sonnet'], 'claude-sonnet-4-6', 'sonnet should map to claude-sonnet-4-6');
});

test('sonnet alias maps to claude-sonnet-4-6 in claudeModels (model-mapping.lib.mjs)', () => {
  assert.strictEqual(claudeModels['sonnet'], 'claude-sonnet-4-6', 'sonnet should map to claude-sonnet-4-6');
});

test('validateModelName accepts sonnet and maps to claude-sonnet-4-6', () => {
  const result = validateModelName('sonnet', 'claude');
  assert(result.valid, `sonnet should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6', 'sonnet should map to claude-sonnet-4-6');
});

test('mapModelToId maps sonnet to claude-sonnet-4-6', () => {
  const result = mapModelToId('sonnet');
  assert.strictEqual(result, 'claude-sonnet-4-6', 'mapModelToId should map sonnet to claude-sonnet-4-6');
});

// ============================================================
// Section 2: Sonnet 4.6 Direct Model ID Tests
// ============================================================
console.log('\n=== 2. Sonnet 4.6 Direct Model ID Tests ===');

test('validateModelName accepts claude-sonnet-4-6 directly', () => {
  const result = validateModelName('claude-sonnet-4-6', 'claude');
  assert(result.valid, `claude-sonnet-4-6 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6', 'Should map to itself');
});

test('mapModelToId passes through claude-sonnet-4-6 unchanged', () => {
  const result = mapModelToId('claude-sonnet-4-6');
  assert.strictEqual(result, 'claude-sonnet-4-6', 'Full model ID should pass through unchanged');
});

test('sonnet-4-6 alias maps to claude-sonnet-4-6', () => {
  const result = validateModelName('sonnet-4-6', 'claude');
  assert(result.valid, `sonnet-4-6 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6', 'sonnet-4-6 should map to claude-sonnet-4-6');
});

test('mapModelToId maps sonnet-4-6 to claude-sonnet-4-6', () => {
  const result = mapModelToId('sonnet-4-6');
  assert.strictEqual(result, 'claude-sonnet-4-6', 'mapModelToId should map sonnet-4-6 to claude-sonnet-4-6');
});

// ============================================================
// Section 3: Backward Compatibility Tests (Sonnet 4.5)
// ============================================================
console.log('\n=== 3. Backward Compatibility Tests (Sonnet 4.5) ===');

test('sonnet-4-5 alias maps to claude-sonnet-4-5-20250929', () => {
  const result = validateModelName('sonnet-4-5', 'claude');
  assert(result.valid, `sonnet-4-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-5-20250929', 'sonnet-4-5 should map to claude-sonnet-4-5-20250929');
});

test('claude-sonnet-4-5 alias maps to claude-sonnet-4-5-20250929', () => {
  const result = validateModelName('claude-sonnet-4-5', 'claude');
  assert(result.valid, `claude-sonnet-4-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5 should map to claude-sonnet-4-5-20250929');
});

test('claude-sonnet-4-5-20250929 (full ID) still works', () => {
  const result = validateModelName('claude-sonnet-4-5-20250929', 'claude');
  assert(result.valid, `claude-sonnet-4-5-20250929 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-5-20250929', 'Should map to itself');
});

test('mapModelToId maps sonnet-4-5 to claude-sonnet-4-5-20250929', () => {
  const result = mapModelToId('sonnet-4-5');
  assert.strictEqual(result, 'claude-sonnet-4-5-20250929', 'mapModelToId should map sonnet-4-5 to claude-sonnet-4-5-20250929');
});

// ============================================================
// Section 4: [1m] Suffix Support for Sonnet 4.6 Tests
// ============================================================
console.log('\n=== 4. [1m] Suffix Support for Sonnet 4.6 Tests ===');

test('MODELS_SUPPORTING_1M_CONTEXT includes claude-sonnet-4-6', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-sonnet-4-6'), 'claude-sonnet-4-6 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('MODELS_SUPPORTING_1M_CONTEXT includes sonnet-4-6', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('sonnet-4-6'), 'sonnet-4-6 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('supports1mContext returns true for sonnet (now 4.6)', () => {
  assert.strictEqual(supports1mContext('sonnet', 'claude'), true, 'sonnet should support 1M context');
});

test('supports1mContext returns true for sonnet-4-6', () => {
  assert.strictEqual(supports1mContext('sonnet-4-6', 'claude'), true, 'sonnet-4-6 should support 1M context');
});

test('supports1mContext returns true for claude-sonnet-4-6', () => {
  assert.strictEqual(supports1mContext('claude-sonnet-4-6', 'claude'), true, 'claude-sonnet-4-6 should support 1M context');
});

test('validateModelName accepts sonnet[1m] and maps to claude-sonnet-4-6[1m]', () => {
  const result = validateModelName('sonnet[1m]', 'claude');
  assert(result.valid, `sonnet[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6[1m]', 'sonnet[1m] should map to claude-sonnet-4-6[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts sonnet-4-6[1m] and maps to claude-sonnet-4-6[1m]', () => {
  const result = validateModelName('sonnet-4-6[1m]', 'claude');
  assert(result.valid, `sonnet-4-6[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6[1m]', 'sonnet-4-6[1m] should map to claude-sonnet-4-6[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts claude-sonnet-4-6[1m]', () => {
  const result = validateModelName('claude-sonnet-4-6[1m]', 'claude');
  assert(result.valid, `claude-sonnet-4-6[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6[1m]', 'claude-sonnet-4-6[1m] should map to itself');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('mapModelToId handles sonnet[1m]', () => {
  const result = mapModelToId('sonnet[1m]');
  assert.strictEqual(result, 'claude-sonnet-4-6[1m]', 'mapModelToId should handle sonnet[1m]');
});

test('mapModelToId handles sonnet-4-6[1m]', () => {
  const result = mapModelToId('sonnet-4-6[1m]');
  assert.strictEqual(result, 'claude-sonnet-4-6[1m]', 'mapModelToId should handle sonnet-4-6[1m]');
});

// ============================================================
// Section 5: Sonnet 4.5 [1m] Backward Compatibility
// ============================================================
console.log('\n=== 5. Sonnet 4.5 [1m] Backward Compatibility ===');

test('sonnet-4-5[1m] still works', () => {
  const result = validateModelName('sonnet-4-5[1m]', 'claude');
  assert(result.valid, `sonnet-4-5[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-5-20250929[1m]', 'sonnet-4-5[1m] should map to claude-sonnet-4-5-20250929[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('mapModelToId handles sonnet-4-5[1m]', () => {
  const result = mapModelToId('sonnet-4-5[1m]');
  assert.strictEqual(result, 'claude-sonnet-4-5-20250929[1m]', 'mapModelToId should handle sonnet-4-5[1m]');
});

// ============================================================
// Section 6: Max Output Tokens and Thinking Budget Tests
// ============================================================
console.log('\n=== 6. Max Output Tokens and Thinking Budget Tests ===');

test('getMaxOutputTokensForModel returns 64000 for sonnet (Sonnet 4.6)', () => {
  assert.strictEqual(getMaxOutputTokensForModel('sonnet'), 64000, 'Sonnet 4.6 should have 64K max output tokens');
});

test('getMaxOutputTokensForModel returns 64000 for sonnet-4-6', () => {
  assert.strictEqual(getMaxOutputTokensForModel('sonnet-4-6'), 64000, 'sonnet-4-6 should have 64K max output tokens');
});

test('getMaxOutputTokensForModel returns 64000 for claude-sonnet-4-6', () => {
  assert.strictEqual(getMaxOutputTokensForModel('claude-sonnet-4-6'), 64000, 'claude-sonnet-4-6 should have 64K max output tokens');
});

test('getDefaultMaxThinkingBudgetForModel returns 31999 for sonnet', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('sonnet'), 31999, 'Sonnet 4.6 should have 31999 thinking budget');
});

test('getDefaultMaxThinkingBudgetForModel returns 31999 for sonnet-4-6', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('sonnet-4-6'), 31999, 'sonnet-4-6 should have 31999 thinking budget');
});

// ============================================================
// Section 7: Available Model Names Tests
// ============================================================
console.log('\n=== 7. Available Model Names Tests ===');

test('getAvailableModelNames includes sonnet for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('sonnet'), `sonnet should be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames includes sonnet-4-6 alias', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('sonnet-4-6'), `sonnet-4-6 should be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames includes sonnet-4-5 alias for backward compatibility', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('sonnet-4-5'), `sonnet-4-5 should be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames includes claude-sonnet-4-5 alias for backward compatibility', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('claude-sonnet-4-5'), `claude-sonnet-4-5 should be in available model names: ${names.join(', ')}`);
});

// ============================================================
// Section 8: Case Insensitivity Tests
// ============================================================
console.log('\n=== 8. Case Insensitivity Tests ===');

test('validateModelName handles SONNET (uppercase)', () => {
  const result = validateModelName('SONNET', 'claude');
  assert(result.valid, `SONNET should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6', 'SONNET should map to claude-sonnet-4-6');
});

test('validateModelName handles SONNET[1M] (uppercase)', () => {
  const result = validateModelName('SONNET[1M]', 'claude');
  assert(result.valid, `SONNET[1M] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6[1m]', 'SONNET[1M] should map to claude-sonnet-4-6[1m]');
});

test('validateModelName handles Sonnet-4-6 (mixed case)', () => {
  const result = validateModelName('Sonnet-4-6', 'claude');
  assert(result.valid, `Sonnet-4-6 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6', 'Sonnet-4-6 should map to claude-sonnet-4-6');
});

// ============================================================
// Section 9: Regression Tests for Other Models
// ============================================================
console.log('\n=== 9. Regression Tests for Other Models ===');

test('opus alias still works (regression test)', () => {
  const result = validateModelName('opus', 'claude');
  assert(result.valid, `opus should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101', 'opus should map to claude-opus-4-5-20251101');
});

test('haiku alias still works (regression test)', () => {
  const result = validateModelName('haiku', 'claude');
  assert(result.valid, `haiku should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-haiku-4-5-20251001', 'haiku should map correctly');
});

test('opus-4-6 alias still works (regression test)', () => {
  const result = validateModelName('opus-4-6', 'claude');
  assert(result.valid, `opus-4-6 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-6', 'opus-4-6 should map to claude-opus-4-6');
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
