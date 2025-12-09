import { strict as assert } from 'assert';
import { parseOpenCodeTokenUsage, calculateOpenCodePricing } from '../src/opencode.lib.mjs';

// Mock fetchModelInfo since we can't actually fetch from models.dev in tests
let mockFetchModelInfo = null;

const mockFetchModelInfoImpl = (modelId) => {
  const mockData = {
    'grok-code-fast-1': {
      name: 'Grok Code Fast 1',
      cost: {
        input: 0.000003,
        output: 0.000015,
        cache_read: 0.0000015,
        cache_write: 0.0000075
      },
      provider: 'xAI'
    },
    'grok-code': {
      name: 'Grok Code',
      cost: {
        input: 0.000005,
        output: 0.000025,
        cache_read: 0.0000025,
        cache_write: 0.0000125
      },
      provider: 'OpenCode'
    }
  };
  return Promise.resolve(mockData[modelId] || null);
};

// Test parseOpenCodeTokenUsage
console.log('🧪 Testing parseOpenCodeTokenUsage...');

// Test with empty output
const emptyResult = parseOpenCodeTokenUsage('');
assert.deepStrictEqual(emptyResult, {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
  stepCount: 0
}, 'Empty output should return zero values');

// Test with valid JSON output
const sampleOutput = `{"type":"step_start","id":"step_1"}
{"type":"step_finish","part":{"tokens":{"input":100,"output":50,"reasoning":10,"cache":{"read":20,"write":30}},"cost":0.001}}
{"type":"step_finish","part":{"tokens":{"input":200,"output":100},"cost":0.002}}
`;

const parsed = parseOpenCodeTokenUsage(sampleOutput);
assert.strictEqual(parsed.inputTokens, 300, 'Input tokens should be summed');
assert.strictEqual(parsed.outputTokens, 150, 'Output tokens should be summed');
assert.strictEqual(parsed.reasoningTokens, 10, 'Reasoning tokens should be summed');
assert.strictEqual(parsed.cacheReadTokens, 20, 'Cache read tokens should be summed');
assert.strictEqual(parsed.cacheWriteTokens, 30, 'Cache write tokens should be summed');
assert.strictEqual(parsed.totalCost, 0.003, 'Total cost should be summed');
assert.strictEqual(parsed.stepCount, 2, 'Step count should be correct');

console.log('✅ parseOpenCodeTokenUsage tests passed');

// Test calculateOpenCodePricing
console.log('🧪 Testing calculateOpenCodePricing...');

// Mock the fetchModelInfo
global.fetchModelInfo = mockFetchModelInfoImpl;

// Test with token usage that has actual cost
const tokenUsageWithCost = {
  inputTokens: 1000,
  outputTokens: 500,
  reasoningTokens: 0,
  cacheReadTokens: 200,
  cacheWriteTokens: 100,
  totalCost: 0.01, // Actual cost from JSON
  stepCount: 1
};

const pricingWithCost = await calculateOpenCodePricing('opencode/grok-code', tokenUsageWithCost);
assert.strictEqual(pricingWithCost.modelName, 'opencode/grok-code', 'Model name should be preserved');
assert.strictEqual(pricingWithCost.provider, 'OpenCode', 'Provider should be OpenCode');
assert.strictEqual(pricingWithCost.tokenUsage.totalCost, 0.01, 'Token usage should be passed through');
assert.strictEqual(pricingWithCost.isFreeModel, false, 'Should not be marked as free model');

// Test with token usage without actual cost (fallback to pricing API)
const tokenUsageNoCost = {
  inputTokens: 1000,
  outputTokens: 500,
  reasoningTokens: 0,
  cacheReadTokens: 200,
  cacheWriteTokens: 100,
  totalCost: 0, // No actual cost
  stepCount: 1
};

const pricingNoCost = await calculateOpenCodePricing('opencode/grok-code', tokenUsageNoCost);
assert.strictEqual(pricingNoCost.tokenUsage.totalCost, 0, 'Token usage should be passed through');

// Test with unknown model
const pricingUnknown = await calculateOpenCodePricing('unknown/model', tokenUsageNoCost);
assert.strictEqual(pricingUnknown.isFreeModel, true, 'Unknown model should be marked as free when pricing API fails');

console.log('✅ calculateOpenCodePricing tests passed');

console.log('🎉 All opencode pricing tests passed!');