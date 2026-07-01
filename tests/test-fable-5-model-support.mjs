#!/usr/bin/env node
// Test file for issue #1875: Claude Fable 5 (and Claude Mythos 5) model support
// Tests alias resolution, [1m] suffix support, effort levels (incl. xhigh/max),
// 128k max output tokens, adaptive-thinking-only env handling, default fallbacks,
// and backward compatibility with existing Claude models.

import assert from 'assert';

const { CLAUDE_MODELS, MODELS_SUPPORTING_1M_CONTEXT, validateModelName, supports1mContext, getAvailableModelNames, claudeModels, defaultFallbackModels, resolveDefaultFallbackModel, primaryModelNames } = await import('../src/models/index.mjs');
const { mapModelToId, availableModels } = await import('../src/claude.lib.mjs');
const { isFable5, isMythos5, isFable5OrMythos5, supportsEffortLevel, supportsXHighEffortLevel, supportsMaxEffortLevel, getMaxOutputTokensForModel, claudeCode, getClaudeEnv, thinkLevelToEffortLevel, getThinkingLevelToTokens } = await import('../src/config.lib.mjs');

console.log('Testing Claude Fable 5 / Mythos 5 Model Support (Issue #1875)\n');

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
// Section 1: Fable 5 Alias Resolution
// ============================================================
console.log('\n=== 1. Fable 5 Alias Resolution ===');

test('fable alias maps to claude-fable-5 in claudeModels', () => {
  assert.strictEqual(claudeModels['fable'], 'claude-fable-5', 'fable should map to claude-fable-5');
});

test('fable-5 alias maps to claude-fable-5 in claudeModels', () => {
  assert.strictEqual(claudeModels['fable-5'], 'claude-fable-5', 'fable-5 should map to claude-fable-5');
});

test('claude-fable-5 maps to itself in claudeModels', () => {
  assert.strictEqual(claudeModels['claude-fable-5'], 'claude-fable-5', 'claude-fable-5 should map to itself');
});

test('fable alias resolves in CLAUDE_MODELS', () => {
  assert.strictEqual(CLAUDE_MODELS['fable'], 'claude-fable-5', 'fable should resolve in CLAUDE_MODELS');
});

test('fable alias resolves in availableModels (claude.lib.mjs)', () => {
  assert.strictEqual(availableModels['fable'], 'claude-fable-5', 'fable should resolve in availableModels');
});

