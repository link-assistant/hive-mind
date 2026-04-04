#!/usr/bin/env node

/**
 * Regression tests for Issue #1508: Fix context, token and cost estimation calculation accuracy
 *
 * Root causes tested:
 * 1. Multi-model token usage not split by model in budget stats
 * 2. Sub-sessions duplicated under each model in multi-model mode
 * 3. resultModelUsage merge into JSONL-based calculations
 * 4. Per-model cost display in budget stats string
 */

import { buildBudgetStatsString, accumulateModelUsage, mergeResultModelUsage } from '../src/claude.budget-stats.lib.mjs';

// Test framework
let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('\u2705 PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`\u274c FAILED: ${error.message}`);
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

// Count occurrences of a substring in a string
function countOccurrences(str, substring) {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(substring, pos)) !== -1) {
    count++;
    pos += substring.length;
  }
  return count;
}

// Shared test fixtures
const OPUS_MODEL_INFO = { limit: { context: 1000000, output: 128000 } };
const HAIKU_MODEL_INFO = { limit: { context: 200000, output: 32000 } };

function makeMultiModelTokenUsage({ subSessions = undefined } = {}) {
  return {
    inputTokens: 1707,
    cacheCreationTokens: 139358,
    cacheReadTokens: 2988864,
    outputTokens: 25957,
    totalTokens: 167022,
    subSessions: subSessions || [
      {
        inputTokens: 1707,
        cacheCreationTokens: 139358,
        cacheReadTokens: 2988864,
        outputTokens: 25957,
        messageCount: 49,
        peakContextUsage: 71907,
        peakOutputUsage: 5548,
      },
    ],
    compactifications: null,
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 58,
        cacheCreationTokens: 87556,
        cacheReadTokens: 2276830,
        outputTokens: 20546,
        modelName: 'Claude Opus 4.6',
        modelInfo: OPUS_MODEL_INFO,
        peakContextUsage: 71907,
        costUSD: 2.1995800000000005,
        costBreakdown: {
          input: { tokens: 58, costPerMillion: 5, cost: 0.00029 },
          cacheWrite: { tokens: 87556, costPerMillion: 6.25, cost: 0.547225 },
          cacheRead: { tokens: 2276830, costPerMillion: 0.5, cost: 1.138415 },
          output: { tokens: 20546, costPerMillion: 25, cost: 0.51365 },
        },
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 1649,
        cacheCreationTokens: 51802,
        cacheReadTokens: 712034,
        outputTokens: 5411,
        modelName: 'Claude Haiku 4.5',
        modelInfo: HAIKU_MODEL_INFO,
        peakContextUsage: 0,
        costUSD: 0.1646599,
        costBreakdown: {
          input: { tokens: 1649, costPerMillion: 0.8, cost: 0.0013192 },
          cacheWrite: { tokens: 51802, costPerMillion: 1, cost: 0.051802 },
          cacheRead: { tokens: 712034, costPerMillion: 0.08, cost: 0.0569627 },
          output: { tokens: 5411, costPerMillion: 10, cost: 0.05411 },
        },
      },
    },
  };
}

console.log('🧪 Running Issue #1508 regression tests...\n');
console.log('='.repeat(80));

// ==== Test Group: Multi-model budget stats ====
console.log('\n📋 Test Group: Multi-model per-model token/cost split\n');

runTest('multi-model shows both model names in bold', () => {
  const result = buildBudgetStatsString(makeMultiModelTokenUsage());
  assertContains(result, '**Claude Opus 4.6:**', 'Should show Opus heading');
  assertContains(result, '**Claude Haiku 4.5:**', 'Should show Haiku heading');
});

runTest('multi-model shows per-model input tokens', () => {
  const result = buildBudgetStatsString(makeMultiModelTokenUsage());
  // Opus: 58 + 87556 = 87614 input non-cached ≈ 87.6K
  assertContains(result, '87.6K', 'Should show Opus input tokens');
  // Haiku: 1649 + 51802 = 53451 ≈ 53.5K
  assertContains(result, '53.5K', 'Should show Haiku input tokens');
});

runTest('multi-model shows per-model cached tokens', () => {
  const result = buildBudgetStatsString(makeMultiModelTokenUsage());
  // Opus cache read: 2,276,830 ≈ 2.3M
  assertContains(result, '2.3M cached', 'Should show Opus cached tokens');
  // Haiku cache read: 712,034 ≈ 712K
  assertContains(result, '712.0K cached', 'Should show Haiku cached tokens');
});

runTest('multi-model shows per-model output tokens', () => {
  const result = buildBudgetStatsString(makeMultiModelTokenUsage());
  // Opus output: 20,546 ≈ 20.5K
  assertContains(result, '20.5K output', 'Should show Opus output tokens');
  // Haiku output: 5,411 ≈ 5.4K
  assertContains(result, '5.4K output', 'Should show Haiku output tokens');
});

