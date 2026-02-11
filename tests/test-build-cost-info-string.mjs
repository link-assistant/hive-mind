#!/usr/bin/env node

/**
 * Unit tests for buildCostInfoString function
 * Tests the cost information formatting logic for Issue #1015
 *
 * This function builds cost estimation strings for log comments.
 * Key behaviors tested:
 * - Returns empty string when all values are unknown (Issue #1015 Bug 2)
 * - Properly formats public pricing estimates
 * - Properly formats Anthropic calculated costs
 * - Shows difference when both values are available
 * - Handles pricing info with model name, provider, token usage
 * - Handles free model special case
 */

// Copy of the buildCostInfoString function from src/github.lib.mjs for testing
// This allows us to test the function in isolation without requiring the full module dependencies
// Issue #1250: Enhanced to support OpenCode Zen cost and original provider reference
const buildCostInfoString = (totalCostUSD, anthropicTotalCostUSD, pricingInfo) => {
  // Issue #1015: Don't show cost section when all values are unknown (clutters output)
  const hasPublic = totalCostUSD !== null && totalCostUSD !== undefined;
  const hasAnthropic = anthropicTotalCostUSD !== null && anthropicTotalCostUSD !== undefined;
  const hasPricing = pricingInfo && (pricingInfo.modelName || pricingInfo.tokenUsage || pricingInfo.isFreeModel || pricingInfo.isOpencodeFreeModel);
  // Issue #1250: Check for OpenCode Zen actual cost
  const hasOpencodeCost = pricingInfo?.opencodeCost !== null && pricingInfo?.opencodeCost !== undefined;
  if (!hasPublic && !hasAnthropic && !hasPricing && !hasOpencodeCost) return '';
  let costInfo = '\n\n💰 **Cost estimation:**';
  if (pricingInfo?.modelName) {
    costInfo += `\n- Model: ${pricingInfo.modelName}`;
    if (pricingInfo.provider) costInfo += `\n- Provider: ${pricingInfo.provider}`;
  }
  // Issue #1250: Show public pricing estimate based on original provider prices
  if (hasPublic) {
    // For models with zero pricing from original provider, show as free
    if (pricingInfo?.isFreeModel && totalCostUSD === 0) {
      costInfo += '\n- Public pricing estimate: $0.00 (Free model)';
    } else {
      // Show actual public pricing estimate with original provider reference
      const originalProviderRef = pricingInfo?.originalProvider ? ` (based on ${pricingInfo.originalProvider} prices)` : '';
      costInfo += `\n- Public pricing estimate: $${totalCostUSD.toFixed(6)}${originalProviderRef}`;
    }
  } else if (hasPricing) {
    costInfo += '\n- Public pricing estimate: unknown';
  }
  // Issue #1250: Show actual cost from OpenCode Zen for agent tool
  if (hasOpencodeCost) {
    if (pricingInfo.isOpencodeFreeModel) {
      costInfo += '\n- Calculated by OpenCode Zen: $0.00 (Free model)';
    } else {
      costInfo += `\n- Calculated by OpenCode Zen: $${pricingInfo.opencodeCost.toFixed(6)}`;
    }
  }
  if (pricingInfo?.tokenUsage) {
    const u = pricingInfo.tokenUsage;
    let tokenInfo = `\n- Token usage: ${u.inputTokens?.toLocaleString() || 0} input, ${u.outputTokens?.toLocaleString() || 0} output`;
    if (u.reasoningTokens > 0) tokenInfo += `, ${u.reasoningTokens.toLocaleString()} reasoning`;
    if (u.cacheReadTokens > 0 || u.cacheWriteTokens > 0) tokenInfo += `, ${u.cacheReadTokens?.toLocaleString() || 0} cache read, ${u.cacheWriteTokens?.toLocaleString() || 0} cache write`;
    costInfo += tokenInfo;
  }
  if (hasAnthropic) {
    costInfo += `\n- Calculated by Anthropic: $${anthropicTotalCostUSD.toFixed(6)} USD`;
    if (hasPublic) {
      const diff = anthropicTotalCostUSD - totalCostUSD;
      const pct = totalCostUSD > 0 ? (diff / totalCostUSD) * 100 : 0;
      costInfo += `\n- Difference: $${diff.toFixed(6)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)`;
    }
  }
  return costInfo;
};

// Test framework
let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function assertContains(str, substring, message = '') {
  if (!str.includes(substring)) {
    throw new Error(`${message}\nExpected string to contain: "${substring}"\nActual string: "${str}"`);
  }
}

function assertNotContains(str, substring, message = '') {
  if (str.includes(substring)) {
    throw new Error(`${message}\nExpected string NOT to contain: "${substring}"\nActual string: "${str}"`);
  }
}

