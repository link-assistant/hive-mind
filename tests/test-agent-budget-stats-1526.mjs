#!/usr/bin/env node

/**
 * Tests for Issue #1526: Agent CLI budget stats and improved usage format
 *
 * Tests:
 * - parseAgentTokenUsage extracts model/context info from step_finish events
 * - buildAgentBudgetStats builds budget stats compatible with buildBudgetStatsString
 * - buildBudgetStatsString renders Agent CLI data correctly
 * - Context window fix: peakContextUsage=0 does not show misleading context%
 */

import { buildBudgetStatsString, buildAgentBudgetStats } from '../src/claude.budget-stats.lib.mjs';
import { parseAgentTokenUsage } from '../src/agent.lib.mjs';

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

console.log('🧪 Running Issue #1526 tests: Agent CLI budget stats and usage format improvements\n');
console.log('='.repeat(80));

// ==== Test Group: parseAgentTokenUsage model/context extraction ====
console.log('\n📋 Test Group: parseAgentTokenUsage model/context info (Issue #1526)\n');

runTest('extracts model info from step_finish events', () => {
  const output = JSON.stringify({
    type: 'step_finish',
    part: {
      tokens: { input: 13192, output: 336, reasoning: 0, cache: { read: 224, write: 0 } },
      cost: 0,
      model: { providerID: 'opencode', requestedModelID: 'minimax-m2.5-free', respondedModelID: 'MiniMax-M2.5' },
      context: { contextLimit: 204800, outputLimit: 32000, usableContext: 172800, safeLimit: 146880 },
    },
  });
  const usage = parseAgentTokenUsage(output);
  assertEqual(usage.requestedModelId, 'minimax-m2.5-free', 'Should extract requestedModelID');
  assertEqual(usage.respondedModelId, 'MiniMax-M2.5', 'Should extract respondedModelID');
  assertEqual(usage.contextLimit, 204800, 'Should extract contextLimit');
  assertEqual(usage.outputLimit, 32000, 'Should extract outputLimit');
});

runTest('tracks peak context usage across steps', () => {
  const step1 = JSON.stringify({
    type: 'step_finish',
    part: {
      tokens: { input: 1000, output: 100, reasoning: 0, cache: { read: 5000, write: 0 } },
      cost: 0,
      model: { requestedModelID: 'test-model', respondedModelID: 'Test Model' },
      context: { contextLimit: 200000, outputLimit: 32000 },
    },
  });
  const step2 = JSON.stringify({
    type: 'step_finish',
    part: {
      tokens: { input: 500, output: 200, reasoning: 0, cache: { read: 15000, write: 0 } },
      cost: 0,
      model: { requestedModelID: 'test-model', respondedModelID: 'Test Model' },
      context: { contextLimit: 200000, outputLimit: 32000 },
    },
  });
  const usage = parseAgentTokenUsage(step1 + '\n' + step2);
  // Peak context: max(1000+5000, 500+15000) = max(6000, 15500) = 15500
  assertEqual(usage.peakContextUsage, 15500, 'Should track peak context usage as max(input+cache_read) per step');
});

runTest('handles step_finish without model/context fields', () => {
  const output = JSON.stringify({
    type: 'step_finish',
    part: {
      tokens: { input: 100, output: 50 },
      cost: 0,
    },
  });
  const usage = parseAgentTokenUsage(output);
  assertEqual(usage.requestedModelId, null, 'Should be null when no model info');
  assertEqual(usage.contextLimit, null, 'Should be null when no context info');
  assertEqual(usage.peakContextUsage, 0, 'Should be 0 when no context info');
});

// ==== Test Group: buildAgentBudgetStats ====
console.log('\n📋 Test Group: buildAgentBudgetStats (Issue #1526)\n');

runTest('builds budget stats from agent token usage with context info', () => {
  const tokenUsage = {
    inputTokens: 15000,
    outputTokens: 1000,
    reasoningTokens: 0,
    cacheReadTokens: 50000,
    cacheWriteTokens: 0,
    stepCount: 5,
    requestedModelId: 'minimax-m2.5-free',
    respondedModelId: 'MiniMax-M2.5',
    contextLimit: 204800,
    outputLimit: 32000,
    peakContextUsage: 14000,
  };
  const pricingInfo = {
    modelId: 'opencode/minimax-m2.5-free',
    modelName: 'MiniMax M2.5',
    totalCostUSD: 0.005,
  };
  const result = buildAgentBudgetStats(tokenUsage, pricingInfo);
  assertEqual(result !== null, true, 'Should return non-null result');
  assertEqual(Object.keys(result.modelUsage).length, 1, 'Should have one model');

  const modelKey = Object.keys(result.modelUsage)[0];
  const modelData = result.modelUsage[modelKey];
  assertEqual(modelData.modelName, 'MiniMax M2.5', 'Should use pricing modelName');
  assertEqual(modelData.peakContextUsage, 14000, 'Should pass through peakContextUsage');
  assertEqual(modelData.modelInfo.limit.context, 204800, 'Should set context limit');
  assertEqual(modelData.modelInfo.limit.output, 32000, 'Should set output limit');
  assertEqual(modelData.costUSD, 0.005, 'Should set cost from pricingInfo');
});