runTest('multi-model shows per-model cost on Total line', () => {
  const result = buildBudgetStatsString(makeMultiModelTokenUsage());
  // Issue #1526: Cost now shown on the Total line
  assertContains(result, '$2.199580 cost', 'Should show Opus cost');
  assertContains(result, '$0.164660 cost', 'Should show Haiku cost');
});

// ==== Test Group: Sub-session deduplication in multi-model ====
console.log('\n📋 Test Group: Sub-sessions not duplicated per model\n');

runTest('single sub-session in multi-model does not show sub-sessions header', () => {
  const result = buildBudgetStatsString(makeMultiModelTokenUsage());
  assertNotContains(result, 'Sub sessions', 'Single sub-session in multi-model should not show sub-sessions header');
});

runTest('multi sub-sessions shown only once in multi-model', () => {
  const tokenUsage = makeMultiModelTokenUsage({
    subSessions: [
      { inputTokens: 1000, cacheCreationTokens: 50000, cacheReadTokens: 1500000, outputTokens: 12000, messageCount: 25, peakContextUsage: 60000, peakOutputUsage: 5000 },
      { inputTokens: 707, cacheCreationTokens: 89358, cacheReadTokens: 1488864, outputTokens: 13957, messageCount: 24, peakContextUsage: 71907, peakOutputUsage: 5548 },
    ],
  });
  const result = buildBudgetStatsString(tokenUsage);
  // Issue #1526: Sub-sessions shown as numbered "Context window:" lines, appearing once globally
  assertEqual(countOccurrences(result, '1. Context window:'), 1, 'Sub-session 1 should appear once');
  assertEqual(countOccurrences(result, '2. Context window:'), 1, 'Sub-session 2 should appear once');
});

runTest('single-model multi sub-sessions still shown under that model', () => {
  const tokenUsage = {
    inputTokens: 100000,
    cacheCreationTokens: 20000,
    cacheReadTokens: 10000,
    outputTokens: 30000,
    totalTokens: 150000,
    subSessions: [
      { inputTokens: 60000, cacheCreationTokens: 15000, cacheReadTokens: 8000, outputTokens: 18000, messageCount: 25, peakContextUsage: 80000, peakOutputUsage: 18000 },
      { inputTokens: 40000, cacheCreationTokens: 5000, cacheReadTokens: 2000, outputTokens: 12000, messageCount: 15, peakContextUsage: 45000, peakOutputUsage: 12000 },
    ],
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 100000,
        cacheCreationTokens: 20000,
        cacheReadTokens: 10000,
        outputTokens: 30000,
        modelName: 'Claude Opus 4.6',
        modelInfo: OPUS_MODEL_INFO,
        peakContextUsage: 80000,
        costUSD: 1.5,
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage);
  // Issue #1526: Sub-sessions shown as numbered "Context window:" lines
  assertContains(result, '1. Context window:', 'Should show sub-session 1');
  assertContains(result, '2. Context window:', 'Should show sub-session 2');
});

// ==== Test Group: accumulateModelUsage with multi-model ====
console.log('\n📋 Test Group: accumulateModelUsage multi-model tracking\n');

runTest('accumulates tokens for different models separately', () => {
  const modelUsageMap = {};

  // Opus entry
  accumulateModelUsage(modelUsageMap, {
    message: {
      model: 'claude-opus-4-6',
      usage: { input_tokens: 100, cache_creation_input_tokens: 500, cache_read_input_tokens: 2000, output_tokens: 300 },
    },
  });

  // Haiku entry
  accumulateModelUsage(modelUsageMap, {
    message: {
      model: 'claude-haiku-4-5-20251001',
      usage: { input_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 1000, output_tokens: 150 },
    },
  });

  // Second Opus entry
  accumulateModelUsage(modelUsageMap, {
    message: {
      model: 'claude-opus-4-6',
      usage: { input_tokens: 80, output_tokens: 200 },
    },
  });

  assertEqual(Object.keys(modelUsageMap).length, 2, 'Should have 2 models');
  assertEqual(modelUsageMap['claude-opus-4-6'].inputTokens, 180, 'Opus input should be 100 + 80');
  assertEqual(modelUsageMap['claude-opus-4-6'].outputTokens, 500, 'Opus output should be 300 + 200');
  assertEqual(modelUsageMap['claude-opus-4-6'].cacheReadTokens, 2000, 'Opus cache read should be 2000');
  assertEqual(modelUsageMap['claude-haiku-4-5-20251001'].inputTokens, 50, 'Haiku input should be 50');
  assertEqual(modelUsageMap['claude-haiku-4-5-20251001'].outputTokens, 150, 'Haiku output should be 150');
});

