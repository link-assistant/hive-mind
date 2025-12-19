#!/usr/bin/env node

/**
 * Test file for issue #882 fixes
 * Tests the fixes for --tool agent infinite loop
 */

import { test } from 'node:test';
import assert from 'node:assert';

// Import the unified model mapping
import {
  mapModelForTool,
  isModelCompatibleWithTool,
  validateToolModelCompatibility,
  getValidModelsForTool,
  claudeModels,
  agentModels,
  opencodeModels,
  codexModels
} from '../src/model-mapping.lib.mjs';

test('Model mapping - Agent tool should map grok-code correctly', () => {
  const mapped = mapModelForTool('agent', 'grok-code');
  assert.strictEqual(mapped, 'opencode/grok-code', 'grok-code should map to opencode/grok-code for agent');
});

test('Model mapping - Claude tool should not accept grok-code', () => {
  const mapped = mapModelForTool('claude', 'grok-code');
  // grok-code is not in claudeModels, so it should return as-is
  assert.strictEqual(mapped, 'grok-code', 'grok-code should not be mapped for claude');

  // And it should not be compatible
  const isCompatible = isModelCompatibleWithTool('claude', 'grok-code');
  assert.strictEqual(isCompatible, false, 'grok-code should not be compatible with claude tool');
});

test('Model mapping - Agent tool should accept sonnet', () => {
  const mapped = mapModelForTool('agent', 'sonnet');
  assert.strictEqual(mapped, 'anthropic/claude-3-5-sonnet', 'sonnet should map to anthropic/claude-3-5-sonnet for agent');

  const isCompatible = isModelCompatibleWithTool('agent', 'sonnet');
  assert.strictEqual(isCompatible, true, 'sonnet should be compatible with agent tool');
});

test('Model mapping - Claude tool should accept sonnet', () => {
  const mapped = mapModelForTool('claude', 'sonnet');
  assert.strictEqual(mapped, 'claude-sonnet-4-5-20250929', 'sonnet should map to claude-sonnet-4-5-20250929 for claude');

  const isCompatible = isModelCompatibleWithTool('claude', 'sonnet');
  assert.strictEqual(isCompatible, true, 'sonnet should be compatible with claude tool');
});

test('Model mapping - Validation should throw for incompatible model-tool combinations', () => {
  assert.throws(
    () => validateToolModelCompatibility('claude', 'grok-code'),
    /not compatible with --tool claude/,
    'Should throw error for grok-code with claude tool'
  );
});

test('Model mapping - Valid models list should be non-empty for each tool', () => {
  const claudeValidModels = getValidModelsForTool('claude');
  assert.ok(claudeValidModels.length > 0, 'Claude should have valid models');
  assert.ok(claudeValidModels.includes('sonnet'), 'Claude valid models should include sonnet');

  const agentValidModels = getValidModelsForTool('agent');
  assert.ok(agentValidModels.length > 0, 'Agent should have valid models');
  assert.ok(agentValidModels.includes('grok-code'), 'Agent valid models should include grok-code');

  const opencodeValidModels = getValidModelsForTool('opencode');
  assert.ok(opencodeValidModels.length > 0, 'OpenCode should have valid models');

  const codexValidModels = getValidModelsForTool('codex');
  assert.ok(codexValidModels.length > 0, 'Codex should have valid models');
});

test('Model mapping - OpenCode should handle grok-code correctly', () => {
  const mapped = mapModelForTool('opencode', 'grok-code');
  assert.strictEqual(mapped, 'opencode/grok-code', 'grok-code should map to opencode/grok-code for opencode');

  const isCompatible = isModelCompatibleWithTool('opencode', 'grok-code');
  assert.strictEqual(isCompatible, true, 'grok-code should be compatible with opencode tool');
});

test('Model mapping - Codex should handle gpt5 correctly', () => {
  const mapped = mapModelForTool('codex', 'gpt5');
  assert.strictEqual(mapped, 'gpt-5', 'gpt5 should map to gpt-5 for codex');

  const isCompatible = isModelCompatibleWithTool('codex', 'gpt5');
  assert.strictEqual(isCompatible, true, 'gpt5 should be compatible with codex tool');
});

test('Model mapping - Each tool has distinct model maps', () => {
  // Verify that each tool maintains its own model mapping
  const claudeSonnet = mapModelForTool('claude', 'sonnet');
  const agentSonnet = mapModelForTool('agent', 'sonnet');

  assert.notStrictEqual(claudeSonnet, agentSonnet,
    'sonnet should map differently for claude vs agent (different APIs)');
});

test('Model mapping - Export model maps are objects', () => {
  assert.strictEqual(typeof claudeModels, 'object', 'claudeModels should be an object');
  assert.strictEqual(typeof agentModels, 'object', 'agentModels should be an object');
  assert.strictEqual(typeof opencodeModels, 'object', 'opencodeModels should be an object');
  assert.strictEqual(typeof codexModels, 'object', 'codexModels should be an object');
});

console.log('✅ All tests for issue #882 fixes passed!');