runTest('returns null when no steps', () => {
  const tokenUsage = { inputTokens: 0, outputTokens: 0, stepCount: 0 };
  const result = buildAgentBudgetStats(tokenUsage, null);
  assertEqual(result, null, 'Should return null when stepCount is 0');
});

runTest('returns null when tokenUsage is null', () => {
  const result = buildAgentBudgetStats(null, null);
  assertEqual(result, null, 'Should return null when tokenUsage is null');
});

// ==== Test Group: End-to-end Agent budget stats rendering ====
console.log('\n📋 Test Group: End-to-end Agent budget stats rendering (Issue #1526)\n');

runTest('renders Agent CLI budget stats with context window', () => {
  const tokenUsage = {
    inputTokens: 15000,
    outputTokens: 1000,
    cacheReadTokens: 50000,
    cacheWriteTokens: 0,
    stepCount: 5,
    respondedModelId: 'MiniMax-M2.5',
    contextLimit: 204800,
    outputLimit: 32000,
    peakContextUsage: 14000,
  };
  const pricingInfo = { modelName: 'MiniMax M2.5', totalCostUSD: 0.005 };
  const budgetData = buildAgentBudgetStats(tokenUsage, pricingInfo);
  const result = buildBudgetStatsString(budgetData);
  assertContains(result, '📊 **Context and tokens usage:**', 'Should have header');
  assertContains(result, 'Context window:', 'Should show context window');
  assertContains(result, '14K / 204.8K (7%) input tokens', 'Should show peak context vs limit');
  assertContains(result, '1K / 32K (3%) output tokens', 'Should show output vs limit');
  assertContains(result, 'Total:', 'Should show Total line');
  assertContains(result, '$0.005000 cost', 'Should show cost on total line');
});

runTest('renders Agent CLI budget stats without context window when peakContextUsage is 0', () => {
  const tokenUsage = {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    stepCount: 2,
    respondedModelId: 'TestModel',
    contextLimit: 200000,
    outputLimit: 64000,
    peakContextUsage: 0, // No peak context tracked
  };
  const pricingInfo = { modelName: 'Test Model', totalCostUSD: null };
  const budgetData = buildAgentBudgetStats(tokenUsage, pricingInfo);
  const result = buildBudgetStatsString(budgetData);
  // Issue #1539: peakContextUsage=0 — context window line skipped entirely.
  // Issue #1547: Output percentage uses consistent X / Y (Z%) format in Total line.
  assertNotContains(result, 'Context window:', 'Should NOT show context window when peak is 0');
  assertContains(result, '500 / 64K (1%) output tokens', 'Should show output usage in Total line');
});

// ==== Test Group: Context window 288% bug fix ====
console.log('\n📋 Test Group: Context window 288% bug fix (Issue #1526)\n');

runTest('Haiku with peakContextUsage=0 skips context window line', () => {
  // Issue #1539: When peakContextUsage is 0 (e.g., model from result JSON only),
  // skip context window display entirely — cumulative totals produce impossible
  // percentages like 288%. Output percentage shown in Total line instead.
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 30000,
    cacheReadTokens: 500000,
    outputTokens: 5000,
    totalTokens: 85000,
    subSessions: [],
    modelUsage: {
      'claude-haiku-4-5-20251001': {
        inputTokens: 75,
        cacheCreationTokens: 47259,
        cacheReadTokens: 527935,
        outputTokens: 4936,
        modelName: 'Claude Haiku 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
        peakContextUsage: 0, // Not tracked for result-JSON-sourced models
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage);
  // Issue #1539: Context window line skipped when peak is unknown
  assertNotContains(result, 'Context window:', 'Should NOT show context window when peak is 0');
  assertNotContains(result, '288%', 'Should NOT show impossible 288% percentage');
  // Issue #1547: Output percentage uses consistent format in Total line
  assertContains(result, '4.9K / 64K (8%) output tokens', 'Should show output tokens in Total line');
});

runTest('Opus with valid peakContextUsage still shows context correctly', () => {
  const tokenUsage = {
    inputTokens: 88700,
    cacheCreationTokens: 0,
    cacheReadTokens: 4700000,
    outputTokens: 27800,
    totalTokens: 116500,
    subSessions: [],
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 3257,
        cacheCreationTokens: 85443,
        cacheReadTokens: 4661830,
        outputTokens: 27802,
        modelName: 'Claude Opus 4.6',
        modelInfo: { limit: { context: 1000000, output: 128000 } },
        peakContextUsage: 90814, // Valid peak context from JSONL tracking
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage);
  // Should show 90.8K / 1M input tokens (9%)
  assertContains(result, '90.8K / 1M (9%) input tokens', 'Should show correct context window for Opus');
  assertContains(result, '27.8K / 128K (22%) output tokens', 'Should show output tokens');
});

// ==== Summary ====
console.log('\n' + '='.repeat(80));
console.log(`\n🏁 Test Results: ${testsPassed} passed, ${testsFailed} failed out of ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