test('validateModelName accepts fable and maps to claude-fable-5', () => {
  const result = validateModelName('fable', 'claude');
  assert(result.valid, `fable should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-fable-5', 'fable should map to claude-fable-5');
});

test('validateModelName accepts fable-5 and maps to claude-fable-5', () => {
  const result = validateModelName('fable-5', 'claude');
  assert(result.valid, `fable-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-fable-5', 'fable-5 should map to claude-fable-5');
});

test('validateModelName accepts claude-fable-5 directly', () => {
  const result = validateModelName('claude-fable-5', 'claude');
  assert(result.valid, `claude-fable-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-fable-5', 'Should map to itself');
});

test('mapModelToId maps fable to claude-fable-5', () => {
  assert.strictEqual(mapModelToId('fable'), 'claude-fable-5', 'mapModelToId should map fable to claude-fable-5');
});

test('mapModelToId passes through claude-fable-5 unchanged', () => {
  assert.strictEqual(mapModelToId('claude-fable-5'), 'claude-fable-5', 'Full model ID should pass through unchanged');
});

// ============================================================
// Section 2: Mythos 5 Alias Resolution
// ============================================================
console.log('\n=== 2. Mythos 5 Alias Resolution ===');

test('mythos-5 alias maps to claude-mythos-5 in claudeModels', () => {
  assert.strictEqual(claudeModels['mythos-5'], 'claude-mythos-5', 'mythos-5 should map to claude-mythos-5');
});

test('claude-mythos-5 maps to itself in claudeModels', () => {
  assert.strictEqual(claudeModels['claude-mythos-5'], 'claude-mythos-5', 'claude-mythos-5 should map to itself');
});

test('mythos-5 alias resolves in CLAUDE_MODELS', () => {
  assert.strictEqual(CLAUDE_MODELS['mythos-5'], 'claude-mythos-5', 'mythos-5 should resolve in CLAUDE_MODELS');
});

test('validateModelName accepts mythos-5 and maps to claude-mythos-5', () => {
  const result = validateModelName('mythos-5', 'claude');
  assert(result.valid, `mythos-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-mythos-5', 'mythos-5 should map to claude-mythos-5');
});

test('validateModelName accepts claude-mythos-5 directly', () => {
  const result = validateModelName('claude-mythos-5', 'claude');
  assert(result.valid, `claude-mythos-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-mythos-5', 'Should map to itself');
});

test('mapModelToId maps mythos-5 to claude-mythos-5', () => {
  assert.strictEqual(mapModelToId('mythos-5'), 'claude-mythos-5', 'mapModelToId should map mythos-5 to claude-mythos-5');
});

// ============================================================
// Section 3: isFable5 / isMythos5 / isFable5OrMythos5 Classifiers
// ============================================================
console.log('\n=== 3. Model Classifier Helpers ===');

test('isFable5 returns true for fable alias', () => {
  assert.strictEqual(isFable5('fable'), true, 'fable alias should be Fable 5');
});

test('isFable5 returns true for fable-5', () => {
  assert.strictEqual(isFable5('fable-5'), true, 'fable-5 should be Fable 5');
});

test('isFable5 returns true for claude-fable-5', () => {
  assert.strictEqual(isFable5('claude-fable-5'), true, 'claude-fable-5 should be Fable 5');
});

test('isFable5 returns false for mythos-5', () => {
  assert.strictEqual(isFable5('mythos-5'), false, 'mythos-5 should not be Fable 5');
});

test('isFable5 returns false for opus / sonnet / null', () => {
  assert.strictEqual(isFable5('opus'), false, 'opus should not be Fable 5');
  assert.strictEqual(isFable5('sonnet'), false, 'sonnet should not be Fable 5');
  assert.strictEqual(isFable5(null), false, 'null should not be Fable 5');
  assert.strictEqual(isFable5(''), false, 'empty string should not be Fable 5');
});

test('isMythos5 returns true for mythos-5', () => {
  assert.strictEqual(isMythos5('mythos-5'), true, 'mythos-5 should be Mythos 5');
});

test('isMythos5 returns true for claude-mythos-5', () => {
  assert.strictEqual(isMythos5('claude-mythos-5'), true, 'claude-mythos-5 should be Mythos 5');
});

test('isMythos5 returns false for fable', () => {
  assert.strictEqual(isMythos5('fable'), false, 'fable should not be Mythos 5');
});

test('isMythos5 returns false for null/empty', () => {
  assert.strictEqual(isMythos5(null), false, 'null should not be Mythos 5');
  assert.strictEqual(isMythos5(''), false, 'empty string should not be Mythos 5');
});

test('isFable5OrMythos5 returns true for fable and mythos-5', () => {
  assert.strictEqual(isFable5OrMythos5('fable'), true, 'fable should match');
  assert.strictEqual(isFable5OrMythos5('claude-fable-5'), true, 'claude-fable-5 should match');
  assert.strictEqual(isFable5OrMythos5('mythos-5'), true, 'mythos-5 should match');
  assert.strictEqual(isFable5OrMythos5('claude-mythos-5'), true, 'claude-mythos-5 should match');
});

test('isFable5OrMythos5 returns false for opus/sonnet/haiku', () => {
  assert.strictEqual(isFable5OrMythos5('opus'), false, 'opus should not match');
  assert.strictEqual(isFable5OrMythos5('sonnet'), false, 'sonnet should not match');
  assert.strictEqual(isFable5OrMythos5('haiku'), false, 'haiku should not match');
});

// ============================================================
// Section 4: 1M Context Support
// ============================================================
console.log('\n=== 4. 1M Context Support ===');

test('MODELS_SUPPORTING_1M_CONTEXT includes claude-fable-5', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-fable-5'), 'claude-fable-5 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('MODELS_SUPPORTING_1M_CONTEXT includes claude-mythos-5', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-mythos-5'), 'claude-mythos-5 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('supports1mContext returns true for fable', () => {
  assert.strictEqual(supports1mContext('fable', 'claude'), true, 'fable should support 1M context');
});

test('supports1mContext returns true for claude-fable-5', () => {
  assert.strictEqual(supports1mContext('claude-fable-5', 'claude'), true, 'claude-fable-5 should support 1M context');
});

test('supports1mContext returns true for mythos-5', () => {
  assert.strictEqual(supports1mContext('mythos-5', 'claude'), true, 'mythos-5 should support 1M context');
});

test('supports1mContext returns true for claude-mythos-5', () => {
  assert.strictEqual(supports1mContext('claude-mythos-5', 'claude'), true, 'claude-mythos-5 should support 1M context');
});

test('validateModelName accepts fable[1m]', () => {
  const result = validateModelName('fable[1m]', 'claude');
  assert(result.valid, `fable[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-fable-5[1m]', 'Should map to claude-fable-5[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts claude-fable-5[1m]', () => {
  const result = validateModelName('claude-fable-5[1m]', 'claude');
  assert(result.valid, `claude-fable-5[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-fable-5[1m]', 'Should map to claude-fable-5[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts mythos-5[1m]', () => {
  const result = validateModelName('mythos-5[1m]', 'claude');
  assert(result.valid, `mythos-5[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-mythos-5[1m]', 'Should map to claude-mythos-5[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('mapModelToId handles fable[1m]', () => {
  assert.strictEqual(mapModelToId('fable[1m]'), 'claude-fable-5[1m]', 'mapModelToId should handle fable[1m]');
});

// ============================================================
// Section 5: Effort Level Support (low/medium/high/xhigh/max)
// ============================================================
console.log('\n=== 5. Effort Level Support ===');

test('supportsEffortLevel returns true for fable', () => {
  assert.strictEqual(supportsEffortLevel('fable'), true, 'Fable 5 supports effort levels');
});

test('supportsEffortLevel returns true for claude-fable-5', () => {
  assert.strictEqual(supportsEffortLevel('claude-fable-5'), true, 'claude-fable-5 supports effort levels');
});

test('supportsEffortLevel returns true for mythos-5', () => {
  assert.strictEqual(supportsEffortLevel('mythos-5'), true, 'Mythos 5 supports effort levels');
});

test('supportsXHighEffortLevel returns true for fable', () => {
  assert.strictEqual(supportsXHighEffortLevel('fable'), true, 'Fable 5 should support xhigh');
});

test('supportsXHighEffortLevel returns true for claude-fable-5', () => {
  assert.strictEqual(supportsXHighEffortLevel('claude-fable-5'), true, 'claude-fable-5 should support xhigh');
});

test('supportsXHighEffortLevel returns true for mythos-5 (unlike Mythos Preview)', () => {
  assert.strictEqual(supportsXHighEffortLevel('mythos-5'), true, 'Mythos 5 should support xhigh');
});

test('supportsMaxEffortLevel returns true for fable', () => {
  assert.strictEqual(supportsMaxEffortLevel('fable'), true, 'Fable 5 should support max effort');
});

test('supportsMaxEffortLevel returns true for claude-fable-5', () => {
  assert.strictEqual(supportsMaxEffortLevel('claude-fable-5'), true, 'claude-fable-5 should support max effort');
});

test('supportsMaxEffortLevel returns true for mythos-5', () => {
  assert.strictEqual(supportsMaxEffortLevel('mythos-5'), true, 'Mythos 5 should support max effort');
});

test('thinkLevelToEffortLevel maps xhigh to xhigh for Fable 5', () => {
  assert.strictEqual(thinkLevelToEffortLevel('xhigh', { supportsXHigh: true }), 'xhigh', 'xhigh should map to xhigh for Fable 5');
});

test('thinkLevelToEffortLevel maps max to max for Fable 5', () => {
  assert.strictEqual(thinkLevelToEffortLevel('max', { supportsXHigh: true, supportsMax: true }), 'max', 'max should stay max for Fable 5');
});

// ============================================================
// Section 6: Max Output Tokens (128k)
// ============================================================
console.log('\n=== 6. Max Output Tokens (128k) ===');

test('getMaxOutputTokensForModel returns 128000 for fable', () => {
  assert.strictEqual(getMaxOutputTokensForModel('fable'), claudeCode.maxOutputTokensOpus46, 'Fable 5 should have 128000 max output tokens');
});

test('getMaxOutputTokensForModel returns 128000 for claude-fable-5', () => {
  assert.strictEqual(getMaxOutputTokensForModel('claude-fable-5'), claudeCode.maxOutputTokensOpus46, 'claude-fable-5 should have 128000 max output tokens');
});

test('getMaxOutputTokensForModel returns 128000 for mythos-5', () => {
  assert.strictEqual(getMaxOutputTokensForModel('mythos-5'), claudeCode.maxOutputTokensOpus46, 'Mythos 5 should have 128000 max output tokens');
});

test('getMaxOutputTokensForModel returns 128000 for claude-mythos-5', () => {
  assert.strictEqual(getMaxOutputTokensForModel('claude-mythos-5'), claudeCode.maxOutputTokensOpus46, 'claude-mythos-5 should have 128000 max output tokens');
});

test('claudeCode.maxOutputTokensOpus46 is 128000 (sanity)', () => {
  assert.strictEqual(claudeCode.maxOutputTokensOpus46, 128000, 'maxOutputTokensOpus46 should be 128000');
});

// ============================================================
// Section 7: Adaptive-Thinking-Only Env (MAX_THINKING_TOKENS deleted)
// ============================================================
console.log('\n=== 7. Adaptive Thinking (MAX_THINKING_TOKENS deletion) ===');

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for fable (high)', () => {
  const env = getClaudeEnv({ model: 'fable', thinkLevel: 'high' });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'MAX_THINKING_TOKENS should not be set for Fable 5');
});

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for claude-fable-5 (high)', () => {
  const env = getClaudeEnv({ model: 'claude-fable-5', thinkLevel: 'high' });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'MAX_THINKING_TOKENS should not be set for claude-fable-5');
});

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for mythos-5 (high)', () => {
  const env = getClaudeEnv({ model: 'mythos-5', thinkLevel: 'high' });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'MAX_THINKING_TOKENS should not be set for Mythos 5');
});

test('getClaudeEnv deletes inherited MAX_THINKING_TOKENS for fable', () => {
  const prev = process.env.MAX_THINKING_TOKENS;
  process.env.MAX_THINKING_TOKENS = '12345';
  try {
    const env = getClaudeEnv({ model: 'fable', thinkLevel: 'high' });
    assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'Inherited MAX_THINKING_TOKENS should be removed for Fable 5');
  } finally {
    if (prev === undefined) delete process.env.MAX_THINKING_TOKENS;
    else process.env.MAX_THINKING_TOKENS = prev;
  }
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=xhigh for fable with xhigh think (no MAX_THINKING_TOKENS)', () => {
  const env = getClaudeEnv({ model: 'fable', thinkLevel: 'xhigh' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'xhigh', 'Fable 5 with xhigh should get xhigh effort');
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'No MAX_THINKING_TOKENS for Fable 5');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=max for fable with max think', () => {
  const env = getClaudeEnv({ model: 'fable', thinkLevel: 'max' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'max', 'Fable 5 with max should get max effort');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=xhigh for mythos-5 with xhigh think', () => {
  const env = getClaudeEnv({ model: 'mythos-5', thinkLevel: 'xhigh' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'xhigh', 'Mythos 5 with xhigh should get xhigh effort');
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'No MAX_THINKING_TOKENS for Mythos 5');
});

test('getClaudeEnv does not set effort level for fable with off think', () => {
  const env = getClaudeEnv({ model: 'fable', thinkLevel: 'off' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, undefined, 'No effort level when thinking is off');
});

// ============================================================
// Section 8: Default Fallback Models
// ============================================================
console.log('\n=== 8. Default Fallback Models ===');

test('defaultFallbackModels.claude maps claude-fable-5 -> opus (Opus 4.8 safety fallback)', () => {
  assert.strictEqual(defaultFallbackModels.claude['claude-fable-5'], 'opus', 'Fable 5 should fall back to opus (Opus 4.8)');
});

test('defaultFallbackModels.claude maps claude-mythos-5 -> fable', () => {
  assert.strictEqual(defaultFallbackModels.claude['claude-mythos-5'], 'fable', 'Mythos 5 should fall back to fable');
});

test('resolveDefaultFallbackModel returns opus for fable alias', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'fable'), 'opus', 'fable alias should resolve fallback to opus');
});

