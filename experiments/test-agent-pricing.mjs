#!/usr/bin/env node
/**
 * Test script for agent tool pricing calculation
 *
 * This script tests:
 * 1. parseAgentTokenUsage - parsing step_finish events from agent JSON output
 * 2. calculateAgentPricing - calculating pricing using models.dev API
 *
 * Usage: node experiments/test-agent-pricing.mjs
 */

import { parseAgentTokenUsage, calculateAgentPricing } from '../src/agent.lib.mjs';

// Sample agent output from PR #864 log (simplified for testing)
const sampleAgentOutput = `
{"type":"step_start","timestamp":1765236921234}
{"type":"step_finish","timestamp":1765236922272,"sessionID":"ses_test123","part":{"type":"step-finish","reason":"tool-calls","cost":0,"tokens":{"input":10625,"output":215,"reasoning":677,"cache":{"read":832,"write":0}}}}
{"type":"step_start","timestamp":1765236922500}
{"type":"step_finish","timestamp":1765236927109,"sessionID":"ses_test123","part":{"type":"step-finish","reason":"tool-calls","cost":0,"tokens":{"input":1444,"output":186,"reasoning":0,"cache":{"read":0,"write":0}}}}
{"type":"step_start","timestamp":1765236927200}
{"type":"step_finish","timestamp":1765236928259,"sessionID":"ses_test123","part":{"type":"step-finish","reason":"tool-calls","cost":0,"tokens":{"input":324,"output":26,"reasoning":0,"cache":{"read":100,"write":50}}}}
{"type":"text","timestamp":1765236929000,"content":"Some text output"}
`;

console.log('=== Testing Agent Pricing Calculation ===\n');

// Test 1: Parse token usage from agent output
console.log('Test 1: parseAgentTokenUsage');
console.log('-'.repeat(40));
const tokenUsage = parseAgentTokenUsage(sampleAgentOutput);
console.log('Parsed token usage:', JSON.stringify(tokenUsage, null, 2));

// Verify expected values
const expectedStepCount = 3;
const expectedInputTokens = 10625 + 1444 + 324; // 12393
const expectedOutputTokens = 215 + 186 + 26; // 427
const expectedReasoningTokens = 677 + 0 + 0; // 677
const expectedCacheReadTokens = 832 + 0 + 100; // 932
const expectedCacheWriteTokens = 0 + 0 + 50; // 50

console.log('\nVerification:');
console.log(`  Step count: ${tokenUsage.stepCount} (expected: ${expectedStepCount}) ${tokenUsage.stepCount === expectedStepCount ? '✅' : '❌'}`);
console.log(`  Input tokens: ${tokenUsage.inputTokens} (expected: ${expectedInputTokens}) ${tokenUsage.inputTokens === expectedInputTokens ? '✅' : '❌'}`);
console.log(`  Output tokens: ${tokenUsage.outputTokens} (expected: ${expectedOutputTokens}) ${tokenUsage.outputTokens === expectedOutputTokens ? '✅' : '❌'}`);
console.log(`  Reasoning tokens: ${tokenUsage.reasoningTokens} (expected: ${expectedReasoningTokens}) ${tokenUsage.reasoningTokens === expectedReasoningTokens ? '✅' : '❌'}`);
console.log(`  Cache read tokens: ${tokenUsage.cacheReadTokens} (expected: ${expectedCacheReadTokens}) ${tokenUsage.cacheReadTokens === expectedCacheReadTokens ? '✅' : '❌'}`);
console.log(`  Cache write tokens: ${tokenUsage.cacheWriteTokens} (expected: ${expectedCacheWriteTokens}) ${tokenUsage.cacheWriteTokens === expectedCacheWriteTokens ? '✅' : '❌'}`);

// Test 2: Calculate pricing using models.dev API
console.log('\n\nTest 2: calculateAgentPricing (requires network)');
console.log('-'.repeat(40));

try {
  // Test with grok-code (free model)
  console.log('\nTesting grok-code (free model):');
  const grokPricing = await calculateAgentPricing('opencode/grok-code', tokenUsage);
  console.log('Pricing result:', JSON.stringify(grokPricing, null, 2));

  if (grokPricing.isFreeModel) {
    console.log('✅ Correctly identified as free model');
  } else {
    console.log('❌ Should be identified as free model');
  }

  if (grokPricing.totalCostUSD === 0) {
    console.log('✅ Total cost is $0.00');
  } else {
    console.log(`❌ Total cost should be $0.00, got $${grokPricing.totalCostUSD}`);
  }

  // Test with a paid model (Claude)
  console.log('\n\nTesting claude-sonnet-4 (paid model):');
  const claudePricing = await calculateAgentPricing('opencode/claude-sonnet-4', tokenUsage);
  console.log('Pricing result:', JSON.stringify(claudePricing, null, 2));

  if (claudePricing.totalCostUSD !== null && claudePricing.totalCostUSD > 0) {
    console.log(`✅ Calculated cost: $${claudePricing.totalCostUSD.toFixed(6)}`);
  } else {
    console.log('❌ Should have calculated a cost for paid model');
  }

} catch (error) {
  console.error('Error during pricing calculation:', error.message);
}

console.log('\n=== Tests Complete ===');
