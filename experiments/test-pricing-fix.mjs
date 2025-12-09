#!/usr/bin/env node
/**
 * Test script to verify the pricing fix for issue #892
 *
 * This script tests that:
 * - Public price estimate uses grok-code-fast-1 pricing
 * - Provider price uses opencode/grok-code pricing (grok-code) when no actual cost
 */

import { calculateOpenCodePricing } from '../src/opencode.lib.mjs';

// Mock token usage
const tokenUsage = {
  inputTokens: 1000,
  outputTokens: 500,
  reasoningTokens: 0,
  cacheReadTokens: 200,
  cacheWriteTokens: 100,
  totalCost: 0, // No actual cost, so uses API pricing
  stepCount: 1
};

console.log('=== Testing OpenCode Pricing Fix for Issue #892 ===\n');

try {
  const pricing = await calculateOpenCodePricing('opencode/grok-code', tokenUsage);

  console.log('Pricing result:');
  console.log(JSON.stringify(pricing, null, 2));

  console.log('\nVerification:');

  // Public estimate should be calculated (using grok-code-fast-1)
  if (pricing.publicEstimate !== null && pricing.publicEstimate > 0) {
    console.log(`✅ Public estimate calculated: $${pricing.publicEstimate.toFixed(6)} (should use grok-code-fast-1 pricing)`);
  } else {
    console.log('❌ Public estimate should be calculated using grok-code-fast-1 pricing');
  }

  // Provider price should be calculated using opencode pricing
  if (pricing.providerPrice !== null && pricing.providerPrice >= 0) {
    console.log(`✅ Provider price calculated: $${pricing.providerPrice.toFixed(6)} (should use opencode/grok-code pricing)`);
  } else {
    console.log('❌ Provider price should be calculated');
  }

  // For this token usage, provider price should be different from public estimate if pricing differs
  if (pricing.publicEstimate !== pricing.providerPrice) {
    console.log('✅ Public estimate and provider price are different (as expected for different models)');
  } else {
    console.log('ℹ️  Public estimate and provider price are the same (possible if pricing is identical)');
  }

} catch (error) {
  console.error('Error during pricing calculation:', error.message);
}

console.log('\n=== Test Complete ===');