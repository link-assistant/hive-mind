#!/usr/bin/env node

/**
 * Comprehensive tests for all free models
 * Tests all 10 free models (4 OpenCode Zen + 6 Kilo Gateway) to ensure they work in hive-mind
 * Issue #1300: Updated free models - minimax-m2.5-free replaces m2.1, glm-4.7-free removed from OpenCode
 */

import { strict as assert } from 'assert';
import { validateModelName, AGENT_MODELS } from '../src/model-validation.lib.mjs';
import { mapModelForTool, isModelCompatibleWithTool, getValidModelsForTool, agentModels } from '../src/model-mapping.lib.mjs';

// OpenCode Zen free models (current - Issue #1300)
const OPENCODE_FREE_MODELS = ['opencode/big-pickle', 'opencode/gpt-5-nano', 'opencode/kimi-k2.5-free', 'opencode/minimax-m2.5-free'];

const OPENCODE_SHORT_ALIASES = ['big-pickle', 'gpt-5-nano', 'kimi-k2.5-free', 'minimax-m2.5-free'];

// Kilo Gateway free models (Issue #1282, updated in #1300)
const KILO_FREE_MODELS = ['kilo/glm-5-free', 'kilo/glm-4.5-air-free', 'kilo/minimax-m2.5-free', 'kilo/deepseek-r1-free', 'kilo/giga-potato-free', 'kilo/trinity-large-preview'];

// Kilo-exclusive models also support short aliases without kilo/ prefix (Issue #1300)
const KILO_SHORT_ALIASES = ['kilo/glm-5-free', 'kilo/glm-4.5-air-free', 'kilo/minimax-m2.5-free', 'kilo/deepseek-r1-free', 'kilo/giga-potato-free', 'kilo/trinity-large-preview'];

const KILO_EXCLUSIVE_SHORT_ALIASES = ['glm-5-free', 'glm-4.5-air-free', 'deepseek-r1-free', 'giga-potato-free', 'trinity-large-preview'];

// Deprecated models (still work for backward compatibility but not recommended)
const DEPRECATED_OPENCODE_MODELS = ['opencode/glm-4.7-free', 'opencode/minimax-m2.1-free'];
const DEPRECATED_KILO_MODELS = ['kilo/glm-4.7-free', 'kilo/kimi-k2.5-free', 'kilo/minimax-m2.1-free'];

// Combined lists
const ALL_FREE_MODELS = [...OPENCODE_FREE_MODELS, ...KILO_FREE_MODELS];

console.log('🧪 Running comprehensive free model tests...\n');
console.log(`📊 Testing ${OPENCODE_FREE_MODELS.length} OpenCode Zen models and ${KILO_FREE_MODELS.length} Kilo Gateway models\n`);

// Test 1: OpenCode Zen model validation for full model IDs
console.log('1️⃣ Testing OpenCode Zen full model ID validation...');
for (const model of OPENCODE_FREE_MODELS) {
  const result = validateModelName(model, 'agent');
  assert.ok(result.valid, `Model ${model} should be valid`);
  assert.strictEqual(result.mappedModel, model, `Model ${model} should map to itself`);
  console.log(`✅ ${model}: Valid and maps correctly`);
}

// Test 2: Kilo Gateway model validation for full model IDs
console.log('\n2️⃣ Testing Kilo Gateway full model ID validation...');
for (const model of KILO_FREE_MODELS) {
  const result = validateModelName(model, 'agent');
  assert.ok(result.valid, `Model ${model} should be valid`);
  assert.strictEqual(result.mappedModel, model, `Model ${model} should map to itself`);
  console.log(`✅ ${model}: Valid and maps correctly`);
}

// Test 3: OpenCode Zen model validation for short aliases
console.log('\n3️⃣ Testing OpenCode Zen short alias validation...');
for (const alias of OPENCODE_SHORT_ALIASES) {
  const result = validateModelName(alias, 'agent');
  assert.ok(result.valid, `Alias ${alias} should be valid`);
  assert.ok(result.mappedModel.startsWith('opencode/'), `Alias ${alias} should map to opencode/ prefix`);
  console.log(`✅ ${alias}: Valid and maps to ${result.mappedModel}`);
}