console.log('🧪 Running buildCostInfoString unit tests (Issue #1015)...\n');
console.log('='.repeat(80));

// ==== Issue #1015 Bug 2: Empty when all values unknown ====
console.log('\n📋 Test Group: Issue #1015 Bug 2 - Empty when all values unknown\n');

runTest('returns empty string when all values are null', () => {
  const result = buildCostInfoString(null, null, null);
  assertEqual(result, '', 'Should return empty string when all values are null');
});

runTest('returns empty string when all values are undefined', () => {
  const result = buildCostInfoString(undefined, undefined, undefined);
  assertEqual(result, '', 'Should return empty string when all values are undefined');
});

runTest('returns empty string with empty pricing info object', () => {
  const result = buildCostInfoString(null, null, {});
  assertEqual(result, '', 'Should return empty string with empty pricing info');
});

runTest('returns empty string when pricing info has no relevant fields', () => {
  const result = buildCostInfoString(null, null, { irrelevantField: 'value' });
  assertEqual(result, '', 'Should return empty string when pricing info has no relevant fields');
});

// ==== Public pricing estimate tests ====
console.log('\n📋 Test Group: Public pricing estimate\n');

runTest('shows public pricing estimate when available', () => {
  const result = buildCostInfoString(1.5, null, null);
  assertContains(result, '💰 **Cost estimation:**', 'Should contain cost estimation header');
  assertContains(result, 'Public pricing estimate: $1.500000', 'Should contain formatted cost');
});

runTest('formats small cost with 6 decimal places', () => {
  const result = buildCostInfoString(0.000123, null, null);
  assertContains(result, '$0.000123', 'Should format with 6 decimal places');
});

runTest('formats zero cost correctly', () => {
  const result = buildCostInfoString(0, null, null);
  assertContains(result, '$0.000000', 'Should format zero with 6 decimal places');
});

// ==== Anthropic cost tests ====
console.log('\n📋 Test Group: Anthropic calculated cost\n');

runTest('shows Anthropic calculated cost when available', () => {
  const result = buildCostInfoString(null, 2.5, null);
  assertContains(result, 'Calculated by Anthropic: $2.500000 USD', 'Should show Anthropic cost');
});

runTest('shows difference when both costs available (Anthropic higher)', () => {
  const result = buildCostInfoString(1.0, 1.5, null);
  assertContains(result, 'Difference: $0.500000 (+50.00%)', 'Should show positive difference');
});

runTest('shows difference when both costs available (Anthropic lower)', () => {
  const result = buildCostInfoString(2.0, 1.5, null);
  assertContains(result, 'Difference: $-0.500000 (-25.00%)', 'Should show negative difference');
});

runTest('shows zero difference when costs are equal', () => {
  const result = buildCostInfoString(1.0, 1.0, null);
  assertContains(result, 'Difference: $0.000000 (0.00%)', 'Should show zero difference');
});

runTest('handles zero public cost in percentage calculation', () => {
  const result = buildCostInfoString(0, 1.0, null);
  assertContains(result, 'Difference: $1.000000 (0.00%)', 'Should handle division by zero');
});

// ==== Pricing info tests ====
console.log('\n📋 Test Group: Pricing info formatting\n');

runTest('shows model name when available', () => {
  const result = buildCostInfoString(null, null, { modelName: 'claude-3-opus' });
  assertContains(result, 'Model: claude-3-opus', 'Should show model name');
});

runTest('shows provider when model name and provider available', () => {
  const result = buildCostInfoString(null, null, {
    modelName: 'gpt-4',
    provider: 'OpenAI',
  });
  assertContains(result, 'Model: gpt-4', 'Should show model name');
  assertContains(result, 'Provider: OpenAI', 'Should show provider');
});

runTest('shows unknown for public pricing when has pricing info but no public cost', () => {
  const result = buildCostInfoString(null, null, { modelName: 'claude-3' });
  assertContains(result, 'Public pricing estimate: unknown', 'Should show unknown');
});

runTest('shows free model pricing correctly', () => {
  const result = buildCostInfoString(0, null, {
    modelName: 'claude-3-haiku',
    isFreeModel: true,
  });
  assertContains(result, 'Public pricing estimate: $0.00 (Free model)', 'Should show free model');
});

// ==== Token usage tests ====
console.log('\n📋 Test Group: Token usage formatting\n');

runTest('shows basic token usage', () => {
  const result = buildCostInfoString(null, null, {
    modelName: 'claude-3',
    tokenUsage: {
      inputTokens: 1000,
      outputTokens: 500,
    },
  });
  assertContains(result, 'Token usage: 1,000 input, 500 output', 'Should show formatted token counts');
});

