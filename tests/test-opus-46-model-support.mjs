#!/usr/bin/env node
// Test file for issue #1221: Claude Opus 4.6 model support
// Tests model aliases, [1m] suffix support, and backward compatibility
// Updated for Issue #1329: Sonnet 4.6 support (sonnet alias now maps to Sonnet 4.6)

import assert from 'assert';

// Import the model validation module
const { CLAUDE_MODELS, MODELS_SUPPORTING_1M_CONTEXT, validateModelName, parseModelWith1mSuffix, supports1mContext, getAvailableModelNames } = await import('../src/model-validation.lib.mjs');
const { mapModelToId, availableModels } = await import('../src/claude.lib.mjs');
const { claudeModels } = await import('../src/model-mapping.lib.mjs');
const { isOpus46OrLater, getMaxOutputTokensForModel, getDefaultMaxThinkingBudgetForModel, claudeCode, DEFAULT_MAX_THINKING_BUDGET, DEFAULT_MAX_THINKING_BUDGET_OPUS_46 } = await import('../src/config.lib.mjs');

console.log('Testing Claude Opus 4.5/4.6 Model Support (Issue #1221, Issue #1238)\n');

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
// Section 1: Opus Default Model Tests (Issue #1238: opus -> Opus 4.5)
// ============================================================
console.log('\n=== 1. Opus Default Model Tests (Issue #1238) ===');

test('opus alias maps to claude-opus-4-5-20251101 in CLAUDE_MODELS', () => {
  assert.strictEqual(CLAUDE_MODELS['opus'], 'claude-opus-4-5-20251101', 'opus should map to claude-opus-4-5-20251101');
});

test('opus alias maps to claude-opus-4-5-20251101 in availableModels (claude.lib.mjs)', () => {
  assert.strictEqual(availableModels['opus'], 'claude-opus-4-5-20251101', 'opus should map to claude-opus-4-5-20251101');
});

test('opus alias maps to claude-opus-4-5-20251101 in claudeModels (model-mapping.lib.mjs)', () => {
  assert.strictEqual(claudeModels['opus'], 'claude-opus-4-5-20251101', 'opus should map to claude-opus-4-5-20251101');
});