// Test 4: Kilo Gateway model validation for short aliases
console.log('\n4️⃣ Testing Kilo Gateway short alias validation...');
for (const alias of KILO_SHORT_ALIASES) {
  const result = validateModelName(alias, 'agent');
  assert.ok(result.valid, `Alias ${alias} should be valid`);
  assert.ok(result.mappedModel.startsWith('kilo/'), `Alias ${alias} should map to kilo/ prefix, got ${result.mappedModel}`);
  console.log(`✅ ${alias}: Valid and maps to ${result.mappedModel}`);
}

// Test 4.5: Kilo-exclusive models support short names without kilo/ prefix
console.log('\n4️⃣.5️⃣ Testing Kilo-exclusive short names without provider prefix...');
for (const alias of KILO_EXCLUSIVE_SHORT_ALIASES) {
  const result = validateModelName(alias, 'agent');
  assert.ok(result.valid, `Alias ${alias} should be valid`);
  assert.ok(result.mappedModel.startsWith('kilo/'), `Alias ${alias} should map to kilo/ prefix, got ${result.mappedModel}`);
  console.log(`✅ ${alias}: Valid and maps to ${result.mappedModel}`);
}

// Test 5: AGENT_MODELS contains all free models
console.log('\n5️⃣ Testing AGENT_MODELS configuration...');
for (const model of ALL_FREE_MODELS) {
  assert.ok(model in AGENT_MODELS, `AGENT_MODELS should contain ${model}`);
  assert.strictEqual(AGENT_MODELS[model], model, `AGENT_MODELS[${model}] should equal ${model}`);
  console.log(`✅ ${model}: Found in AGENT_MODELS`);
}

for (const alias of OPENCODE_SHORT_ALIASES) {
  assert.ok(alias in AGENT_MODELS, `AGENT_MODELS should contain alias ${alias}`);
  assert.ok(AGENT_MODELS[alias].startsWith('opencode/'), `Alias ${alias} should map to opencode/ prefix`);
  console.log(`✅ ${alias}: Found in AGENT_MODELS as ${AGENT_MODELS[alias]}`);
}

for (const alias of KILO_SHORT_ALIASES) {
  assert.ok(alias in AGENT_MODELS, `AGENT_MODELS should contain alias ${alias}`);
  assert.ok(AGENT_MODELS[alias].startsWith('kilo/'), `Alias ${alias} should map to kilo/ prefix`);
  console.log(`✅ ${alias}: Found in AGENT_MODELS as ${AGENT_MODELS[alias]}`);
}

for (const alias of KILO_EXCLUSIVE_SHORT_ALIASES) {
  assert.ok(alias in AGENT_MODELS, `AGENT_MODELS should contain Kilo-exclusive alias ${alias}`);
  assert.ok(AGENT_MODELS[alias].startsWith('kilo/'), `Alias ${alias} should map to kilo/ prefix`);
  console.log(`✅ ${alias}: Found in AGENT_MODELS as ${AGENT_MODELS[alias]}`);
}

// Test 6: Model mapping consistency for OpenCode Zen
console.log('\n6️⃣ Testing OpenCode Zen model mapping consistency...');
for (const model of OPENCODE_FREE_MODELS) {
  const mapped = mapModelForTool('agent', model);
  assert.strictEqual(mapped, model, `Model ${model} should map to itself via mapModelForTool`);
  console.log(`✅ ${model}: mapModelForTool works correctly`);
}

for (const alias of OPENCODE_SHORT_ALIASES) {
  const mapped = mapModelForTool('agent', alias);
  assert.strictEqual(mapped, AGENT_MODELS[alias], `Alias ${alias} should map consistently`);
  console.log(`✅ ${alias}: mapModelForTool works correctly`);
}

// Test 7: Model mapping consistency for Kilo Gateway
console.log('\n7️⃣ Testing Kilo Gateway model mapping consistency...');
for (const model of KILO_FREE_MODELS) {
  const mapped = mapModelForTool('agent', model);
  assert.strictEqual(mapped, model, `Model ${model} should map to itself via mapModelForTool`);
  console.log(`✅ ${model}: mapModelForTool works correctly`);
}

for (const alias of KILO_SHORT_ALIASES) {
  const mapped = mapModelForTool('agent', alias);
  assert.strictEqual(mapped, AGENT_MODELS[alias], `Alias ${alias} should map consistently`);
  console.log(`✅ ${alias}: mapModelForTool works correctly`);
}

