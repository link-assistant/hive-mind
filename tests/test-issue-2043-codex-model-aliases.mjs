#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression tests for issue #2043: generation-relative Codex aliases and
 * OpenAI provider-prefix normalization.
 */

import assert from 'node:assert/strict';
import { codexModels, getLatestCodexGenerationAliases, getValidModelsForTool, resolveModelId, validateModelName } from '../src/models/index.mjs';

const assertValidCodexModel = (input, expected) => {
  assert.equal(resolveModelId(input, 'codex'), expected);
  const validation = validateModelName(input, 'codex');
  assert.equal(validation.valid, true);
  assert.equal(validation.mappedModel, expected);
};

const generationAliases = {
  sol: 'gpt-5.6-sol',
  terra: 'gpt-5.6-terra',
  luna: 'gpt-5.6-luna',
};

for (const [alias, modelId] of Object.entries(generationAliases)) {
  assertValidCodexModel(alias, modelId);
  assertValidCodexModel(`openai/${alias}`, `openai/${modelId}`);
  assertValidCodexModel(`openai.${alias}`, `openai.${modelId}`);
}

const knownOpenAIModels = [...new Set(Object.values(codexModels).filter(model => !model.startsWith('openai.')))];
for (const modelId of knownOpenAIModels) {
  const bareModelId = modelId.replace(/^openai[/.]/, '');
  assertValidCodexModel(`openai/${bareModelId}`, `openai/${bareModelId}`);
  assertValidCodexModel(`openai.${bareModelId}`, `openai.${bareModelId}`);
}

assert.equal(validateModelName('openai/not-a-real-model', 'codex').valid, false);
assert.equal(validateModelName('openai.not-a-real-model', 'codex').valid, false);

assert.deepEqual(
  getLatestCodexGenerationAliases({
    'gpt-5.6-sol': 'gpt-5.6-sol',
    'gpt-5.6-terra': 'gpt-5.6-terra',
    'gpt-5.6-luna': 'gpt-5.6-luna',
    'gpt-5.7-sol': 'gpt-5.7-sol',
    'gpt-5.7-terra': 'gpt-5.7-terra',
    'gpt-5.7-luna': 'gpt-5.7-luna',
  }),
  {
    sol: 'gpt-5.7-sol',
    terra: 'gpt-5.7-terra',
    luna: 'gpt-5.7-luna',
  }
);

const validModels = getValidModelsForTool('codex');
for (const alias of Object.keys(generationAliases)) {
  assert.ok(validModels.includes(alias));
  assert.ok(validModels.includes(`openai/${alias}`));
  assert.ok(validModels.includes(`openai.${alias}`));
}

console.log('Issue #2043 Codex model alias tests passed');
