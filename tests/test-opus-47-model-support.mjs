#!/usr/bin/env node
// Test file for issue #1620: Claude Opus 4.7 model support
// Tests model aliases, [1m] suffix support, and backward compatibility with Opus 4.6

import assert from 'assert';

const { CLAUDE_MODELS, MODELS_SUPPORTING_1M_CONTEXT, validateModelName, parseModelWith1mSuffix, supports1mContext, getAvailableModelNames, claudeModels } = await import('../src/models/index.mjs');
const { mapModelToId, availableModels } = await import('../src/claude.lib.mjs');
const { isOpus46OrLater, isOpus47OrLater, supportsEffortLevel, supportsXHighEffortLevel, getMaxOutputTokensForModel, getDefaultMaxThinkingBudgetForModel, claudeCode, DEFAULT_MAX_THINKING_BUDGET_OPUS_46, getClaudeEnv, thinkLevelToEffortLevel, thinkingBudgetToEffortLevel, OPUS_47_EFFORT_LEVELS, OPUS_46_EFFORT_LEVELS, getThinkingLevelToTokens, getTokensToThinkingLevel } = await import('../src/config.lib.mjs');

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
// Section 1: Opus 4.7 Backward-Compat Tests (Issue #1620)
// Note: As of Issue #1832, the bare `opus` alias now points to Opus 4.8.
// Opus 4.7 must remain reachable via the explicit `opus-4-7` / `claude-opus-4-7` aliases.
// ============================================================
console.log('\n=== 1. Opus 4.7 Backward-Compat Tests ===');

test('opus-4-7 alias maps to claude-opus-4-7 in CLAUDE_MODELS', () => {
  assert.strictEqual(CLAUDE_MODELS['opus-4-7'], 'claude-opus-4-7', 'opus-4-7 should map to claude-opus-4-7');
});

test('opus-4-7 alias maps to claude-opus-4-7 in availableModels (claude.lib.mjs)', () => {
  assert.strictEqual(availableModels['opus-4-7'], 'claude-opus-4-7', 'opus-4-7 should map to claude-opus-4-7');
});

test('opus-4-7 alias maps to claude-opus-4-7 in claudeModels (models/index.mjs)', () => {
  assert.strictEqual(claudeModels['opus-4-7'], 'claude-opus-4-7', 'opus-4-7 should map to claude-opus-4-7');
});

