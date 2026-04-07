#!/usr/bin/env node

/**
 * Regression tests for Issue #1539: Wrong calculation of context and tokens usage
 *
 * Root cause: When peakContextUsage is 0 (e.g. model data from result JSON only,
 * not tracked in JSONL), the code fell back to cumulative totals
 * (inputTokens + cacheCreationTokens + cacheReadTokens) as "context window" usage.
 * This produced impossible percentages like 250% because cumulative totals across
 * all requests can far exceed a model's per-request context window limit.
 *
 * Fix: Only show context window input token usage when peakContextUsage > 0.
 * When peak is unknown, skip the input token part of context window display.
 * Output tokens and cumulative totals on the "Total:" line are unaffected.
 */

import { buildBudgetStatsString, displayBudgetStats, mergeResultModelUsage } from '../src/claude.budget-stats.lib.mjs';

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

// Reproduce the exact scenario from the issue report
const OPUS_MODEL_INFO = { limit: { context: 1000000, output: 128000 } };
const HAIKU_MODEL_INFO = { limit: { context: 200000, output: 64000 } };

console.log('🧪 Running Issue #1539 regression tests...\n');
console.log('='.repeat(80));

// ==== Test Group: Issue #1539 exact reproduction ====
console.log('\n📋 Test Group: Exact reproduction of reported bug\n');

runTest('Haiku with peakContextUsage=0 does NOT show cumulative as context window', () => {
  // Reproduce exact numbers from the issue:
  // Total: 70.5K + 429.6K cached input tokens, 7.0K output tokens
  // This means inputTokens+cacheCreation = 70500, cacheRead = 429600
  const tokenUsage = {
    inputTokens: 70500 + 109900,
    cacheCreationTokens: 0,
    cacheReadTokens: 429600 + 7300000,
    outputTokens: 7000 + 30700,
    totalTokens: 180400,
    subSessions: [],
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 109900,
        cacheCreationTokens: 0,
        cacheReadTokens: 7300000,
        outputTokens: 30700,
        modelName: 'Claude Opus 4.6',
        modelInfo: OPUS_MODEL_INFO,
        peakContextUsage: 109900, // Opus has JSONL tracking
        costUSD: 5.502571,
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 70500,
        cacheCreationTokens: 0,
        cacheReadTokens: 429600,
        outputTokens: 7000,
        modelName: 'Claude Haiku 4.5',
        modelInfo: HAIKU_MODEL_INFO,
        peakContextUsage: 0, // No JSONL tracking for sub-agent
        costUSD: 0.165163,
      },
    },
  };

  const result = buildBudgetStatsString(tokenUsage);

  // The bug: would show "500.1K / 200K input tokens (250%)" — impossible
  assertNotContains(result, '(250%)', 'Should NOT show 250% context usage');
  assertNotContains(result, '500.1K / 200K', 'Should NOT show cumulative as context window');
  assertNotContains(result, '/ 200K input tokens', 'Should NOT show any input token context for Haiku');

  // Issue #1539: Context window line should be skipped entirely for unknown peak.
  // Output percentage is embedded in the Total line instead.
  assertNotContains(result, 'Context window: 7K / 64K output tokens', 'Should NOT show separate context window line for Haiku');
  assertContains(result, '11% of 64K output limit', 'Should embed output percentage in Total line');

  // Cumulative totals on Total: line should be unaffected
  assertContains(result, '70.5K', 'Should show Haiku non-cached input in Total');
  assertContains(result, '429.6K cached', 'Should show Haiku cached tokens in Total');
});

runTest('Opus with peakContextUsage > 0 still shows context window normally', () => {
  const tokenUsage = {
    inputTokens: 109900,
    cacheCreationTokens: 0,
    cacheReadTokens: 7300000,
    outputTokens: 30700,
    totalTokens: 140600,
    subSessions: [],
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 109900,
        cacheCreationTokens: 0,
        cacheReadTokens: 7300000,
        outputTokens: 30700,
        modelName: 'Claude Opus 4.6',
        modelInfo: OPUS_MODEL_INFO,
        peakContextUsage: 109900,
        costUSD: 5.502571,
      },
    },
  };

  const result = buildBudgetStatsString(tokenUsage);
  assertContains(result, '109.9K / 1M input tokens (11%)', 'Should show Opus context window');
  assertContains(result, '30.7K / 128K output tokens (24%)', 'Should show Opus output tokens');
});

// ==== Test Group: Context window never exceeds 100% ====
console.log('\n📋 Test Group: Context window percentage sanity checks\n');

