#!/usr/bin/env node
// Test file for issue #1620: Claude Opus 4.7 model support
// Tests model aliases, [1m] suffix support, and backward compatibility with Opus 4.6

import assert from 'assert';

const { CLAUDE_MODELS, MODELS_SUPPORTING_1M_CONTEXT, validateModelName, parseModelWith1mSuffix, supports1mContext, getAvailableModelNames, claudeModels } = await import('../src/models/index.mjs');
const { mapModelToId, availableModels } = await import('../src/claude.lib.mjs');
const { isOpus46OrLater, getMaxOutputTokensForModel, getDefaultMaxThinkingBudgetForModel, claudeCode, DEFAULT_MAX_THINKING_BUDGET_OPUS_46 } = await import('../src/config.lib.mjs');

console.log('Testing Claude Opus 4.7 Model Support (Issue #1620)\n');

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
// Section 1: Opus Default Model Tests (Issue #1620: opus -> Opus 4.7)
// ============================================================
console.log('\n=== 1. Opus Default Model Tests (Issue #1620) ===');

test('opus alias maps to claude-opus-4-7 in CLAUDE_MODELS', () => {
  assert.strictEqual(CLAUDE_MODELS['opus'], 'claude-opus-4-7', 'opus should map to claude-opus-4-7');
});

test('opus alias maps to claude-opus-4-7 in availableModels (claude.lib.mjs)', () => {
  assert.strictEqual(availableModels['opus'], 'claude-opus-4-7', 'opus should map to claude-opus-4-7');
});

test('opus alias maps to claude-opus-4-7 in claudeModels (models/index.mjs)', () => {
  assert.strictEqual(claudeModels['opus'], 'claude-opus-4-7', 'opus should map to claude-opus-4-7');
});

