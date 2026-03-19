#!/usr/bin/env node
/**
 * Model Information Library Unit Tests
 *
 * Tests for the model-info.lib.mjs module, including:
 * - getToolDisplayName() mapping
 * - buildModelInfoString() output formatting
 * - resolveModelId() alias resolution
 * - modelsUsed actual-vs-requested display
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
  // opus maps to claude-opus-4-5 in current mapping
  const result = resolveModelId('opus', 'claude');
  assert.ok(result.startsWith('claude-opus'), `Expected claude-opus prefix but got: ${result}`);
});

test('resolveModelId resolves "sonnet" for claude tool', () => {
  const result = resolveModelId('sonnet', 'claude');
  assert.ok(result.startsWith('claude-sonnet'), `Expected claude-sonnet prefix but got: ${result}`);
});

test('resolveModelId resolves "haiku" for claude tool', () => {
  const result = resolveModelId('haiku', 'claude');
  assert.ok(result.startsWith('claude-haiku'), `Expected claude-haiku prefix but got: ${result}`);
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
  const result = resolveModelId('opus[1m]', 'claude');
  assert.ok(result.startsWith('claude-opus'), `Expected claude-opus prefix but got: ${result}`);
  const result2 = resolveModelId('sonnet[1M]', 'claude');
  assert.ok(result2.startsWith('claude-sonnet'), `Expected claude-sonnet prefix but got: ${result2}`);
});

test('resolveModelId returns null for null input', () => {
  assert.equal(resolveModelId(null, 'claude'), null);
});

test('resolveModelId returns model as-is for unknown alias', () => {
  assert.equal(resolveModelId('custom-model', 'claude'), 'custom-model');
});

test('resolveModelId defaults to claude tool when tool is null', () => {
  const result = resolveModelId('opus', null);
  assert.ok(result.startsWith('claude-opus'), `Expected claude-opus prefix but got: ${result}`);
});

// ============================================================================
// buildModelInfoString Tests - New format with modelsUsed
// ============================================================================

console.log('\n📋 buildModelInfoString Tests\n');

test('buildModelInfoString returns empty string when no data', () => {
  assert.equal(buildModelInfoString({}), '');
  assert.equal(buildModelInfoString(), '');
});

test('buildModelInfoString includes tool name', () => {
  const result = buildModelInfoString({
    tool: 'claude',
    requestedModel: 'opus',
    modelsUsed: [{ modelId: 'claude-opus-4-5-20251101', modelInfo: null }],
  });
  assert.ok(result.includes('Tool: Claude'), `Expected "Tool: Claude" but got: ${result}`);
});

test('buildModelInfoString includes requested model', () => {
  const result = buildModelInfoString({
    requestedModel: 'opus',
    modelsUsed: [{ modelId: 'claude-opus-4-5-20251101', modelInfo: null }],
  });
  assert.ok(result.includes('Requested: `opus`'), `Expected "Requested: \`opus\`" but got: ${result}`);
});

test('buildModelInfoString shows header emoji', () => {
  const result = buildModelInfoString({
    requestedModel: 'opus',
    modelsUsed: [{ modelId: 'claude-opus-4-5-20251101', modelInfo: null }],
  });
  assert.ok(result.includes('🤖 **Models used:**'), `Expected header but got: ${result}`);
});

test('buildModelInfoString shows main model in bold when matches requested', () => {
  const result = buildModelInfoString({
    requestedModel: 'opus',
    tool: 'claude',
    modelsUsed: [
      {
        modelId: 'claude-opus-4-5-20251101',
        modelInfo: { name: 'Claude Opus 4.5', provider: 'Anthropic', knowledge: '2025-09' },
      },
    ],
  });
  assert.ok(result.includes('**Main model: Claude Opus 4.5**'), `Expected bold main model but got: ${result}`);
  assert.ok(!result.includes('⚠️'), `Should not have warning when model matches but got: ${result}`);
});

test('buildModelInfoString shows warning when main model does not match requested', () => {
  const result = buildModelInfoString({
    requestedModel: 'opus',
    tool: 'claude',
    modelsUsed: [
      {
        modelId: 'claude-sonnet-4-6',
        modelInfo: { name: 'Claude Sonnet 4.6', provider: 'Anthropic' },
      },
    ],
  });
  assert.ok(result.includes('**Main model: Claude Sonnet 4.6**'), `Expected bold main model but got: ${result}`);
  assert.ok(result.includes('⚠️'), `Expected warning when model doesn't match but got: ${result}`);
  assert.ok(result.includes('does not match requested'), `Expected mismatch message but got: ${result}`);
});

test('buildModelInfoString shows supporting models', () => {
  const result = buildModelInfoString({
    requestedModel: 'opus',
    tool: 'claude',
    modelsUsed: [
      { modelId: 'claude-opus-4-5-20251101', modelInfo: { name: 'Claude Opus 4.5', provider: 'Anthropic' } },
      { modelId: 'claude-haiku-4-5-20251001', modelInfo: { name: 'Claude Haiku 4.5', provider: 'Anthropic' } },
    ],
  });
  assert.ok(result.includes('Supporting models:'), `Expected "Supporting models:" but got: ${result}`);
  assert.ok(result.includes('Claude Haiku 4.5'), `Expected haiku model in supporting but got: ${result}`);
});

test('buildModelInfoString with model metadata shows ID and provider', () => {
  const result = buildModelInfoString({
    requestedModel: 'opus',
    tool: 'claude',
    modelsUsed: [
      {
        modelId: 'claude-opus-4-5-20251101',
        modelInfo: { name: 'Claude Opus 4.5', provider: 'Anthropic', knowledge: '2025-09' },
      },
    ],
  });
  assert.ok(result.includes('claude-opus-4-5-20251101'), `Expected model ID but got: ${result}`);
  assert.ok(result.includes('Anthropic'), `Expected provider but got: ${result}`);
  assert.ok(result.includes('2025-09'), `Expected knowledge cutoff but got: ${result}`);
});

test('buildModelInfoString falls back to modelInfo when no modelsUsed', () => {
  const result = buildModelInfoString({
    requestedModel: 'opus',
    modelInfo: { name: 'Claude Opus 4.6', id: 'claude-opus-4-6', provider: 'Anthropic', knowledge: '2025-05' },
  });
  assert.ok(result.includes('Model: Claude Opus 4.6'), `Expected model name but got: ${result}`);
  assert.ok(result.includes('Anthropic'), `Expected provider but got: ${result}`);
  assert.ok(result.includes('2025-05'), `Expected knowledge cutoff but got: ${result}`);
});

test('buildModelInfoString falls back to pricingInfo when no modelsUsed or modelInfo', () => {
  const result = buildModelInfoString({
    pricingInfo: { modelId: 'opencode/grok-code', modelName: 'grok-code', provider: 'OpenCode Zen' },
  });
  assert.ok(result.includes('grok-code'), `Expected model name from pricingInfo but got: ${result}`);
  assert.ok(result.includes('OpenCode Zen'), `Expected provider from pricingInfo but got: ${result}`);
});

test('buildModelInfoString with modelsUsed with no metadata shows model ID', () => {
  const result = buildModelInfoString({
    requestedModel: 'opus',
    modelsUsed: [{ modelId: 'claude-opus-4-5-20251101', modelInfo: null }],
  });
  assert.ok(result.includes('claude-opus-4-5-20251101'), `Expected model ID but got: ${result}`);
});

// ============================================================================
// resolveModelId - Per-tool coverage for all supported tools
// ============================================================================

console.log('\n📋 resolveModelId - All Tools Coverage\n');

test('resolveModelId resolves "opus" for opencode tool', () => {
  const result = resolveModelId('opus', 'opencode');
  assert.ok(result.includes('claude') || result.includes('opus'), `Expected opus-related ID but got: ${result}`);
});

test('resolveModelId resolves "gpt4" for opencode tool', () => {
  const result = resolveModelId('gpt4', 'opencode');
  assert.equal(result, 'openai/gpt-4');
});

test('resolveModelId resolves "gpt4o" for opencode tool', () => {
  const result = resolveModelId('gpt4o', 'opencode');
  assert.equal(result, 'openai/gpt-4o');
});

test('resolveModelId resolves "grok" for opencode tool', () => {
  const result = resolveModelId('grok', 'opencode');
  assert.equal(result, 'opencode/grok-code');
});

test('resolveModelId resolves "o3" for codex tool', () => {
  const result = resolveModelId('o3', 'codex');
  assert.equal(result, 'o3');
});

test('resolveModelId resolves "gpt4o" for codex tool', () => {
  const result = resolveModelId('gpt4o', 'codex');
  assert.equal(result, 'gpt-4o');
});

test('resolveModelId resolves "opus" for codex tool', () => {
  const result = resolveModelId('opus', 'codex');
  assert.ok(result.includes('claude') || result.includes('opus'), `Expected opus-related ID but got: ${result}`);
});

test('resolveModelId resolves "opus" for agent tool', () => {
  const result = resolveModelId('opus', 'agent');
  assert.ok(result.includes('claude') || result.includes('opus'), `Expected opus-related ID but got: ${result}`);
});

test('resolveModelId resolves "haiku" for agent tool', () => {
  const result = resolveModelId('haiku', 'agent');
  assert.ok(result.includes('haiku'), `Expected haiku ID but got: ${result}`);
});

test('resolveModelId returns model as-is when not in map for agent tool', () => {
  const result = resolveModelId('custom-model-123', 'agent');
  assert.equal(result, 'custom-model-123');
});

// ============================================================================
// buildModelInfoString - Per-tool coverage for all supported tools
// ============================================================================

console.log('\n📋 buildModelInfoString - All Tools Coverage\n');

test('buildModelInfoString shows "Codex" tool name for codex', () => {
  const result = buildModelInfoString({
    tool: 'codex',
    requestedModel: 'gpt5',
    modelsUsed: [{ modelId: 'gpt-5', modelInfo: { name: 'GPT-5', provider: 'OpenAI' } }],
  });
  assert.ok(result.includes('Tool: Codex'), `Expected "Tool: Codex" but got: ${result}`);
  assert.ok(result.includes('GPT-5'), `Expected model name but got: ${result}`);
  assert.ok(result.includes('OpenAI'), `Expected provider but got: ${result}`);
});

test('buildModelInfoString shows "OpenCode" tool name for opencode', () => {
  const result = buildModelInfoString({
    tool: 'opencode',
    requestedModel: 'grok',
    modelsUsed: [{ modelId: 'opencode/grok-code', modelInfo: { name: 'Grok Code', provider: 'xAI' } }],
  });
  assert.ok(result.includes('Tool: OpenCode'), `Expected "Tool: OpenCode" but got: ${result}`);
  assert.ok(result.includes('Grok Code'), `Expected model name but got: ${result}`);
});

test('buildModelInfoString shows "Agent" tool name for agent', () => {
  const result = buildModelInfoString({
    tool: 'agent',
    requestedModel: 'grok',
    modelsUsed: [{ modelId: 'opencode/grok-code', modelInfo: { name: 'Grok Code', provider: 'OpenCode Zen' } }],
  });
  assert.ok(result.includes('Tool: Agent'), `Expected "Tool: Agent" but got: ${result}`);
});

test('buildModelInfoString shows warning for codex when actual model does not match requested', () => {
  const result = buildModelInfoString({
    tool: 'codex',
    requestedModel: 'gpt5',
    modelsUsed: [{ modelId: 'gpt-4o', modelInfo: { name: 'GPT-4o', provider: 'OpenAI' } }],
  });
  assert.ok(result.includes('⚠️'), `Expected warning when model doesn't match but got: ${result}`);
  assert.ok(result.includes('does not match requested'), `Expected mismatch message but got: ${result}`);
});

test('buildModelInfoString shows warning for agent when actual model does not match requested', () => {
  const result = buildModelInfoString({
    tool: 'agent',
    requestedModel: 'opus',
    modelsUsed: [{ modelId: 'opencode/grok-code', modelInfo: { name: 'Grok Code', provider: 'OpenCode Zen' } }],
  });
  assert.ok(result.includes('⚠️'), `Expected warning for agent mismatch but got: ${result}`);
});

test('buildModelInfoString no warning for agent when actual model matches requested', () => {
  const result = buildModelInfoString({
    tool: 'agent',
    requestedModel: 'grok',
    modelsUsed: [{ modelId: 'opencode/grok-code', modelInfo: { name: 'Grok Code', provider: 'OpenCode Zen' } }],
  });
  assert.ok(!result.includes('⚠️'), `Should not have warning when model matches but got: ${result}`);
});

test('buildModelInfoString uses pricingInfo for agent tool when no modelsUsed', () => {
  const result = buildModelInfoString({
    tool: 'agent',
    pricingInfo: { modelId: 'opencode/grok-code', modelName: 'grok-code', provider: 'OpenCode Zen' },
  });
  assert.ok(result.includes('grok-code'), `Expected grok-code from pricingInfo but got: ${result}`);
  assert.ok(result.includes('OpenCode Zen'), `Expected provider from pricingInfo but got: ${result}`);
});

test('buildModelInfoString uses pricingInfo for codex tool when no modelsUsed', () => {
  const result = buildModelInfoString({
    tool: 'codex',
    pricingInfo: { modelId: 'gpt-5', modelName: 'GPT-5', provider: 'OpenAI' },
  });
  assert.ok(result.includes('GPT-5'), `Expected GPT-5 from pricingInfo but got: ${result}`);
  assert.ok(result.includes('OpenAI'), `Expected OpenAI provider from pricingInfo but got: ${result}`);
});

// ============================================================================
// getModelInfoForComment - Async tests with mocked metadata
// ============================================================================

console.log('\n📋 getModelInfoForComment - Async Tests\n');

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

// Import getModelInfoForComment for async tests
const { getModelInfoForComment } = await import('../src/model-info.lib.mjs');

await asyncTest('getModelInfoForComment returns string (no crash)', async () => {
  const result = await getModelInfoForComment({ requestedModel: 'sonnet', tool: 'claude' });
  assert.equal(typeof result, 'string', `Expected string but got: ${typeof result}`);
});

await asyncTest('getModelInfoForComment with null inputs returns string', async () => {
  const result = await getModelInfoForComment({});
  assert.equal(typeof result, 'string', `Expected string but got: ${typeof result}`);
  assert.equal(result, '', 'Expected empty string for no inputs');
});

await asyncTest('getModelInfoForComment with agent tool and pricingInfo', async () => {
  const result = await getModelInfoForComment({
    requestedModel: 'grok',
    tool: 'agent',
    pricingInfo: { modelId: 'opencode/grok-code', modelName: 'grok-code' },
    actualModelIds: ['opencode/grok-code'],
  });
  assert.equal(typeof result, 'string', `Expected string but got: ${typeof result}`);
  assert.ok(result.includes('grok-code') || result.includes('opencode/grok-code'), `Expected grok model in output but got: ${result}`);
});

await asyncTest('getModelInfoForComment with codex tool and actual model IDs', async () => {
  const result = await getModelInfoForComment({
    requestedModel: 'gpt5',
    tool: 'codex',
    actualModelIds: ['gpt-5'],
  });
  assert.equal(typeof result, 'string', `Expected string but got: ${typeof result}`);
  assert.ok(result.includes('gpt-5') || result.includes('Codex'), `Expected codex/gpt model in output but got: ${result}`);
});

await asyncTest('getModelInfoForComment with opencode tool and actual model IDs', async () => {
  const result = await getModelInfoForComment({
    requestedModel: 'grok',
    tool: 'opencode',
    actualModelIds: ['opencode/grok-code'],
  });
  assert.equal(typeof result, 'string', `Expected string but got: ${typeof result}`);
  assert.ok(result.includes('OpenCode') || result.includes('grok'), `Expected opencode/grok in output but got: ${result}`);
});

await asyncTest('getModelInfoForComment with multiple actual models (main + supporting)', async () => {
  const result = await getModelInfoForComment({
    requestedModel: 'opus',
    tool: 'claude',
    actualModelIds: ['claude-opus-4-5-20251101', 'claude-haiku-4-5-20251001'],
  });
  assert.equal(typeof result, 'string', `Expected string but got: ${typeof result}`);
  assert.ok(result.includes('claude-opus'), `Expected opus model in output but got: ${result}`);
  assert.ok(result.includes('claude-haiku') || result.includes('Supporting'), `Expected supporting model in output but got: ${result}`);
});

await asyncTest('getModelInfoForComment pricingInfo model used when no actualModelIds', async () => {
  const result = await getModelInfoForComment({
    tool: 'agent',
    pricingInfo: { modelId: 'opencode/grok-code', modelName: 'grok-code', provider: 'OpenCode Zen' },
  });
  assert.equal(typeof result, 'string', `Expected string but got: ${typeof result}`);
  // pricingInfo.modelId should be used when no actualModelIds
  assert.ok(result.includes('grok'), `Expected grok model from pricingInfo but got: ${result}`);
});

await asyncTest('getModelInfoForComment falls back to resolved model when nothing else provided', async () => {
  const result = await getModelInfoForComment({
    requestedModel: 'sonnet',
    tool: 'claude',
  });
  assert.equal(typeof result, 'string', `Expected string but got: ${typeof result}`);
  // Should at minimum show the requested model
  assert.ok(result.includes('sonnet') || result.includes('claude-sonnet'), `Expected sonnet model in output but got: ${result}`);
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