test('resolveDefaultFallbackModel returns opus for fable-5 alias', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'fable-5'), 'opus', 'fable-5 should resolve fallback to opus');
});

test('resolveDefaultFallbackModel returns opus for claude-fable-5 full id', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'claude-fable-5'), 'opus', 'claude-fable-5 should resolve fallback to opus');
});

test('resolveDefaultFallbackModel returns fable for mythos-5 alias', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'mythos-5'), 'fable', 'mythos-5 should resolve fallback to fable');
});

test('resolveDefaultFallbackModel returns fable for claude-mythos-5 full id', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'claude-mythos-5'), 'fable', 'claude-mythos-5 should resolve fallback to fable');
});

// ============================================================
// Section 9: Available / Primary Model Names
// ============================================================
console.log('\n=== 9. Available / Primary Model Names ===');

test('getAvailableModelNames includes fable for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('fable'), `fable should be in available model names: ${names.join(', ')}`);
});

test('getAvailableModelNames includes mythos-5 for claude tool', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('mythos-5'), `mythos-5 should be in available model names: ${names.join(', ')}`);
});

test('primaryModelNames.claude includes fable', () => {
  assert(primaryModelNames.claude.includes('fable'), `fable should be a primary model name: ${primaryModelNames.claude.join(', ')}`);
});

