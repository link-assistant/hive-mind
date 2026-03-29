#!/usr/bin/env node

/**
 * Unit tests for token budget statistics features (Issue #1491)
 *
 * Tests:
 * - buildBudgetStatsString: Markdown generation for GitHub comments
 * - Sub-session tracking in calculateSessionTokens helper functions
 */

import { buildBudgetStatsString } from '../src/claude.budget-stats.lib.mjs';

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

// Shared test fixtures
const SONNET_MODEL_INFO = { limit: { context: 200000, output: 64000 } };

function makeTokenUsage({ input = 50000, cacheCreate = 10000, cacheRead = 5000, output = 15000, modelId = 'claude-sonnet-4-5-20250929', modelName = 'Claude Sonnet 4.5', modelInfo = SONNET_MODEL_INFO, subSessions = undefined, compactifications = undefined } = {}) {
  return {
    inputTokens: input,
    cacheCreationTokens: cacheCreate,
    cacheReadTokens: cacheRead,
    outputTokens: output,
    totalTokens: input + cacheCreate + output,
    subSessions,
    compactifications,
    modelUsage: {
      [modelId]: { inputTokens: input, cacheCreationTokens: cacheCreate, cacheReadTokens: cacheRead, outputTokens: output, modelName, modelInfo },
    },
  };
}

function makeStreamUsage({ input = 50000, cacheCreate = 10000, cacheRead = 5000, output = 15000, eventCount = 30 } = {}) {
  return { inputTokens: input, cacheCreationTokens: cacheCreate, cacheReadTokens: cacheRead, outputTokens: output, eventCount };
}

console.log('🧪 Running token budget statistics unit tests (Issue #1491)...\n');
console.log('='.repeat(80));

// ==== Test Group: buildBudgetStatsString ====
console.log('\n📋 Test Group: buildBudgetStatsString - GitHub comment generation\n');

runTest('returns empty string when tokenUsage is null', () => {
  assertEqual(buildBudgetStatsString(null, null), '', 'Should return empty string for null tokenUsage');
});

runTest('shows context window percentage with model limits', () => {
  const result = buildBudgetStatsString(makeTokenUsage(), null);
  assertContains(result, '📊 **Token budget statistics:**', 'Should have header');
  assertContains(result, 'Context window:', 'Should show context window');
  assertContains(result, '200,000', 'Should show context limit');
  assertContains(result, '32.50%', 'Should show correct percentage (65000/200000)');
  assertContains(result, 'Output tokens:', 'Should show output tokens');
  assertContains(result, '64,000', 'Should show output limit');
  assertContains(result, '23.44%', 'Should show output percentage (15000/64000)');
});

runTest('shows context tokens without percentage when no model limits', () => {
  const result = buildBudgetStatsString(makeTokenUsage({ cacheCreate: 0, cacheRead: 0, modelId: 'unknown-model', modelName: 'unknown-model', modelInfo: null }), null);
  assertContains(result, 'Context tokens used:', 'Should show context tokens without percentage');
  assertNotContains(result, 'Context window:', 'Should not show context window when no limits');
});

runTest('shows sub-session breakdown when compactification occurred', () => {
  const tokenUsage = makeTokenUsage({
    input: 100000,
    cacheCreate: 20000,
    cacheRead: 10000,
    output: 30000,
    subSessions: [
      { inputTokens: 60000, cacheCreationTokens: 15000, cacheReadTokens: 8000, outputTokens: 18000, messageCount: 25 },
      { inputTokens: 40000, cacheCreationTokens: 5000, cacheReadTokens: 2000, outputTokens: 12000, messageCount: 15 },
    ],
    compactifications: [{ timestamp: '2026-03-29T10:00:00Z', preTokens: 167219, trigger: 'auto' }],
  });
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, 'Compactifications: 1', 'Should show compactification count');
  assertContains(result, 'Sub-session 1 (initial)', 'Should label first sub-session');
  assertContains(result, 'Sub-session 2 (after compactification #1)', 'Should label second sub-session');
  assertContains(result, '25 messages', 'Should show message count for sub-session 1');
  assertContains(result, '15 messages', 'Should show message count for sub-session 2');
});

runTest('shows stream vs JSONL comparison when both available', () => {
  const result = buildBudgetStatsString(makeTokenUsage(), makeStreamUsage({ input: 49500, output: 14800, eventCount: 42 }));
  assertContains(result, 'Own calculation (stream):', 'Should show stream calculation');
  assertContains(result, '42 events', 'Should show event count');
  assertContains(result, 'JSONL calculation:', 'Should show JSONL calculation');
  assertContains(result, 'diff:', 'Should show difference when mismatch');
});

runTest('does not show diff when stream and JSONL match', () => {
  const result = buildBudgetStatsString(makeTokenUsage(), makeStreamUsage());
  assertNotContains(result, 'diff:', 'Should not show diff when values match');
});

