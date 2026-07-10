#!/usr/bin/env node
// Test file for issue #2003: Claude Sonnet 5 model support
// Verifies that the bare `sonnet` alias now resolves to Claude Sonnet 5 (the new
// default for `--tool claude`), that the explicit `sonnet-5`/`claude-sonnet-5`
// aliases resolve correctly, that Sonnet 5 exposes the expected capabilities
// (1M context via [1m], 128k output tokens, xhigh/max effort, adaptive-thinking-only),
// that the escalate ladder treats it as the `sonnet` tier, and that the prior
// Sonnet 4.6 aliases keep working for backward compatibility.

import assert from 'assert';

const { CLAUDE_MODELS, MODELS_SUPPORTING_1M_CONTEXT, validateModelName, supports1mContext, getAvailableModelNames, claudeModels, defaultModels, resolveDefaultFallbackModel, primaryModelNames } = await import('../src/models/index.mjs');
const { mapModelToId, availableModels } = await import('../src/claude.lib.mjs');
const { isSonnet5, supportsEffortLevel, supportsXHighEffortLevel, supportsMaxEffortLevel, getMaxOutputTokensForModel, claudeCode, getClaudeEnv, getThinkingLevelToTokens } = await import('../src/config.lib.mjs');
const { canonicalTier } = await import('../src/solve.escalate.lib.mjs');

console.log('Testing Claude Sonnet 5 Model Support (Issue #2003)\n');

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
// Section 1: `sonnet` remains an explicit alias for Sonnet 5
// ============================================================
console.log('\n=== 1. Bare `sonnet` alias resolves to Claude Sonnet 5 ===');

test('claudeModels.sonnet maps to claude-sonnet-5', () => {
  assert.strictEqual(claudeModels['sonnet'], 'claude-sonnet-5', 'sonnet should map to claude-sonnet-5');
});

test('CLAUDE_MODELS.sonnet maps to claude-sonnet-5', () => {
  assert.strictEqual(CLAUDE_MODELS['sonnet'], 'claude-sonnet-5', 'sonnet should map to claude-sonnet-5');
});

test('availableModels.sonnet (claude.lib.mjs) maps to claude-sonnet-5', () => {
  assert.strictEqual(availableModels['sonnet'], 'claude-sonnet-5', 'sonnet should map to claude-sonnet-5');
});

test('defaultModels.claude is opus (Issue #2033)', () => {
  assert.strictEqual(defaultModels['claude'], 'opus', 'claude default should be opus');
});

