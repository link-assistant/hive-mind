#!/usr/bin/env node

/**
 * Test script to verify that fetchModelInfo prefers Anthropic provider
 * for Claude models when calculating public pricing.
 *
 * This addresses issue #933: Use Anthropic provider instead of Helicone
 * for public price calculation.
 */

import { fetchModelInfo } from '../src/claude.lib.mjs';

async function testProviderSelection() {
  console.log('Testing provider selection for Claude models...\n');

  const testModels = [
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-5-20251101',
    'claude-3-5-sonnet-20241022'
  ];

  for (const modelId of testModels) {
    console.log(`Testing model: ${modelId}`);
    const modelInfo = await fetchModelInfo(modelId);

    if (modelInfo) {
      console.log(`  ✓ Provider: ${modelInfo.provider}`);
      console.log(`  ✓ Cost info:`, modelInfo.cost);

      // Verify it's using Anthropic provider
      if (modelInfo.provider === 'Anthropic') {
        console.log(`  ✅ PASS: Using Anthropic provider (not Helicone)\n`);
      } else {
        console.log(`  ❌ FAIL: Using ${modelInfo.provider} instead of Anthropic\n`);
        process.exit(1);
      }
    } else {
      console.log(`  ⚠️  Model not found in pricing API\n`);
    }
  }

  console.log('✅ All tests passed! Anthropic provider is correctly preferred for Claude models.');
}

testProviderSelection().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