runTest('peakContextUsage near context limit shows valid percentage', () => {
  const tokenUsage = {
    inputTokens: 190000,
    outputTokens: 5000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 195000,
    subSessions: [],
    modelUsage: {
      'claude-haiku-4-5-20251001': {
        inputTokens: 190000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 5000,
        modelName: 'Claude Haiku 4.5',
        modelInfo: HAIKU_MODEL_INFO,
        peakContextUsage: 190000, // 95% — valid
        costUSD: 0.1,
      },
    },
  };

  const result = buildBudgetStatsString(tokenUsage);
  assertContains(result, '190K / 200K input tokens (95%)', 'Should show 95% context usage');
});

runTest('zero peakContextUsage with large cumulative does NOT show impossible percentage', () => {
  // Scenario: model with 200K limit, but cumulative usage = 1M across many requests
  const tokenUsage = {
    inputTokens: 100000,
    cacheCreationTokens: 0,
    cacheReadTokens: 900000,
    outputTokens: 10000,
    totalTokens: 110000,
    subSessions: [],
    modelUsage: {
      'test-model': {
        inputTokens: 100000,
        cacheCreationTokens: 0,
        cacheReadTokens: 900000,
        outputTokens: 10000,
        modelName: 'Test Model',
        modelInfo: { limit: { context: 200000, output: 32000 } },
        peakContextUsage: 0, // Unknown
        costUSD: 0.5,
      },
    },
  };

  const result = buildBudgetStatsString(tokenUsage);
  // Should NOT show 500% (1M / 200K)
  assertNotContains(result, '500%', 'Should NOT show 500% context usage');
  assertNotContains(result, '/ 200K input tokens', 'Should NOT show input context when peak unknown');
  assertNotContains(result, 'Context window:', 'Should NOT show context window line when peak unknown');
  // Total line should still show all token data plus output percentage
  assertContains(result, '100K', 'Should show non-cached input in Total');
  assertContains(result, '900K cached', 'Should show cached tokens in Total');
  assertContains(result, '31% of 32K output limit', 'Should embed output percentage in Total line');
});

// ==== Test Group: Sub-sessions with unknown peak ====
console.log('\n📋 Test Group: Sub-sessions handle unknown peak correctly\n');

runTest('sub-session with peakContextUsage=0 skips input context but shows output', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 10000,
    cacheReadTokens: 300000,
    outputTokens: 8000,
    totalTokens: 68000,
    subSessions: [
      { inputTokens: 30000, cacheCreationTokens: 5000, cacheReadTokens: 200000, outputTokens: 5000, messageCount: 10, peakContextUsage: 0, peakOutputUsage: 5000 },
      { inputTokens: 20000, cacheCreationTokens: 5000, cacheReadTokens: 100000, outputTokens: 3000, messageCount: 8, peakContextUsage: 45000, peakOutputUsage: 3000 },
    ],
    modelUsage: {
      'test-model': {
        inputTokens: 50000,
        cacheCreationTokens: 10000,
        cacheReadTokens: 300000,
        outputTokens: 8000,
        modelName: 'Test Model',
        modelInfo: { limit: { context: 200000, output: 32000 } },
        peakContextUsage: 45000,
        costUSD: 0.3,
      },
    },
  };

  const result = buildBudgetStatsString(tokenUsage);
  // Sub-session 1: peakContextUsage=0 → no input context shown
  // Sub-session 2: peakContextUsage=45000 → shown as 45K / 200K (23%)
  assertContains(result, '45K / 200K input tokens (23%)', 'Sub-session 2 should show context');
  // Sub-session 1 should NOT show cumulative (235K / 200K = 118%)
  assertNotContains(result, '118%', 'Sub-session 1 should NOT show impossible percentage');
  assertNotContains(result, '235K / 200K', 'Sub-session 1 should NOT show cumulative as context');
});

runTest('sub-session with peakContextUsage > 0 displays normally', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 10000,
    cacheReadTokens: 300000,
    outputTokens: 8000,
    totalTokens: 68000,
    subSessions: [
      { inputTokens: 30000, cacheCreationTokens: 5000, cacheReadTokens: 200000, outputTokens: 5000, messageCount: 10, peakContextUsage: 80000, peakOutputUsage: 5000 },
      { inputTokens: 20000, cacheCreationTokens: 5000, cacheReadTokens: 100000, outputTokens: 3000, messageCount: 8, peakContextUsage: 45000, peakOutputUsage: 3000 },
    ],
    modelUsage: {
      'test-model': {
        inputTokens: 50000,
        cacheCreationTokens: 10000,
        cacheReadTokens: 300000,
        outputTokens: 8000,
        modelName: 'Test Model',
        modelInfo: { limit: { context: 200000, output: 32000 } },
        peakContextUsage: 80000,
        costUSD: 0.3,
      },
    },
  };

  const result = buildBudgetStatsString(tokenUsage);
  assertContains(result, '80K / 200K input tokens (40%)', 'Sub-session 1 should show peak context');
  assertContains(result, '45K / 200K input tokens (23%)', 'Sub-session 2 should show peak context');
});

