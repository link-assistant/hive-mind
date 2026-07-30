#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2115: automated working-session summaries
 * must carry the same cost and token/context-budget facts as their log comment.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWorkingSessionSummaryDetails } from '../src/solve.results.lib.mjs';

const budgetStatsData = {
  tokenUsage: {
    inputTokens: 511_606,
    cacheReadTokens: 23_370_240,
    cacheCreationTokens: 0,
    outputTokens: 63_787,
    totalCostUSD: 34.125,
    modelUsage: {
      'gpt-5.6-sol': {
        inputTokens: 511_606,
        cacheReadTokens: 23_370_240,
        cacheCreationTokens: 0,
        outputTokens: 63_787,
        peakContextUsage: 511_606,
        modelName: 'GPT-5.6 Sol',
        modelInfo: { limit: { context: 1_000_000, output: 128_000 } },
        costUSD: 34.125,
      },
    },
    subSessions: [],
  },
};

const details = buildWorkingSessionSummaryDetails({
  publicPricingEstimate: 34.125,
  pricingInfo: { modelName: 'GPT-5.6 Sol', provider: 'OpenAI' },
  budgetStatsData,
});

assert.match(details, /### 💰 \*\*Cost estimation:\*\*/);
assert.match(details, /Public pricing estimate: \$34\.125000/);
assert.match(details, /### 📊 \*\*Context and tokens usage:\*\*/);
assert.match(details, /511\.6K \/ 1M \(51%\) input tokens/);
assert.match(details, /63\.8K \/ 128K \(50%\) output tokens/);
assert.match(details, /23\.4M cached/);

assert.equal(
  buildWorkingSessionSummaryDetails({
    publicPricingEstimate: null,
    anthropicTotalCostUSD: null,
    pricingInfo: null,
    budgetStatsData: null,
  }),
  '',
  'summaries without observed usage must not gain an empty metadata section'
);

const [topLevel, watch, autoMerge] = await Promise.all([readFile(new URL('../src/solve.mjs', import.meta.url), 'utf8'), readFile(new URL('../src/solve.watch.lib.mjs', import.meta.url), 'utf8'), readFile(new URL('../src/solve.auto-merge.lib.mjs', import.meta.url), 'utf8')]);
assert.match(topLevel, /sessionUsage: \{ sessionId, tempDir, resultModelUsage, streamTokenUsage, subAgentCalls \}/);
assert.match(watch, /budgetStatsData: autoRestartBudgetStatsData/);
assert.match(autoMerge, /budgetStatsData: autoMergeBudgetStatsData/);

console.log('Issue #2115 working-session summary usage tests passed');