test('validateModelName accepts opus and maps to claude-opus-4-5-20251101', () => {
  const result = validateModelName('opus', 'claude');
  assert(result.valid, `opus should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101', 'opus should map to claude-opus-4-5-20251101');
});

test('mapModelToId maps opus to claude-opus-4-5-20251101', () => {
  const result = mapModelToId('opus');
  assert.strictEqual(result, 'claude-opus-4-5-20251101', 'mapModelToId should map opus to claude-opus-4-5-20251101');
});

// ============================================================
// Section 2: Direct Model ID Tests
// ============================================================
console.log('\n=== 2. Direct Model ID Tests ===');

test('validateModelName accepts claude-opus-4-6 directly', () => {
  const result = validateModelName('claude-opus-4-6', 'claude');
  assert(result.valid, `claude-opus-4-6 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-6', 'Should map to itself');
});

test('mapModelToId passes through claude-opus-4-6 unchanged', () => {
  const result = mapModelToId('claude-opus-4-6');
  assert.strictEqual(result, 'claude-opus-4-6', 'Full model ID should pass through unchanged');
});

// ============================================================
// Section 3: Backward Compatibility Tests
// ============================================================
console.log('\n=== 3. Backward Compatibility Tests ===');

test('claude-opus-4-5 alias maps to claude-opus-4-5-20251101', () => {
  const result = validateModelName('claude-opus-4-5', 'claude');
  assert(result.valid, `claude-opus-4-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101', 'claude-opus-4-5 should map to claude-opus-4-5-20251101');
});

test('claude-opus-4-5-20251101 (full ID) still works', () => {
  const result = validateModelName('claude-opus-4-5-20251101', 'claude');
  assert(result.valid, `claude-opus-4-5-20251101 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101', 'Should map to itself');
});

test('sonnet alias still works (now maps to Sonnet 4.6, Issue #1329)', () => {
  const result = validateModelName('sonnet', 'claude');
  assert(result.valid, `sonnet should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6', 'sonnet should map to claude-sonnet-4-6');
});

test('haiku alias still works (regression test)', () => {
  const result = validateModelName('haiku', 'claude');
  assert(result.valid, `haiku should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-haiku-4-5-20251001', 'haiku should map correctly');
});

// ============================================================
// Section 4: [1m] Suffix Parsing Tests
// ============================================================
console.log('\n=== 4. [1m] Suffix Parsing Tests ===');

test('parseModelWith1mSuffix extracts base model and suffix for opus[1m]', () => {
  const result = parseModelWith1mSuffix('opus[1m]');
  assert.strictEqual(result.baseModel, 'opus', 'Base model should be opus');
  assert.strictEqual(result.has1mSuffix, true, 'Should have 1m suffix');
});

test('parseModelWith1mSuffix extracts base model and suffix for claude-opus-4-6[1m]', () => {
  const result = parseModelWith1mSuffix('claude-opus-4-6[1m]');
  assert.strictEqual(result.baseModel, 'claude-opus-4-6', 'Base model should be claude-opus-4-6');
  assert.strictEqual(result.has1mSuffix, true, 'Should have 1m suffix');
});

test('parseModelWith1mSuffix handles case-insensitive suffix [1M]', () => {
  const result = parseModelWith1mSuffix('opus[1M]');
  assert.strictEqual(result.baseModel, 'opus', 'Base model should be opus');
  assert.strictEqual(result.has1mSuffix, true, 'Should have 1m suffix');
});

test('parseModelWith1mSuffix returns no suffix for regular model', () => {
  const result = parseModelWith1mSuffix('opus');
  assert.strictEqual(result.baseModel, 'opus', 'Base model should be opus');
  assert.strictEqual(result.has1mSuffix, false, 'Should not have 1m suffix');
});

// ============================================================
// Section 5: [1m] Suffix Validation Tests
// ============================================================
console.log('\n=== 5. [1m] Suffix Validation Tests ===');

test('supports1mContext returns true for opus', () => {
  assert.strictEqual(supports1mContext('opus', 'claude'), true, 'opus should support 1M context');
});

test('supports1mContext returns true for claude-opus-4-6', () => {
  assert.strictEqual(supports1mContext('claude-opus-4-6', 'claude'), true, 'claude-opus-4-6 should support 1M context');
});

test('supports1mContext returns true for sonnet', () => {
  assert.strictEqual(supports1mContext('sonnet', 'claude'), true, 'sonnet should support 1M context');
});

test('supports1mContext returns false for haiku', () => {
  assert.strictEqual(supports1mContext('haiku', 'claude'), false, 'haiku should not support 1M context');
});

test('supports1mContext returns false for non-claude tools', () => {
  assert.strictEqual(supports1mContext('opus', 'opencode'), false, 'Non-claude tools should not support 1M context');
});

// ============================================================
// Section 6: [1m] Suffix with validateModelName Tests
// ============================================================
console.log('\n=== 6. [1m] Suffix with validateModelName Tests ===');

test('validateModelName accepts opus[1m] (now maps to Opus 4.5, Issue #1238)', () => {
  const result = validateModelName('opus[1m]', 'claude');
  assert(result.valid, `opus[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101[1m]', 'Should map to claude-opus-4-5-20251101[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts claude-opus-4-6[1m]', () => {
  const result = validateModelName('claude-opus-4-6[1m]', 'claude');
  assert(result.valid, `claude-opus-4-6[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-6[1m]', 'Should map to claude-opus-4-6[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts sonnet[1m] (now maps to Sonnet 4.6, Issue #1329)', () => {
  const result = validateModelName('sonnet[1m]', 'claude');
  assert(result.valid, `sonnet[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-6[1m]', 'Should map to claude-sonnet-4-6[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName rejects haiku[1m] (unsupported)', () => {
  const result = validateModelName('haiku[1m]', 'claude');
  assert.strictEqual(result.valid, false, 'haiku[1m] should be invalid');
  assert(result.message.includes('does not support [1m]'), `Error should mention 1m not supported: ${result.message}`);
});

// ============================================================
// Section 7: mapModelToId with [1m] Suffix Tests
// ============================================================
console.log('\n=== 7. mapModelToId with [1m] Suffix Tests ===');

test('mapModelToId handles opus[1m] (now maps to Opus 4.5, Issue #1238)', () => {
  const result = mapModelToId('opus[1m]');
  assert.strictEqual(result, 'claude-opus-4-5-20251101[1m]', 'mapModelToId should handle opus[1m]');
});

test('mapModelToId handles claude-opus-4-6[1m]', () => {
  const result = mapModelToId('claude-opus-4-6[1m]');
  assert.strictEqual(result, 'claude-opus-4-6[1m]', 'mapModelToId should handle claude-opus-4-6[1m]');
});

test('mapModelToId handles sonnet[1m] (now maps to Sonnet 4.6, Issue #1329)', () => {
  const result = mapModelToId('sonnet[1m]');
  assert.strictEqual(result, 'claude-sonnet-4-6[1m]', 'mapModelToId should handle sonnet[1m]');
});

// ============================================================
// Section 8: Opus 4.5/4.6 Max Output Tokens Tests (Issue #1238)
// ============================================================
console.log('\n=== 8. Opus 4.5/4.6 Max Output Tokens Tests (Issue #1238) ===');

test('isOpus46OrLater returns false for opus (now maps to Opus 4.5, Issue #1238)', () => {
  assert.strictEqual(isOpus46OrLater('opus'), false, 'opus should NOT be identified as Opus 4.6+ (now Opus 4.5)');
});

test('isOpus46OrLater returns true for claude-opus-4-6', () => {
  assert.strictEqual(isOpus46OrLater('claude-opus-4-6'), true, 'claude-opus-4-6 should be identified as Opus 4.6+');
});

test('isOpus46OrLater returns false for claude-opus-4-5-20251101', () => {
  assert.strictEqual(isOpus46OrLater('claude-opus-4-5-20251101'), false, 'claude-opus-4-5-20251101 should not be Opus 4.6+');
});

test('isOpus46OrLater returns false for sonnet', () => {
  assert.strictEqual(isOpus46OrLater('sonnet'), false, 'sonnet should not be Opus 4.6+');
});

test('getMaxOutputTokensForModel returns 64000 for opus (now Opus 4.5, Issue #1238)', () => {
  assert.strictEqual(getMaxOutputTokensForModel('opus'), 64000, 'Opus 4.5 should have 64K max output tokens');
});

test('getMaxOutputTokensForModel returns 128000 for opus-4-6', () => {
  assert.strictEqual(getMaxOutputTokensForModel('opus-4-6'), 128000, 'opus-4-6 should have 128K max output tokens');
});

test('getMaxOutputTokensForModel returns 128000 for claude-opus-4-6', () => {
  assert.strictEqual(getMaxOutputTokensForModel('claude-opus-4-6'), 128000, 'claude-opus-4-6 should have 128K max output tokens');
});

test('getMaxOutputTokensForModel returns 64000 for sonnet', () => {
  assert.strictEqual(getMaxOutputTokensForModel('sonnet'), 64000, 'Sonnet should have 64K max output tokens');
});

// ============================================================
// Section 9: Opus 4.5/4.6 Thinking Budget Tests (Issue #1238)
// ============================================================
console.log('\n=== 9. Opus 4.5/4.6 Thinking Budget Tests (Issue #1238) ===');

test('DEFAULT_MAX_THINKING_BUDGET_OPUS_46 is 31999 (aligned with standard models, Issue #1238)', () => {
  assert.strictEqual(DEFAULT_MAX_THINKING_BUDGET_OPUS_46, 31999, 'Opus 4.6 default thinking budget should be 31999');
});

test('getDefaultMaxThinkingBudgetForModel returns 31999 for opus (now Opus 4.5, Issue #1238)', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('opus'), 31999, 'Opus 4.5 should have 31999 thinking budget');
});

test('getDefaultMaxThinkingBudgetForModel returns 31999 for opus-4-6 (aligned with standard, Issue #1238)', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('opus-4-6'), 31999, 'Opus 4.6 should have 31999 thinking budget');
});

test('getDefaultMaxThinkingBudgetForModel returns 31999 for sonnet', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('sonnet'), 31999, 'Sonnet should have 31999 thinking budget');
});

// ============================================================
// Section 10: Available Model Names Tests
// ============================================================
console.log('\n=== 10. Available Model Names Tests ===');

test('getAvailableModelNames includes opus for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('opus'), `opus should be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames includes sonnet for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('sonnet'), `sonnet should be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames includes claude-opus-4-5 alias', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('claude-opus-4-5'), `claude-opus-4-5 should be in available model names: ${names.join(', ')}`);
});

// ============================================================
// Section 10b: Shorter Alias Tests (Issue #1221 - PR comment feedback)
// ============================================================
console.log('\n=== 10b. Shorter Alias Tests ===');

test('opus-4-6 alias maps to claude-opus-4-6', () => {
  const result = validateModelName('opus-4-6', 'claude');
  assert(result.valid, `opus-4-6 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-6', 'opus-4-6 should map to claude-opus-4-6');
});

test('opus-4-5 alias maps to claude-opus-4-5-20251101', () => {
  const result = validateModelName('opus-4-5', 'claude');
  assert(result.valid, `opus-4-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101', 'opus-4-5 should map to claude-opus-4-5-20251101');
});

test('sonnet-4-5 alias maps to claude-sonnet-4-5-20250929', () => {
  const result = validateModelName('sonnet-4-5', 'claude');
  assert(result.valid, `sonnet-4-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-5-20250929', 'sonnet-4-5 should map to claude-sonnet-4-5-20250929');
});

test('haiku-4-5 alias maps to claude-haiku-4-5-20251001', () => {
  const result = validateModelName('haiku-4-5', 'claude');
  assert(result.valid, `haiku-4-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-haiku-4-5-20251001', 'haiku-4-5 should map to claude-haiku-4-5-20251001');
});

test('opus-4-6[1m] supports 1M context', () => {
  const result = validateModelName('opus-4-6[1m]', 'claude');
  assert(result.valid, `opus-4-6[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-6[1m]', 'opus-4-6[1m] should map to claude-opus-4-6[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('sonnet-4-5[1m] supports 1M context', () => {
  const result = validateModelName('sonnet-4-5[1m]', 'claude');
  assert(result.valid, `sonnet-4-5[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-4-5-20250929[1m]', 'sonnet-4-5[1m] should map to claude-sonnet-4-5-20250929[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('opus-4-5[1m] supports 1M context (Issue #1238)', () => {
  const result = validateModelName('opus-4-5[1m]', 'claude');
  assert(result.valid, `opus-4-5[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101[1m]', 'opus-4-5[1m] should map to claude-opus-4-5-20251101[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('mapModelToId handles opus-4-6', () => {
  const result = mapModelToId('opus-4-6');
  assert.strictEqual(result, 'claude-opus-4-6', 'mapModelToId should map opus-4-6 to claude-opus-4-6');
});

test('isOpus46OrLater returns true for opus-4-6', () => {
  assert.strictEqual(isOpus46OrLater('opus-4-6'), true, 'opus-4-6 should be identified as Opus 4.6+');
});

test('getMaxOutputTokensForModel returns 128000 for opus-4-6', () => {
  assert.strictEqual(getMaxOutputTokensForModel('opus-4-6'), 128000, 'opus-4-6 should have 128K max output tokens');
});

// ============================================================
// Section 11: Case Insensitivity Tests (Issue #1238)
// ============================================================
console.log('\n=== 11. Case Insensitivity Tests (Issue #1238) ===');

test('validateModelName handles OPUS (uppercase)', () => {
  const result = validateModelName('OPUS', 'claude');
  assert(result.valid, `OPUS should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101', 'OPUS should map to claude-opus-4-5-20251101');
});

test('validateModelName handles OPUS[1M] (uppercase)', () => {
  const result = validateModelName('OPUS[1M]', 'claude');
  assert(result.valid, `OPUS[1M] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-5-20251101[1m]', 'OPUS[1M] should map to claude-opus-4-5-20251101[1m]');
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
