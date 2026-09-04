#!/usr/bin/env node
// Test file for issue #2202: support for the newest vendor models
//   - Claude Fable 5.1 (`claude-fable-5-1`) and Claude Mythos 5.1 (`claude-mythos-5-1`)
//   - OpenAI GPT-6 Astra (`gpt-6-astra`), GPT-5.6 Cyber (`gpt-5.6-cyber`) and the
//     two Daybreak aliases already advertised by the installed Codex CLI.
//
// Vendor-quoted specifications and citations for every claim asserted here live in
// docs/case-studies/issue-2202/data/research/online-research.md

import assert from 'assert';

const { CLAUDE_MODELS, CODEX_MODELS, MODELS_SUPPORTING_1M_CONTEXT, validateModelName, supports1mContext, getAvailableModelNames, claudeModels, codexModels, defaultModels, defaultFallbackModels, resolveDefaultFallbackModel, resolveModelId, mapModelForTool, getModelMapForTool, primaryModelNames } = await import('../src/models/index.mjs');
const { mapModelToId, availableModels } = await import('../src/claude.lib.mjs');
const { isFable5, isMythos5, isFable5OrMythos5, supportsEffortLevel, supportsXHighEffortLevel, supportsMaxEffortLevel, getMaxOutputTokensForModel } = await import('../src/config.lib.mjs');

console.log('Testing new model support (Issue #2202)\n');

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
// Section 1: Claude Fable 5.1 alias resolution
// ============================================================
console.log('\n=== 1. Claude Fable 5.1 Alias Resolution ===');

test('fable-5-1 alias maps to claude-fable-5-1 in claudeModels', () => {
  assert.strictEqual(claudeModels['fable-5-1'], 'claude-fable-5-1');
});

test('claude-fable-5-1 maps to itself in claudeModels', () => {
  assert.strictEqual(claudeModels['claude-fable-5-1'], 'claude-fable-5-1');
});

test('bare fable alias now points at Fable 5.1 (Fable 5 is legacy)', () => {
  assert.strictEqual(claudeModels['fable'], 'claude-fable-5-1');
});

test('fable-5 stays pinned to claude-fable-5 for existing users', () => {
  assert.strictEqual(claudeModels['fable-5'], 'claude-fable-5');
});

test('fable-5-1 resolves in CLAUDE_MODELS', () => {
  assert.strictEqual(CLAUDE_MODELS['fable-5-1'], 'claude-fable-5-1');
});

test('claude-fable-5-1 resolves in CLAUDE_MODELS', () => {
  assert.strictEqual(CLAUDE_MODELS['claude-fable-5-1'], 'claude-fable-5-1');
});

test('fable-5-1 resolves in availableModels (claude.lib.mjs)', () => {
  assert.strictEqual(availableModels['fable-5-1'], 'claude-fable-5-1');
});

test('mapModelToId resolves fable-5-1', () => {
  assert.strictEqual(mapModelToId('fable-5-1'), 'claude-fable-5-1');
});