runTest('skips synthetic model entries', () => {
  const modelUsageMap = {};
  accumulateModelUsage(modelUsageMap, {
    message: {
      model: '<synthetic>',
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  });
  assertEqual(Object.keys(modelUsageMap).length, 0, 'Should skip <synthetic> model');
});

// ==== Test Group: Edge cases ====
console.log('\n📋 Test Group: Edge cases\n');

function makeSingleModelTokenUsage(modelId, modelName, overrides = {}) {
  const input = overrides.inputTokens ?? 1000;
  const cacheCreation = overrides.cacheCreationTokens ?? 0;
  const cacheRead = overrides.cacheReadTokens ?? 0;
  const output = overrides.outputTokens ?? 200;
  const peak = overrides.peakContextUsage ?? input + cacheCreation + cacheRead;
  return {
    inputTokens: input,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    outputTokens: output,
    totalTokens: input + cacheCreation + output,
    subSessions: [{ inputTokens: input, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead, outputTokens: output, messageCount: 5, peakContextUsage: peak, peakOutputUsage: output }],
    modelUsage: {
      [modelId]: { inputTokens: input, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead, outputTokens: output, modelName, modelInfo: overrides.modelInfo ?? null, peakContextUsage: peak, costUSD: overrides.costUSD ?? null },
    },
  };
}

runTest('model with null costUSD does not show cost line', () => {
  const result = buildBudgetStatsString(makeSingleModelTokenUsage('unknown-model', 'Unknown Model', { cacheCreationTokens: 500, peakContextUsage: 1500 }));
  assertNotContains(result, 'Cost:', 'Should not show cost when null');
});

runTest('model with zero costUSD shows $0 cost on Total line', () => {
  const result = buildBudgetStatsString(makeSingleModelTokenUsage('free-model', 'Free Model', { costUSD: 0 }));
  // Issue #1526: Cost now shown on the Total line
  assertContains(result, '$0.000000 cost', 'Should show $0.000000 for zero cost');
});

// ==== Test Group: Per-model context window and max output tokens (Issue #1508 feedback) ====
console.log('\n📋 Test Group: Per-model context window and max output tokens\n');

runTest('multi-model single sub-session shows per-model context window', () => {
  const result = buildBudgetStatsString(makeMultiModelTokenUsage());
  // Opus: peakContextUsage 71907 / contextLimit 1000000 = 7% — shown as single-line format
  assertContains(result, '71.9K / 1M input tokens (7%)', 'Should show Opus context window usage');
  // Issue #1526: Haiku peakContextUsage is 0 — falls back to cumulative total
  // Cumulative: 1649 + 51802 + 712034 = 765485 ≈ 765.5K / 200K = 383%
  assertContains(result, '765.5K / 200K input tokens (383%)', 'Should show Haiku cumulative context as fallback');
  assertContains(result, '5.4K / 32K output tokens (17%)', 'Should show Haiku output tokens');
});

runTest('multi-model single sub-session shows per-model max output tokens', () => {
  const result = buildBudgetStatsString(makeMultiModelTokenUsage());
  // Opus: 20546 output / 128000 outputLimit = 16%
  assertContains(result, '20.5K / 128K output tokens (16%)', 'Should show Opus max output usage');
  // Haiku: 5411 / 32000 = 17%
  assertContains(result, '5.4K / 32K output tokens (17%)', 'Should show Haiku max output usage');
});

runTest('multi-model multi sub-sessions shows global sub-sessions AND per-model context/output', () => {
  const tokenUsage = makeMultiModelTokenUsage({
    subSessions: [
      { inputTokens: 1000, cacheCreationTokens: 50000, cacheReadTokens: 1500000, outputTokens: 12000, messageCount: 25, peakContextUsage: 60000, peakOutputUsage: 5000 },
      { inputTokens: 707, cacheCreationTokens: 89358, cacheReadTokens: 1488864, outputTokens: 13957, messageCount: 24, peakContextUsage: 71907, peakOutputUsage: 5548 },
    ],
  });
  const result = buildBudgetStatsString(tokenUsage);
  // Issue #1526: Global sub-sessions shown as numbered Context window lines
  assertContains(result, '1. Context window:', 'Sub-session 1 shown globally');
  assertContains(result, '2. Context window:', 'Sub-session 2 shown globally');
  // Per-model headings
  assertContains(result, '**Claude Opus 4.6:**', 'Should show Opus heading');
  assertContains(result, '**Claude Haiku 4.5:**', 'Should show Haiku heading');
  // Per-model output limits shown (Opus 128K, Haiku 32K)
  assertContains(result, '20.5K / 128K output tokens', 'Should show Opus output usage');
  assertContains(result, '5.4K / 32K output tokens', 'Should show Haiku output usage');
});

// ==== Summary ====
console.log('\n' + '='.repeat(80));
console.log(`\n🏁 Test Results: ${testsPassed} passed, ${testsFailed} failed out of ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
