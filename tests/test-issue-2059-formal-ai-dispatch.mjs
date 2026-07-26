#!/usr/bin/env node

/**
 * Regression coverage for issue #2059.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getValidModelsForTool,
  isModelCompatibleWithTool,
  mapModelForTool,
  primaryModelNames,
  validateModelName,
} from '../src/models/index.mjs';

const FORMAL_AI_MODEL_BY_TOOL = {
  claude: 'formal-ai',
  agent: 'formalai/formal-ai',
  opencode: 'formalai/formal-ai',
  codex: 'formal-ai',
  qwen: 'formal-ai',
  gemini: 'formal-ai',
};

for (const [tool, expectedModel] of Object.entries(FORMAL_AI_MODEL_BY_TOOL)) {
  test(`--tool ${tool} accepts and maps --model formal-ai`, () => {
    const validation = validateModelName('formal-ai', tool);

    assert.equal(validation.valid, true);
    assert.equal(validation.mappedModel, expectedModel);
    assert.equal(mapModelForTool(tool, 'formal-ai'), expectedModel);
    assert.equal(isModelCompatibleWithTool(tool, 'formal-ai'), true);
    assert.ok(getValidModelsForTool(tool).includes('formal-ai'));
    assert.ok(primaryModelNames[tool].includes('formal-ai'));
  });

  test(`--tool ${tool} accepts the full formalai/formal-ai selector`, () => {
    const validation = validateModelName('formalai/formal-ai', tool);

    assert.equal(validation.valid, true);
    assert.equal(validation.mappedModel, expectedModel);
    assert.equal(mapModelForTool(tool, 'formalai/formal-ai'), expectedModel);
    assert.equal(isModelCompatibleWithTool(tool, 'formalai/formal-ai'), true);
  });
}