// ==== Test Group: displayBudgetStats (async version) ====
console.log('\n📋 Test Group: displayBudgetStats async function\n');

runTest('displayBudgetStats skips input context when peakContextUsage is 0', async () => {
  const logLines = [];
  const log = async msg => logLines.push(msg);
  const usage = {
    inputTokens: 70500,
    cacheCreationTokens: 0,
    cacheReadTokens: 429600,
    outputTokens: 7000,
    modelInfo: { limit: { context: 200000, output: 64000 } },
    peakContextUsage: 0,
  };
  const tokenUsage = { subSessions: [] };

  await displayBudgetStats(usage, tokenUsage, log);

  const output = logLines.join('\n');
  assertNotContains(output, '/ 200 000 input tokens', 'Should NOT show input context when peak is 0');
  assertNotContains(output, '250%', 'Should NOT show 250%');
  assertNotContains(output, 'Context window:', 'Should NOT show context window line when peak is 0');
  // Output percentage should be embedded in Total line
  assertContains(output, '11% of 64 000 output limit', 'Should embed output percentage in Total line');
});

runTest('displayBudgetStats shows input context when peakContextUsage > 0', async () => {
  const logLines = [];
  const log = async msg => logLines.push(msg);
  const usage = {
    inputTokens: 70500,
    cacheCreationTokens: 0,
    cacheReadTokens: 429600,
    outputTokens: 7000,
    modelInfo: { limit: { context: 200000, output: 64000 } },
    peakContextUsage: 150000,
  };
  const tokenUsage = { subSessions: [] };

  await displayBudgetStats(usage, tokenUsage, log);

  const output = logLines.join('\n');
  assertContains(output, '150 000 / 200 000 input tokens (75%)', 'Should show peak context usage');
  assertContains(output, '/ 64 000 output tokens', 'Should show output tokens');
});

// ==== Test Group: mergeResultModelUsage extracts contextWindow and maxOutputTokens ====
console.log('\n📋 Test Group: mergeResultModelUsage extracts model limits from result JSON\n');

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

runTest('mergeResultModelUsage stores _resultContextWindow for new model', () => {
  const modelUsage = {};
  const resultModelUsage = {
    'claude-haiku-4-5-20251001': {
      inputTokens: 3208,
      outputTokens: 6977,
      cacheReadInputTokens: 429633,
      cacheCreationInputTokens: 67285,
      costUSD: 0.165,
      contextWindow: 200000,
      maxOutputTokens: 32000,
    },
  };
  mergeResultModelUsage(modelUsage, resultModelUsage);
  assertEqual(modelUsage['claude-haiku-4-5-20251001']._resultContextWindow, 200000, 'Should store contextWindow from result JSON');
  assertEqual(modelUsage['claude-haiku-4-5-20251001']._resultMaxOutputTokens, 32000, 'Should store maxOutputTokens from result JSON');
});

runTest('mergeResultModelUsage stores limits for existing model with higher result totals', () => {
  const modelUsage = {
    'claude-haiku-4-5-20251001': {
      inputTokens: 100,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 50,
    },
  };
  const resultModelUsage = {
    'claude-haiku-4-5-20251001': {
      inputTokens: 3208,
      outputTokens: 6977,
      cacheReadInputTokens: 429633,
      cacheCreationInputTokens: 67285,
      costUSD: 0.165,
      contextWindow: 200000,
      maxOutputTokens: 32000,
    },
  };
  mergeResultModelUsage(modelUsage, resultModelUsage);
  assertEqual(modelUsage['claude-haiku-4-5-20251001']._resultContextWindow, 200000, 'Should store contextWindow on merge');
  assertEqual(modelUsage['claude-haiku-4-5-20251001']._resultMaxOutputTokens, 32000, 'Should store maxOutputTokens on merge');
});

runTest('mergeResultModelUsage handles missing contextWindow/maxOutputTokens gracefully', () => {
  const modelUsage = {};
  const resultModelUsage = {
    'claude-opus-4-6': {
      inputTokens: 1670,
      outputTokens: 30550,
      cacheReadInputTokens: 6972897,
      cacheCreationInputTokens: 171113,
      costUSD: 5.328,
    },
  };
  mergeResultModelUsage(modelUsage, resultModelUsage);
  assertEqual(modelUsage['claude-opus-4-6']._resultContextWindow, undefined, 'Should not set _resultContextWindow when not in result');
  assertEqual(modelUsage['claude-opus-4-6']._resultMaxOutputTokens, undefined, 'Should not set _resultMaxOutputTokens when not in result');
});

// ==== Summary ====
console.log('\n' + '='.repeat(80));
console.log(`\n🏁 Test Results: ${testsPassed} passed, ${testsFailed} failed out of ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
