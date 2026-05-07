#!/usr/bin/env node

/**
 * Test script for Issue #1250: Verify calculateAgentPricing with base model lookup
 */

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Import the agent pricing functions
const agentLib = await import('../src/agent.lib.mjs');
const { calculateAgentPricing, parseAgentTokenUsage } = agentLib;

console.log('🧪 Issue #1250 calculateAgentPricing Test\n');
console.log('='.repeat(80));

// Test 1: kimi-k2.5-free should get pricing from kimi-k2.5
console.log('\n📋 Test 1: kimi-k2.5-free base model pricing\n');

const tokenUsage = {
  inputTokens: 1000000,
  outputTokens: 1000000,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
  stepCount: 1,
};

const result = await calculateAgentPricing('moonshot/kimi-k2.5-free', tokenUsage);
console.log('Input: moonshot/kimi-k2.5-free with 1M input, 1M output tokens');
console.log('Result:');
console.log(`  Model Name: ${result.modelName}`);
console.log(`  Provider: ${result.provider}`);
console.log(`  Original Provider: ${result.originalProvider}`);
console.log(`  Base Model Name: ${result.baseModelName}`);
console.log(`  Total Cost USD (Public): $${result.totalCostUSD?.toFixed(6) || 'N/A'}`);
console.log(`  OpenCode Cost: $${result.opencodeCost?.toFixed(6) || 'N/A'}`);
console.log(`  Is Free Model: ${result.isFreeModel}`);
console.log(`  Is OpenCode Free Model: ${result.isOpencodeFreeModel}`);
console.log(`  Pricing: ${JSON.stringify(result.pricing)}`);

if (result.totalCostUSD > 0) {
  console.log(`\n  ✅ SUCCESS: Public pricing estimate is $${result.totalCostUSD.toFixed(2)}, not $0.00`);
} else {
  console.log(`\n  ❌ FAILURE: Public pricing estimate is $0.00`);
}

// Test 2: grok-code should remain at $0 (no paid equivalent)
console.log('\n📋 Test 2: grok-code truly free model\n');

const result2 = await calculateAgentPricing('opencode/grok-code', tokenUsage);
console.log('Input: opencode/grok-code with 1M input, 1M output tokens');
console.log('Result:');
console.log(`  Model Name: ${result2.modelName}`);
console.log(`  Provider: ${result2.provider}`);
console.log(`  Total Cost USD (Public): $${result2.totalCostUSD?.toFixed(6) || 'N/A'}`);
console.log(`  Is Free Model: ${result2.isFreeModel}`);

// Test 3: Token parsing test
console.log('\n📋 Test 3: Token usage parsing\n');

const sampleOutput = `{"type":"status","mode":"stdin-stream"}
{"type":"session.created","sessionID":"ses_test123"}
{"type":"step_finish","timestamp":1770842531248,"sessionID":"ses_test123","part":{"id":"prt_test1","type":"step-finish","cost":0,"tokens":{"input":15413,"output":64,"reasoning":0,"cache":{"read":32,"write":0}}}}
{"type":"step_finish","timestamp":1770842551248,"sessionID":"ses_test123","part":{"id":"prt_test2","type":"step-finish","cost":0,"tokens":{"input":25,"output":43,"reasoning":1,"cache":{"read":68045,"write":0}}}}
`;

const parsed = parseAgentTokenUsage(sampleOutput);
console.log('Sample output parsing:');
console.log(`  Step count: ${parsed.stepCount}`);
console.log(`  Input tokens: ${parsed.inputTokens}`);
console.log(`  Output tokens: ${parsed.outputTokens}`);
console.log(`  Reasoning tokens: ${parsed.reasoningTokens}`);
console.log(`  Cache read tokens: ${parsed.cacheReadTokens}`);

if (parsed.inputTokens > 0 && parsed.outputTokens > 0) {
  console.log('\n  ✅ SUCCESS: Tokens are correctly parsed');
} else {
  console.log('\n  ❌ FAILURE: Token parsing returned 0');
}

console.log('\n' + '='.repeat(80));
console.log('\n✅ Test completed\n');