test('validateModelName accepts opus and maps to claude-opus-4-7', () => {
  const result = validateModelName('opus', 'claude');
  assert(result.valid, `opus should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7', 'opus should map to claude-opus-4-7');
});

test('mapModelToId maps opus to claude-opus-4-7', () => {
  const result = mapModelToId('opus');
  assert.strictEqual(result, 'claude-opus-4-7', 'mapModelToId should map opus to claude-opus-4-7');
});

// ============================================================
// Section 2: Opus 4.7 Direct Model ID Tests
// ============================================================
console.log('\n=== 2. Direct Model ID Tests ===');

test('validateModelName accepts claude-opus-4-7 directly', () => {
  const result = validateModelName('claude-opus-4-7', 'claude');
  assert(result.valid, `claude-opus-4-7 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7', 'Should map to itself');
});

test('mapModelToId passes through claude-opus-4-7 unchanged', () => {
  const result = mapModelToId('claude-opus-4-7');
  assert.strictEqual(result, 'claude-opus-4-7', 'Full model ID should pass through unchanged');
});

test('opus-4-7 alias maps to claude-opus-4-7', () => {
  const result = validateModelName('opus-4-7', 'claude');
  assert(result.valid, `opus-4-7 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7', 'opus-4-7 should map to claude-opus-4-7');
});

test('mapModelToId handles opus-4-7', () => {
  const result = mapModelToId('opus-4-7');
  assert.strictEqual(result, 'claude-opus-4-7', 'mapModelToId should map opus-4-7 to claude-opus-4-7');
});

// ============================================================
// Section 3: Backward Compatibility Tests (Opus 4.6 still works)
// ============================================================
console.log('\n=== 3. Backward Compatibility Tests ===');

test('opus-4-6 alias still maps to claude-opus-4-6', () => {
  const result = validateModelName('opus-4-6', 'claude');
  assert(result.valid, `opus-4-6 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-6', 'opus-4-6 should map to claude-opus-4-6');
});

test('claude-opus-4-6 still works directly', () => {
  const result = validateModelName('claude-opus-4-6', 'claude');
  assert(result.valid, `claude-opus-4-6 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-6', 'Should map to itself');
});

test('claude-opus-4-5 alias maps to claude-opus-4-5-20251101', () => {
  const result = validateModelName('claude-opus-4-5', 'claude');
  assert(result.valid, `claude-opus-4-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101', 'claude-opus-4-5 should map to claude-opus-4-5-20251101');
});

test('sonnet alias still works (maps to Sonnet 4.6)', () => {
  const result = validateModelName('sonnet', 'claude');
  assert(result.valid, `sonnet should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6', 'sonnet should map to claude-sonnet-4-6');
});

test('haiku alias still works', () => {
  const result = validateModelName('haiku', 'claude');
  assert(result.valid, `haiku should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-haiku-4-5-20251001', 'haiku should map correctly');
});

// ============================================================
// Section 4: [1m] Suffix Tests for Opus 4.7
// ============================================================
console.log('\n=== 4. [1m] Suffix Tests for Opus 4.7 ===');

test('supports1mContext returns true for opus (now Opus 4.7)', () => {
  assert.strictEqual(supports1mContext('opus', 'claude'), true, 'opus should support 1M context');
});

test('supports1mContext returns true for claude-opus-4-7', () => {
  assert.strictEqual(supports1mContext('claude-opus-4-7', 'claude'), true, 'claude-opus-4-7 should support 1M context');
});

test('supports1mContext returns true for opus-4-7', () => {
  assert.strictEqual(supports1mContext('opus-4-7', 'claude'), true, 'opus-4-7 should support 1M context');
});

test('supports1mContext still returns true for claude-opus-4-6', () => {
  assert.strictEqual(supports1mContext('claude-opus-4-6', 'claude'), true, 'claude-opus-4-6 should still support 1M context');
});

test('validateModelName accepts opus[1m] (maps to Opus 4.7)', () => {
  const result = validateModelName('opus[1m]', 'claude');
  assert(result.valid, `opus[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7[1m]', 'Should map to claude-opus-4-7[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts claude-opus-4-7[1m]', () => {
  const result = validateModelName('claude-opus-4-7[1m]', 'claude');
  assert(result.valid, `claude-opus-4-7[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7[1m]', 'Should map to claude-opus-4-7[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts opus-4-7[1m]', () => {
  const result = validateModelName('opus-4-7[1m]', 'claude');
  assert(result.valid, `opus-4-7[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7[1m]', 'Should map to claude-opus-4-7[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('mapModelToId handles opus[1m] (maps to Opus 4.7)', () => {
  const result = mapModelToId('opus[1m]');
  assert.strictEqual(result, 'claude-opus-4-7[1m]', 'mapModelToId should handle opus[1m]');
});

test('mapModelToId handles claude-opus-4-7[1m]', () => {
  const result = mapModelToId('claude-opus-4-7[1m]');
  assert.strictEqual(result, 'claude-opus-4-7[1m]', 'mapModelToId should handle claude-opus-4-7[1m]');
});

// ============================================================
// Section 5: isOpus46OrLater Tests for Opus 4.7
// ============================================================
console.log('\n=== 5. isOpus46OrLater Tests for Opus 4.7 ===');

test('isOpus46OrLater returns true for opus (now Opus 4.7)', () => {
  assert.strictEqual(isOpus46OrLater('opus'), true, 'opus should be identified as Opus 4.6+');
});

test('isOpus46OrLater returns true for claude-opus-4-7', () => {
  assert.strictEqual(isOpus46OrLater('claude-opus-4-7'), true, 'claude-opus-4-7 should be identified as Opus 4.6+');
});

test('isOpus46OrLater returns true for opus-4-7', () => {
  assert.strictEqual(isOpus46OrLater('opus-4-7'), true, 'opus-4-7 should be identified as Opus 4.6+');
});

test('isOpus46OrLater still returns true for claude-opus-4-6', () => {
  assert.strictEqual(isOpus46OrLater('claude-opus-4-6'), true, 'claude-opus-4-6 should still be Opus 4.6+');
});

test('isOpus46OrLater returns false for claude-opus-4-5-20251101', () => {
  assert.strictEqual(isOpus46OrLater('claude-opus-4-5-20251101'), false, 'Opus 4.5 should not be Opus 4.6+');
});

// ============================================================
// Section 6: Max Output Tokens for Opus 4.7
// ============================================================
console.log('\n=== 6. Max Output Tokens Tests ===');

test('getMaxOutputTokensForModel returns 128000 for opus (now Opus 4.7)', () => {
  assert.strictEqual(getMaxOutputTokensForModel('opus'), claudeCode.maxOutputTokensOpus46, 'Opus 4.7 should have 128000 max output tokens');
});

test('getMaxOutputTokensForModel returns 128000 for opus-4-7', () => {
  assert.strictEqual(getMaxOutputTokensForModel('opus-4-7'), claudeCode.maxOutputTokensOpus46, 'opus-4-7 should have 128000 max output tokens');
});

test('getMaxOutputTokensForModel returns 128000 for claude-opus-4-7', () => {
  assert.strictEqual(getMaxOutputTokensForModel('claude-opus-4-7'), claudeCode.maxOutputTokensOpus46, 'claude-opus-4-7 should have 128000 max output tokens');
});

// ============================================================
// Section 7: Thinking Budget Tests for Opus 4.7
// ============================================================
console.log('\n=== 7. Thinking Budget Tests ===');

test('getDefaultMaxThinkingBudgetForModel returns 31999 for opus (now Opus 4.7)', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('opus'), 31999, 'Opus 4.7 should have 31999 thinking budget');
});

test('getDefaultMaxThinkingBudgetForModel returns 31999 for opus-4-7', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('opus-4-7'), 31999, 'opus-4-7 should have 31999 thinking budget');
});

// ============================================================
// Section 8: Case Insensitivity Tests
// ============================================================
console.log('\n=== 8. Case Insensitivity Tests ===');

test('validateModelName handles OPUS (uppercase, maps to Opus 4.7)', () => {
  const result = validateModelName('OPUS', 'claude');
  assert(result.valid, `OPUS should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7', 'OPUS should map to claude-opus-4-7');
});

test('validateModelName handles OPUS[1M] (uppercase)', () => {
  const result = validateModelName('OPUS[1M]', 'claude');
  assert(result.valid, `OPUS[1M] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7[1m]', 'OPUS[1M] should map to claude-opus-4-7[1m]');
});

// ============================================================
// Section 9: Available Model Names Tests
// ============================================================
console.log('\n=== 9. Available Model Names Tests ===');

test('getAvailableModelNames includes opus for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('opus'), `opus should be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames includes opus-4-7 for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('opus-4-7'), `opus-4-7 should be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames includes opus-4-6 for backward compatibility', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('opus-4-6'), `opus-4-6 should still be in available model names: ${names.join(', ')}`);
});

// ============================================================
// Section 10: MODELS_SUPPORTING_1M_CONTEXT includes Opus 4.7
// ============================================================
console.log('\n=== 10. 1M Context Support List ===');

test('MODELS_SUPPORTING_1M_CONTEXT includes claude-opus-4-7', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-opus-4-7'), 'claude-opus-4-7 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('MODELS_SUPPORTING_1M_CONTEXT includes opus-4-7', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('opus-4-7'), 'opus-4-7 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('MODELS_SUPPORTING_1M_CONTEXT still includes claude-opus-4-6', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-opus-4-6'), 'claude-opus-4-6 should still be in MODELS_SUPPORTING_1M_CONTEXT');
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
