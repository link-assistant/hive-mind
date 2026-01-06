#!/usr/bin/env node
// Token budget statistics display module
// Extracted from claude.lib.mjs to maintain file line limits

import { formatNumber } from './claude.lib.mjs';

/**
 * Display token budget statistics (context window usage and ratios)
 * @param {Object} usage - Usage data for a model
 * @param {Function} log - Logging function
 */
export const displayBudgetStats = async (usage, log) => {
  const modelInfo = usage.modelInfo;
  if (!modelInfo?.limit) {
    await log('\n      ⚠️  Budget stats not available (no model limits found)');
    return;
  }

  await log('\n      📊 Token Budget Statistics:');

  // Context window usage
  if (modelInfo.limit.context) {
    const contextLimit = modelInfo.limit.context;
    // Input tokens include regular input + cache creation + cache read
    const totalInputUsed = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
    const contextUsageRatio = totalInputUsed / contextLimit;
    const contextUsagePercent = (contextUsageRatio * 100).toFixed(2);

    await log('        Context window:');
    await log(`          Used: ${formatNumber(totalInputUsed)} tokens`);
    await log(`          Limit: ${formatNumber(contextLimit)} tokens`);
    await log(`          Ratio: ${contextUsageRatio.toFixed(4)} (${contextUsagePercent}%)`);
  }

  // Output tokens usage
  if (modelInfo.limit.output) {
    const outputLimit = modelInfo.limit.output;
    const outputUsageRatio = usage.outputTokens / outputLimit;
    const outputUsagePercent = (outputUsageRatio * 100).toFixed(2);

    await log('        Output tokens:');
    await log(`          Used: ${formatNumber(usage.outputTokens)} tokens`);
    await log(`          Limit: ${formatNumber(outputLimit)} tokens`);
    await log(`          Ratio: ${outputUsageRatio.toFixed(4)} (${outputUsagePercent}%)`);
  }

  // Total session tokens (input + cache_creation + output)
  const totalSessionTokens = usage.inputTokens + usage.cacheCreationTokens + usage.outputTokens;
  await log(`        Total session tokens: ${formatNumber(totalSessionTokens)}`);
};
