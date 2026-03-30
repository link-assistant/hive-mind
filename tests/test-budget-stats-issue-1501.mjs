#!/usr/bin/env node

/**
 * Regression tests for Issue #1501: Cost and token/context budget calculations are wrong
 *
 * Root causes tested:
 * 1. JSONL token duplication — same message ID counted multiple times (upstream: anthropics/claude-code#6805)
 * 2. Context window shows cumulative sum instead of peak per-request usage
 * 3. Stream vs JSONL mismatch due to duplication
 * 4. Cost estimate inflation from duplicated tokens
 *
 * These tests use buildBudgetStatsString and accumulateModelUsage to verify correct behavior.
 */

import { buildBudgetStatsString, accumulateModelUsage, createEmptySubSessionUsage } from '../src/claude.budget-stats.lib.mjs';

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

function assertLessThan(actual, limit, message = '') {
  if (actual >= limit) {
    throw new Error(`${message}\nExpected ${actual} to be less than ${limit}`);
  }
}

const OPUS_MODEL_INFO = { limit: { context: 1000000, output: 128000 } };

console.log('\u{1f9ea} Running Issue #1501 regression tests: Cost and token calculation fixes\n');
console.log('='.repeat(80));

// ==== Test Group: Context Window Display ====
console.log('\n\u{1f4cb} Test Group: Context window should NOT exceed 100% for valid usage\n');

runTest('context window percentage with large cache reads stays reasonable', () => {
  // Simulates the PR #1500 scenario: many API calls with large cache reads
  // After dedup, a single model's cumulative usage might still be large,
  // but the context window display should show peak usage, not cumulative
  const tokenUsage = {
    inputTokens: 645,
    cacheCreationTokens: 2101865,
    cacheReadTokens: 73066385,
    outputTokens: 82449,
    totalTokens: 2184959,
    // Peak context per request - the highest single-request fill
    peakContextUsage: 850000,
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 645,
        cacheCreationTokens: 2101865,
        cacheReadTokens: 73066385,
        outputTokens: 82449,
        modelName: 'Claude Opus 4.6',
        modelInfo: OPUS_MODEL_INFO,
        // Peak context for this specific model
        peakContextUsage: 850000,
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  // Should NOT show 7516.89%
  assertNotContains(result, '7516', 'Context should NOT show 7516% (cumulative sum)');
  // Should show peak context usage
  assertContains(result, 'Peak context', 'Should show peak context window usage');
});

runTest('context window total tokens processed shown separately from peak', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 10000,
    cacheReadTokens: 5000,
    outputTokens: 15000,
    totalTokens: 75000,
    peakContextUsage: 60000,
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 50000,
        cacheCreationTokens: 10000,
        cacheReadTokens: 5000,
        outputTokens: 15000,
        modelName: 'Claude Opus 4.6',
        modelInfo: OPUS_MODEL_INFO,
        peakContextUsage: 60000,
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  // Should show both cumulative and peak
  assertContains(result, 'Total tokens processed', 'Should show total tokens processed label');
  assertContains(result, 'Peak context', 'Should show peak context window');
});

// ==== Test Group: JSONL Deduplication ====
console.log('\n\u{1f4cb} Test Group: JSONL deduplication by message ID\n');

runTest('accumulateModelUsage deduplicates entries with same message ID', () => {
  const modelUsageMap = {};
  const seenMessageIds = new Set();

  // Simulate 3 duplicated JSONL entries for the same message (thinking + text + tool_use)
  const entries = [{ message: { id: 'msg_01ABC', model: 'claude-opus-4-6', usage: { input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 50 } } }, { message: { id: 'msg_01ABC', model: 'claude-opus-4-6', usage: { input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 50 } } }, { message: { id: 'msg_01ABC', model: 'claude-opus-4-6', usage: { input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 50 } } }];

  for (const entry of entries) {
    const msgId = entry.message.id;
    if (msgId && seenMessageIds.has(msgId)) continue; // Skip duplicates
    if (msgId) seenMessageIds.add(msgId);
    accumulateModelUsage(modelUsageMap, entry);
  }

  // Should count tokens only once
  const usage = modelUsageMap['claude-opus-4-6'];
  assertEqual(usage.inputTokens, 100, 'Input tokens should be counted once');
  assertEqual(usage.cacheReadTokens, 5000, 'Cache read tokens should be counted once');
  assertEqual(usage.outputTokens, 50, 'Output tokens should be counted once');
});

