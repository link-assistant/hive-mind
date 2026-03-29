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

/**
 * Display sub-session breakdown when compactification events occurred (Issue #1491)
 * @param {Object} tokenUsage - Token usage data with subSessions and compactifications
 * @param {Object} modelInfo - Model info with context/output limits
 * @param {Function} log - Logging function
 */
export const displaySubSessionStats = async (tokenUsage, modelInfo, log) => {
  if (!tokenUsage.subSessions || !tokenUsage.compactifications) return;

  const contextLimit = modelInfo?.limit?.context;
  await log(`\n      🔄 Compactification events: ${tokenUsage.compactifications.length}`);

  for (let i = 0; i < tokenUsage.subSessions.length; i++) {
    const sub = tokenUsage.subSessions[i];
    const totalInput = sub.inputTokens + sub.cacheCreationTokens + sub.cacheReadTokens;
    const label = i === 0 ? 'Initial session' : `After compactification #${i}`;

    await log(`        Sub-session ${i + 1} (${label}):`);
    await log(`          Messages: ${sub.messageCount}`);
    await log(`          Context used: ${formatNumber(totalInput)} tokens`);
    if (contextLimit) {
      const pct = ((totalInput / contextLimit) * 100).toFixed(2);
      await log(`          Context usage: ${pct}% of ${formatNumber(contextLimit)}`);
    }
    await log(`          Output: ${formatNumber(sub.outputTokens)} tokens`);
  }

  // Show compactification details
  for (let i = 0; i < tokenUsage.compactifications.length; i++) {
    const comp = tokenUsage.compactifications[i];
    let detail = `        Compactification #${i + 1}: trigger=${comp.trigger}`;
    if (comp.preTokens) detail += `, pre-compaction tokens=${formatNumber(comp.preTokens)}`;
    await log(detail);
  }
};

/**
 * Display stream vs JSONL token comparison (Issue #1491)
 * Shows independent calculation from stream events vs JSONL session file
 * @param {Object} streamTokenUsage - Token usage accumulated from stream JSON events
 * @param {Object} jsonlTokenUsage - Token usage calculated from JSONL session file
 * @param {Function} log - Logging function
 */
export const displayTokenComparison = async (streamTokenUsage, jsonlTokenUsage, log) => {
  if (!streamTokenUsage || !jsonlTokenUsage) return;

  const streamTotal = streamTokenUsage.inputTokens + streamTokenUsage.cacheCreationTokens + streamTokenUsage.outputTokens;
  const jsonlTotal = jsonlTokenUsage.inputTokens + jsonlTokenUsage.cacheCreationTokens + jsonlTokenUsage.outputTokens;

  await log('\n      🔍 Token calculation comparison:');
  await log(`        Stream JSON events: ${formatNumber(streamTotal)} tokens (${streamTokenUsage.eventCount} events)`);
  await log(`        JSONL session file: ${formatNumber(jsonlTotal)} tokens`);

  if (streamTotal !== jsonlTotal) {
    const diff = jsonlTotal - streamTotal;
    const pct = streamTotal > 0 ? ((diff / streamTotal) * 100).toFixed(2) : 'N/A';
    await log(`        Difference: ${formatNumber(Math.abs(diff))} tokens (${diff > 0 ? '+' : ''}${pct}%)`);
  } else {
    await log('        Match: calculations are consistent');
  }
};

/**
 * Build budget stats string for GitHub PR comments (Issue #1491)
 * Similar to buildCostInfoString but for token budget statistics
 * @param {Object} tokenUsage - Token usage data from calculateSessionTokens
 * @param {Object|null} streamTokenUsage - Token usage from stream JSON events
 * @returns {string} Formatted markdown string for PR comment
 */
export const buildBudgetStatsString = (tokenUsage, streamTokenUsage) => {
  if (!tokenUsage) return '';

  let stats = '\n\n### 📊 **Token budget statistics:**';

  // Per-model breakdown
  if (tokenUsage.modelUsage) {
    const modelIds = Object.keys(tokenUsage.modelUsage);
    for (const modelId of modelIds) {
      const usage = tokenUsage.modelUsage[modelId];
      const modelName = usage.modelName || modelId;
      const contextLimit = usage.modelInfo?.limit?.context;
      const outputLimit = usage.modelInfo?.limit?.output;
      const totalInput = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;

      if (modelIds.length > 1) stats += `\n- **${modelName}**:`;

      if (contextLimit) {
        const contextPct = ((totalInput / contextLimit) * 100).toFixed(2);
        stats += `\n- Context window: ${totalInput.toLocaleString()} / ${contextLimit.toLocaleString()} tokens (${contextPct}%)`;
      } else {
        stats += `\n- Context tokens used: ${totalInput.toLocaleString()}`;
      }

      if (outputLimit) {
        const outputPct = ((usage.outputTokens / outputLimit) * 100).toFixed(2);
        stats += `\n- Output tokens: ${usage.outputTokens.toLocaleString()} / ${outputLimit.toLocaleString()} tokens (${outputPct}%)`;
      } else {
        stats += `\n- Output tokens: ${usage.outputTokens.toLocaleString()}`;
      }
    }
  }

  // Sub-session breakdown if compactification occurred
  if (tokenUsage.subSessions && tokenUsage.compactifications) {
    stats += `\n- Compactifications: ${tokenUsage.compactifications.length}`;
    for (let i = 0; i < tokenUsage.subSessions.length; i++) {
      const sub = tokenUsage.subSessions[i];
      const totalInput = sub.inputTokens + sub.cacheCreationTokens + sub.cacheReadTokens;
      const label = i === 0 ? 'initial' : `after compactification #${i}`;
      stats += `\n  - Sub-session ${i + 1} (${label}): ${totalInput.toLocaleString()} context, ${sub.outputTokens.toLocaleString()} output, ${sub.messageCount} messages`;
    }
  }

  // Stream vs JSONL comparison
  if (streamTokenUsage) {
    const streamTotal = streamTokenUsage.inputTokens + streamTokenUsage.cacheCreationTokens + streamTokenUsage.outputTokens;
    const jsonlTotal = tokenUsage.inputTokens + tokenUsage.cacheCreationTokens + tokenUsage.outputTokens;
    stats += `\n- Own calculation (stream): ${streamTotal.toLocaleString()} tokens (${streamTokenUsage.eventCount} events)`;
    stats += `\n- JSONL calculation: ${jsonlTotal.toLocaleString()} tokens`;
    if (streamTotal !== jsonlTotal) {
      const diff = jsonlTotal - streamTotal;
      const pct = streamTotal > 0 ? ((diff / streamTotal) * 100).toFixed(2) : 'N/A';
      stats += ` (diff: ${diff > 0 ? '+' : ''}${pct}%)`;
    }
  }

  return stats;
};