for (const alias of KILO_EXCLUSIVE_SHORT_ALIASES) {
  const mapped = mapModelForTool('agent', alias);
  assert.strictEqual(mapped, AGENT_MODELS[alias], `Kilo-exclusive alias ${alias} should map consistently`);
  console.log(`✅ ${alias}: mapModelForTool works correctly (Kilo-exclusive)`);
}

// Test 8: Tool compatibility
console.log('\n8️⃣ Testing tool compatibility...');
for (const model of ALL_FREE_MODELS) {
  const compatible = isModelCompatibleWithTool('agent', model);
  assert.ok(compatible, `Model ${model} should be compatible with agent tool`);
  console.log(`✅ ${model}: Compatible with agent tool`);
}

// Test 9: Valid models list
console.log('\n9️⃣ Testing valid models list...');
const validModels = getValidModelsForTool('agent');
assert.ok(Array.isArray(validModels), 'getValidModelsForTool should return array');
assert.ok(validModels.length >= ALL_FREE_MODELS.length, 'Should have at least as many models as free models');

for (const model of OPENCODE_FREE_MODELS) {
  const baseModel = model.replace('opencode/', '');
  assert.ok(validModels.includes(baseModel), `Valid models should include ${baseModel}`);
  console.log(`✅ ${baseModel}: Found in valid models list`);
}

// Test 10: Invalid model handling
console.log('\n🔟 Testing invalid model handling...');
const invalidModels = ['opencode/invalid-model', 'opencode/fake-free', 'kilo/invalid-model', 'nonexistent/model', 'invalid-format'];

for (const invalidModel of invalidModels) {
  const result = validateModelName(invalidModel, 'agent');
  assert.ok(!result.valid, `Invalid model ${invalidModel} should be rejected`);
  assert.ok(result.message, 'Should provide error message for invalid model');
  console.log(`✅ ${invalidModel}: Properly rejected`);
}

// Test 11: Case insensitive validation for OpenCode Zen
console.log('\n1️⃣1️⃣ Testing OpenCode Zen case insensitive validation...');
const opencodeVariants = ['OPENCODE/BIG-PICKLE', 'Opencode/Gpt-5-Nano', 'oPeNcOdE/kImI-k2.5-fReE', 'OPENCODE/minimax-m2.5-free'];

for (const caseVariant of opencodeVariants) {
  const result = validateModelName(caseVariant, 'agent');
  assert.ok(result.valid, `Case variant ${caseVariant} should be valid`);
  assert.ok(result.mappedModel, 'Should return mapped model for case variant');
  console.log(`✅ ${caseVariant}: Case insensitive validation works`);
}

// Test 12: Case insensitive validation for Kilo Gateway
console.log('\n1️⃣2️⃣ Testing Kilo Gateway case insensitive validation...');
const kiloVariants = ['KILO/GLM-5-FREE', 'Kilo/Glm-4.5-Air-Free', 'kIlO/dEePsEeK-r1-fReE', 'kilo/MINIMAX-M2.5-FREE', 'KILO/trinity-large-preview'];

for (const caseVariant of kiloVariants) {
  const result = validateModelName(caseVariant, 'agent');
  assert.ok(result.valid, `Case variant ${caseVariant} should be valid`);
  assert.ok(result.mappedModel, 'Should return mapped model for case variant');
  console.log(`✅ ${caseVariant}: Case insensitive validation works`);
}

// Test 12.5: Case insensitive validation for Kilo-exclusive short aliases
console.log('\n1️⃣2️⃣.5️⃣ Testing Kilo-exclusive short aliases case insensitive validation...');
const kiloExclusiveVariants = ['GLM-5-FREE', 'Glm-4.5-Air-Free', 'dEePsEeK-r1-fReE', 'GIGA-POTATO-FREE', 'Trinity-Large-Preview'];

for (const caseVariant of kiloExclusiveVariants) {
  const result = validateModelName(caseVariant, 'agent');
  assert.ok(result.valid, `Case variant ${caseVariant} should be valid`);
  assert.ok(result.mappedModel.startsWith('kilo/'), `Should map to kilo/ prefix for ${caseVariant}`);
  console.log(`✅ ${caseVariant}: Case insensitive validation works (maps to ${result.mappedModel})`);
}

