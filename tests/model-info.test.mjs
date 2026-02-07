#!/usr/bin/env node
/**
 * Model Information Library Unit Tests
 *
 * Tests for the model-info.lib.mjs module, including:
 * - getToolDisplayName() mapping
 * - buildModelInfoString() output formatting
 * - resolveModelId() alias resolution
 *
 * Run with: node tests/model-info.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1225
 */

import assert from 'node:assert/strict';
import { getToolDisplayName, buildModelInfoString, resolveModelId } from '../src/model-info.lib.mjs';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

// ============================================================================
// getToolDisplayName Tests
// ============================================================================

console.log('\n📋 getToolDisplayName Tests\n');

test('getToolDisplayName returns "Claude" for claude', () => {
  assert.equal(getToolDisplayName('claude'), 'Claude');
});

test('getToolDisplayName returns "Codex" for codex', () => {
  assert.equal(getToolDisplayName('codex'), 'Codex');
});

test('getToolDisplayName returns "OpenCode" for opencode', () => {
  assert.equal(getToolDisplayName('opencode'), 'OpenCode');
});

test('getToolDisplayName returns "Agent" for agent', () => {
  assert.equal(getToolDisplayName('agent'), 'Agent');
});

test('getToolDisplayName returns "AI tool" for unknown', () => {
  assert.equal(getToolDisplayName('unknown'), 'AI tool');
});

test('getToolDisplayName returns "AI tool" for null', () => {
  assert.equal(getToolDisplayName(null), 'AI tool');
});

test('getToolDisplayName returns "AI tool" for undefined', () => {
  assert.equal(getToolDisplayName(undefined), 'AI tool');
});

test('getToolDisplayName is case-insensitive', () => {
  assert.equal(getToolDisplayName('Claude'), 'Claude');
  assert.equal(getToolDisplayName('CLAUDE'), 'Claude');
  assert.equal(getToolDisplayName('CODEX'), 'Codex');
});

// ============================================================================
// resolveModelId Tests
// ============================================================================

console.log('\n📋 resolveModelId Tests\n');

test('resolveModelId resolves "opus" for claude tool', () => {
  assert.equal(resolveModelId('opus', 'claude'), 'claude-opus-4-6');
});

test('resolveModelId resolves "sonnet" for claude tool', () => {
  assert.equal(resolveModelId('sonnet', 'claude'), 'claude-sonnet-4-5-20250929');
});

test('resolveModelId resolves "haiku" for claude tool', () => {
  assert.equal(resolveModelId('haiku', 'claude'), 'claude-haiku-4-5-20251001');
});

test('resolveModelId resolves "grok" for agent tool', () => {
  assert.equal(resolveModelId('grok', 'agent'), 'opencode/grok-code');
});

test('resolveModelId resolves "sonnet" for agent tool', () => {
  assert.equal(resolveModelId('sonnet', 'agent'), 'anthropic/claude-3-5-sonnet');
});

test('resolveModelId resolves "gpt5" for codex tool', () => {
  assert.equal(resolveModelId('gpt5', 'codex'), 'gpt-5');
});

test('resolveModelId strips [1m] suffix', () => {
  assert.equal(resolveModelId('opus[1m]', 'claude'), 'claude-opus-4-6');
  assert.equal(resolveModelId('sonnet[1M]', 'claude'), 'claude-sonnet-4-5-20250929');
});

test('resolveModelId returns null for null input', () => {
  assert.equal(resolveModelId(null, 'claude'), null);
});

test('resolveModelId returns model as-is for unknown alias', () => {
  assert.equal(resolveModelId('custom-model', 'claude'), 'custom-model');
});

test('resolveModelId defaults to claude tool when tool is null', () => {
  assert.equal(resolveModelId('opus', null), 'claude-opus-4-6');
});

// ============================================================================
// buildModelInfoString Tests
// ============================================================================

console.log('\n📋 buildModelInfoString Tests\n');

test('buildModelInfoString returns empty string when no data', () => {
  assert.equal(buildModelInfoString({}), '');
  assert.equal(buildModelInfoString(), '');
});

test('buildModelInfoString includes tool name', () => {
  const result = buildModelInfoString({ tool: 'claude', requestedModel: 'opus' });
  assert.ok(result.includes('Tool: Claude'), `Expected "Tool: Claude" but got: ${result}`);
});

test('buildModelInfoString includes requested model', () => {
  const result = buildModelInfoString({ requestedModel: 'opus' });
  assert.ok(result.includes('Requested model: `opus`'), `Expected "Requested model: \`opus\`" but got: ${result}`);
});

test('buildModelInfoString includes model info from models.dev', () => {
  const modelInfo = {
    name: 'Claude Opus 4.6',
    id: 'claude-opus-4-6',
    provider: 'Anthropic',
    knowledge: '2025-05',
  };
  const result = buildModelInfoString({ modelInfo });
  assert.ok(result.includes('Model: Claude Opus 4.6'), `Expected model name but got: ${result}`);
  assert.ok(result.includes('Model ID: `claude-opus-4-6`'), `Expected model ID but got: ${result}`);
  assert.ok(result.includes('Provider: Anthropic'), `Expected provider but got: ${result}`);
  assert.ok(result.includes('Knowledge cutoff: 2025-05'), `Expected knowledge cutoff but got: ${result}`);
});

test('buildModelInfoString falls back to pricingInfo when no modelInfo', () => {
  const pricingInfo = {
    modelName: 'grok-code',
    provider: 'OpenCode',
  };
  const result = buildModelInfoString({ pricingInfo });
  assert.ok(result.includes('Model: grok-code'), `Expected model name from pricingInfo but got: ${result}`);
  assert.ok(result.includes('Provider: OpenCode'), `Expected provider from pricingInfo but got: ${result}`);
});

test('buildModelInfoString includes header emoji', () => {
  const result = buildModelInfoString({ requestedModel: 'opus' });
  assert.ok(result.includes('🤖 **Model information:**'), `Expected header but got: ${result}`);
});

test('buildModelInfoString with full data shows all fields', () => {
  const result = buildModelInfoString({
    requestedModel: 'opus',
    tool: 'claude',
    modelInfo: {
      name: 'Claude Opus 4.6',
      id: 'claude-opus-4-6',
      provider: 'Anthropic',
      knowledge: '2025-05',
    },
  });
  assert.ok(result.includes('Tool: Claude'));
  assert.ok(result.includes('Requested model: `opus`'));
  assert.ok(result.includes('Model: Claude Opus 4.6'));
  assert.ok(result.includes('Provider: Anthropic'));
  assert.ok(result.includes('Knowledge cutoff: 2025-05'));
});

test('buildModelInfoString handles modelInfo without knowledge cutoff', () => {
  const result = buildModelInfoString({
    modelInfo: { name: 'Some Model', id: 'some-model' },
  });
  assert.ok(result.includes('Model: Some Model'));
  assert.ok(!result.includes('Knowledge cutoff'));
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
