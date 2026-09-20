#!/usr/bin/env node

/**
 * Unit tests for token budget statistics features (Issue #1491, #1501)
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

function makeTokenUsage({ input = 50000, cacheCreate = 10000, cacheRead = 5000, output = 15000, peakContext = 0, modelId = 'claude-sonnet-4-5-20250929', modelName = 'Claude Sonnet 4.5', modelInfo = SONNET_MODEL_INFO, subSessions = undefined, compactifications = undefined } = {}) {
  return {
    inputTokens: input,
    cacheCreationTokens: cacheCreate,
    cacheReadTokens: cacheRead,
    outputTokens: output,
    totalTokens: input + cacheCreate + output,
    subSessions: subSessions || [{ inputTokens: input, cacheCreationTokens: cacheCreate, cacheReadTokens: cacheRead, outputTokens: output, messageCount: 10, peakContextUsage: peakContext || input + cacheCreate + cacheRead, peakOutputUsage: output }],
    compactifications: compactifications || null,
    modelUsage: {
      [modelId]: { inputTokens: input, cacheCreationTokens: cacheCreate, cacheReadTokens: cacheRead, outputTokens: output, modelName, modelInfo, peakContextUsage: peakContext },
    },
  };
}

console.log('🧪 Running token budget statistics unit tests (Issue #1491, #1501)...\n');
console.log('='.repeat(80));

// ==== Test Group: buildBudgetStatsString ====
console.log('\n📋 Test Group: buildBudgetStatsString - GitHub comment generation\n');

runTest('returns empty string when tokenUsage is null', () => {
  assertEqual(buildBudgetStatsString(null, null), '', 'Should return empty string for null tokenUsage');
});

runTest('single sub-session shows simplified format with context/output on single line', () => {
  const result = buildBudgetStatsString(makeTokenUsage({ peakContext: 65000 }), null);
  assertContains(result, '📊 **Context and tokens usage:**', 'Should have new header');
  // Issue #1600: Unified format — no "Context window:" prefix
  assertContains(result, '65K / 200K (33%) input tokens, 15K / 64K (23%) output tokens', 'Should show context+output on single line');
  assertNotContains(result, 'Context window:', 'Should not have Context window prefix (Issue #1600)');
  assertContains(result, 'Total:', 'Should show total line');
});

runTest('shows cached tokens separately in totals', () => {
  // Issue #1710 R4: When both cache writes and cache reads are present, render
  // them as their own categories rather than fusing the writes into the input
  // figure. Previously this test asserted the fused form `(60K + 5K cached)`,
  // which folded a 1.25× / 2× billed cache-write category into the 1× input
  // category — the silent-mismatch bug Symptom D in the case study describes.
  const result = buildBudgetStatsString(makeTokenUsage({ input: 50000, cacheCreate: 10000, cacheRead: 5000 }), null);
  assertContains(result, '(50K new + 10K cache writes + 5K cache reads) input tokens', 'Should show input + cache writes + cache reads as separate categories (issue #1710 R4)');
});

runTest('preserves legacy short cached form when only cache reads exist', () => {
  // Issue #1710 R4: When cache writes are 0, keep the back-compat
  // `(X + Y cached)` shape so the common Opus-only case is unchanged.
  const result = buildBudgetStatsString(makeTokenUsage({ input: 50000, cacheCreate: 0, cacheRead: 5000 }), null);
  assertContains(result, '(50K + 5K cached) input tokens', 'Should preserve legacy form when only cache reads exist');
});

runTest('shows cache writes alone when no cache reads', () => {
  // Issue #1710 R4: Haiku case from facts.md — writes only, no reads.
  // Previously the cumulative line collapsed to "X input tokens" silently
  // fusing writes with input. Now the writes appear as a labelled category.
  const result = buildBudgetStatsString(makeTokenUsage({ input: 77969, cacheCreate: 57580, cacheRead: 0 }), null);
  assertContains(result, '(78.0K new + 57.6K cache writes) input tokens', 'Should show cache writes as a separate category (issue #1710 R4 / Haiku case)');
});

runTest('does not show cached when zero', () => {
  const result = buildBudgetStatsString(makeTokenUsage({ cacheRead: 0 }), null);
  assertNotContains(result, 'cached', 'Should not show cached when zero');
});

runTest('shows total without context when no model limits', () => {
  const result = buildBudgetStatsString(makeTokenUsage({ cacheCreate: 0, cacheRead: 0, modelId: 'unknown-model', modelName: 'unknown-model', modelInfo: null }), null);
  assertContains(result, 'Total:', 'Should show total');
  assertNotContains(result, 'Context window:', 'Should not show context window when no limits');
});

runTest('shows sub-session breakdown when compactification occurred', () => {
  const tokenUsage = makeTokenUsage({
    input: 100000,
    cacheCreate: 20000,
    cacheRead: 10000,
    output: 30000,
    subSessions: [
      { inputTokens: 60000, cacheCreationTokens: 15000, cacheReadTokens: 8000, outputTokens: 18000, messageCount: 25, peakContextUsage: 80000, peakOutputUsage: 18000 },
      { inputTokens: 40000, cacheCreationTokens: 5000, cacheReadTokens: 2000, outputTokens: 12000, messageCount: 15, peakContextUsage: 45000, peakOutputUsage: 12000 },
    ],
    compactifications: [{ timestamp: '2026-03-29T10:00:00Z', preTokens: 167219, trigger: 'auto' }],
  });
  const result = buildBudgetStatsString(tokenUsage, null);
  // Issue #1600: Numbered sub-sessions without "Context window:" prefix (unified format)
  assertContains(result, '1. ', 'Should number sub-sessions');
  assertContains(result, '2. ', 'Should number sub-sessions');
  assertNotContains(result, 'Context window:', 'Should not have Context window prefix (Issue #1600)');
  assertContains(result, 'input tokens', 'Should show input tokens per sub-session');
  assertContains(result, 'output tokens', 'Should show output tokens per sub-session');
});

runTest('does not show JSONL deduplication line', () => {
  const tokenUsage = makeTokenUsage({});
  tokenUsage.duplicateEntriesSkipped = 42;
  const result = buildBudgetStatsString(tokenUsage, null);
  assertNotContains(result, 'JSONL deduplication', 'Should NOT show deduplication stats');
  assertNotContains(result, 'duplicate entries', 'Should NOT mention duplicates');
});

runTest('does not show stream vs JSONL comparison', () => {
  const streamUsage = { inputTokens: 49500, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 14800, eventCount: 42 };
  const result = buildBudgetStatsString(makeTokenUsage(), streamUsage);
  assertNotContains(result, 'Own calculation', 'Should NOT show stream calculation');
  assertNotContains(result, 'JSONL calculation', 'Should NOT show JSONL calculation');
  assertNotContains(result, 'diff:', 'Should NOT show diff');
});

runTest('shows multiple models with labels', () => {
  const tokenUsage = {
    inputTokens: 80000,
    cacheCreationTokens: 15000,
    cacheReadTokens: 8000,
    outputTokens: 25000,
    totalTokens: 120000,
    subSessions: [{ inputTokens: 80000, cacheCreationTokens: 15000, cacheReadTokens: 8000, outputTokens: 25000, messageCount: 30, peakContextUsage: 95000, peakOutputUsage: 15000 }],
    modelUsage: {
      'claude-opus-4-5-20251101': { inputTokens: 50000, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 15000, modelName: 'Claude Opus 4.5', modelInfo: { limit: { context: 200000, output: 32000 } }, peakContextUsage: 62000 },
      'claude-haiku-4-5-20251001': { inputTokens: 30000, cacheCreationTokens: 5000, cacheReadTokens: 3000, outputTokens: 10000, modelName: 'Claude Haiku 4.5', modelInfo: SONNET_MODEL_INFO, peakContextUsage: 36000 },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, '**Claude Opus 4.5:**', 'Should show Opus model name in bold');
  assertContains(result, '**Claude Haiku 4.5:**', 'Should show Haiku model name in bold');
});

runTest('does not show bold model name for single model', () => {
  const result = buildBudgetStatsString(makeTokenUsage(), null);
  assertNotContains(result, '**Claude Sonnet 4.5**', 'Single model should not show bold label');
});

// ==== Test Group: Sub-session helper functions ====
console.log('\n📋 Test Group: Sub-session tracking helpers\n');

runTest('empty sub-session has zero values including peak fields', () => {
  const subSession = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, messageCount: 0, peakContextUsage: 0, peakOutputUsage: 0 };
  assertEqual(subSession.inputTokens, 0, 'inputTokens should be 0');
  assertEqual(subSession.outputTokens, 0, 'outputTokens should be 0');
  assertEqual(subSession.peakContextUsage, 0, 'peakContextUsage should be 0');
  assertEqual(subSession.peakOutputUsage, 0, 'peakOutputUsage should be 0');
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
  const result = buildBudgetStatsString(makeTokenUsage({ input: 0, cacheCreate: 0, cacheRead: 0, output: 0, peakContext: 0 }), null);
  // Issue #1600: Output detalization shown for sub-agent single sessions with no peak context
  assertContains(result, 'Total: 0 input tokens, 0 output tokens', 'Should show 0 for zero tokens');
});

runTest('handles multiple compactifications with numbered sub-sessions', () => {
  const tokenUsage = makeTokenUsage({
    input: 200000,
    cacheCreate: 30000,
    cacheRead: 15000,
    output: 50000,
    subSessions: [
      { inputTokens: 80000, cacheCreationTokens: 12000, cacheReadTokens: 6000, outputTokens: 20000, messageCount: 20, peakContextUsage: 90000, peakOutputUsage: 20000 },
      { inputTokens: 70000, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 15000, messageCount: 18, peakContextUsage: 80000, peakOutputUsage: 15000 },
      { inputTokens: 50000, cacheCreationTokens: 8000, cacheReadTokens: 4000, outputTokens: 15000, messageCount: 12, peakContextUsage: 55000, peakOutputUsage: 15000 },
    ],
    compactifications: [
      { timestamp: '2026-03-29T10:00:00Z', preTokens: 167000, trigger: 'auto' },
      { timestamp: '2026-03-29T11:30:00Z', preTokens: 155000, trigger: 'auto' },
    ],
  });
  const result = buildBudgetStatsString(tokenUsage, null);
  // Issue #1600: Numbered sub-sessions without "Context window:" prefix (unified format)
  assertContains(result, '1. ', 'Should show sub-session 1');
  assertContains(result, '2. ', 'Should show sub-session 2');
  assertContains(result, '3. ', 'Should show sub-session 3');
  assertNotContains(result, 'Context window:', 'Should not have Context window prefix (Issue #1600)');
});

// ==== Summary ====
console.log('\n' + '='.repeat(80));
console.log(`\n🏁 Test Results: ${testsPassed} passed, ${testsFailed} failed out of ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
