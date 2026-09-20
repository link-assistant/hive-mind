#!/usr/bin/env node

/**
 * Test script for Issue #1250: Verify pricing data for kimi-k2.5-free
 */

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const https = (await use('https')).default;

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

console.log('🔍 Checking kimi-k2.5-free model pricing\n');

const apiData = await fetchModelsApi();

// Find kimi-k2.5-free in all providers
for (const [providerKey, provider] of Object.entries(apiData)) {
  if (provider.models) {
    const model = provider.models['kimi-k2.5-free'];
    if (model) {
      console.log(`Provider: ${provider.name || providerKey}`);
      console.log('  Model: kimi-k2.5-free');
      console.log('  Full model data:');
      console.log(JSON.stringify(model, null, 4));
    }
  }
}

console.log('\n---\n');

// Find kimi-k2.5 (without -free suffix) in all providers
for (const [providerKey, provider] of Object.entries(apiData)) {
  if (provider.models) {
    const model = provider.models['kimi-k2.5'];
    if (model) {
      console.log(`Provider: ${provider.name || providerKey}`);
      console.log('  Model: kimi-k2.5');
      console.log('  Full model data:');
      console.log(JSON.stringify(model, null, 4));
    }
  }
}

// Find OpenCode Zen provider
console.log('\n---\n');
console.log('OpenCode Zen provider data:');
for (const [providerKey, provider] of Object.entries(apiData)) {
  if (provider.name?.includes('OpenCode') || providerKey.includes('opencode')) {
    console.log(`Provider key: ${providerKey}`);
    console.log(`Provider name: ${provider.name}`);
    console.log('Models:');
    for (const [modelId, modelInfo] of Object.entries(provider.models || {})) {
      console.log(`  ${modelId}: cost = ${JSON.stringify(modelInfo.cost)}`);
    }
  }
}