test('default claude model resolves to the current Opus model (Issue #2033)', () => {
  const result = validateModelName(defaultModels['claude'], 'claude');
  assert(result.valid, `default should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-opus-4-8', 'default opus should map to claude-opus-4-8');
});

test('validateModelName maps sonnet to claude-sonnet-5', () => {
  const result = validateModelName('sonnet', 'claude');
  assert(result.valid, `sonnet should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-5', 'sonnet should map to claude-sonnet-5');
});

test('mapModelToId maps sonnet to claude-sonnet-5', () => {
  assert.strictEqual(mapModelToId('sonnet'), 'claude-sonnet-5', 'mapModelToId should map sonnet to claude-sonnet-5');
});

// ============================================================
// Section 2: Explicit sonnet-5 / claude-sonnet-5 aliases
// ============================================================
console.log('\n=== 2. Explicit sonnet-5 / claude-sonnet-5 aliases ===');

test('sonnet-5 alias maps to claude-sonnet-5', () => {
  assert.strictEqual(claudeModels['sonnet-5'], 'claude-sonnet-5', 'sonnet-5 should map to claude-sonnet-5');
});

test('claude-sonnet-5 full ID maps to itself', () => {
  assert.strictEqual(claudeModels['claude-sonnet-5'], 'claude-sonnet-5', 'claude-sonnet-5 should map to itself');
});

test('validateModelName accepts sonnet-5', () => {
  const result = validateModelName('sonnet-5', 'claude');
  assert(result.valid, `sonnet-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-5', 'sonnet-5 should map to claude-sonnet-5');
});

test('validateModelName accepts claude-sonnet-5 directly', () => {
  const result = validateModelName('claude-sonnet-5', 'claude');
  assert(result.valid, `claude-sonnet-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-5', 'Should map to itself');
});

test('mapModelToId passes through claude-sonnet-5 unchanged', () => {
  assert.strictEqual(mapModelToId('claude-sonnet-5'), 'claude-sonnet-5', 'Full ID should pass through');
});

test('validateModelName handles SONNET-5 (mixed/upper case)', () => {
  const result = validateModelName('SONNET-5', 'claude');
  assert(result.valid, `SONNET-5 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-5', 'SONNET-5 should map to claude-sonnet-5');
});

// ============================================================
// Section 3: 1M context window support via [1m] suffix
// ============================================================
console.log('\n=== 3. 1M Context Window Support ===');

test('MODELS_SUPPORTING_1M_CONTEXT includes claude-sonnet-5', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-sonnet-5'), 'claude-sonnet-5 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('MODELS_SUPPORTING_1M_CONTEXT includes sonnet-5', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('sonnet-5'), 'sonnet-5 should be in MODELS_SUPPORTING_1M_CONTEXT');
});

test('supports1mContext returns true for sonnet (now Sonnet 5)', () => {
  assert.strictEqual(supports1mContext('sonnet', 'claude'), true, 'sonnet should support 1M context');
});

test('supports1mContext returns true for sonnet-5', () => {
  assert.strictEqual(supports1mContext('sonnet-5', 'claude'), true, 'sonnet-5 should support 1M context');
});

test('supports1mContext returns true for claude-sonnet-5', () => {
  assert.strictEqual(supports1mContext('claude-sonnet-5', 'claude'), true, 'claude-sonnet-5 should support 1M context');
});

test('validateModelName accepts sonnet[1m] and maps to claude-sonnet-5[1m]', () => {
  const result = validateModelName('sonnet[1m]', 'claude');
  assert(result.valid, `sonnet[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-5[1m]', 'sonnet[1m] should map to claude-sonnet-5[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

test('validateModelName accepts sonnet-5[1m]', () => {
  const result = validateModelName('sonnet-5[1m]', 'claude');
  assert(result.valid, `sonnet-5[1m] should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-sonnet-5[1m]', 'sonnet-5[1m] should map to claude-sonnet-5[1m]');
  assert.strictEqual(result.has1mSuffix, true, 'Should indicate 1m suffix');
});

// ============================================================
// Section 4: isSonnet5 classifier
// ============================================================
console.log('\n=== 4. isSonnet5 Classifier ===');

test('isSonnet5 returns true for sonnet (default)', () => {
  assert.strictEqual(isSonnet5('sonnet'), true, 'sonnet should be Sonnet 5');
});

test('isSonnet5 returns true for sonnet-5', () => {
  assert.strictEqual(isSonnet5('sonnet-5'), true, 'sonnet-5 should be Sonnet 5');
});

test('isSonnet5 returns true for claude-sonnet-5', () => {
  assert.strictEqual(isSonnet5('claude-sonnet-5'), true, 'claude-sonnet-5 should be Sonnet 5');
});

test('isSonnet5 returns true for claude-sonnet-5[1m]', () => {
  assert.strictEqual(isSonnet5('claude-sonnet-5[1m]'), true, 'claude-sonnet-5[1m] should be Sonnet 5');
});

test('isSonnet5 returns false for sonnet-4-6 / claude-sonnet-4-6', () => {
  assert.strictEqual(isSonnet5('sonnet-4-6'), false, 'sonnet-4-6 should not be Sonnet 5');
  assert.strictEqual(isSonnet5('claude-sonnet-4-6'), false, 'claude-sonnet-4-6 should not be Sonnet 5');
});

test('isSonnet5 returns false for opus / haiku / fable / null', () => {
  assert.strictEqual(isSonnet5('opus'), false, 'opus should not be Sonnet 5');
  assert.strictEqual(isSonnet5('haiku'), false, 'haiku should not be Sonnet 5');
  assert.strictEqual(isSonnet5('fable'), false, 'fable should not be Sonnet 5');
  assert.strictEqual(isSonnet5(null), false, 'null should not be Sonnet 5');
});

// ============================================================
// Section 5: Effort levels (xhigh/max) and max output tokens
// ============================================================
console.log('\n=== 5. Effort Levels and Max Output Tokens ===');

test('supportsEffortLevel returns true for sonnet (Sonnet 5)', () => {
  assert.strictEqual(supportsEffortLevel('sonnet'), true, 'Sonnet 5 should support effort levels');
});

test('supportsXHighEffortLevel returns true for sonnet (Sonnet 5)', () => {
  assert.strictEqual(supportsXHighEffortLevel('sonnet'), true, 'Sonnet 5 should support xhigh');
  assert.strictEqual(supportsXHighEffortLevel('claude-sonnet-5'), true, 'claude-sonnet-5 should support xhigh');
});

test('supportsXHighEffortLevel returns false for Sonnet 4.6 (unchanged)', () => {
  assert.strictEqual(supportsXHighEffortLevel('sonnet-4-6'), false, 'Sonnet 4.6 should not support xhigh');
});

test('supportsMaxEffortLevel returns true for sonnet (Sonnet 5)', () => {
  assert.strictEqual(supportsMaxEffortLevel('sonnet'), true, 'Sonnet 5 should support max');
});

test('getMaxOutputTokensForModel returns 128K for sonnet (Sonnet 5)', () => {
  assert.strictEqual(getMaxOutputTokensForModel('sonnet'), claudeCode.maxOutputTokensOpus46, 'Sonnet 5 should have 128K output tokens');
  assert.strictEqual(getMaxOutputTokensForModel('claude-sonnet-5'), claudeCode.maxOutputTokensOpus46, 'claude-sonnet-5 should have 128K output tokens');
});

test('getMaxOutputTokensForModel returns default (64K) for Sonnet 4.6 (unchanged)', () => {
  assert.strictEqual(getMaxOutputTokensForModel('sonnet-4-6'), claudeCode.maxOutputTokens, 'Sonnet 4.6 keeps 64K output tokens');
});

// ============================================================
// Section 6: Adaptive-thinking-only env handling
// ============================================================
console.log('\n=== 6. Adaptive-Thinking-Only Environment Handling ===');

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for sonnet (adaptive-only)', () => {
  const env = getClaudeEnv({ model: 'sonnet', thinkingBudget: 8000 });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'Sonnet 5 is adaptive-thinking-only');
});

test('getClaudeEnv does NOT set MAX_THINKING_TOKENS for claude-sonnet-5', () => {
  const env = getClaudeEnv({ model: 'claude-sonnet-5', thinkLevel: 'high' });
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'Sonnet 5 is adaptive-thinking-only');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=xhigh for sonnet with xhigh think', () => {
  const env = getClaudeEnv({ model: 'sonnet', thinkLevel: 'xhigh' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'xhigh', 'Sonnet 5 with xhigh should get xhigh effort');
  assert.strictEqual(env.MAX_THINKING_TOKENS, undefined, 'No MAX_THINKING_TOKENS for Sonnet 5');
});

test('getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL=max for sonnet with max think', () => {
  const env = getClaudeEnv({ model: 'sonnet', thinkLevel: 'max' });
  assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, 'max', 'Sonnet 5 with max should get max effort');
});

// Cross think-level matrix for Sonnet 5 (adaptive, xhigh, max all supported)
const thinkLevels = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
for (const level of thinkLevels) {
  const tokens = getThinkingLevelToTokens(31999);
  const env = getClaudeEnv({ model: 'sonnet', thinkLevel: level, thinkingBudget: tokens[level] });
  test(`sonnet + --think ${level}: no MAX_THINKING_TOKENS`, () => {
    assert.strictEqual(env.MAX_THINKING_TOKENS, undefined);
  });
  if (level === 'off') {
    test(`sonnet + --think off: no effort level`, () => {
      assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, undefined);
    });
  } else {
    test(`sonnet + --think ${level}: effort=${level}`, () => {
      assert.strictEqual(env.CLAUDE_CODE_EFFORT_LEVEL, level);
    });
  }
}

// ============================================================
// Section 7: Default fallback + escalate tier
// ============================================================
console.log('\n=== 7. Default Fallback and Escalate Tier ===');

test('claude-sonnet-5 falls back to sonnet-4-6', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'claude-sonnet-5'), 'sonnet-4-6', 'Sonnet 5 should fall back to Sonnet 4.6');
});

test('sonnet alias falls back to sonnet-4-6 (resolves to Sonnet 5 first)', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'sonnet'), 'sonnet-4-6', 'sonnet should fall back to Sonnet 4.6');
});

test('canonicalTier maps sonnet-5 and claude-sonnet-5 to sonnet tier', () => {
  assert.strictEqual(canonicalTier('sonnet-5'), 'sonnet', 'sonnet-5 should be sonnet tier');
  assert.strictEqual(canonicalTier('claude-sonnet-5'), 'sonnet', 'claude-sonnet-5 should be sonnet tier');
  assert.strictEqual(canonicalTier('sonnet'), 'sonnet', 'sonnet should be sonnet tier');
});

// ============================================================
// Section 8: Availability + backward compatibility
// ============================================================
console.log('\n=== 8. Availability and Backward Compatibility ===');

test('getAvailableModelNames includes sonnet and sonnet-5 for claude', () => {
  const names = getAvailableModelNames('claude');
  assert(names.includes('sonnet'), `sonnet should be available: ${names.join(', ')}`);
  assert(names.includes('sonnet-5'), `sonnet-5 should be available: ${names.join(', ')}`);
});

test('primaryModelNames.claude still advertises sonnet', () => {
  assert(primaryModelNames['claude'].includes('sonnet'), 'sonnet should be a primary claude model name');
});

test('sonnet-4-6 alias still maps to claude-sonnet-4-6 (backward compat)', () => {
  assert.strictEqual(validateModelName('sonnet-4-6', 'claude').mappedModel, 'claude-sonnet-4-6', 'sonnet-4-6 should still work');
});

test('claude-sonnet-4-6 full ID still works (backward compat)', () => {
  assert.strictEqual(validateModelName('claude-sonnet-4-6', 'claude').mappedModel, 'claude-sonnet-4-6', 'claude-sonnet-4-6 should still work');
});

test('sonnet-4-5 alias still maps to claude-sonnet-4-5-20250929 (backward compat)', () => {
  assert.strictEqual(validateModelName('sonnet-4-5', 'claude').mappedModel, 'claude-sonnet-4-5-20250929', 'sonnet-4-5 should still work');
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
