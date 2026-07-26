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
import { resolveFormalAiToolInvocation } from '../src/formal-ai.lib.mjs';

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

  test(`--tool ${tool} dispatches --model formal-ai through formal-ai with`, () => {
    const invocation = resolveFormalAiToolInvocation({
      tool,
      model: 'formal-ai',
      toolPath: `/opt/hive/${tool}`,
      env: {},
    });

    assert.equal(invocation.command, 'formal-ai');
    assert.deepEqual(invocation.args, ['with', tool]);
    assert.equal(invocation.displayCommand, `formal-ai with ${tool}`);
    assert.equal(invocation.formalAi, true);
  });
}

test('a non-Formal-AI model keeps its configured tool command', () => {
  const invocation = resolveFormalAiToolInvocation({
    tool: 'agent',
    model: 'nemotron-3-super-free',
    toolPath: '/opt/hive/agent',
    env: {},
  });

  assert.equal(invocation.command, '/opt/hive/agent');
  assert.deepEqual(invocation.args, []);
  assert.equal(invocation.displayCommand, '/opt/hive/agent');
  assert.equal(invocation.formalAi, false);
});

test('a configured persistent server disables the wrapper-owned temporary server', () => {
  const invocation = resolveFormalAiToolInvocation({
    tool: 'codex',
    model: 'formal-ai',
    toolPath: 'codex',
    env: {
      HIVE_MIND_FORMAL_AI_PATH: '/opt/formal ai/formal-ai',
      HIVE_MIND_FORMAL_AI_BASE_URL: 'http://link-assistant-formal-ai:8080',
    },
  });

  assert.equal(invocation.command, '/opt/formal ai/formal-ai');
  assert.deepEqual(invocation.args, ['with', '--base-url', 'http://link-assistant-formal-ai:8080', '--no-start-server', 'codex']);
  assert.equal(invocation.displayCommand, "'/opt/formal ai/formal-ai' with --base-url http://link-assistant-formal-ai:8080 --no-start-server codex");
});