runTest('shows reasoning tokens when present', () => {
  const result = buildCostInfoString(null, null, {
    modelName: 'claude-3',
    tokenUsage: {
      inputTokens: 1000,
      outputTokens: 500,
      reasoningTokens: 200,
    },
  });
  assertContains(result, '200 reasoning', 'Should show reasoning tokens');
});

runTest('shows cache tokens when present', () => {
  const result = buildCostInfoString(null, null, {
    modelName: 'claude-3',
    tokenUsage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 300,
      cacheWriteTokens: 100,
    },
  });
  assertContains(result, '300 cache read, 100 cache write', 'Should show cache tokens');
});

runTest('handles zero tokens', () => {
  const result = buildCostInfoString(null, null, {
    modelName: 'claude-3',
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
    },
  });
  assertContains(result, 'Token usage: 0 input, 0 output', 'Should show zero tokens');
});

runTest('handles undefined token values', () => {
  const result = buildCostInfoString(null, null, {
    modelName: 'claude-3',
    tokenUsage: {},
  });
  assertContains(result, 'Token usage: 0 input, 0 output', 'Should default to 0');
});

runTest('does not show reasoning tokens when zero', () => {
  const result = buildCostInfoString(null, null, {
    modelName: 'claude-3',
    tokenUsage: {
      inputTokens: 1000,
      outputTokens: 500,
      reasoningTokens: 0,
    },
  });
  assertNotContains(result, 'reasoning', 'Should not show zero reasoning tokens');
});

runTest('does not show cache tokens when both are zero', () => {
  const result = buildCostInfoString(null, null, {
    modelName: 'claude-3',
    tokenUsage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  });
  assertNotContains(result, 'cache', 'Should not show zero cache tokens');
});

// ==== Comprehensive format tests ====
console.log('\n📋 Test Group: Comprehensive format\n');

runTest('shows all information when everything is available', () => {
  const result = buildCostInfoString(1.5, 1.2, {
    modelName: 'claude-3-opus',
    provider: 'Anthropic',
    tokenUsage: {
      inputTokens: 10000,
      outputTokens: 5000,
      reasoningTokens: 1000,
      cacheReadTokens: 500,
      cacheWriteTokens: 200,
    },
  });

  assertContains(result, '💰 **Cost estimation:**', 'Should have header');
  assertContains(result, 'Model: claude-3-opus', 'Should have model');
  assertContains(result, 'Provider: Anthropic', 'Should have provider');
  assertContains(result, 'Public pricing estimate: $1.500000', 'Should have public cost');
  assertContains(result, 'Token usage:', 'Should have token usage');
  assertContains(result, '10,000 input', 'Should format input tokens with commas');
  assertContains(result, '5,000 output', 'Should format output tokens with commas');
  assertContains(result, '1,000 reasoning', 'Should show reasoning tokens');
  assertContains(result, 'cache read', 'Should show cache read');
  assertContains(result, 'cache write', 'Should show cache write');
  assertContains(result, 'Calculated by Anthropic: $1.200000 USD', 'Should have Anthropic cost');
  assertContains(result, 'Difference:', 'Should have difference');
});

runTest('real-world example from Issue #1015', () => {
  // This mimics the actual case that triggered Issue #1015
  // When Claude CLI requires terms acceptance, there's no actual work done
  const result = buildCostInfoString(null, null, null);
  assertEqual(result, '', 'Should return empty for terms acceptance scenario');
});

runTest('real-world example with actual work', () => {
  // This mimics a successful solve.mjs execution
  const result = buildCostInfoString(8.089715, 5.636999, {
    modelName: 'claude-sonnet-4-20250514',
    provider: 'Anthropic',
    tokenUsage: {
      inputTokens: 500000,
      outputTokens: 50000,
    },
  });

  assertContains(result, '$8.089715', 'Should show public cost');
  assertContains(result, '$5.636999 USD', 'Should show Anthropic cost');
  assertContains(result, 'Difference: $-2.452716 (-30.32%)', 'Should show negative difference');
});

// ==== Edge cases ====
console.log('\n📋 Test Group: Edge cases\n');

runTest('handles large token counts', () => {
  const result = buildCostInfoString(null, null, {
    modelName: 'claude-3',
    tokenUsage: {
      inputTokens: 1000000000,
      outputTokens: 500000000,
    },
  });
  assertContains(result, '1,000,000,000 input', 'Should format large numbers with commas');
});

runTest('handles very small costs', () => {
  const result = buildCostInfoString(0.000001, 0.000002, null);
  assertContains(result, '$0.000001', 'Should show small public cost');
  assertContains(result, '$0.000002 USD', 'Should show small Anthropic cost');
});

