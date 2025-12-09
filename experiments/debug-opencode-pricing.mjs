#!/usr/bin/env node
// Debug script to test calculateOpenCodePricing function behavior
// Tests different scenarios for issue #892 pricing requirements

import { calculateOpenCodePricing } from '../src/opencode.lib.mjs';

// Mock token usage data for testing
const mockTokenUsage = {
  inputTokens: 10000,
  outputTokens: 5000,
  reasoningTokens: 2000,
  cacheReadTokens: 1000,
  cacheWriteTokens: 500,
  totalCost: 0, // Will vary per test
  stepCount: 1
};

const mockTokenUsageWithActualCost = {
  ...mockTokenUsage,
  totalCost: 0.0125 // $0.0125 actual cost from JSON
};

async function runTests() {
  console.log('🧪 Testing calculateOpenCodePricing function for issue #892\n');

  // Test 1: Provider price with actual costs from JSON (should use actual cost)
  console.log('Test 1: Provider price with actual costs from JSON output');
  console.log('Input: modelId="opencode/grok-code", tokenUsage with totalCost=0.0125');
  try {
    const result1 = await calculateOpenCodePricing('opencode/grok-code', mockTokenUsageWithActualCost);
    console.log('Result:');
    console.log(`  Public estimate: $${result1.publicEstimate?.toFixed(6) || 'null'} (should use grok-code-fast-1 pricing)`);
    console.log(`  Provider price: $${result1.providerPrice?.toFixed(6) || 'null'} (should use actual cost: $0.012500)`);
    console.log(`  Expected: Provider price should be 0.012500 (actual cost from JSON)\n`);
  } catch (error) {
    console.log(`Error: ${error.message}\n`);
  }

  // Test 2: Provider price without actual costs (should use opencode/grok-code pricing)
  console.log('Test 2: Provider price without actual costs (fallback to API pricing)');
  console.log('Input: modelId="opencode/grok-code", tokenUsage with totalCost=0');
  try {
    const result2 = await calculateOpenCodePricing('opencode/grok-code', mockTokenUsage);
    console.log('Result:');
    console.log(`  Public estimate: $${result2.publicEstimate?.toFixed(6) || 'null'} (should use grok-code-fast-1 pricing)`);
    console.log(`  Provider price: $${result2.providerPrice?.toFixed(6) || 'null'} (should use opencode/grok-code pricing from API)`);
    console.log(`  Expected: Provider price should be calculated using grok-code pricing\n`);
  } catch (error) {
    console.log(`Error: ${error.message}\n`);
  }

  // Test 3: Different model ID (should still work)
  console.log('Test 3: Different model ID');
  console.log('Input: modelId="grok-code", tokenUsage with totalCost=0');
  try {
    const result3 = await calculateOpenCodePricing('grok-code', mockTokenUsage);
    console.log('Result:');
    console.log(`  Public estimate: $${result3.publicEstimate?.toFixed(6) || 'null'} (should use grok-code-fast-1 pricing)`);
    console.log(`  Provider price: $${result3.providerPrice?.toFixed(6) || 'null'} (should use grok-code pricing from API)`);
    console.log(`  Expected: Same as test 2, model name extraction should work\n`);
  } catch (error) {
    console.log(`Error: ${error.message}\n`);
  }

  // Test 4: Edge case - zero tokens
  console.log('Test 4: Edge case - zero tokens');
  console.log('Input: modelId="opencode/grok-code", zero token usage');
  try {
    const zeroTokens = { ...mockTokenUsage, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 };
    const result4 = await calculateOpenCodePricing('opencode/grok-code', zeroTokens);
    console.log('Result:');
    console.log(`  Public estimate: $${result4.publicEstimate?.toFixed(6) || 'null'} (should be 0 or null)`);
    console.log(`  Provider price: $${result4.providerPrice?.toFixed(6) || 'null'} (should be 0)`);
    console.log(`  Expected: Both prices should be 0\n`);
  } catch (error) {
    console.log(`Error: ${error.message}\n`);
  }

  console.log('✅ All tests completed');
}

// Run the tests
runTests().catch(console.error);