#!/usr/bin/env node
// Test file for issue #2096: Claude Opus 5 model support
// Verifies that the bare `opus` alias now resolves to Claude Opus 5 (the new
// default for `--tool claude`, and therefore for `/claude` and `/solve`), that
// the explicit `opus-5`/`claude-opus-5` aliases resolve correctly, that Opus 5
// exposes the expected capabilities (1M context via [1m], 128k output tokens,
// xhigh/max effort, adaptive-thinking-only), that the escalate ladder treats it
// as the `opus` tier, and that the prior Opus 4.x aliases keep working for
// backward compatibility.

import assert from 'assert';

const { CLAUDE_MODELS, MODELS_SUPPORTING_1M_CONTEXT, validateModelName, supports1mContext, getAvailableModelNames, claudeModels, defaultModels, resolveDefaultFallbackModel, primaryModelNames } = await import('../src/models/index.mjs');
const { mapModelToId, availableModels } = await import('../src/claude.lib.mjs');
const { isOpus5, supportsEffortLevel, supportsXHighEffortLevel, supportsMaxEffortLevel, getMaxOutputTokensForModel, claudeCode, getClaudeEnv, getThinkingLevelToTokens } = await import('../src/config.lib.mjs');
const { canonicalTier } = await import('../src/solve.escalate.lib.mjs');

console.log('Testing Claude Opus 5 Model Support (Issue #2096)\n');

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
// Section 1: Bare `opus` alias resolves to Claude Opus 5 (default)
// ============================================================
console.log('\n=== 1. Bare `opus` alias resolves to Claude Opus 5 ===');

test('claudeModels.opus maps to claude-opus-5', () => {
  assert.strictEqual(claudeModels['opus'], 'claude-opus-5', 'opus should map to claude-opus-5');
});

test('CLAUDE_MODELS.opus maps to claude-opus-5', () => {
  assert.strictEqual(CLAUDE_MODELS['opus'], 'claude-opus-5', 'opus should map to claude-opus-5');
});

test('availableModels.opus (claude.lib.mjs) maps to claude-opus-5', () => {
  assert.strictEqual(availableModels['opus'], 'claude-opus-5', 'opus should map to claude-opus-5');
});

test('defaultModels.claude is opus (Issue #2033) — the default for /claude and /solve', () => {
  assert.strictEqual(defaultModels['claude'], 'opus', 'claude default should be opus');
});

