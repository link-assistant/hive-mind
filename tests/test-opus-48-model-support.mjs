#!/usr/bin/env node
// Test file for issue #1832: Claude Opus 4.8 model support
// Tests model aliases, [1m] suffix support, and backward compatibility with Opus 4.7/4.6.

import assert from 'assert';

const { CLAUDE_MODELS, MODELS_SUPPORTING_1M_CONTEXT, validateModelName, supports1mContext, getAvailableModelNames, claudeModels, defaultFallbackModels, resolveDefaultFallbackModel } = await import('../src/models/index.mjs');
const { mapModelToId, availableModels } = await import('../src/claude.lib.mjs');
const { isOpus46OrLater, isOpus47OrLater, isOpus48OrLater, supportsEffortLevel, supportsXHighEffortLevel, supportsMaxEffortLevel, getMaxOutputTokensForModel, getDefaultMaxThinkingBudgetForModel, claudeCode, getClaudeEnv, thinkLevelToEffortLevel, thinkingBudgetToEffortLevel, OPUS_47_EFFORT_LEVELS, OPUS_46_EFFORT_LEVELS, getThinkingLevelToTokens } = await import('../src/config.lib.mjs');

console.log('Testing Claude Opus 4.8 Model Support (Issue #1832)\n');

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
// Section 1: Opus Default Model Tests (Issue #1832: opus -> Opus 4.8)
// ============================================================
console.log('\n=== 1. Opus Default Model Tests (Issue #1832) ===');

test('opus alias maps to claude-opus-4-8 in CLAUDE_MODELS', () => {
  assert.strictEqual(CLAUDE_MODELS['opus'], 'claude-opus-4-8', 'opus should map to claude-opus-4-8');
});

test('opus alias maps to claude-opus-4-8 in availableModels (claude.lib.mjs)', () => {
  assert.strictEqual(availableModels['opus'], 'claude-opus-4-8', 'opus should map to claude-opus-4-8');
});

test('opus alias maps to claude-opus-4-8 in claudeModels (models/index.mjs)', () => {
  assert.strictEqual(claudeModels['opus'], 'claude-opus-4-8', 'opus should map to claude-opus-4-8');
});

