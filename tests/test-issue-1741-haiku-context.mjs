#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #1741: cumulative sub-agent context-fill must use new + cache_writes
 * (NOT cache_reads). Cache reads represent the same cached prefix being
 * replayed across many calls — summing them inflates the displayed
 * percentage above 100% (583% in the original report) for a model that
 * never appears as a single-request entry in the parent JSONL.
 *
 * The Total line keeps the (new + writes + reads) split unchanged.
 */

import assert from 'node:assert/strict';
import { buildBudgetStatsString, getCumulativeContextInputTokens } from '../src/claude.budget-stats.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`   ${error.message}`);
    testsFailed++;
  }
};

const HAIKU_MODEL_INFO = { limit: { context: 200_000, output: 64_000 } };

await test('getCumulativeContextInputTokens excludes cache reads', () => {
  assert.equal(getCumulativeContextInputTokens({ inputTokens: 94, cacheCreationTokens: 61_200, cacheReadTokens: 1_100_000 }), 61_294, 'must equal input + cache_creation (no cache_read)');
  assert.equal(getCumulativeContextInputTokens(null), 0);
  assert.equal(getCumulativeContextInputTokens({}), 0);
  assert.equal(getCumulativeContextInputTokens({ inputTokens: 100 }), 100);
});

await test('Haiku sub-agent (issue 1741) renders new+writes only on detail line', () => {
  // Numbers from the original PR #1044 comment that filed issue #1741.
  const tokenUsage = {
    modelUsage: {
      'claude-haiku-4-5-20251001': {
        inputTokens: 94,
        cacheCreationTokens: 61_200,
        cacheReadTokens: 1_100_000,
        outputTokens: 6_600,
        modelName: 'Claude Haiku 4.5',
        modelInfo: HAIKU_MODEL_INFO,
        peakContextUsage: 0,
        costUSD: 0.219954,
        _sourceResultJson: true,
      },
    },
    // Force the multi-model code path, so Haiku prints under its own header.
    // Use a tiny dummy primary model so this test stays self-contained.
    subSessions: [],
  };

  const result = buildBudgetStatsString(tokenUsage);

  // Detail line must use new + cache_writes (= 61 294), NOT cumulative+reads.
  // 61 294 / 200 000 = 31% (rounded).
  assert.ok(result.includes('- 61.3K / 200K (31%) input tokens, 6.6K / 64K (10%) output tokens'), `expected detail line with 61.3K / 200K (31%); got:\n${result}`);
  // The 583% line must be gone.
  assert.ok(!result.includes('(583%)'), `expected no 583% inflation; got:\n${result}`);
  // Total line is unchanged: must keep new + writes + reads split.
  assert.ok(result.includes('Total: (94 new + 61.2K cache writes + 1.1M cache reads) input tokens, 6.6K output tokens, $0.219954 cost'), `Total line should keep cache_read split; got:\n${result}`);
});

await test('Multi-call sub-agent estimator uses new+writes for per-call fill', () => {
  // Simulate 3 sub-agent calls; cumulative reads dominate. The per-call
  // averaged input must exclude cache_reads to stay under 100%.
  const subAgentCalls = [
    { id: 'a1', description: 'work1', model: 'haiku' },
    { id: 'a2', description: 'work2', model: 'haiku' },
    { id: 'a3', description: 'work3', model: 'haiku' },
  ];
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-7': {
        inputTokens: 100,
        cacheCreationTokens: 1_000,
        cacheReadTokens: 0,
        outputTokens: 50,
        modelName: 'Claude Opus 4.7',
        modelInfo: { limit: { context: 1_000_000, output: 128_000 } },
        peakContextUsage: 1_100,
        costUSD: 0.001,
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 300,
        cacheCreationTokens: 90_000,
        cacheReadTokens: 1_500_000,
        outputTokens: 9_000,
        modelName: 'Claude Haiku 4.5',
        modelInfo: HAIKU_MODEL_INFO,
        peakContextUsage: 0,
        costUSD: 0.5,
        _sourceResultJson: true,
      },
    },
    subSessions: [],
  };

  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);

  // 3 calls; aggregate (new+writes) = 90 300; per-call avg = 30 100; 30 100/200 000 = 15%.
  assert.ok(result.includes('1. ~30.1K / 200K (15%) input tokens'), `expected per-call ~30.1K (15%); got:\n${result}`);
  assert.ok(!/~5\d{2}K \/ 200K \(2\d{2}%\)/.test(result), `must not show >100% per-call inflation; got:\n${result}`);
});

console.log(`\nTests: ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
