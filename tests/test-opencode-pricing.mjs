import { strict as assert } from 'assert';
import { parseOpenCodeTokenUsage, calculateOpenCodePricing } from '../src/opencode.lib.mjs';

// Mock fetchModelInfo since we can't actually fetch from models.dev in tests
let mockFetchModelInfo = null;

const mockFetchModelInfoImpl = (modelId) => {
  const mockData = {
    'grok-code-fast-1': {
      name: 'Grok Code Fast 1',
      cost: {
        input: 0.2, // $0.20 per million input tokens (real pricing)
        output: 1.5, // $1.50 per million output tokens
        cache_read: 0.02 // $0.02 per million cache read tokens
        // Note: no cache_write in real API for grok-code-fast-1
      },
      provider: 'xAI'
    },
    'grok-code': {
      name: 'Grok Code',
      cost: {
        input: 0, // Free model
        output: 0,
        cache_read: 0,
        cache_write: 0
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

// Test issue #892 specific requirements
console.log('🧪 Testing issue #892 pricing requirements...');

// Test data matching our debug script
const issue892TokenUsage = {
  inputTokens: 10000,
  outputTokens: 5000,
  reasoningTokens: 2000,
  cacheReadTokens: 1000,
  cacheWriteTokens: 500,
  totalCost: 0,
  stepCount: 1
};

const issue892TokenUsageWithActualCost = {
  ...issue892TokenUsage,
  totalCost: 0.0125 // Actual cost from JSON
};

// Test 1: Public estimate should always use grok-code-fast-1 pricing
const pricingPublicEstimate = await calculateOpenCodePricing('opencode/grok-code', issue892TokenUsage);
const expectedPublicEstimate = (10000 * 0.2 + 5000 * 1.5 + 1000 * 0.02 + 500 * 0) / 1_000_000; // 0.00952
assert(Math.abs(pricingPublicEstimate.publicEstimate - expectedPublicEstimate) < 0.000001, `Public estimate should be ${expectedPublicEstimate}, got ${pricingPublicEstimate.publicEstimate}`);
console.log('✅ Public estimate uses grok-code-fast-1 pricing correctly');

// Test 2: Provider price with actual costs should use actual cost
const pricingWithActualCost = await calculateOpenCodePricing('opencode/grok-code', issue892TokenUsageWithActualCost);
assert.strictEqual(pricingWithActualCost.providerPrice, 0.0125, 'Provider price should use actual cost from JSON when available');
assert(Math.abs(pricingWithActualCost.publicEstimate - expectedPublicEstimate) < 0.000001, `Public estimate should be ${expectedPublicEstimate}, got ${pricingWithActualCost.publicEstimate}`);
console.log('✅ Provider price uses actual cost from JSON correctly');

// Test 3: Provider price without actual costs should use opencode/grok-code pricing
const pricingFallback = await calculateOpenCodePricing('opencode/grok-code', issue892TokenUsage);
assert.strictEqual(pricingFallback.providerPrice, 0, 'Provider price should be 0 for free grok-code model when no actual cost');
assert(Math.abs(pricingFallback.publicEstimate - expectedPublicEstimate) < 0.000001, `Public estimate should be ${expectedPublicEstimate}, got ${pricingFallback.publicEstimate}`);
console.log('✅ Provider price falls back to grok-code pricing correctly');

console.log('✅ Issue #892 pricing requirements tests passed');

console.log('🎉 All opencode pricing tests passed!');