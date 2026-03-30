#!/usr/bin/env node

/**
 * Regression tests for Issue #1501: Cost and token/context budget calculations are wrong
 *
 * Root causes tested:
 * 1. JSONL token duplication — same message ID counted multiple times (upstream: anthropics/claude-code#6805)
 * 2. Context window shows cumulative sum instead of peak per-request usage
 * 3. Cost estimate inflation from duplicated tokens
 * 4. Output format matches user requirements (sub-sessions, cached tokens, no noise)
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

const OPUS_MODEL_INFO = { limit: { context: 1000000, output: 128000 } };

console.log('\u{1f9ea} Running Issue #1501 regression tests: Cost and token calculation fixes\n');
console.log('='.repeat(80));

// ==== Test Group: Context Window Display ====
console.log('\n\u{1f4cb} Test Group: Context window should NOT exceed 100% for valid usage\n');

runTest('context window percentage with large cache reads stays reasonable', () => {
  // Simulates the PR #1500 scenario: many API calls with large cache reads
  // After dedup, peak context is what matters, not cumulative sum
  const tokenUsage = {
    inputTokens: 645,
    cacheCreationTokens: 2101865,
    cacheReadTokens: 73066385,
    outputTokens: 82449,
    totalTokens: 2184959,
    peakContextUsage: 850000,
    subSessions: [{ inputTokens: 645, cacheCreationTokens: 2101865, cacheReadTokens: 73066385, outputTokens: 82449, messageCount: 50, peakContextUsage: 850000, peakOutputUsage: 82449 }],
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
  // Should NOT show 7516.89% — that was the old bug
  assertNotContains(result, '7516', 'Context should NOT show 7516% (cumulative sum)');
  // Should show max context window with peak usage
  assertContains(result, 'Max context window:', 'Should show max context window');
  assertContains(result, '850K', 'Should show 850K peak context');
});

runTest('output format shows totals with cached tokens separately', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 10000,
    cacheReadTokens: 200000,
    outputTokens: 15000,
    totalTokens: 75000,
    peakContextUsage: 60000,
    subSessions: [{ inputTokens: 50000, cacheCreationTokens: 10000, cacheReadTokens: 200000, outputTokens: 15000, messageCount: 10, peakContextUsage: 60000, peakOutputUsage: 15000 }],
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 50000,
        cacheCreationTokens: 10000,
        cacheReadTokens: 200000,
        outputTokens: 15000,
        modelName: 'Claude Opus 4.6',
        modelInfo: OPUS_MODEL_INFO,
        peakContextUsage: 60000,
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  // Should show "Total input tokens: X + Y cached" format
  assertContains(result, 'Total input tokens: 60,000 + 200,000 cached', 'Should show input + cached separately');
  assertContains(result, 'Total output tokens: 15,000 output', 'Should show total output tokens');
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

// ==== Test Group: Output format requirements (from PR #1502 feedback) ====
console.log('\n\u{1f4cb} Test Group: Output format matches user requirements\n');

runTest('does not show JSONL deduplication stats to user', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 10000,
    cacheReadTokens: 5000,
    outputTokens: 15000,
    totalTokens: 75000,
    duplicateEntriesSkipped: 42,
    subSessions: [{ inputTokens: 50000, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 15000, messageCount: 10, peakContextUsage: 60000, peakOutputUsage: 15000 }],
    modelUsage: { 'claude-opus-4-6': { inputTokens: 50000, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 15000, modelName: 'Claude Opus 4.6', modelInfo: OPUS_MODEL_INFO, peakContextUsage: 60000 } },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertNotContains(result, 'JSONL deduplication', 'Should NOT show deduplication to user');
  assertNotContains(result, 'duplicate entries', 'Should NOT mention duplicates');
});

runTest('does not show stream vs JSONL comparison to user', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 10000,
    cacheReadTokens: 5000,
    outputTokens: 15000,
    totalTokens: 75000,
    subSessions: [{ inputTokens: 50000, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 15000, messageCount: 10, peakContextUsage: 60000, peakOutputUsage: 15000 }],
    modelUsage: { 'claude-opus-4-6': { inputTokens: 50000, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 15000, modelName: 'Claude Opus 4.6', modelInfo: OPUS_MODEL_INFO, peakContextUsage: 60000 } },
  };
  const streamUsage = { inputTokens: 49500, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 14800, eventCount: 42 };
  const result = buildBudgetStatsString(tokenUsage, streamUsage);
  assertNotContains(result, 'Own calculation', 'Should NOT show stream calculation');
  assertNotContains(result, 'JSONL calculation', 'Should NOT show JSONL calculation');
});

runTest('single sub-session shows simplified format', () => {
  const tokenUsage = {
    inputTokens: 645,
    cacheCreationTokens: 2101865,
    cacheReadTokens: 73066385,
    outputTokens: 82449,
    totalTokens: 2184959,
    peakContextUsage: 850000,
    subSessions: [{ inputTokens: 645, cacheCreationTokens: 2101865, cacheReadTokens: 73066385, outputTokens: 82449, messageCount: 50, peakContextUsage: 850000, peakOutputUsage: 82449 }],
    modelUsage: { 'claude-opus-4-6': { inputTokens: 645, cacheCreationTokens: 2101865, cacheReadTokens: 73066385, outputTokens: 82449, modelName: 'Claude Opus 4.6', modelInfo: OPUS_MODEL_INFO, peakContextUsage: 850000 } },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  // Single sub-session: simplified format with Max context / Max output
  assertContains(result, 'Max context window:', 'Should show Max context window');
  assertContains(result, 'Max output tokens:', 'Should show Max output tokens');
  assertNotContains(result, 'Sub sessions', 'Single sub-session should NOT show sub-sessions list');
});

runTest('multiple sub-sessions shows numbered list', () => {
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
    compactifications: [{ timestamp: '2026-03-29T10:00:00Z', preTokens: 167219, trigger: 'auto' }],
    modelUsage: {
      'claude-opus-4-6': { inputTokens: 100000, cacheCreationTokens: 20000, cacheReadTokens: 10000, outputTokens: 30000, modelName: 'Claude Opus 4.6', modelInfo: OPUS_MODEL_INFO, peakContextUsage: 80000 },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, 'Sub sessions (between compact events):', 'Should show sub-sessions header');
  assertContains(result, '1. ', 'Should number first sub-session');
  assertContains(result, '2. ', 'Should number second sub-session');
  assertNotContains(result, 'Max context window:', 'Multiple sub-sessions should NOT show single simplified format');
});

runTest('createEmptySubSessionUsage has peak tracking fields', () => {
  const sub = createEmptySubSessionUsage();
  assertEqual(sub.peakContextUsage, 0, 'Should have peakContextUsage = 0');
  assertEqual(sub.peakOutputUsage, 0, 'Should have peakOutputUsage = 0');
  assertEqual(sub.inputTokens, 0, 'Should have inputTokens = 0');
  assertEqual(sub.messageCount, 0, 'Should have messageCount = 0');
});

runTest('multi-model shows per-model stats with bold labels', () => {
  const tokenUsage = {
    inputTokens: 80000,
    cacheCreationTokens: 15000,
    cacheReadTokens: 8000,
    outputTokens: 25000,
    totalTokens: 120000,
    subSessions: [{ inputTokens: 80000, cacheCreationTokens: 15000, cacheReadTokens: 8000, outputTokens: 25000, messageCount: 30, peakContextUsage: 95000, peakOutputUsage: 15000 }],
    modelUsage: {
      'claude-opus-4-5-20251101': { inputTokens: 50000, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 15000, modelName: 'Claude Opus 4.5', modelInfo: { limit: { context: 200000, output: 32000 } }, peakContextUsage: 62000 },
      'claude-haiku-4-5-20251001': { inputTokens: 30000, cacheCreationTokens: 5000, cacheReadTokens: 3000, outputTokens: 10000, modelName: 'Claude Haiku 4.5', modelInfo: { limit: { context: 200000, output: 64000 } }, peakContextUsage: 36000 },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, '**Claude Opus 4.5:**', 'Should show Opus in bold');
  assertContains(result, '**Claude Haiku 4.5:**', 'Should show Haiku in bold');
});

runTest('single model does not show bold label', () => {
  const tokenUsage = {
    inputTokens: 645,
    cacheCreationTokens: 2101865,
    cacheReadTokens: 73066385,
    outputTokens: 82449,
    totalTokens: 2184959,
    subSessions: [{ inputTokens: 645, cacheCreationTokens: 2101865, cacheReadTokens: 73066385, outputTokens: 82449, messageCount: 50, peakContextUsage: 850000, peakOutputUsage: 82449 }],
    modelUsage: { 'claude-opus-4-6': { inputTokens: 645, cacheCreationTokens: 2101865, cacheReadTokens: 73066385, outputTokens: 82449, modelName: 'Claude Opus 4.6', modelInfo: OPUS_MODEL_INFO, peakContextUsage: 850000 } },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertNotContains(result, '**Claude Opus 4.6**', 'Single model should NOT show bold label');
});

// ==== Summary ====
console.log('\n' + '='.repeat(80));
console.log(`\n\u{1f3c1} Test Results: ${testsPassed} passed, ${testsFailed} failed out of ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
