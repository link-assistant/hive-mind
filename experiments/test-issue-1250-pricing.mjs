#!/usr/bin/env node

/**
 * Test script for Issue #1250: Fix `--tool agent` pricing display
 *
 * This experiment verifies:
 * 1. How model names are mapped from "kimi-k2.5-free" to find pricing in models.dev
 * 2. How token usage parsing works with step_finish events
 */

// Use the same setup as the actual code
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const https = (await use('https')).default;

console.log('🧪 Issue #1250 Pricing Display Test\n');
console.log('='.repeat(80));

// Test 1: Model name mapping
console.log('\n📋 Test 1: Model Name Mapping\n');

const testModels = ['kimi-k2.5-free', 'moonshot/kimi-k2.5-free', 'opencode/grok-code', 'openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku'];

for (const modelId of testModels) {
  const modelName = modelId.includes('/') ? modelId.split('/').pop() : modelId;
  console.log(`  "${modelId}" -> modelName: "${modelName}"`);
}

// Test 2: Fetch models.dev API and check if kimi-k2.5-free exists
console.log('\n📋 Test 2: Check models.dev API for Kimi models\n');

const fetchModelsApi = () => {
  return new Promise((resolve, reject) => {
    https
      .get('https://models.dev/api.json', res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
};

try {
  const apiData = await fetchModelsApi();

  // Check for kimi models
  const kimiModels = [];
  for (const [providerKey, provider] of Object.entries(apiData)) {
    if (provider.models) {
      for (const [modelId, modelInfo] of Object.entries(provider.models)) {
        if (modelId.toLowerCase().includes('kimi')) {
          kimiModels.push({
            provider: provider.name || providerKey,
            modelId,
            cost: modelInfo.cost,
          });
        }
      }
    }
  }

  console.log('  Kimi models found in API:');
  for (const model of kimiModels.slice(0, 10)) {
    console.log(`    - ${model.provider} / ${model.modelId}`);
    if (model.cost) {
      console.log(`      Cost: $${model.cost.input}/1M input, $${model.cost.output}/1M output`);
    }
  }

  // Test specific lookups
  console.log('\n  Testing specific model lookups:');

  const testLookups = ['kimi-k2.5-free', 'kimi-k2.5', 'kimi-k2-0905-preview'];
  for (const modelId of testLookups) {
    let found = false;
    for (const [providerKey, provider] of Object.entries(apiData)) {
      if (provider.models && provider.models[modelId]) {
        found = true;
        const info = provider.models[modelId];
        console.log(`    ✅ "${modelId}" found in ${provider.name || providerKey}`);
        console.log(`       Name: ${info.name}, Cost: $${info.cost?.input || '?'} input, $${info.cost?.output || '?'} output`);
        break;
      }
    }
    if (!found) {
      console.log(`    ❌ "${modelId}" NOT FOUND in any provider`);
    }
  }
} catch (error) {
  console.log('  Error fetching API:', error.message);
}

// Test 3: Token parsing simulation
console.log('\n📋 Test 3: Token Usage Parsing Test\n');

// Simulate step_finish events as they appear in the output
const sampleOutput = `{"type":"status","mode":"stdin-stream"}
{"type":"session.created","sessionID":"ses_test123"}
{"type":"step_finish","timestamp":1770842531248,"sessionID":"ses_test123","part":{"id":"prt_test1","type":"step-finish","cost":0,"tokens":{"input":15413,"output":64,"reasoning":0,"cache":{"read":32,"write":0}}}}
{"type":"step_finish","timestamp":1770842551248,"sessionID":"ses_test123","part":{"id":"prt_test2","type":"step-finish","cost":0,"tokens":{"input":25,"output":43,"reasoning":1,"cache":{"read":68045,"write":0}}}}
`;

// This is the parseAgentTokenUsage function copy
const parseAgentTokenUsage = output => {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
    stepCount: 0,
  };

  const lines = output.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || !trimmedLine.startsWith('{')) continue;

    try {
      const parsed = JSON.parse(trimmedLine);

      if (parsed.type === 'step_finish' && parsed.part?.tokens) {
        const tokens = parsed.part.tokens;
        usage.stepCount++;

        if (tokens.input) usage.inputTokens += tokens.input;
        if (tokens.output) usage.outputTokens += tokens.output;
        if (tokens.reasoning) usage.reasoningTokens += tokens.reasoning;

        if (tokens.cache) {
          if (tokens.cache.read) usage.cacheReadTokens += tokens.cache.read;
          if (tokens.cache.write) usage.cacheWriteTokens += tokens.cache.write;
        }

        if (parsed.part.cost !== undefined) {
          usage.totalCost += parsed.part.cost;
        }
      }
    } catch {
      continue;
    }
  }

  return usage;
};

const tokenUsage = parseAgentTokenUsage(sampleOutput);
console.log('  Sample output parsing result:');
console.log(`    Step count: ${tokenUsage.stepCount}`);
console.log(`    Input tokens: ${tokenUsage.inputTokens}`);
console.log(`    Output tokens: ${tokenUsage.outputTokens}`);
console.log(`    Reasoning tokens: ${tokenUsage.reasoningTokens}`);
console.log(`    Cache read tokens: ${tokenUsage.cacheReadTokens}`);
console.log(`    Cache write tokens: ${tokenUsage.cacheWriteTokens}`);

// Test with empty/problematic output
console.log('\n  Testing edge cases:');
console.log(`    Empty string: ${JSON.stringify(parseAgentTokenUsage(''))}`);
console.log(`    No step_finish events: ${JSON.stringify(parseAgentTokenUsage('{"type":"text","content":"hello"}'))}`);

// Test 4: Proposed fix - normalize model names
console.log('\n📋 Test 4: Proposed Model Name Normalization\n');

/**
 * Normalize model name to match models.dev API format
 * - Remove "-free" suffix for pricing lookup
 * - Handle aliases
 */
const normalizeModelForPricing = modelId => {
  // Extract model name from provider/model format
  let modelName = modelId.includes('/') ? modelId.split('/').pop() : modelId;

  // Map of model aliases to their paid equivalents in models.dev
  const modelAliasMap = {
    // Free versions map to their paid equivalents
    'kimi-k2.5-free': 'kimi-k2.5',
    'grok-code': 'grok-3', // Grok code might map to grok-3 or similar
    'gpt-4o-mini-free': 'gpt-4o-mini',
    'claude-3.5-haiku-free': 'claude-3-5-haiku-20241022',
    // Add more mappings as needed
  };

  // Check if there's a direct alias
  if (modelAliasMap[modelName]) {
    return modelAliasMap[modelName];
  }

  // Try removing "-free" suffix
  if (modelName.endsWith('-free')) {
    return modelName.replace(/-free$/, '');
  }

  return modelName;
};

console.log('  Model name normalization:');
const testNormalize = ['kimi-k2.5-free', 'moonshot/kimi-k2.5-free', 'grok-code', 'gpt-4o-mini'];
for (const modelId of testNormalize) {
  console.log(`    "${modelId}" -> "${normalizeModelForPricing(modelId)}"`);
}

console.log('\n' + '='.repeat(80));
console.log('\n✅ Test completed\n');
console.log('🔍 Root causes identified:');
console.log('  1. Model name "kimi-k2.5-free" does not exist in models.dev API');
console.log('     -> Need to normalize to "kimi-k2.5" for pricing lookup');
console.log('  2. Token usage of 0 may be caused by output format mismatch');
console.log('     -> Need to verify fullOutput contains valid NDJSON lines');