// ============================================================
// Section 10: Case Insensitivity
// ============================================================
console.log('\n=== 10. Case Insensitivity ===');

test('validateModelName handles FABLE (uppercase)', () => {
  const result = validateModelName('FABLE', 'claude');
  assert(result.valid, `FABLE should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-fable-5', 'FABLE should map to claude-fable-5');
});

test('validateModelName handles CLAUDE-FABLE-5 (uppercase full ID)', () => {
  const result = validateModelName('CLAUDE-FABLE-5', 'claude');
  assert(result.valid, `CLAUDE-FABLE-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-fable-5', 'Uppercase full ID should map correctly');
});

test('validateModelName handles MYTHOS-5 (uppercase)', () => {
  const result = validateModelName('MYTHOS-5', 'claude');
  assert(result.valid, `MYTHOS-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-mythos-5', 'MYTHOS-5 should map to claude-mythos-5');
});

// ============================================================
// Section 11: Backward Compatibility (existing models unchanged)
// ============================================================
console.log('\n=== 11. Backward Compatibility ===');

test('opus alias still maps to claude-opus-4-8', () => {
  assert.strictEqual(validateModelName('opus', 'claude').mappedModel, 'claude-opus-4-8', 'opus should still map to claude-opus-4-8');
});

test('sonnet alias now maps to claude-sonnet-5 (Issue #2003)', () => {
  assert.strictEqual(validateModelName('sonnet', 'claude').mappedModel, 'claude-sonnet-5', 'sonnet should map to claude-sonnet-5');
});

test('opus-4-8 fallback still resolves to opus-4-7 (unchanged)', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'opus-4-8'), 'opus-4-7', 'Opus 4.8 fallback unchanged');
});

test('supportsXHighEffortLevel still false for opus-4-6, but true for sonnet (now Sonnet 5, Issue #2003)', () => {
  assert.strictEqual(supportsXHighEffortLevel('opus-4-6'), false, 'Opus 4.6 should not support xhigh');
  assert.strictEqual(supportsXHighEffortLevel('sonnet'), true, 'Sonnet 5 should support xhigh');
  assert.strictEqual(supportsXHighEffortLevel('sonnet-4-6'), false, 'Sonnet 4.6 should not support xhigh');
});

test('getMaxOutputTokensForModel still 64000 for haiku', () => {
  assert.strictEqual(getMaxOutputTokensForModel('haiku'), claudeCode.maxOutputTokens, 'Haiku keeps default max output tokens');
});

// ============================================================
// Section 12: Cross-Model Think Level Matrix (Fable 5 / Mythos 5 rows)
// ============================================================
console.log('\n=== 12. getClaudeEnv Cross-Model Think Level Matrix ===');

const thinkLevels = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
const testModels = [
  { name: 'fable (Fable 5)', alias: 'fable' },
  { name: 'claude-fable-5', alias: 'claude-fable-5' },
  { name: 'mythos-5 (Mythos 5)', alias: 'mythos-5' },
  { name: 'claude-mythos-5', alias: 'claude-mythos-5' },
];

for (const model of testModels) {
  for (const level of thinkLevels) {
    const tokens = getThinkingLevelToTokens(31999);
    const budget = tokens[level];
    const env = getClaudeEnv({ model: model.alias, thinkLevel: level, thinkingBudget: budget });

    // All Fable 5 / Mythos 5 models are adaptive-thinking-only: never set MAX_THINKING_TOKENS
    test(`${model.name} + --think ${level}: no MAX_THINKING_TOKENS`, () => {
      assert.strictEqual(env.MAX_THINKING_TOKENS, undefined);
    });

    if (level === 'off') {
      test(`${model.name} + --think off: no effort level`, () => {
        assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, undefined);
      });
    } else {
      // Fable 5 / Mythos 5 support the full effort ladder including xhigh and max
      test(`${model.name} + --think ${level}: effort=${level}`, () => {
        assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, level);
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