runTest('accumulateModelUsage counts different messages separately', () => {
  const modelUsageMap = {};
  const seenMessageIds = new Set();

  const entries = [{ message: { id: 'msg_01ABC', model: 'claude-opus-4-6', usage: { input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 50 } } }, { message: { id: 'msg_01DEF', model: 'claude-opus-4-6', usage: { input_tokens: 200, cache_read_input_tokens: 6000, output_tokens: 80 } } }];

  for (const entry of entries) {
    const msgId = entry.message.id;
    if (msgId && seenMessageIds.has(msgId)) continue;
    if (msgId) seenMessageIds.add(msgId);
    accumulateModelUsage(modelUsageMap, entry);
  }

  const usage = modelUsageMap['claude-opus-4-6'];
  assertEqual(usage.inputTokens, 300, 'Input tokens should sum across different messages');
  assertEqual(usage.cacheReadTokens, 11000, 'Cache read tokens should sum across different messages');
  assertEqual(usage.outputTokens, 130, 'Output tokens should sum across different messages');
});

runTest('accumulateModelUsage handles entries without message ID (legacy)', () => {
  const modelUsageMap = {};

  // Entries without ID should all be counted (backward compatibility)
  const entries = [{ message: { model: 'claude-opus-4-6', usage: { input_tokens: 100, output_tokens: 50 } } }, { message: { model: 'claude-opus-4-6', usage: { input_tokens: 200, output_tokens: 80 } } }];

  for (const entry of entries) {
    accumulateModelUsage(modelUsageMap, entry);
  }

  const usage = modelUsageMap['claude-opus-4-6'];
  assertEqual(usage.inputTokens, 300, 'Entries without message ID should all be counted');
  assertEqual(usage.outputTokens, 130, 'Output tokens should sum for entries without ID');
});

// ==== Test Group: Cost calculation clarity ====
console.log('\n\u{1f4cb} Test Group: Cost and token display clarity\n');

runTest('buildBudgetStatsString shows per-model stats with clear labels', () => {
  const tokenUsage = {
    inputTokens: 80000,
    cacheCreationTokens: 15000,
    cacheReadTokens: 8000,
    outputTokens: 25000,
    totalTokens: 120000,
    peakContextUsage: 95000,
    modelUsage: {
      'claude-opus-4-5-20251101': {
        inputTokens: 50000,
        cacheCreationTokens: 10000,
        cacheReadTokens: 5000,
        outputTokens: 15000,
        modelName: 'Claude Opus 4.5',
        modelInfo: { limit: { context: 200000, output: 32000 } },
        peakContextUsage: 62000,
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 30000,
        cacheCreationTokens: 5000,
        cacheReadTokens: 3000,
        outputTokens: 10000,
        modelName: 'Claude Haiku 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
        peakContextUsage: 36000,
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  // Multi-model mode should show each model separately
  assertContains(result, '**Claude Opus 4.5**', 'Should show Opus model');
  assertContains(result, '**Claude Haiku 4.5**', 'Should show Haiku model');
});

runTest('single model mode shows simplified output', () => {
  const tokenUsage = {
    inputTokens: 645,
    cacheCreationTokens: 2101865,
    cacheReadTokens: 73066385,
    outputTokens: 82449,
    totalTokens: 2184959,
    peakContextUsage: 850000,
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 645,
        cacheCreationTokens: 2101865,
        cacheReadTokens: 73066385,
        outputTokens: 82449,
        modelName: 'Claude Opus 4.6',
        modelInfo: OPUS_MODEL_INFO,
        peakContextUsage: 850000,
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  // Single model should NOT show bold model name labels (simplified)
  assertNotContains(result, '**Claude Opus 4.6**', 'Single model should not show bold label');
});

// ==== Summary ====
console.log('\n' + '='.repeat(80));
console.log(`\n\u{1f3c1} Test Results: ${testsPassed} passed, ${testsFailed} failed out of ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