runTest('returns proper string format starting with newlines', () => {
  const result = buildCostInfoString(1.0, null, null);
  assertEqual(result.startsWith('\n\n'), true, 'Should start with two newlines');
});

runTest('handles tokenUsage being the only truthy pricingInfo field', () => {
  const result = buildCostInfoString(null, null, {
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 50,
    },
  });
  assertContains(result, 'Token usage: 100 input, 50 output', 'Should show token usage');
  assertContains(result, 'Public pricing estimate: unknown', 'Should show unknown cost');
});

runTest('handles isFreeModel being the only truthy pricingInfo field', () => {
  const result = buildCostInfoString(0, null, {
    isFreeModel: true,
  });
  assertContains(result, 'Public pricing estimate: $0.00 (Free model)', 'Should show free model');
});

// ==== Issue #1250: OpenCode Zen cost tests ====
console.log('\n📋 Test Group: Issue #1250 - OpenCode Zen cost\n');

runTest('shows OpenCode Zen as provider with free cost', () => {
  const result = buildCostInfoString(1.5, null, {
    modelName: 'kimi-k2.5-free',
    provider: 'OpenCode Zen',
    originalProvider: 'Moonshot AI',
    opencodeCost: 0,
    isOpencodeFreeModel: true,
  });
  assertContains(result, 'Provider: OpenCode Zen', 'Should show OpenCode Zen as provider');
  assertContains(result, 'Calculated by OpenCode Zen: $0.00 (Free model)', 'Should show free cost');
});

runTest('shows public pricing estimate with original provider reference', () => {
  const result = buildCostInfoString(2.5, null, {
    modelName: 'gpt-4o-mini',
    provider: 'OpenCode Zen',
    originalProvider: 'OpenAI',
    opencodeCost: 0,
    isOpencodeFreeModel: true,
  });
  assertContains(result, 'Public pricing estimate: $2.500000 (based on OpenAI prices)', 'Should show original provider reference');
  assertContains(result, 'Calculated by OpenCode Zen: $0.00 (Free model)', 'Should show OpenCode Zen free cost');
});

runTest('shows both public pricing and OpenCode Zen cost for agent tool', () => {
  const result = buildCostInfoString(5.0, null, {
    modelName: 'claude-3.5-haiku',
    provider: 'OpenCode Zen',
    originalProvider: 'Anthropic',
    opencodeCost: 0,
    isOpencodeFreeModel: true,
    tokenUsage: {
      inputTokens: 10000,
      outputTokens: 5000,
    },
  });
  assertContains(result, 'Provider: OpenCode Zen', 'Should show OpenCode Zen provider');
  assertContains(result, 'Public pricing estimate: $5.000000 (based on Anthropic prices)', 'Should show pricing with Anthropic reference');
  assertContains(result, 'Calculated by OpenCode Zen: $0.00 (Free model)', 'Should show free OpenCode Zen cost');
  assertContains(result, 'Token usage: 10,000 input, 5,000 output', 'Should show token usage');
});

runTest('handles OpenCode Zen with non-free cost', () => {
  const result = buildCostInfoString(3.0, null, {
    modelName: 'premium-model',
    provider: 'OpenCode Zen',
    opencodeCost: 1.5,
    isOpencodeFreeModel: false,
  });
  assertContains(result, 'Public pricing estimate: $3.000000', 'Should show public estimate');
  assertContains(result, 'Calculated by OpenCode Zen: $1.500000', 'Should show actual OpenCode Zen cost');
  assertNotContains(result, 'Free model', 'Should not show Free model for non-free cost');
});

runTest('shows output with only OpenCode Zen cost present', () => {
  const result = buildCostInfoString(null, null, {
    modelName: 'grok-code',
    provider: 'OpenCode Zen',
    opencodeCost: 0,
    isOpencodeFreeModel: true,
  });
  assertContains(result, 'Provider: OpenCode Zen', 'Should show provider');
  assertContains(result, 'Public pricing estimate: unknown', 'Should show unknown public estimate');
  assertContains(result, 'Calculated by OpenCode Zen: $0.00 (Free model)', 'Should show free cost');
});

runTest('isOpencodeFreeModel triggers hasPricing check', () => {
  const result = buildCostInfoString(null, null, {
    isOpencodeFreeModel: true,
  });
  // Should not be empty since isOpencodeFreeModel is truthy
  assertContains(result, '💰 **Cost estimation:**', 'Should show cost header');
});

// Summary
console.log('\n' + '='.repeat(80));
console.log(`Test Results for buildCostInfoString (Issues #1015 & #1250):`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(80));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