// Test 14: Deprecated models still work for backward compatibility
console.log('\n1️⃣4️⃣ Testing deprecated models backward compatibility...');
const allDeprecatedModels = [...DEPRECATED_OPENCODE_MODELS, ...DEPRECATED_KILO_MODELS];
for (const deprecatedModel of allDeprecatedModels) {
  const result = validateModelName(deprecatedModel, 'agent');
  assert.ok(result.valid, `Deprecated model ${deprecatedModel} should still be valid for backward compatibility`);
  console.log(`✅ ${deprecatedModel}: Deprecated but still works`);
}

console.log('\n🎯 All free model tests passed!');

// Test 13: Mapping between model-validation.lib.mjs and model-mapping.lib.mjs consistency
console.log('\n1️⃣3️⃣ Testing consistency between validation and mapping modules...');
for (const [alias, fullModel] of Object.entries(agentModels)) {
  if (ALL_FREE_MODELS.includes(fullModel) || OPENCODE_SHORT_ALIASES.includes(alias) || KILO_SHORT_ALIASES.includes(alias) || KILO_EXCLUSIVE_SHORT_ALIASES.includes(alias)) {
    const validationResult = validateModelName(alias, 'agent');
    const mappingResult = mapModelForTool('agent', alias);

    assert.strictEqual(validationResult.mappedModel, fullModel, `Validation and mapping should agree for ${alias}`);
    assert.strictEqual(mappingResult, fullModel, `mapModelForTool should return expected model for ${alias}`);
    console.log(`✅ ${alias} -> ${fullModel}: Consistent between modules`);
  }
}

// Test 15: agent.lib.mjs mapModelToId consistency (Issue #1300 - PR feedback)
// The mapModelToId function in agent.lib.mjs is the ACTUAL production mapping used
// when executing agent CLI commands. It must be consistent with model-mapping.lib.mjs.
console.log('\n1️⃣5️⃣ Testing agent.lib.mjs mapModelToId consistency...');
const { mapModelToId } = await import('../src/agent.lib.mjs');

// Verify no moonshot/ prefix is used - only opencode/ and kilo/ for free models
const freeShortNames = [...OPENCODE_SHORT_ALIASES, ...KILO_EXCLUSIVE_SHORT_ALIASES];
for (const shortName of freeShortNames) {
  const mappedByAgentLib = mapModelToId(shortName);
  const mappedByMappingLib = mapModelForTool('agent', shortName);

  // Critical: agent.lib.mjs should never use moonshot/ prefix
  assert.ok(!mappedByAgentLib.startsWith('moonshot/'), `mapModelToId(${shortName}) should NOT use moonshot/ prefix, got ${mappedByAgentLib}`);

  // Verify it uses only opencode/ or kilo/ prefix
  assert.ok(mappedByAgentLib.startsWith('opencode/') || mappedByAgentLib.startsWith('kilo/'), `mapModelToId(${shortName}) should use opencode/ or kilo/ prefix, got ${mappedByAgentLib}`);

  // Verify consistency between agent.lib.mjs and model-mapping.lib.mjs
  assert.strictEqual(mappedByAgentLib, mappedByMappingLib, `mapModelToId(${shortName})=${mappedByAgentLib} should match mapModelForTool(agent, ${shortName})=${mappedByMappingLib}`);

  console.log(`✅ ${shortName} -> ${mappedByAgentLib}: Consistent (no moonshot/ prefix)`);
}

// Test 16: Default model kimi-k2.5-free maps correctly through agent.lib.mjs
console.log('\n1️⃣6️⃣ Testing default model (kimi-k2.5-free) through agent.lib.mjs...');
const defaultModel = 'kimi-k2.5-free';
const defaultMapped = mapModelToId(defaultModel);
assert.strictEqual(defaultMapped, 'opencode/kimi-k2.5-free', `Default model ${defaultModel} should map to opencode/kimi-k2.5-free, got ${defaultMapped}`);
assert.ok(!defaultMapped.startsWith('moonshot/'), `Default model should NOT use moonshot/ prefix`);
console.log(`✅ ${defaultModel} -> ${defaultMapped}: Default model maps correctly`);

console.log('\n🎉 All comprehensive free model tests completed successfully!');
console.log(`📊 Summary: ${OPENCODE_FREE_MODELS.length} OpenCode + ${KILO_FREE_MODELS.length} Kilo = ${ALL_FREE_MODELS.length} total free models tested`);