test('validateModelName accepts fable-5-1', () => {
  const result = validateModelName('fable-5-1', 'claude');
  assert(result.valid, `fable-5-1 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-fable-5-1');
});

test('validateModelName accepts the full claude-fable-5-1 ID', () => {
  const result = validateModelName('claude-fable-5-1', 'claude');
  assert(result.valid, `claude-fable-5-1 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-fable-5-1');
});

test('mapModelForTool resolves fable-5-1 for claude', () => {
  assert.strictEqual(mapModelForTool('claude', 'fable-5-1'), 'claude-fable-5-1');
});

test('fable-5-1 is case-insensitive', () => {
  const result = validateModelName('FABLE-5-1', 'claude');
  assert(result.valid, 'FABLE-5-1 should be valid');
  assert.strictEqual(result.mappedModel, 'claude-fable-5-1');
});

// ============================================================
// Section 2: Claude Mythos 5.1 alias resolution
// ============================================================
console.log('\n=== 2. Claude Mythos 5.1 Alias Resolution ===');

test('mythos-5-1 alias maps to claude-mythos-5-1 in claudeModels', () => {
  assert.strictEqual(claudeModels['mythos-5-1'], 'claude-mythos-5-1');
});

test('claude-mythos-5-1 maps to itself in claudeModels', () => {
  assert.strictEqual(claudeModels['claude-mythos-5-1'], 'claude-mythos-5-1');
});

test('mythos-5 still maps to claude-mythos-5', () => {
  assert.strictEqual(claudeModels['mythos-5'], 'claude-mythos-5');
});

test('claude-mythos-5-1 resolves in CLAUDE_MODELS', () => {
  assert.strictEqual(CLAUDE_MODELS['claude-mythos-5-1'], 'claude-mythos-5-1');
});

test('validateModelName accepts mythos-5-1', () => {
  const result = validateModelName('mythos-5-1', 'claude');
  assert(result.valid, `mythos-5-1 should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'claude-mythos-5-1');
});

// ============================================================
// Section 3: Fable/Mythos 5.1 capability classifiers
// ============================================================
console.log('\n=== 3. Capability Classifiers ===');

test('isFable5 recognizes claude-fable-5-1', () => {
  assert.strictEqual(isFable5('claude-fable-5-1'), true);
});

test('isMythos5 recognizes claude-mythos-5-1', () => {
  assert.strictEqual(isMythos5('claude-mythos-5-1'), true);
});

test('isFable5OrMythos5 recognizes both 5.1 models', () => {
  assert.strictEqual(isFable5OrMythos5('claude-fable-5-1'), true);
  assert.strictEqual(isFable5OrMythos5('claude-mythos-5-1'), true);
});

test('claude-fable-5-1 supports effort levels', () => {
  assert.strictEqual(supportsEffortLevel('claude-fable-5-1'), true);
});

test('claude-fable-5-1 supports the xhigh effort level', () => {
  assert.strictEqual(supportsXHighEffortLevel('claude-fable-5-1'), true);
});

test('claude-fable-5-1 supports the max effort level', () => {
  assert.strictEqual(supportsMaxEffortLevel('claude-fable-5-1'), true);
});

test('claude-fable-5-1 has a 128k max output budget', () => {
  assert.strictEqual(getMaxOutputTokensForModel('claude-fable-5-1'), 128000);
});

test('claude-mythos-5-1 has a 128k max output budget', () => {
  assert.strictEqual(getMaxOutputTokensForModel('claude-mythos-5-1'), 128000);
});

// ============================================================
// Section 4: 1M context registration
// ============================================================
console.log('\n=== 4. 1M Context Window ===');

test('MODELS_SUPPORTING_1M_CONTEXT includes claude-fable-5-1', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-fable-5-1'));
});

test('MODELS_SUPPORTING_1M_CONTEXT includes claude-mythos-5-1', () => {
  assert(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-mythos-5-1'));
});

test('supports1mContext accepts fable-5-1', () => {
  assert.strictEqual(supports1mContext('fable-5-1', 'claude'), true);
});

test('supports1mContext accepts claude-mythos-5-1', () => {
  assert.strictEqual(supports1mContext('claude-mythos-5-1', 'claude'), true);
});

test('validateModelName accepts the [1m] suffix on fable-5-1', () => {
  const result = validateModelName('fable-5-1[1m]', 'claude');
  assert(result.valid, `fable-5-1[1m] should be valid, got: ${result.message}`);
});

// ============================================================
// Section 5: GPT-6 Astra
// ============================================================
console.log('\n=== 5. GPT-6 Astra ===');

test('gpt-6-astra is present in codexModels', () => {
  assert.strictEqual(codexModels['gpt-6-astra'], 'gpt-6-astra');
});

test('gpt-6-astra resolves in CODEX_MODELS', () => {
  assert.strictEqual(CODEX_MODELS['gpt-6-astra'], 'gpt-6-astra');
});

test('validateModelName accepts gpt-6-astra for codex', () => {
  const result = validateModelName('gpt-6-astra', 'codex');
  assert(result.valid, `gpt-6-astra should be valid, got: ${result.message}`);
  assert.strictEqual(result.mappedModel, 'gpt-6-astra');
});

test('mapModelForTool resolves gpt-6-astra for codex', () => {
  assert.strictEqual(mapModelForTool('codex', 'gpt-6-astra'), 'gpt-6-astra');
});

test('the openai/ and openai. variants of gpt-6-astra are generated', () => {
  const codexMap = getModelMapForTool('codex');
  assert.strictEqual(codexMap['openai/gpt-6-astra'], 'openai/gpt-6-astra');
  assert.strictEqual(codexMap['openai.gpt-6-astra'], 'openai.gpt-6-astra');
});

test('gpt-6-astra is listed in the codex --model help text', () => {
  assert(primaryModelNames.codex.includes('gpt-6-astra'), 'gpt-6-astra should be a primary codex model name');
});

test('gpt-6-astra appears in getAvailableModelNames for codex', () => {
  assert(getAvailableModelNames('codex').includes('gpt-6-astra'));
});

// ============================================================
// Section 6: GPT-5.6 Cyber and the Daybreak aliases
// ============================================================
console.log('\n=== 6. GPT-5.6 Cyber and Daybreak aliases ===');

test('gpt-5.6-cyber is present in codexModels', () => {
  assert.strictEqual(codexModels['gpt-5.6-cyber'], 'gpt-5.6-cyber');
});

test('validateModelName accepts gpt-5.6-cyber', () => {
  const result = validateModelName('gpt-5.6-cyber', 'codex');
  assert(result.valid, `gpt-5.6-cyber should be valid, got: ${result.message}`);
});

test('gpt-daybreak-blue-latest is present in codexModels', () => {
  assert.strictEqual(codexModels['gpt-daybreak-blue-latest'], 'gpt-daybreak-blue-latest');
});

test('gpt-daybreak-red-latest is present in codexModels', () => {
  assert.strictEqual(codexModels['gpt-daybreak-red-latest'], 'gpt-daybreak-red-latest');
});

test('validateModelName accepts both Daybreak aliases', () => {
  for (const model of ['gpt-daybreak-blue-latest', 'gpt-daybreak-red-latest']) {
    const result = validateModelName(model, 'codex');
    assert(result.valid, `${model} should be valid, got: ${result.message}`);
  }
});

// ============================================================
// Section 7: Fallback chains
// ============================================================
console.log('\n=== 7. Fallback Chains ===');

test('claude-fable-5-1 falls back to the previous Fable generation', () => {
  assert.strictEqual(defaultFallbackModels.claude['claude-fable-5-1'], 'fable-5');
});

test('claude-fable-5 still falls back to opus', () => {
  assert.strictEqual(defaultFallbackModels.claude['claude-fable-5'], 'opus');
});

test('claude-mythos-5-1 falls back to the generally available Fable model', () => {
  assert.strictEqual(defaultFallbackModels.claude['claude-mythos-5-1'], 'fable');
});

test('resolveDefaultFallbackModel walks fable -> fable-5', () => {
  assert.strictEqual(resolveDefaultFallbackModel('claude', 'fable'), 'fable-5');
});

test('gpt-6-astra falls back to gpt-5.6-sol', () => {
  assert.strictEqual(defaultFallbackModels.codex['gpt-6-astra'], 'gpt-5.6-sol');
});

test('openai.gpt-6-astra falls back to the prefixed gpt-5.6-sol', () => {
  assert.strictEqual(defaultFallbackModels.codex['openai.gpt-6-astra'], 'openai.gpt-5.6-sol');
});

test('gpt-5.6-cyber falls back to gpt-5.6-sol', () => {
  assert.strictEqual(defaultFallbackModels.codex['gpt-5.6-cyber'], 'gpt-5.6-sol');
});

test('resolveDefaultFallbackModel resolves gpt-6-astra', () => {
  assert.strictEqual(resolveDefaultFallbackModel('codex', 'gpt-6-astra'), 'gpt-5.6-sol');
});

// ============================================================
// Section 8: Defaults are deliberately unchanged
// ============================================================
console.log('\n=== 8. Defaults Unchanged (cost safety) ===');

test('the claude default stays opus (Fable 5.1 is $10/$50 vs Opus 5 $5/$25)', () => {
  assert.strictEqual(defaultModels.claude, 'opus');
});

test('the codex default stays gpt-5.6-sol (GPT-6 Astra is preview-gated)', () => {
  assert.strictEqual(defaultModels.codex, 'gpt-5.6-sol');
});

// ============================================================
// Section 9: Backward compatibility
// ============================================================
console.log('\n=== 9. Backward Compatibility ===');

const preservedClaudeAliases = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
  'fable-5': 'claude-fable-5',
  'claude-fable-5': 'claude-fable-5',
  'mythos-5': 'claude-mythos-5',
  'claude-mythos-5': 'claude-mythos-5',
  'opus-4-8': 'claude-opus-4-8',
  'sonnet-4-6': 'claude-sonnet-4-6',
};

for (const [alias, expected] of Object.entries(preservedClaudeAliases)) {
  test(`claude alias ${alias} still resolves to ${expected}`, () => {
    assert.strictEqual(claudeModels[alias], expected);
  });
}

const preservedCodexAliases = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.2', 'gpt-5.3-codex-spark'];

for (const alias of preservedCodexAliases) {
  test(`codex alias ${alias} still resolves`, () => {
    assert.strictEqual(codexModels[alias], alias);
  });
}

test('sol/terra/luna generation aliases are still complete for GPT-5.6', () => {
  // GPT-6 Astra must not partially promote the sol/terra/luna family to generation 6.
  assert.strictEqual(resolveModelId('gpt-5.6-sol', 'codex'), 'gpt-5.6-sol');
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
