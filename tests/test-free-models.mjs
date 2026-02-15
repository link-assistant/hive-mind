#!/usr/bin/env node

/**
 * Comprehensive tests for all free models
 * Tests all 11 free models (5 OpenCode Zen + 6 Kilo Gateway) to ensure they work in hive-mind
 */

import { strict as assert } from 'assert';
import { validateModelName, AGENT_MODELS } from '../src/model-validation.lib.mjs';
import { mapModelForTool, isModelCompatibleWithTool, getValidModelsForTool, agentModels } from '../src/model-mapping.lib.mjs';

// OpenCode Zen free models
const OPENCODE_FREE_MODELS = ['opencode/big-pickle', 'opencode/gpt-5-nano', 'opencode/kimi-k2.5-free', 'opencode/glm-4.7-free', 'opencode/minimax-m2.1-free'];

const OPENCODE_SHORT_ALIASES = ['big-pickle', 'gpt-5-nano', 'kimi-k2.5-free', 'glm-4.7-free', 'minimax-m2.1-free'];

// Kilo Gateway free models (Issue #1282)
const KILO_FREE_MODELS = ['kilo/glm-5-free', 'kilo/glm-4.7-free', 'kilo/kimi-k2.5-free', 'kilo/minimax-m2.1-free', 'kilo/giga-potato-free', 'kilo/trinity-large-preview'];

const KILO_SHORT_ALIASES = ['kilo/glm-5-free', 'kilo/glm-4.7-free', 'kilo/kimi-k2.5-free', 'kilo/minimax-m2.1-free', 'kilo/giga-potato-free', 'kilo/trinity-large-preview'];

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
const opencodeVariants = ['OPENCODE/BIG-PICKLE', 'Opencode/Gpt-5-Nano', 'oPeNcOdE/kImI-k2.5-fReE', 'opencode/GLM-4.7-FREE', 'OPENCODE/minimax-m2.1-free'];

for (const caseVariant of opencodeVariants) {
  const result = validateModelName(caseVariant, 'agent');
  assert.ok(result.valid, `Case variant ${caseVariant} should be valid`);
  assert.ok(result.mappedModel, 'Should return mapped model for case variant');
  console.log(`✅ ${caseVariant}: Case insensitive validation works`);
}

// Test 12: Case insensitive validation for Kilo Gateway
console.log('\n1️⃣2️⃣ Testing Kilo Gateway case insensitive validation...');
const kiloVariants = ['KILO/GLM-5-FREE', 'Kilo/Glm-4.7-Free', 'kIlO/kImI-k2.5-fReE', 'kilo/MINIMAX-M2.1-FREE', 'KILO/trinity-large-preview'];

for (const caseVariant of kiloVariants) {
  const result = validateModelName(caseVariant, 'agent');
  assert.ok(result.valid, `Case variant ${caseVariant} should be valid`);
  assert.ok(result.mappedModel, 'Should return mapped model for case variant');
  console.log(`✅ ${caseVariant}: Case insensitive validation works`);
}

console.log('\n🎯 All free model tests passed!');

// Test 13: Mapping between model-validation.lib.mjs and model-mapping.lib.mjs consistency
console.log('\n1️⃣3️⃣ Testing consistency between validation and mapping modules...');
for (const [alias, fullModel] of Object.entries(agentModels)) {
  if (ALL_FREE_MODELS.includes(fullModel) || OPENCODE_SHORT_ALIASES.includes(alias) || KILO_SHORT_ALIASES.includes(alias)) {
    const validationResult = validateModelName(alias, 'agent');
    const mappingResult = mapModelForTool('agent', alias);

    assert.strictEqual(validationResult.mappedModel, fullModel, `Validation and mapping should agree for ${alias}`);
    assert.strictEqual(mappingResult, fullModel, `mapModelForTool should return expected model for ${alias}`);
    console.log(`✅ ${alias} -> ${fullModel}: Consistent between modules`);
  }
}

console.log('\n🎉 All comprehensive free model tests completed successfully!');
console.log(`📊 Summary: ${OPENCODE_FREE_MODELS.length} OpenCode + ${KILO_FREE_MODELS.length} Kilo = ${ALL_FREE_MODELS.length} total free models tested`);