test('validateModelName accepts opus and maps to claude-opus-4-8', () => {
  const result = validateModelName('opus', 'claude');
  assert(result.valid, `opus should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-8', 'opus should map to claude-opus-4-8');
});

test('mapModelToId maps opus to claude-opus-4-8', () => {
  const result = mapModelToId('opus');
  assert.strictEqual(result, 'claude-opus-4-8', 'mapModelToId should map opus to claude-opus-4-8');
});

// ============================================================
// Section 2: Opus 4.8 Direct Model ID Tests
// ============================================================
console.log('\n=== 2. Direct Model ID Tests ===');

test('validateModelName accepts claude-opus-4-8 directly', () => {
  const result = validateModelName('claude-opus-4-8', 'claude');
  assert(result.valid, `claude-opus-4-8 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-8', 'Should map to itself');
});

test('mapModelToId passes through claude-opus-4-8 unchanged', () => {
  const result = mapModelToId('claude-opus-4-8');
  assert.strictEqual(result, 'claude-opus-4-8', 'Full model ID should pass through unchanged');
});

test('opus-4-8 alias maps to claude-opus-4-8', () => {
  const result = validateModelName('opus-4-8', 'claude');
  assert(result.valid, `opus-4-8 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-8', 'opus-4-8 should map to claude-opus-4-8');
});

test('mapModelToId handles opus-4-8', () => {
  const result = mapModelToId('opus-4-8');
  assert.strictEqual(result, 'claude-opus-4-8', 'mapModelToId should map opus-4-8 to claude-opus-4-8');
});

// ============================================================
// Section 3: Backward Compatibility Tests (Opus 4.7 / 4.6 / 4.5 still work)
// ============================================================
console.log('\n=== 3. Backward Compatibility Tests ===');

test('opus-4-7 alias still maps to claude-opus-4-7', () => {
  const result = validateModelName('opus-4-7', 'claude');
  assert(result.valid, `opus-4-7 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7', 'opus-4-7 should map to claude-opus-4-7');
});

test('claude-opus-4-7 still works directly', () => {
  const result = validateModelName('claude-opus-4-7', 'claude');
  assert(result.valid, `claude-opus-4-7 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7', 'Should map to itself');
});

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

test('sonnet alias still works (now maps to Sonnet 5, Issue #2003)', () => {
  const result = validateModelName('sonnet', 'claude');
  assert(result.valid, `sonnet should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-5', 'sonnet should map to claude-sonnet-5');
});

test('haiku alias still works', () => {
  const result = validateModelName('haiku', 'claude');
  assert(result.valid, `haiku should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-haiku-4-5-20251001', 'haiku should map correctly');
});

test('opusplan alias still works', () => {
  const result = validateModelName('opusplan', 'claude');
  assert(result.valid, `opusplan should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'opusplan', 'opusplan should map to opusplan');
});

// ============================================================
// Section 4: [1m] Suffix Tests for Opus 4.8
// ============================================================
console.log('\n=== 4. [1m] Suffix Tests for Opus 4.8 ===');

test('supports1mContext returns true for opus (now Opus 4.8)', () => {
  assert.strictEqual(supports1mContext('opus', 'claude'), true, 'opus should support 1M context');
});

test('supports1mContext returns true for claude-opus-4-8', () => {
  assert.strictEqual(supports1mContext('claude-opus-4-8', 'claude'), true, 'claude-opus-4-8 should support 1M context');
});

test('supports1mContext returns true for opus-4-8', () => {
  assert.strictEqual(supports1mContext('opus-4-8', 'claude'), true, 'opus-4-8 should support 1M context');
});

test('supports1mContext still returns true for claude-opus-4-7', () => {
  assert.strictEqual(supports1mContext('claude-opus-4-7', 'claude'), true, 'claude-opus-4-7 should still support 1M context');
});

test('supports1mContext still returns true for claude-opus-4-6', () => {
  assert.strictEqual(supports1mContext('claude-opus-4-6', 'claude'), true, 'claude-opus-4-6 should still support 1M context');
});

test('validateModelName accepts opus[1m] (maps to Opus 4.8)', () => {
  const result = validateModelName('opus[1m]', 'claude');
  assert(result.valid, `opus[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-8[1m]', 'Should map to claude-opus-4-8[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts claude-opus-4-8[1m]', () => {
  const result = validateModelName('claude-opus-4-8[1m]', 'claude');
  assert(result.valid, `claude-opus-4-8[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-8[1m]', 'Should map to claude-opus-4-8[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts opus-4-8[1m]', () => {
  const result = validateModelName('opus-4-8[1m]', 'claude');
  assert(result.valid, `opus-4-8[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-8[1m]', 'Should map to claude-opus-4-8[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('mapModelToId handles opus[1m] (maps to Opus 4.8)', () => {
  const result = mapModelToId('opus[1m]');
  assert.strictEqual(result, 'claude-opus-4-8[1m]', 'mapModelToId should handle opus[1m]');
});

test('mapModelToId handles claude-opus-4-8[1m]', () => {
  const result = mapModelToId('claude-opus-4-8[1m]');
  assert.strictEqual(result, 'claude-opus-4-8[1m]', 'mapModelToId should handle claude-opus-4-8[1m]');
});

// ============================================================
// Section 5: isOpus48OrLater Tests
// ============================================================
console.log('\n=== 5. isOpus48OrLater Tests ===');

test('isOpus48OrLater returns true for opus alias (now Opus 4.8)', () => {
  assert.strictEqual(isOpus48OrLater('opus'), true, 'opus alias should be Opus 4.8+');
});

test('isOpus48OrLater returns true for opusplan', () => {
  assert.strictEqual(isOpus48OrLater('opusplan'), true, 'opusplan should be Opus 4.8+');
});

test('isOpus48OrLater returns true for claude-opus-4-8', () => {
  assert.strictEqual(isOpus48OrLater('claude-opus-4-8'), true, 'claude-opus-4-8 should be Opus 4.8+');
});

test('isOpus48OrLater returns true for opus-4-8', () => {
  assert.strictEqual(isOpus48OrLater('opus-4-8'), true, 'opus-4-8 should be Opus 4.8+');
});

test('isOpus48OrLater returns true for future opus-5', () => {
  assert.strictEqual(isOpus48OrLater('claude-opus-5'), true, 'opus-5 should be Opus 4.8+');
});

test('isOpus48OrLater returns false for claude-opus-4-7', () => {
  assert.strictEqual(isOpus48OrLater('claude-opus-4-7'), false, 'Opus 4.7 should not be Opus 4.8+');
});

test('isOpus48OrLater returns false for opus-4-7', () => {
  assert.strictEqual(isOpus48OrLater('opus-4-7'), false, 'opus-4-7 should not be Opus 4.8+');
});

test('isOpus48OrLater returns false for opus-4-6', () => {
  assert.strictEqual(isOpus48OrLater('opus-4-6'), false, 'opus-4-6 should not be Opus 4.8+');
});

test('isOpus48OrLater returns false for sonnet', () => {
  assert.strictEqual(isOpus48OrLater('sonnet'), false, 'sonnet should not be Opus 4.8+');
});

test('isOpus48OrLater returns false for haiku', () => {
  assert.strictEqual(isOpus48OrLater('haiku'), false, 'haiku should not be Opus 4.8+');
});

test('isOpus48OrLater returns false for null/empty', () => {
  assert.strictEqual(isOpus48OrLater(null), false, 'null should not be Opus 4.8+');
  assert.strictEqual(isOpus48OrLater(''), false, 'empty string should not be Opus 4.8+');
});

// ============================================================
// Section 6: isOpus47OrLater covers Opus 4.8
// ============================================================
console.log('\n=== 6. isOpus47OrLater Covers Opus 4.8 ===');

test('isOpus47OrLater returns true for opus (now Opus 4.8)', () => {
  assert.strictEqual(isOpus47OrLater('opus'), true, 'opus alias should be Opus 4.7+');
});

test('isOpus47OrLater returns true for claude-opus-4-8', () => {
  assert.strictEqual(isOpus47OrLater('claude-opus-4-8'), true, 'Opus 4.8 should be Opus 4.7+');
});

test('isOpus47OrLater returns true for opus-4-8', () => {
  assert.strictEqual(isOpus47OrLater('opus-4-8'), true, 'opus-4-8 should be Opus 4.7+');
});

test('isOpus47OrLater still returns true for claude-opus-4-7', () => {
  assert.strictEqual(isOpus47OrLater('claude-opus-4-7'), true, 'Opus 4.7 should still be Opus 4.7+');
});

test('isOpus47OrLater returns false for opus-4-6', () => {
  assert.strictEqual(isOpus47OrLater('opus-4-6'), false, 'opus-4-6 should not be Opus 4.7+');
});

// ============================================================
// Section 7: isOpus46OrLater covers Opus 4.8
// ============================================================
console.log('\n=== 7. isOpus46OrLater Covers Opus 4.8 ===');

test('isOpus46OrLater returns true for opus (now Opus 4.8)', () => {
  assert.strictEqual(isOpus46OrLater('opus'), true, 'opus should be identified as Opus 4.6+');
});

test('isOpus46OrLater returns true for claude-opus-4-8', () => {
  assert.strictEqual(isOpus46OrLater('claude-opus-4-8'), true, 'claude-opus-4-8 should be identified as Opus 4.6+');
});

test('isOpus46OrLater returns true for opus-4-8', () => {
  assert.strictEqual(isOpus46OrLater('opus-4-8'), true, 'opus-4-8 should be identified as Opus 4.6+');
});

test('isOpus46OrLater still returns true for claude-opus-4-7', () => {
  assert.strictEqual(isOpus46OrLater('claude-opus-4-7'), true, 'claude-opus-4-7 should still be Opus 4.6+');
});

test('isOpus46OrLater still returns true for claude-opus-4-6', () => {
  assert.strictEqual(isOpus46OrLater('claude-opus-4-6'), true, 'claude-opus-4-6 should still be Opus 4.6+');
});

test('isOpus46OrLater returns false for claude-opus-4-5-20251101', () => {
  assert.strictEqual(isOpus46OrLater('claude-opus-4-5-20251101'), false, 'Opus 4.5 should not be Opus 4.6+');
});

// ============================================================
// Section 8: Max Output Tokens for Opus 4.8
// ============================================================
console.log('\n=== 8. Max Output Tokens Tests ===');

test('getMaxOutputTokensForModel returns 128000 for opus (now Opus 4.8)', () => {
  assert.strictEqual(getMaxOutputTokensForModel('opus'), claudeCode.maxOutputTokensOpus46, 'Opus 4.8 should have 128000 max output tokens');
});

test('getMaxOutputTokensForModel returns 128000 for opus-4-8', () => {
  assert.strictEqual(getMaxOutputTokensForModel('opus-4-8'), claudeCode.maxOutputTokensOpus46, 'opus-4-8 should have 128000 max output tokens');
});

test('getMaxOutputTokensForModel returns 128000 for claude-opus-4-8', () => {
  assert.strictEqual(getMaxOutputTokensForModel('claude-opus-4-8'), claudeCode.maxOutputTokensOpus46, 'claude-opus-4-8 should have 128000 max output tokens');
});

// ============================================================
// Section 9: Thinking Budget Tests for Opus 4.8
// ============================================================
console.log('\n=== 9. Thinking Budget Tests ===');

test('getDefaultMaxThinkingBudgetForModel returns 31999 for opus (now Opus 4.8)', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('opus'), 31999, 'Opus 4.8 should have 31999 thinking budget');
});

test('getDefaultMaxThinkingBudgetForModel returns 31999 for opus-4-8', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('opus-4-8'), 31999, 'opus-4-8 should have 31999 thinking budget');
});

test('getDefaultMaxThinkingBudgetForModel returns 31999 for claude-opus-4-8', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('claude-opus-4-8'), 31999, 'claude-opus-4-8 should have 31999 thinking budget');
});

// ============================================================
// Section 10: Case Insensitivity Tests
// ============================================================
console.log('\n=== 10. Case Insensitivity Tests ===');

test('validateModelName handles OPUS (uppercase, maps to Opus 4.8)', () => {
  const result = validateModelName('OPUS', 'claude');
  assert(result.valid, `OPUS should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-8', 'OPUS should map to claude-opus-4-8');
});

test('validateModelName handles OPUS[1M] (uppercase)', () => {
  const result = validateModelName('OPUS[1M]', 'claude');
  assert(result.valid, `OPUS[1M] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-8[1m]', 'OPUS[1M] should map to claude-opus-4-8[1m]');
});

test('validateModelName handles CLAUDE-OPUS-4-8 (uppercase full ID)', () => {
  const result = validateModelName('CLAUDE-OPUS-4-8', 'claude');
  assert(result.valid, `CLAUDE-OPUS-4-8 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-8', 'Uppercase full ID should map correctly');
});

// ============================================================
// Section 11: Available Model Names Tests
// ============================================================
console.log('\n=== 11. Available Model Names Tests ===');

test('getAvailableModelNames includes opus for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('opus'), `opus should be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames includes opus-4-8 for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('opus-4-8'), `opus-4-8 should be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames includes opus-4-7 for backward compatibility', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('opus-4-7'), `opus-4-7 should still be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames includes opus-4-6 for backward compatibility', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('opus-4-6'), `opus-4-6 should still be in available model names: ${names.join(', ')}`);
});

// ============================================================
// Section 12: MODELS_SUPPORTING_1M_CONTEXT includes Opus 4.8
// ============================================================
console.log('\n=== 12. 1M Context Support List ===');

test('MODELS_SUPPORTING_1M_CONTEXT includes claude-opus-4-8', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-opus-4-8'), 'claude-opus-4-8 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('MODELS_SUPPORTING_1M_CONTEXT includes opus-4-8', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('opus-4-8'), 'opus-4-8 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('MODELS_SUPPORTING_1M_CONTEXT still includes claude-opus-4-7', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-opus-4-7'), 'claude-opus-4-7 should still be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('MODELS_SUPPORTING_1M_CONTEXT still includes claude-opus-4-6', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-opus-4-6'), 'claude-opus-4-6 should still be in MODELS_SUPPORTING_1M_CONTEXT');
});

// ============================================================
// Section 13: Effort Level for Opus 4.8 (xhigh / max support inherited from 4.7)
// ============================================================
console.log('\n=== 13. Effort Level Tests for Opus 4.8 ===');

test('OPUS_47_EFFORT_LEVELS includes xhigh (shared with Opus 4.8)', () => {
  assert(OPUS_47_EFFORT_LEVELS.includes('xhigh'), 'Effort levels list should include xhigh');
});

test('OPUS_47_EFFORT_LEVELS has correct levels', () => {
  assert.deepStrictEqual(OPUS_47_EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max'], 'Opus 4.7/4.8 effort levels should be low/medium/high/xhigh/max');
});

test('supportsEffortLevel returns true for opus (now Opus 4.8)', () => {
  assert.strictEqual(supportsEffortLevel('opus'), true, 'Opus 4.8 alias supports effort levels');
});

test('supportsEffortLevel returns true for claude-opus-4-8', () => {
  assert.strictEqual(supportsEffortLevel('claude-opus-4-8'), true, 'Opus 4.8 supports effort levels');
});

test('supportsXHighEffortLevel returns true for opus (now Opus 4.8)', () => {
  assert.strictEqual(supportsXHighEffortLevel('opus'), true, 'opus alias should support native xhigh');
});

test('supportsXHighEffortLevel returns true for claude-opus-4-8', () => {
  assert.strictEqual(supportsXHighEffortLevel('claude-opus-4-8'), true, 'Opus 4.8 should support native xhigh');
});

test('supportsXHighEffortLevel returns true for opus-4-8', () => {
  assert.strictEqual(supportsXHighEffortLevel('opus-4-8'), true, 'opus-4-8 should support native xhigh');
});

test('supportsXHighEffortLevel returns true for claude-opus-4-7 (backward compat)', () => {
  assert.strictEqual(supportsXHighEffortLevel('claude-opus-4-7'), true, 'Opus 4.7 should still support native xhigh');
});

test('supportsXHighEffortLevel returns false for opus-4-6', () => {
  assert.strictEqual(supportsXHighEffortLevel('opus-4-6'), false, 'Opus 4.6 should not support native xhigh');
});

test('supportsXHighEffortLevel returns true for sonnet (now Sonnet 5, Issue #2003)', () => {
  assert.strictEqual(supportsXHighEffortLevel('sonnet'), true, 'Sonnet 5 should support native xhigh');
  assert.strictEqual(supportsXHighEffortLevel('sonnet-4-6'), false, 'Sonnet 4.6 should not support native xhigh');
});

test('supportsMaxEffortLevel returns true for claude-opus-4-8', () => {
  assert.strictEqual(supportsMaxEffortLevel('claude-opus-4-8'), true, 'Opus 4.8 should support max effort');
});

test('thinkLevelToEffortLevel maps xhigh to xhigh for Opus 4.8', () => {
  assert.strictEqual(thinkLevelToEffortLevel('xhigh', { supportsXHigh: true }), 'xhigh', 'xhigh should map to xhigh for Opus 4.8');
});

test('thinkLevelToEffortLevel maps max to max for Opus 4.8', () => {
  assert.strictEqual(thinkLevelToEffortLevel('max', { supportsXHigh: true, supportsMax: true }), 'max', 'max should stay max for Opus 4.8');
});

test('thinkLevelToEffortLevel maps ultra to max for Opus 4.8 (ultracode-class deepest tier)', () => {
  // Issue #2027: ultra is the ultracode-class deepest effort; on Claude it maps to the max effort level.
  assert.strictEqual(thinkLevelToEffortLevel('ultra', { supportsXHigh: true, supportsMax: true }), 'max', 'ultra should map to max for Opus 4.8');
});

test('thinkLevelToEffortLevel maps ultra to xhigh when max is unsupported but xhigh is', () => {
  assert.strictEqual(thinkLevelToEffortLevel('ultra', { supportsXHigh: true, supportsMax: false }), 'xhigh', 'ultra should degrade to xhigh when max is unavailable');
});

// ============================================================
// Section 14: getClaudeEnv for Opus 4.8 (adaptive thinking inherited from 4.7)
// ============================================================
console.log('\n=== 14. getClaudeEnv Tests for Opus 4.8 ===');

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for Opus 4.8 (via opus alias)', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'high' });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'MAX_THINKING_TOKENS should not be set for Opus 4.8');
});

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for Opus 4.8 (explicit opus-4-8)', () => {
  const env = getClaudeEnv({ model: 'opus-4-8', thinkLevel: 'high' });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'MAX_THINKING_TOKENS should not be set for Opus 4.8');
});

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for Opus 4.8 (full id claude-opus-4-8)', () => {
  const env = getClaudeEnv({ model: 'claude-opus-4-8', thinkLevel: 'high' });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'MAX_THINKING_TOKENS should not be set for Opus 4.8');
});

test('getClaudeEnv DOES set MAX_THINKING_TOKENS for Opus 4.6', () => {
  const env = getClaudeEnv({ model: 'opus-4-6', thinkingBudget: 16000 });
  assert.strictEqual(env.MAX_THINKING_TOKENS, '16000', 'MAX_THINKING_TOKENS should be set for Opus 4.6');
});

test('getClaudeEnv DOES set MAX_THINKING_TOKENS for Sonnet 4.6', () => {
  const env = getClaudeEnv({ model: 'sonnet-4-6', thinkingBudget: 8000 });
  assert.strictEqual(env.MAX_THINKING_TOKENS, '8000', 'MAX_THINKING_TOKENS should be set for Sonnet 4.6');
});

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for Sonnet (now Sonnet 5, adaptive-only, Issue #2003)', () => {
  const env = getClaudeEnv({ model: 'sonnet', thinkingBudget: 8000 });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'Sonnet 5 is adaptive-thinking-only; MAX_THINKING_TOKENS should not be set');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=max for Opus 4.8 with max think', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'max' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'max', 'Opus 4.8 with max should get max effort');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=xhigh for Opus 4.8 with xhigh think', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'xhigh' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'xhigh', 'Opus 4.8 with xhigh should get xhigh effort');
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'No MAX_THINKING_TOKENS for Opus 4.8');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=high for Opus 4.8 with high think', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'high' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'high', 'Opus 4.8 with high should get high effort');
});

test('getClaudeEnv sets the lowest effort for Opus 4.8 with off think', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'off' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'low', 'Adaptive Opus 4.8 uses its lowest effort when thinking is off');
});

test('getClaudeEnv: explicit claude-opus-4-8 + xhigh -> effort=xhigh, no MAX_THINKING_TOKENS', () => {
  const env = getClaudeEnv({ model: 'claude-opus-4-8', thinkLevel: 'xhigh' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'xhigh');
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined);
});

// ============================================================
// Section 15: --show-thinking-content Tests (carried over from 4.7)
// ============================================================
console.log('\n=== 15. --show-thinking-content Tests ===');

test('getClaudeEnv sets CLAUDE_CODE_SHOW_THINKING when showThinkingContent is true (Opus 4.8)', () => {
  const env = getClaudeEnv({ model: 'opus', showThinkingContent: true });
  assert.strictEqual(env.CLAUDE_CODE_SHOW_THINKING, '1', 'CLAUDE_CODE_SHOW_THINKING should be 1');
});

test('getClaudeEnv does not set CLAUDE_CODE_SHOW_THINKING when showThinkingContent is false (Opus 4.8)', () => {
  const env = getClaudeEnv({ model: 'opus', showThinkingContent: false });
  assert.strictEqual(env.CLAUDE_CODE_SHOW_THINKING, undefined, 'CLAUDE_CODE_SHOW_THINKING should not be set');
});

test('getClaudeEnv does not set CLAUDE_CODE_SHOW_THINKING by default (Opus 4.8)', () => {
  const env = getClaudeEnv({ model: 'opus' });
  assert.strictEqual(env.CLAUDE_CODE_SHOW_THINKING, undefined, 'CLAUDE_CODE_SHOW_THINKING should not be set by default');
});

// ============================================================
// Section 16: --thinking-budget cross-model effort mapping (Opus 4.8)
// ============================================================
console.log('\n=== 16. --thinking-budget Cross-Model Effort Mapping ===');

test('thinkingBudgetToEffortLevel: low budget -> low effort for Opus 4.8', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(8000, 31999, { supportsXHigh: true, supportsMax: true }), 'low');
});

test('thinkingBudgetToEffortLevel: medium budget -> medium effort for Opus 4.8', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(16000, 31999, { supportsXHigh: true, supportsMax: true }), 'medium');
});

test('thinkingBudgetToEffortLevel: high budget -> high effort for Opus 4.8', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(24000, 31999, { supportsXHigh: true, supportsMax: true }), 'high');
});

test('thinkingBudgetToEffortLevel: full budget -> max effort for Opus 4.8', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(31999, 31999, { supportsXHigh: true, supportsMax: true }), 'max');
});

test('getClaudeEnv: --thinking-budget 31999 -> effort=max for Opus 4.8', () => {
  const env = getClaudeEnv({ model: 'opus', thinkingBudget: 31999 });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'max');
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined);
});

test('getClaudeEnv: --thinking-budget 16000 -> effort=medium for Opus 4.8 (no MAX_THINKING_TOKENS)', () => {
  const env = getClaudeEnv({ model: 'claude-opus-4-8', thinkingBudget: 16000 });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'medium');
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined);
});

// ============================================================
// Section 17: Default Fallback Models (Opus 4.8 -> Opus 4.7)
// ============================================================
console.log('\n=== 17. Default Fallback Models ===');

test('defaultFallbackModels.claude maps claude-opus-4-8 -> opus-4-7', () => {
  assert.strictEqual(defaultFallbackModels.claude['claude-opus-4-8'], 'opus-4-7', 'Opus 4.8 should fall back to Opus 4.7');
});

test('defaultFallbackModels.claude still maps claude-opus-4-7 -> opus-4-6', () => {
  assert.strictEqual(defaultFallbackModels.claude['claude-opus-4-7'], 'opus-4-6', 'Opus 4.7 should still fall back to Opus 4.6');
});

test('resolveDefaultFallbackModel returns opus-4-7 for opus alias', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'opus'), 'opus-4-7', 'opus alias should resolve fallback to opus-4-7');
});

test('resolveDefaultFallbackModel returns opus-4-7 for opus-4-8 alias', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'opus-4-8'), 'opus-4-7', 'opus-4-8 should resolve fallback to opus-4-7');
});

test('resolveDefaultFallbackModel returns opus-4-7 for claude-opus-4-8 full id', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'claude-opus-4-8'), 'opus-4-7', 'claude-opus-4-8 should resolve fallback to opus-4-7');
});

test('resolveDefaultFallbackModel returns opus-4-6 for opus-4-7 alias (backward compat)', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'opus-4-7'), 'opus-4-6', 'opus-4-7 should still resolve fallback to opus-4-6');
});

// ============================================================
// Section 18: Bidirectional --think <-> --thinking-budget conversion (unchanged from 4.7)
// ============================================================
console.log('\n=== 18. Bidirectional --think <-> --thinking-budget Conversion ===');

test('getThinkingLevelToTokens: all levels produce expected tokens', () => {
  const tokens = getThinkingLevelToTokens(31999);
  assert.strictEqual(tokens.off, 0);
  assert.strictEqual(tokens.low, 7999);
  assert.strictEqual(tokens.medium, 15999);
  assert.strictEqual(tokens.high, 23999);
  assert.strictEqual(tokens.xhigh, 31999);
  assert.strictEqual(tokens.ultra, 31999);
  assert.strictEqual(tokens.max, 31999);
});

// ============================================================
// Section 19: Effort Level Constants and Opus 4.6 backward compatibility
// ============================================================
console.log('\n=== 19. Effort Level Constants ===');

test('OPUS_46_EFFORT_LEVELS has correct values (unchanged)', () => {
  assert.deepStrictEqual(OPUS_46_EFFORT_LEVELS, ['low', 'medium', 'high', 'max']);
});

test('OPUS_47_EFFORT_LEVELS has correct values including xhigh (shared with 4.8)', () => {
  assert.deepStrictEqual(OPUS_47_EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('supportsEffortLevel returns true for Opus 4.5', () => {
  assert.strictEqual(supportsEffortLevel('claude-opus-4-5-20251101'), true, 'Opus 4.5 supports effort');
});

// ============================================================
// Section 20: getClaudeEnv cross-model think level matrix (Opus 4.8 row)
// ============================================================
console.log('\n=== 20. getClaudeEnv Cross-Model Think Level Matrix ===');

const thinkLevels = ['off', 'low', 'medium', 'high', 'xhigh', 'ultra', 'max'];
const testModels = [
  { name: 'opus (4.8)', alias: 'opus', adaptive: true, supportsEffort: true, supportsXHigh: true, supportsMax: true },
  { name: 'claude-opus-4-8', alias: 'claude-opus-4-8', adaptive: true, supportsEffort: true, supportsXHigh: true, supportsMax: true },
  { name: 'opus-4-7', alias: 'opus-4-7', adaptive: true, supportsEffort: true, supportsXHigh: true, supportsMax: true },
  { name: 'opus-4-6', alias: 'opus-4-6', adaptive: false, supportsEffort: true, supportsXHigh: false, supportsMax: true },
  { name: 'sonnet (5)', alias: 'sonnet', adaptive: true, supportsEffort: true, supportsXHigh: true, supportsMax: true },
  { name: 'sonnet-4-6', alias: 'sonnet-4-6', adaptive: false, supportsEffort: true, supportsXHigh: false, supportsMax: true },
  { name: 'haiku (4.5)', alias: 'haiku', adaptive: false, supportsEffort: false, supportsXHigh: false, supportsMax: false },
];

for (const model of testModels) {
  for (const level of thinkLevels) {
    const tokens = getThinkingLevelToTokens(31999);
    const budget = tokens[level];
    const env = getClaudeEnv({ model: model.alias, thinkLevel: level, thinkingBudget: budget });

    if (model.adaptive) {
      test(`${model.name} + --think ${level}: no MAX_THINKING_TOKENS`, () => {
        assert.strictEqual(env.MAX_THINKING_TOKENS, undefined);
      });
    } else {
      test(`${model.name} + --think ${level}: MAX_THINKING_TOKENS=${budget}`, () => {
        assert.strictEqual(env.MAX_THINKING_TOKENS, String(budget));
      });
    }

    if (level === 'off') {
      test(`${model.name} + --think off: lowest effort when adaptive`, () => {
        assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, model.adaptive ? 'low' : undefined);
      });
    } else if (model.supportsEffort) {
      const expectedEffort = level === 'xhigh' ? (model.supportsXHigh ? 'xhigh' : model.supportsMax ? 'max' : 'high') : level === 'ultra' ? (model.supportsMax ? 'max' : model.supportsXHigh ? 'xhigh' : 'high') : level === 'max' ? (model.supportsMax ? 'max' : 'high') : level;
      test(`${model.name} + --think ${level}: effort=${expectedEffort}`, () => {
        assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, expectedEffort);
      });
    }
  }
}

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