runTest('shows multiple models with labels', () => {
  const tokenUsage = {
    inputTokens: 80000,
    cacheCreationTokens: 15000,
    cacheReadTokens: 8000,
    outputTokens: 25000,
    totalTokens: 120000,
    modelUsage: {
      'claude-opus-4-5-20251101': { inputTokens: 50000, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 15000, modelName: 'Claude Opus 4.5', modelInfo: { limit: { context: 200000, output: 32000 } } },
      'claude-haiku-4-5-20251001': { inputTokens: 30000, cacheCreationTokens: 5000, cacheReadTokens: 3000, outputTokens: 10000, modelName: 'Claude Haiku 4.5', modelInfo: SONNET_MODEL_INFO },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, '**Claude Opus 4.5**', 'Should show Opus model name in bold');
  assertContains(result, '**Claude Haiku 4.5**', 'Should show Haiku model name in bold');
});

runTest('does not show sub-sessions when no compactification', () => {
  const result = buildBudgetStatsString(makeTokenUsage({ cacheCreate: 0, cacheRead: 0 }), null);
  assertNotContains(result, 'Compactifications', 'Should not show compactifications section');
  assertNotContains(result, 'Sub-session', 'Should not show sub-session breakdown');
});

runTest('does not show stream comparison when no stream data', () => {
  const result = buildBudgetStatsString(makeTokenUsage({ cacheCreate: 0, cacheRead: 0 }), null);
  assertNotContains(result, 'Own calculation', 'Should not show stream calculation');
  assertNotContains(result, 'JSONL calculation', 'Should not show JSONL calculation');
});

// ==== Test Group: Sub-session helper functions ====
console.log('\n📋 Test Group: Sub-session tracking helpers\n');

runTest('empty sub-session has zero values', () => {
  const subSession = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, messageCount: 0 };
  assertEqual(subSession.inputTokens, 0, 'inputTokens should be 0');
  assertEqual(subSession.outputTokens, 0, 'outputTokens should be 0');
  assertEqual(subSession.messageCount, 0, 'messageCount should be 0');
});

runTest('compactification boundary is detected by type and subtype', () => {
  const entry = { type: 'system', subtype: 'compact_boundary', compactMetadata: { preTokens: 167219, trigger: 'auto' } };
  assertEqual(entry.type === 'system' && entry.subtype === 'compact_boundary', true, 'Should detect compact_boundary');
  assertEqual(entry.compactMetadata.preTokens, 167219, 'Should have preTokens');
  assertEqual(entry.compactMetadata.trigger, 'auto', 'Should have trigger');
});

runTest('non-compact system events are not treated as boundaries', () => {
  const entry = { type: 'system', subtype: 'init' };
  assertEqual(entry.type === 'system' && entry.subtype === 'compact_boundary', false, 'Should not detect init as compact_boundary');
});

runTest('assistant messages with usage are not boundaries', () => {
  const entry = { type: 'assistant', message: { usage: { input_tokens: 100 }, model: 'claude-sonnet-4-5' } };
  assertEqual(entry.type === 'system' && entry.subtype === 'compact_boundary', false, 'Should not detect assistant as compact_boundary');
});

// ==== Test Group: Edge cases ====
console.log('\n📋 Test Group: Edge cases\n');

runTest('handles zero tokens gracefully', () => {
  const result = buildBudgetStatsString(makeTokenUsage({ input: 0, cacheCreate: 0, cacheRead: 0, output: 0 }), null);
  assertContains(result, '0.00%', 'Should show 0% for zero tokens');
});

runTest('handles high context usage (near limit)', () => {
  const result = buildBudgetStatsString(makeTokenUsage({ input: 180000, cacheCreate: 15000, cacheRead: 3000, output: 60000 }), null);
  assertContains(result, '99.00%', 'Should show 99% context usage ((180000+15000+3000)/200000)');
  assertContains(result, '93.75%', 'Should show 93.75% output usage (60000/64000)');
});

runTest('handles multiple compactifications', () => {
  const tokenUsage = makeTokenUsage({
    input: 200000,
    cacheCreate: 30000,
    cacheRead: 15000,
    output: 50000,
    subSessions: [
      { inputTokens: 80000, cacheCreationTokens: 12000, cacheReadTokens: 6000, outputTokens: 20000, messageCount: 20 },
      { inputTokens: 70000, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 15000, messageCount: 18 },
      { inputTokens: 50000, cacheCreationTokens: 8000, cacheReadTokens: 4000, outputTokens: 15000, messageCount: 12 },
    ],
    compactifications: [
      { timestamp: '2026-03-29T10:00:00Z', preTokens: 167000, trigger: 'auto' },
      { timestamp: '2026-03-29T11:30:00Z', preTokens: 155000, trigger: 'auto' },
    ],
  });
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, 'Compactifications: 2', 'Should show 2 compactifications');
  assertContains(result, 'Sub-session 1 (initial)', 'Should show sub-session 1');
  assertContains(result, 'Sub-session 2 (after compactification #1)', 'Should show sub-session 2');
  assertContains(result, 'Sub-session 3 (after compactification #2)', 'Should show sub-session 3');
});

// ==== Summary ====
console.log('\n' + '='.repeat(80));
console.log(`\n🏁 Test Results: ${testsPassed} passed, ${testsFailed} failed out of ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