test('validateModelName accepts opus-4-7 and maps to claude-opus-4-7', () => {
  const result = validateModelName('opus-4-7', 'claude');
  assert(result.valid, `opus-4-7 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7', 'opus-4-7 should map to claude-opus-4-7');
});

test('mapModelToId maps opus-4-7 to claude-opus-4-7', () => {
  const result = mapModelToId('opus-4-7');
  assert.strictEqual(result, 'claude-opus-4-7', 'mapModelToId should map opus-4-7 to claude-opus-4-7');
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

// ============================================================
// Section 4: [1m] Suffix Tests for Opus 4.7
// ============================================================
console.log('\n=== 4. [1m] Suffix Tests for Opus 4.7 ===');

test('supports1mContext returns true for opus (now Opus 4.8, still 1M-capable)', () => {
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

test('mapModelToId handles claude-opus-4-7[1m]', () => {
  const result = mapModelToId('claude-opus-4-7[1m]');
  assert.strictEqual(result, 'claude-opus-4-7[1m]', 'mapModelToId should handle claude-opus-4-7[1m]');
});

// ============================================================
// Section 5: isOpus46OrLater Tests for Opus 4.7
// ============================================================
console.log('\n=== 5. isOpus46OrLater Tests for Opus 4.7 ===');

test('isOpus46OrLater returns true for opus (now Opus 4.8, still 4.6+)', () => {
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

test('getMaxOutputTokensForModel returns 128000 for opus (now Opus 4.8, same 128K)', () => {
  assert.strictEqual(getMaxOutputTokensForModel('opus'), claudeCode.maxOutputTokensOpus46, 'opus alias should have 128000 max output tokens');
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

test('getDefaultMaxThinkingBudgetForModel returns 31999 for opus (now Opus 4.8, same budget)', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('opus'), 31999, 'opus alias should have 31999 thinking budget');
});

test('getDefaultMaxThinkingBudgetForModel returns 31999 for opus-4-7', () => {
  assert.strictEqual(getDefaultMaxThinkingBudgetForModel('opus-4-7'), 31999, 'opus-4-7 should have 31999 thinking budget');
});

// ============================================================
// Section 8: Case Insensitivity Tests
// ============================================================
console.log('\n=== 8. Case Insensitivity Tests ===');

test('validateModelName handles OPUS-4-7 uppercase explicit alias', () => {
  const result = validateModelName('OPUS-4-7', 'claude');
  assert(result.valid, `OPUS-4-7 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7', 'OPUS-4-7 should map to claude-opus-4-7');
});

test('validateModelName handles OPUS-4-7[1M] uppercase explicit alias', () => {
  const result = validateModelName('OPUS-4-7[1M]', 'claude');
  assert(result.valid, `OPUS-4-7[1M] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-7[1m]', 'OPUS-4-7[1M] should map to claude-opus-4-7[1m]');
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
// Section 11: isOpus47OrLater Tests (Issue #1620)
// ============================================================
console.log('\n=== 11. isOpus47OrLater Tests ===');

test('isOpus47OrLater returns true for opus', () => {
  assert.strictEqual(isOpus47OrLater('opus'), true, 'opus alias should be Opus 4.7+');
});

test('isOpus47OrLater returns true for opusplan', () => {
  assert.strictEqual(isOpus47OrLater('opusplan'), true, 'opusplan should be Opus 4.7+');
});

test('isOpus47OrLater returns true for claude-opus-4-7', () => {
  assert.strictEqual(isOpus47OrLater('claude-opus-4-7'), true, 'claude-opus-4-7 should be Opus 4.7+');
});

test('isOpus47OrLater returns true for opus-4-7', () => {
  assert.strictEqual(isOpus47OrLater('opus-4-7'), true, 'opus-4-7 should be Opus 4.7+');
});

test('isOpus47OrLater returns false for claude-opus-4-6', () => {
  assert.strictEqual(isOpus47OrLater('claude-opus-4-6'), false, 'Opus 4.6 should not be Opus 4.7+');
});

test('isOpus47OrLater returns false for opus-4-6', () => {
  assert.strictEqual(isOpus47OrLater('opus-4-6'), false, 'opus-4-6 should not be Opus 4.7+');
});

test('isOpus47OrLater returns false for sonnet', () => {
  assert.strictEqual(isOpus47OrLater('sonnet'), false, 'sonnet should not be Opus 4.7+');
});

test('isOpus47OrLater returns false for haiku', () => {
  assert.strictEqual(isOpus47OrLater('haiku'), false, 'haiku should not be Opus 4.7+');
});

test('isOpus47OrLater returns true for future opus-5', () => {
  assert.strictEqual(isOpus47OrLater('claude-opus-5'), true, 'opus-5 should be Opus 4.7+');
});

// ============================================================
// Section 12: Effort Level for Opus 4.7 (xhigh support)
// ============================================================
console.log('\n=== 12. Effort Level Tests for Opus 4.7 ===');

test('OPUS_47_EFFORT_LEVELS includes xhigh', () => {
  assert(OPUS_47_EFFORT_LEVELS.includes('xhigh'), 'Opus 4.7 effort levels should include xhigh');
});

test('OPUS_47_EFFORT_LEVELS has correct levels', () => {
  assert.deepStrictEqual(OPUS_47_EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max'], 'Opus 4.7 effort levels should be low/medium/high/xhigh/max');
});

test('thinkLevelToEffortLevel maps max to max for Opus 4.7', () => {
  assert.strictEqual(thinkLevelToEffortLevel('max', { isOpus47: true }), 'max', 'max should stay max for Opus 4.7');
});

test('thinkLevelToEffortLevel maps max to max for Opus 4.6', () => {
  assert.strictEqual(thinkLevelToEffortLevel('max', { supportsMax: true }), 'max', 'max should stay max for Opus 4.6');
});

test('thinkLevelToEffortLevel maps max to max without options', () => {
  assert.strictEqual(thinkLevelToEffortLevel('max'), 'max', 'max should stay max by default');
});

test('thinkLevelToEffortLevel maps high to high for Opus 4.7', () => {
  assert.strictEqual(thinkLevelToEffortLevel('high', { isOpus47: true }), 'high', 'high should remain high for Opus 4.7');
});

test('thinkLevelToEffortLevel maps low to low for Opus 4.7', () => {
  assert.strictEqual(thinkLevelToEffortLevel('low', { isOpus47: true }), 'low', 'low should remain low for Opus 4.7');
});

test('thinkLevelToEffortLevel returns undefined for off', () => {
  assert.strictEqual(thinkLevelToEffortLevel('off', { isOpus47: true }), undefined, 'off should return undefined');
});

test('thinkingBudgetToEffortLevel maps max budget to max for Opus 4.7', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(31999, 31999, { isOpus47: true }), 'max', 'max budget should map to max for Opus 4.7');
});

test('thinkingBudgetToEffortLevel maps max budget to max for Opus 4.6', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(31999, 31999, { supportsMax: true }), 'max', 'max budget should map to max for Opus 4.6');
});

// ============================================================
// Section 13: getClaudeEnv for Opus 4.7 (adaptive thinking)
// ============================================================
console.log('\n=== 13. getClaudeEnv Tests for Opus 4.7 ===');

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for Opus 4.7', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'high' });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'MAX_THINKING_TOKENS should not be set for Opus 4.7');
});

test('getClaudeEnv DOES set MAX_THINKING_TOKENS for Opus 4.6', () => {
  const env = getClaudeEnv({ model: 'opus-4-6', thinkingBudget: 16000 });
  assert.strictEqual(env.MAX_THINKING_TOKENS, '16000', 'MAX_THINKING_TOKENS should be set for Opus 4.6');
});

test('getClaudeEnv DOES set MAX_THINKING_TOKENS for Sonnet 4.6', () => {
  const env = getClaudeEnv({ model: 'sonnet-4-6', thinkingBudget: 8000 });
  assert.strictEqual(env.MAX_THINKING_TOKENS, '8000', 'MAX_THINKING_TOKENS should be set for Sonnet 4.6');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=max for Opus 4.7 with max think', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'max' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'max', 'Opus 4.7 with max should get max effort');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=max for Opus 4.6 with max think', () => {
  const env = getClaudeEnv({ model: 'opus-4-6', thinkLevel: 'max' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'max', 'Opus 4.6 with max should get max effort');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=high for Opus 4.7 with high think', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'high' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'high', 'Opus 4.7 with high should get high effort');
});

test('getClaudeEnv sets the lowest effort for Opus 4.7 with off think', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'off' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'low', 'Adaptive Opus 4.7 uses its lowest effort when thinking is off');
});

// ============================================================
// Section 14: --show-thinking-content Tests
// ============================================================
console.log('\n=== 14. --show-thinking-content Tests ===');

test('getClaudeEnv sets CLAUDE_CODE_SHOW_THINKING when showThinkingContent is true', () => {
  const env = getClaudeEnv({ model: 'opus', showThinkingContent: true });
  assert.strictEqual(env.CLAUDE_CODE_SHOW_THINKING, '1', 'CLAUDE_CODE_SHOW_THINKING should be 1');
});

test('getClaudeEnv does not set CLAUDE_CODE_SHOW_THINKING when showThinkingContent is false', () => {
  const env = getClaudeEnv({ model: 'opus', showThinkingContent: false });
  assert.strictEqual(env.CLAUDE_CODE_SHOW_THINKING, undefined, 'CLAUDE_CODE_SHOW_THINKING should not be set');
});

test('getClaudeEnv does not set CLAUDE_CODE_SHOW_THINKING by default', () => {
  const env = getClaudeEnv({ model: 'opus' });
  assert.strictEqual(env.CLAUDE_CODE_SHOW_THINKING, undefined, 'CLAUDE_CODE_SHOW_THINKING should not be set by default');
});

// ============================================================
// Section 15: --think xhigh explicit support
// ============================================================
console.log('\n=== 15. --think xhigh Explicit Support ===');

test('thinkLevelToEffortLevel maps xhigh to xhigh for Opus 4.7', () => {
  assert.strictEqual(thinkLevelToEffortLevel('xhigh', { isOpus47: true }), 'xhigh', 'xhigh should map to xhigh for Opus 4.7');
});

test('thinkLevelToEffortLevel maps xhigh to max for Opus 4.6', () => {
  assert.strictEqual(thinkLevelToEffortLevel('xhigh', { supportsMax: true }), 'max', 'xhigh should degrade to max for Opus 4.6');
});

test('thinkLevelToEffortLevel maps xhigh to max without options', () => {
  assert.strictEqual(thinkLevelToEffortLevel('xhigh'), 'max', 'xhigh should degrade to max by default');
});

test('getThinkingLevelToTokens includes xhigh key', () => {
  const tokens = getThinkingLevelToTokens(31999);
  assert.strictEqual(tokens.xhigh, 31999, 'xhigh should map to full budget');
});

test('getClaudeEnv sets effort=xhigh for Opus 4.7 with --think xhigh', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'xhigh' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'xhigh', 'Opus 4.7 with xhigh should get xhigh effort');
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'No MAX_THINKING_TOKENS for Opus 4.7');
});

test('getClaudeEnv sets effort=max for Opus 4.6 with --think xhigh', () => {
  const env = getClaudeEnv({ model: 'opus-4-6', thinkLevel: 'xhigh' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'max', 'Opus 4.6 with xhigh should degrade to max effort');
});

test('getClaudeEnv sets MAX_THINKING_TOKENS=31999 for Sonnet 4.6 with --think xhigh', () => {
  const env = getClaudeEnv({ model: 'sonnet-4-6', thinkLevel: 'xhigh', thinkingBudget: 31999 });
  assert.strictEqual(env.MAX_THINKING_TOKENS, '31999', 'Sonnet 4.6 should get full thinking budget for xhigh');
});

// ============================================================
// Section 16: --thinking-budget cross-model effort mapping
// ============================================================
console.log('\n=== 16. --thinking-budget Cross-Model Effort Mapping ===');

test('thinkingBudgetToEffortLevel: low budget → low effort for Opus 4.7', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(8000, 31999, { isOpus47: true }), 'low');
});

test('thinkingBudgetToEffortLevel: medium budget → medium effort for Opus 4.7', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(16000, 31999, { isOpus47: true }), 'medium');
});

test('thinkingBudgetToEffortLevel: high budget → high effort for Opus 4.7', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(24000, 31999, { isOpus47: true }), 'high');
});

test('thinkingBudgetToEffortLevel: full budget -> max effort for Opus 4.7', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(31999, 31999, { isOpus47: true }), 'max');
});

test('thinkingBudgetToEffortLevel: full budget -> max effort for Opus 4.6', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(31999, 31999, { supportsMax: true }), 'max');
});

test('thinkingBudgetToEffortLevel: zero budget → undefined (off)', () => {
  assert.strictEqual(thinkingBudgetToEffortLevel(0, 31999, { isOpus47: true }), undefined);
});

test('getClaudeEnv: --thinking-budget 31999 -> effort=max for Opus 4.7', () => {
  const env = getClaudeEnv({ model: 'opus', thinkingBudget: 31999 });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'max');
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined);
});

test('getClaudeEnv: --thinking-budget 31999 -> effort=max + MAX_THINKING_TOKENS=31999 for Opus 4.6', () => {
  const env = getClaudeEnv({ model: 'opus-4-6', thinkingBudget: 31999 });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'max');
  assert.strictEqual(env.MAX_THINKING_TOKENS, '31999');
});

test('getClaudeEnv: --thinking-budget 16000 → effort=medium + MAX_THINKING_TOKENS=16000 for Sonnet 4.6', () => {
  const env = getClaudeEnv({ model: 'sonnet-4-6', thinkingBudget: 16000, maxBudget: 31999 });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'medium', 'Sonnet 4.6 should get effort level');
  assert.strictEqual(env.MAX_THINKING_TOKENS, '16000');
});

test('getClaudeEnv: --thinking-budget 8000 → MAX_THINKING_TOKENS=8000 for Haiku 4.5 (no effort level)', () => {
  const env = getClaudeEnv({ model: 'haiku', thinkingBudget: 8000 });
  assert.strictEqual(env.MAX_THINKING_TOKENS, '8000');
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, undefined, 'Haiku should not get effort level');
});

// ============================================================
// Section 17: Bidirectional --think ↔ --thinking-budget conversion
// ============================================================
console.log('\n=== 17. Bidirectional --think ↔ --thinking-budget Conversion ===');

test('getThinkingLevelToTokens: all levels produce expected tokens', () => {
  const tokens = getThinkingLevelToTokens(31999);
  assert.strictEqual(tokens.off, 0);
  assert.strictEqual(tokens.low, 7999);
  assert.strictEqual(tokens.medium, 15999);
  assert.strictEqual(tokens.high, 23999);
  assert.strictEqual(tokens.xhigh, 31999);
  assert.strictEqual(tokens.max, 31999);
});

test('getTokensToThinkingLevel: roundtrip off', () => {
  const toLevel = getTokensToThinkingLevel(31999);
  assert.strictEqual(toLevel(0), 'off');
});

test('getTokensToThinkingLevel: roundtrip low', () => {
  const toLevel = getTokensToThinkingLevel(31999);
  assert.strictEqual(toLevel(7999), 'low');
});

test('getTokensToThinkingLevel: roundtrip medium', () => {
  const toLevel = getTokensToThinkingLevel(31999);
  assert.strictEqual(toLevel(15999), 'medium');
});

test('getTokensToThinkingLevel: roundtrip high', () => {
  const toLevel = getTokensToThinkingLevel(31999);
  assert.strictEqual(toLevel(23999), 'high');
});

test('getTokensToThinkingLevel: roundtrip max full budget', () => {
  const toLevel = getTokensToThinkingLevel(31999);
  assert.strictEqual(toLevel(31999), 'max');
});

// ============================================================
// Section 18: All effort levels for Opus 4.6 vs 4.7
// ============================================================
console.log('\n=== 18. Effort Level Constants ===');

test('OPUS_46_EFFORT_LEVELS has correct values', () => {
  assert.deepStrictEqual(OPUS_46_EFFORT_LEVELS, ['low', 'medium', 'high', 'max']);
});

test('OPUS_47_EFFORT_LEVELS has correct values including xhigh', () => {
  assert.deepStrictEqual(OPUS_47_EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('supportsEffortLevel returns true for Opus 4.5', () => {
  assert.strictEqual(supportsEffortLevel('claude-opus-4-5-20251101'), true, 'Opus 4.5 supports effort');
});

test('supportsEffortLevel returns true for Claude Mythos Preview model ids', () => {
  assert.strictEqual(supportsEffortLevel('claude-mythos-preview'), true, 'Mythos Preview supports effort');
});

test('supportsXHighEffortLevel returns true for Opus 4.7 aliases and ids', () => {
  assert.strictEqual(supportsXHighEffortLevel('opus'), true, 'opus alias should support native xhigh');
  assert.strictEqual(supportsXHighEffortLevel('claude-opus-4-7'), true, 'Opus 4.7 id should support native xhigh');
});

test('supportsXHighEffortLevel returns false for other effort-capable models', () => {
  assert.strictEqual(supportsXHighEffortLevel('opus-4-6'), false, 'Opus 4.6 should not support native xhigh');
  assert.strictEqual(supportsXHighEffortLevel('sonnet-4-6'), false, 'Sonnet 4.6 should not support native xhigh');
  assert.strictEqual(supportsXHighEffortLevel('claude-opus-5'), false, 'Only Opus 4.7 has native xhigh in current docs');
});

test('getClaudeEnv sets effort=high for Opus 4.5 with --think max because max is not listed for Opus 4.5', () => {
  const env = getClaudeEnv({ model: 'opus-4-5', thinkLevel: 'max', thinkingBudget: 31999 });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'high');
  assert.strictEqual(env.MAX_THINKING_TOKENS, '31999');
});

test('getClaudeEnv maps xhigh to max for future Opus effort models until xhigh support is documented', () => {
  const env = getClaudeEnv({ model: 'claude-opus-5', thinkLevel: 'xhigh' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'max');
});

// ============================================================
// Section 19: getClaudeEnv for all models with all think levels
// ============================================================
console.log('\n=== 19. getClaudeEnv Cross-Model Think Level Matrix ===');

const thinkLevels = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
const testModels = [
  { name: 'opus (4.7)', alias: 'opus', isOpus47: true, supportsEffort: true, supportsXHigh: true, supportsMax: true },
  { name: 'opus-4-6', alias: 'opus-4-6', isOpus47: false, supportsEffort: true, supportsXHigh: false, supportsMax: true },
  { name: 'opus-4-5', alias: 'opus-4-5', isOpus47: false, supportsEffort: true, supportsXHigh: false, supportsMax: false },
  { name: 'sonnet-4-6', alias: 'sonnet-4-6', isOpus47: false, supportsEffort: true, supportsXHigh: false, supportsMax: true },
  { name: 'sonnet (5)', alias: 'sonnet', isOpus47: true, supportsEffort: true, supportsXHigh: true, supportsMax: true },
  { name: 'haiku (4.5)', alias: 'haiku', isOpus47: false, supportsEffort: false, supportsXHigh: false, supportsMax: false },
];

for (const model of testModels) {
  for (const level of thinkLevels) {
    const tokens = getThinkingLevelToTokens(31999);
    const budget = tokens[level];
    const env = getClaudeEnv({ model: model.alias, thinkLevel: level, thinkingBudget: budget });

    if (model.isOpus47) {
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
        assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, model.isOpus47 ? 'low' : undefined);
      });
    } else if (model.supportsEffort) {
      const expectedEffort = level === 'xhigh' ? (model.supportsXHigh ? 'xhigh' : model.supportsMax ? 'max' : 'high') : level === 'max' ? (model.supportsMax ? 'max' : 'high') : level;
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