test('default claude model resolves to Claude Opus 5 (Issue #2096)', () => {
  const result = validateModelName(defaultModels['claude'], 'claude');
  assert(result.valid, `default should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-5', 'default opus should map to claude-opus-5');
});

test('validateModelName maps opus to claude-opus-5', () => {
  const result = validateModelName('opus', 'claude');
  assert(result.valid, `opus should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-5', 'opus should map to claude-opus-5');
});

test('mapModelToId maps opus to claude-opus-5', () => {
  assert.strictEqual(mapModelToId('opus'), 'claude-opus-5', 'mapModelToId should map opus to claude-opus-5');
});

test('validateModelName handles OPUS (upper case)', () => {
  const result = validateModelName('OPUS', 'claude');
  assert(result.valid, `OPUS should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-5', 'OPUS should map to claude-opus-5');
});

// ============================================================
// Section 2: Explicit opus-5 / claude-opus-5 aliases
// ============================================================
console.log('\n=== 2. Explicit opus-5 / claude-opus-5 aliases ===');

test('opus-5 alias maps to claude-opus-5', () => {
  assert.strictEqual(claudeModels['opus-5'], 'claude-opus-5', 'opus-5 should map to claude-opus-5');
});

test('claude-opus-5 full ID maps to itself', () => {
  assert.strictEqual(claudeModels['claude-opus-5'], 'claude-opus-5', 'claude-opus-5 should map to itself');
});

test('validateModelName accepts opus-5', () => {
  const result = validateModelName('opus-5', 'claude');
  assert(result.valid, `opus-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-5', 'opus-5 should map to claude-opus-5');
});

test('validateModelName accepts claude-opus-5 directly', () => {
  const result = validateModelName('claude-opus-5', 'claude');
  assert(result.valid, `claude-opus-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-5', 'Should map to itself');
});

test('mapModelToId passes through claude-opus-5 unchanged', () => {
  assert.strictEqual(mapModelToId('claude-opus-5'), 'claude-opus-5', 'Full ID should pass through');
});

test('validateModelName handles OPUS-5 (mixed/upper case)', () => {
  const result = validateModelName('OPUS-5', 'claude');
  assert(result.valid, `OPUS-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-5', 'OPUS-5 should map to claude-opus-5');
});

// ============================================================
// Section 3: 1M context window support via [1m] suffix
// ============================================================
console.log('\n=== 3. 1M Context Window Support ===');

test('MODELS_SUPPORTING_1M_CONTEXT includes claude-opus-5', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-opus-5'), 'claude-opus-5 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('MODELS_SUPPORTING_1M_CONTEXT includes opus-5', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('opus-5'), 'opus-5 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('supports1mContext returns true for opus (now Opus 5)', () => {
  assert.strictEqual(supports1mContext('opus', 'claude'), true, 'opus should support 1M context');
});

test('supports1mContext returns true for opus-5', () => {
  assert.strictEqual(supports1mContext('opus-5', 'claude'), true, 'opus-5 should support 1M context');
});

test('supports1mContext returns true for claude-opus-5', () => {
  assert.strictEqual(supports1mContext('claude-opus-5', 'claude'), true, 'claude-opus-5 should support 1M context');
});

test('validateModelName accepts opus[1m] and maps to claude-opus-5[1m]', () => {
  const result = validateModelName('opus[1m]', 'claude');
  assert(result.valid, `opus[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-5[1m]', 'opus[1m] should map to claude-opus-5[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts opus-5[1m]', () => {
  const result = validateModelName('opus-5[1m]', 'claude');
  assert(result.valid, `opus-5[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-5[1m]', 'opus-5[1m] should map to claude-opus-5[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

// ============================================================
// Section 4: isOpus5 classifier
// ============================================================
console.log('\n=== 4. isOpus5 Classifier ===');

test('isOpus5 returns true for opus (default)', () => {
  assert.strictEqual(isOpus5('opus'), true, 'opus should be Opus 5');
});

test('isOpus5 returns true for opus-5', () => {
  assert.strictEqual(isOpus5('opus-5'), true, 'opus-5 should be Opus 5');
});

test('isOpus5 returns true for claude-opus-5', () => {
  assert.strictEqual(isOpus5('claude-opus-5'), true, 'claude-opus-5 should be Opus 5');
});

test('isOpus5 returns true for claude-opus-5[1m]', () => {
  assert.strictEqual(isOpus5('claude-opus-5[1m]'), true, 'claude-opus-5[1m] should be Opus 5');
});

test('isOpus5 returns false for opus-4-8 / claude-opus-4-8', () => {
  assert.strictEqual(isOpus5('opus-4-8'), false, 'opus-4-8 should not be Opus 5');
  assert.strictEqual(isOpus5('claude-opus-4-8'), false, 'claude-opus-4-8 should not be Opus 5');
});

test('isOpus5 returns false for sonnet / haiku / fable / null', () => {
  assert.strictEqual(isOpus5('sonnet'), false, 'sonnet should not be Opus 5');
  assert.strictEqual(isOpus5('haiku'), false, 'haiku should not be Opus 5');
  assert.strictEqual(isOpus5('fable'), false, 'fable should not be Opus 5');
  assert.strictEqual(isOpus5(null), false, 'null should not be Opus 5');
});

// ============================================================
// Section 5: Effort levels (xhigh/max) and max output tokens
// ============================================================
console.log('\n=== 5. Effort Levels and Max Output Tokens ===');

test('supportsEffortLevel returns true for opus (Opus 5)', () => {
  assert.strictEqual(supportsEffortLevel('opus'), true, 'Opus 5 should support effort levels');
});

test('supportsXHighEffortLevel returns true for opus (Opus 5)', () => {
  assert.strictEqual(supportsXHighEffortLevel('opus'), true, 'Opus 5 should support xhigh');
  assert.strictEqual(supportsXHighEffortLevel('opus-5'), true, 'opus-5 should support xhigh');
  assert.strictEqual(supportsXHighEffortLevel('claude-opus-5'), true, 'claude-opus-5 should support xhigh');
});

test('supportsMaxEffortLevel returns true for opus (Opus 5)', () => {
  assert.strictEqual(supportsMaxEffortLevel('opus'), true, 'Opus 5 should support max');
  assert.strictEqual(supportsMaxEffortLevel('claude-opus-5'), true, 'claude-opus-5 should support max');
});

test('getMaxOutputTokensForModel returns 128K for opus (Opus 5)', () => {
  assert.strictEqual(getMaxOutputTokensForModel('opus'), claudeCode.maxOutputTokensOpus46, 'Opus 5 should have 128K output tokens');
  assert.strictEqual(getMaxOutputTokensForModel('claude-opus-5'), claudeCode.maxOutputTokensOpus46, 'claude-opus-5 should have 128K output tokens');
});

// ============================================================
// Section 6: Adaptive-thinking-only env handling
// ============================================================
console.log('\n=== 6. Adaptive-Thinking-Only Environment Handling ===');

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for opus (adaptive-only)', () => {
  const env = getClaudeEnv({ model: 'opus', thinkingBudget: 8000 });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'Opus 5 is adaptive-thinking-only');
});

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for claude-opus-5', () => {
  const env = getClaudeEnv({ model: 'claude-opus-5', thinkLevel: 'high' });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'Opus 5 is adaptive-thinking-only');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=xhigh for opus with xhigh think', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'xhigh' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'xhigh', 'Opus 5 with xhigh should get xhigh effort');
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'No MAX_THINKING_TOKENS for Opus 5');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=max for opus with max think', () => {
  const env = getClaudeEnv({ model: 'opus', thinkLevel: 'max' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'max', 'Opus 5 with max should get max effort');
});

// Cross think-level matrix for Opus 5 (adaptive, xhigh, max all supported)
const thinkLevels = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
for (const level of thinkLevels) {
  const tokens = getThinkingLevelToTokens(31999);
  const env = getClaudeEnv({ model: 'opus', thinkLevel: level, thinkingBudget: tokens[level] });
  test(`opus + --think ${level}: no MAX_THINKING_TOKENS`, () => {
    assert.strictEqual(env.MAX_THINKING_TOKENS, undefined);
  });
  if (level === 'off') {
    test(`opus + --think off: lowest effort`, () => {
      assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'low');
    });
  } else {
    test(`opus + --think ${level}: effort=${level}`, () => {
      assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, level);
    });
  }
}

