#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2115 originally required the automated working-session summary to carry
 * the same cost and token/context-budget facts as the log comment. Issue #2132
 * corrected that: those facts belong to the working session **log** comment only,
 * and duplicating them in the summary produced the same block twice per session.
 *
 * This file keeps the #2115 scenario alive as a regression guard for the
 * corrected behaviour: the renderers still exist and still receive the session's
 * observed usage (for the log comment), but the summary details are empty.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWorkingSessionSummaryDetails } from '../src/solve.results.lib.mjs';
import { buildBudgetStatsString } from '../src/claude.budget-stats.lib.mjs';
import { buildCostInfoString } from '../src/github-cost-info.lib.mjs';

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

// The renderers used by the log comment still report the observed usage of #2115.
const logBudgetStats = buildBudgetStatsString(budgetStatsData.tokenUsage, null);
assert.match(logBudgetStats, /### 📊 \*\*Context and tokens usage:\*\*/);
assert.match(logBudgetStats, /511\.6K \/ 1M \(51%\) input tokens/);
assert.match(logBudgetStats, /63\.8K \/ 128K \(50%\) output tokens/);
assert.match(logBudgetStats, /23\.4M cached/);
assert.match(buildCostInfoString(34.125, null, { modelName: 'GPT-5.6 Sol', provider: 'OpenAI' }, { includeTokenUsage: false }), /### 💰 \*\*Cost estimation:\*\*/);

// Issue #2132: the working session summary carries none of it.
assert.equal(buildWorkingSessionSummaryDetails(), '', 'working session summary must not embed cost/budget details');

const results = await readFile(new URL('../src/solve.results.lib.mjs', import.meta.url), 'utf8');
assert.ok(!/usageDetails/.test(results), 'attachSolutionSummary must not append a usage details block');

const [topLevel, watch, autoMerge] = await Promise.all([readFile(new URL('../src/solve.mjs', import.meta.url), 'utf8'), readFile(new URL('../src/solve.watch.lib.mjs', import.meta.url), 'utf8'), readFile(new URL('../src/solve.auto-merge.lib.mjs', import.meta.url), 'utf8')]);
assert.match(topLevel, /sessionUsage: \{ sessionId, tempDir, resultModelUsage, streamTokenUsage, subAgentCalls \}/);
assert.match(watch, /budgetStatsData: autoRestartBudgetStatsData/);
assert.match(autoMerge, /budgetStatsData: autoMergeBudgetStatsData/);

console.log('Issue #2115 / #2132 working-session summary usage tests passed');
