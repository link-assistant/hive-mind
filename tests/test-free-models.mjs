#!/usr/bin/env node

/**
 * Comprehensive tests for all free models
 * Tests all 5 mentioned free models to ensure they work in hive-mind
 */

import { strict as assert } from 'assert';
import { validateModelName, AGENT_MODELS } from '../src/model-validation.lib.mjs';
import { mapModelForTool, isModelCompatibleWithTool, getValidModelsForTool, agentModels } from '../src/model-mapping.lib.mjs';

const FREE_MODELS = ['opencode/big-pickle', 'opencode/gpt-5-nano', 'opencode/kimi-k2.5-free', 'opencode/glm-4.7-free', 'opencode/minimax-m2.1-free'];

const SHORT_ALIASES = ['big-pickle', 'gpt-5-nano', 'kimi-k2.5-free', 'glm-4.7-free', 'minimax-m2.1-free'];

console.log('🧪 Running comprehensive free model tests...\n');

// Test 1: Model validation for full model IDs
console.log('1️⃣ Testing full model ID validation...');
for (const model of FREE_MODELS) {
  const result = validateModelName(model, 'agent');
  assert.ok(result.valid, `Model ${model} should be valid`);
  assert.strictEqual(result.mappedModel, model, `Model ${model} should map to itself`);
  console.log(`✅ ${model}: Valid and maps correctly`);
}

// Test 2: Model validation for short aliases
console.log('\n2️⃣ Testing short alias validation...');
for (const alias of SHORT_ALIASES) {
  const result = validateModelName(alias, 'agent');
  assert.ok(result.valid, `Alias ${alias} should be valid`);
  assert.ok(result.mappedModel.startsWith('opencode/'), `Alias ${alias} should map to opencode/ prefix`);
  console.log(`✅ ${alias}: Valid and maps to ${result.mappedModel}`);
}

// Test 3: AGENT_MODELS contains all free models
console.log('\n3️⃣ Testing AGENT_MODELS configuration...');
for (const model of FREE_MODELS) {
  assert.ok(model in AGENT_MODELS, `AGENT_MODELS should contain ${model}`);
  assert.strictEqual(AGENT_MODELS[model], model, `AGENT_MODELS[${model}] should equal ${model}`);
  console.log(`✅ ${model}: Found in AGENT_MODELS`);
}

for (const alias of SHORT_ALIASES) {
  assert.ok(alias in AGENT_MODELS, `AGENT_MODELS should contain alias ${alias}`);
  assert.ok(AGENT_MODELS[alias].startsWith('opencode/'), `Alias ${alias} should map to opencode/ prefix`);
  console.log(`✅ ${alias}: Found in AGENT_MODELS as ${AGENT_MODELS[alias]}`);
}

// Test 4: Model mapping consistency
console.log('\n4️⃣ Testing model mapping consistency...');
for (const model of FREE_MODELS) {
  const mapped = mapModelForTool('agent', model);
  assert.strictEqual(mapped, model, `Model ${model} should map to itself via mapModelForTool`);
  console.log(`✅ ${model}: mapModelForTool works correctly`);
}

for (const alias of SHORT_ALIASES) {
  const mapped = mapModelForTool('agent', alias);
  assert.strictEqual(mapped, AGENT_MODELS[alias], `Alias ${alias} should map consistently`);
  console.log(`✅ ${alias}: mapModelForTool works correctly`);
}

// Test 5: Tool compatibility
console.log('\n5️⃣ Testing tool compatibility...');
for (const model of FREE_MODELS) {
  const compatible = isModelCompatibleWithTool('agent', model);
  assert.ok(compatible, `Model ${model} should be compatible with agent tool`);
  console.log(`✅ ${model}: Compatible with agent tool`);
}

for (const alias of SHORT_ALIASES) {
  const compatible = isModelCompatibleWithTool('agent', alias);
  assert.ok(compatible, `Alias ${alias} should be compatible with agent tool`);
  console.log(`✅ ${alias}: Compatible with agent tool`);
}

// Test 6: Valid models list
console.log('\n6️⃣ Testing valid models list...');
const validModels = getValidModelsForTool('agent');
assert.ok(Array.isArray(validModels), 'getValidModelsForTool should return array');
assert.ok(validModels.length >= FREE_MODELS.length, 'Should have at least as many models as free models');

for (const model of FREE_MODELS) {
  const baseModel = model.replace('opencode/', '');
  assert.ok(validModels.includes(baseModel), `Valid models should include ${baseModel}`);
  console.log(`✅ ${baseModel}: Found in valid models list`);
}

// Test 7: Invalid model handling
console.log('\n7️⃣ Testing invalid model handling...');
const invalidModels = ['opencode/invalid-model', 'opencode/fake-free', 'nonexistent/model', 'invalid-format'];

for (const invalidModel of invalidModels) {
  const result = validateModelName(invalidModel, 'agent');
  assert.ok(!result.valid, `Invalid model ${invalidModel} should be rejected`);
  assert.ok(result.message, 'Should provide error message for invalid model');
  console.log(`✅ ${invalidModel}: Properly rejected`);
}

// Test 8: Case insensitive validation
console.log('\n8️⃣ Testing case insensitive validation...');
const caseVariants = ['OPENCODE/BIG-PICKLE', 'Opencode/Gpt-5-Nano', 'oPeNcOdE/kImI-k2.5-fReE', 'opencode/GLM-4.7-FREE', 'OPENCODE/minimax-m2.1-free'];

for (const caseVariant of caseVariants) {
  const result = validateModelName(caseVariant, 'agent');
  assert.ok(result.valid, `Case variant ${caseVariant} should be valid`);
  assert.ok(result.mappedModel, 'Should return mapped model for case variant');
  console.log(`✅ ${caseVariant}: Case insensitive validation works`);
}

console.log('\n🎯 All free model tests passed!');

// Test 9: Mapping between model-validation.lib.mjs and model-mapping.lib.mjs consistency
console.log('\n9️⃣ Testing consistency between validation and mapping modules...');
for (const [alias, fullModel] of Object.entries(agentModels)) {
  if (FREE_MODELS.includes(fullModel) || SHORT_ALIASES.includes(alias)) {
    const validationResult = validateModelName(alias, 'agent');
    const mappingResult = mapModelForTool('agent', alias);

    assert.strictEqual(validationResult.mappedModel, fullModel, `Validation and mapping should agree for ${alias}`);
    assert.strictEqual(mappingResult, fullModel, `mapModelForTool should return expected model for ${alias}`);
    console.log(`✅ ${alias} -> ${fullModel}: Consistent between modules`);
  }
}

console.log('\n🎉 All comprehensive free model tests completed successfully!');