// ============================================================
// Section 7: Default fallback + escalate tier
// ============================================================
console.log('\n=== 7. Default Fallback and Escalate Tier ===');

test('claude-opus-5 falls back to opus-4-8 (prior Opus generation)', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'claude-opus-5'), 'opus-4-8', 'Opus 5 should fall back to Opus 4.8');
});

test('opus alias falls back to opus-4-8 (resolves to Opus 5 first)', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'opus'), 'opus-4-8', 'opus should fall back to Opus 4.8');
});

test('canonicalTier maps opus-5 and claude-opus-5 to opus tier', () => {
  assert.strictEqual(canonicalTier('opus-5'), 'opus', 'opus-5 should be opus tier');
  assert.strictEqual(canonicalTier('claude-opus-5'), 'opus', 'claude-opus-5 should be opus tier');
  assert.strictEqual(canonicalTier('opus'), 'opus', 'opus should be opus tier');
});

// ============================================================
// Section 8: Availability + backward compatibility
// ============================================================
console.log('\n=== 8. Availability and Backward Compatibility ===');

test('getAvailableModelNames includes opus and opus-5 for claude', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('opus'), `opus should be available: ${names.join(', ')}`);
  assert(names.includes('opus-5'), `opus-5 should be available: ${names.join(', ')}`);
});

test('primaryModelNames.claude still advertises opus', () => {
  assert(primaryModelNames['claude'].includes('opus'), 'opus should be a primary claude model name');
});

test('opus-4-8 alias still maps to claude-opus-4-8 (backward compat)', () => {
  assert.strictEqual(validateModelName('opus-4-8', 'claude').mappedModel, 'claude-opus-4-8', 'opus-4-8 should still work');
});

test('claude-opus-4-8 full ID still works (backward compat)', () => {
  assert.strictEqual(validateModelName('claude-opus-4-8', 'claude').mappedModel, 'claude-opus-4-8', 'claude-opus-4-8 should still work');
});

test('opus-4-7 alias still maps to claude-opus-4-7 (backward compat)', () => {
  assert.strictEqual(validateModelName('opus-4-7', 'claude').mappedModel, 'claude-opus-4-7', 'opus-4-7 should still work');
});

test('opus-4-6 alias still maps to claude-opus-4-6 (backward compat)', () => {
  assert.strictEqual(validateModelName('opus-4-6', 'claude').mappedModel, 'claude-opus-4-6', 'opus-4-6 should still work');
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
