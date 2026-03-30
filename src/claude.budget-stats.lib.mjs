#!/usr/bin/env node
// Token budget statistics display module
// Extracted from claude.lib.mjs to maintain file line limits

import { formatNumber } from './claude.lib.mjs';

/**
 * Helper: creates a fresh sub-session usage object for tracking tokens between compactification events
 * @returns {Object} Empty sub-session usage structure
 */
export const createEmptySubSessionUsage = () => ({
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  messageCount: 0,
  peakContextUsage: 0,
  peakOutputUsage: 0,
});

/**
 * Helper: accumulates token usage from a JSONL entry into a model usage map
 * @param {Object} modelUsageMap - Map of model ID to usage data
 * @param {Object} entry - Parsed JSONL entry with message.usage and message.model
 */
export const accumulateModelUsage = (modelUsageMap, entry) => {
  const model = entry.message.model;
  if (model.startsWith('<') && model.endsWith('>')) return; // Issue #1486: skip <synthetic> etc.
  const usage = entry.message.usage;
  if (!modelUsageMap[model]) {
    modelUsageMap[model] = {
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      webSearchRequests: 0,
    };
  }
  if (usage.input_tokens) modelUsageMap[model].inputTokens += usage.input_tokens;
  if (usage.cache_creation_input_tokens) modelUsageMap[model].cacheCreationTokens += usage.cache_creation_input_tokens;
  if (usage.cache_creation) {
    if (usage.cache_creation.ephemeral_5m_input_tokens) modelUsageMap[model].cacheCreation5mTokens += usage.cache_creation.ephemeral_5m_input_tokens;
    if (usage.cache_creation.ephemeral_1h_input_tokens) modelUsageMap[model].cacheCreation1hTokens += usage.cache_creation.ephemeral_1h_input_tokens;
  }
  if (usage.cache_read_input_tokens) modelUsageMap[model].cacheReadTokens += usage.cache_read_input_tokens;
  if (usage.output_tokens) modelUsageMap[model].outputTokens += usage.output_tokens;
};

/**
 * Display detailed model usage information
 * @param {Object} usage - Usage data for a model
 * @param {Function} log - Logging function
 */
export const displayModelUsage = async (usage, log) => {
  // Show all model characteristics if available
  if (usage.modelInfo) {
    const info = usage.modelInfo;
    const fields = [
      { label: 'Model ID', value: info.id },
      { label: 'Provider', value: info.provider || 'Unknown' },
      { label: 'Context window', value: info.limit?.context ? `${formatNumber(info.limit.context)} tokens` : null },
      { label: 'Max output', value: info.limit?.output ? `${formatNumber(info.limit.output)} tokens` : null },
      { label: 'Input modalities', value: info.modalities?.input?.join(', ') || 'N/A' },
      { label: 'Output modalities', value: info.modalities?.output?.join(', ') || 'N/A' },
      { label: 'Knowledge cutoff', value: info.knowledge },
      { label: 'Released', value: info.release_date },
      {
        label: 'Capabilities',
        value: [info.attachment && 'Attachments', info.reasoning && 'Reasoning', info.temperature && 'Temperature', info.tool_call && 'Tool calls'].filter(Boolean).join(', ') || 'N/A',
      },
      { label: 'Open weights', value: info.open_weights ? 'Yes' : 'No' },
    ];
    for (const { label, value } of fields) {
      if (value) await log(`      ${label}: ${value}`);
    }
    await log('');
  } else {
    await log('      ⚠️  Model info not available\n');
  }
  // Show usage data
  await log('      Usage:');
  await log(`        Input tokens: ${formatNumber(usage.inputTokens)}`);
  if (usage.cacheCreationTokens > 0) {
    await log(`        Cache creation tokens: ${formatNumber(usage.cacheCreationTokens)}`);
  }
  if (usage.cacheReadTokens > 0) {
    await log(`        Cache read tokens: ${formatNumber(usage.cacheReadTokens)}`);
  }
  await log(`        Output tokens: ${formatNumber(usage.outputTokens)}`);
  if (usage.webSearchRequests > 0) {
    await log(`        Web search requests: ${usage.webSearchRequests}`);
  }
  // Show detailed cost calculation
  if (usage.costUSD !== null && usage.costUSD !== undefined && usage.costBreakdown) {
    await log('');
    await log('      Cost Calculation (USD):');
    const breakdown = usage.costBreakdown;
    const types = [
      { key: 'input', label: 'Input' },
      { key: 'cacheWrite', label: 'Cache write' },
      { key: 'cacheRead', label: 'Cache read' },
      { key: 'output', label: 'Output' },
    ];
    for (const { key, label } of types) {
      if (breakdown[key].tokens > 0) {
        await log(`        ${label}: ${formatNumber(breakdown[key].tokens)} tokens × $${breakdown[key].costPerMillion}/M = $${breakdown[key].cost.toFixed(6)}`);
      }
    }
    await log('        ─────────────────────────────────');
    await log(`        Total: $${usage.costUSD.toFixed(6)}`);
  } else if (usage.modelInfo === null) {
    await log('');
    await log('      Cost: Not available (could not fetch pricing)');
  }
};

/**
 * Display cost comparison between public pricing and Anthropic's official cost
 * @param {number|null} publicCost - Public pricing estimate
 * @param {number|null} anthropicCost - Anthropic's official cost
 * @param {Function} log - Logging function
 */
export const displayCostComparison = async (publicCost, anthropicCost, log) => {
  await log('\n   💰 Cost estimation:');
  await log(`      Public pricing estimate: ${publicCost !== null && publicCost !== undefined ? `$${publicCost.toFixed(6)} USD` : 'unknown'}`);
  await log(`      Calculated by Anthropic: ${anthropicCost !== null && anthropicCost !== undefined ? `$${anthropicCost.toFixed(6)} USD` : 'unknown'}`);
  if (publicCost !== null && publicCost !== undefined && anthropicCost !== null && anthropicCost !== undefined) {
    const difference = anthropicCost - publicCost;
    const percentDiff = publicCost > 0 ? (difference / publicCost) * 100 : 0;
    await log(`      Difference:              $${difference.toFixed(6)} (${percentDiff > 0 ? '+' : ''}${percentDiff.toFixed(2)}%)`);
  } else {
    await log('      Difference:              unknown');
  }
};

/**
 * Display token budget statistics (context window usage and ratios)
 * @param {Object} usage - Usage data for a model
 * @param {Object} tokenUsage - Full token usage data (with subSessions)
 * @param {Function} log - Logging function
 */
export const displayBudgetStats = async (usage, tokenUsage, log) => {
  const modelInfo = usage.modelInfo;
  if (!modelInfo?.limit) {
    await log('\n      ⚠️  Budget stats not available (no model limits found)');
    return;
  }

  await log('\n      📊 Context and tokens usage:');

  const contextLimit = modelInfo.limit.context;
  const outputLimit = modelInfo.limit.output;
  const subSessions = tokenUsage?.subSessions || [];
  const hasMultipleSubSessions = subSessions.length > 1;

  if (hasMultipleSubSessions) {
    await log('        Sub sessions (between compact events):');
    for (let i = 0; i < subSessions.length; i++) {
      const sub = subSessions[i];
      const subPeak = sub.peakContextUsage || 0;
      let line = `          ${i + 1}. `;
      if (contextLimit && subPeak > 0) {
        const pct = ((subPeak / contextLimit) * 100).toFixed(0);
        line += `${formatNumber(subPeak)} / ${formatNumber(contextLimit)} input tokens (${pct}%)`;
      } else {
        const subTotal = sub.inputTokens + sub.cacheCreationTokens + sub.cacheReadTokens;
        line += `${formatNumber(subTotal)} input tokens`;
      }
      if (outputLimit) {
        const outPct = ((sub.outputTokens / outputLimit) * 100).toFixed(0);
        line += `; ${formatNumber(sub.outputTokens)} / ${formatNumber(outputLimit)} output tokens (${outPct}%)`;
      } else {
        line += `; ${formatNumber(sub.outputTokens)} output tokens`;
      }
      await log(line);
    }
  } else {
    // Single sub-session: simplified format
    const peakContext = usage.peakContextUsage || 0;
    if (contextLimit) {
      if (peakContext > 0) {
        const pct = ((peakContext / contextLimit) * 100).toFixed(0);
        await log(`        Max context window: ${formatNumber(peakContext)} / ${formatNumber(contextLimit)} input tokens (${pct}%)`);
      }
    }
    if (outputLimit) {
      const outPct = ((usage.outputTokens / outputLimit) * 100).toFixed(0);
      await log(`        Max output tokens: ${formatNumber(usage.outputTokens)} / ${formatNumber(outputLimit)} output tokens (${outPct}%)`);
    }
  }

  // Cumulative totals
  const totalInputNonCached = usage.inputTokens + usage.cacheCreationTokens;
  const cachedTokens = usage.cacheReadTokens;
  let totalLine = `        Total input tokens: ${formatNumber(totalInputNonCached)}`;
  if (cachedTokens > 0) totalLine += ` + ${formatNumber(cachedTokens)} cached`;
  await log(totalLine);
  await log(`        Total output tokens: ${formatNumber(usage.outputTokens)}`);
};

/**
 * Format a token count with K/M suffix for compact display
 * @param {number} tokens - Token count
 * @returns {string} Formatted string like "850K" or "1.5M"
 */
const formatTokensCompact = tokens => {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(tokens % 1000000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens % 1000 === 0 ? 0 : 0)}K`;
  return tokens.toLocaleString();
};

/**
 * Build budget stats string for GitHub PR comments (Issue #1491, #1501)
 * Format requested by user: sub-sessions between compactification events,
 * per-model breakdown, cumulative totals with cached tokens shown separately.
 * @param {Object} tokenUsage - Token usage data from calculateSessionTokens
 * @param {Object|null} streamTokenUsage - Token usage from stream JSON events (used for comparison, not displayed)
 * @returns {string} Formatted markdown string for PR comment
 */
export const buildBudgetStatsString = tokenUsage => {
  if (!tokenUsage) return '';

  let stats = '\n\n### 📊 **Context and tokens usage:**';

  // Per-model breakdown
  if (tokenUsage.modelUsage) {
    const modelIds = Object.keys(tokenUsage.modelUsage);
    const isMultiModel = modelIds.length > 1;

    for (const modelId of modelIds) {
      const usage = tokenUsage.modelUsage[modelId];
      const modelName = usage.modelName || modelId;
      const contextLimit = usage.modelInfo?.limit?.context;
      const outputLimit = usage.modelInfo?.limit?.output;

      if (isMultiModel) stats += `\n\n**${modelName}:**`;

      // Sub-session display (Issue #1501: show per sub-session stats)
      const subSessions = tokenUsage.subSessions || [];
      const hasMultipleSubSessions = subSessions.length > 1;

      if (hasMultipleSubSessions) {
        // Multiple sub-sessions: show numbered list
        stats += '\n\nSub sessions (between compact events):';
        for (let i = 0; i < subSessions.length; i++) {
          const sub = subSessions[i];
          const subPeakContext = sub.peakContextUsage || 0;
          const subTotalInput = sub.inputTokens + sub.cacheCreationTokens + sub.cacheReadTokens;
          let line = `\n${i + 1}. `;
          if (contextLimit && subPeakContext > 0) {
            const pct = ((subPeakContext / contextLimit) * 100).toFixed(0);
            line += `${formatTokensCompact(subPeakContext)} / ${formatTokensCompact(contextLimit)} input tokens (${pct}%)`;
          } else {
            line += `${formatTokensCompact(subTotalInput)} input tokens`;
          }
          if (outputLimit) {
            const outPct = ((sub.outputTokens / outputLimit) * 100).toFixed(0);
            line += `; ${formatTokensCompact(sub.outputTokens)} / ${formatTokensCompact(outputLimit)} output tokens (${outPct}%)`;
          } else {
            line += `; ${formatTokensCompact(sub.outputTokens)} output tokens`;
          }
          stats += line;
        }
      } else {
        // Single sub-session (or no sub-sessions): simplified format
        const peakContext = usage.peakContextUsage || 0;
        if (contextLimit) {
          if (peakContext > 0) {
            const pct = ((peakContext / contextLimit) * 100).toFixed(0);
            stats += `\n- Max context window: ${formatTokensCompact(peakContext)} / ${formatTokensCompact(contextLimit)} input tokens (${pct}%)`;
          } else {
            const totalInput = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
            const pct = ((totalInput / contextLimit) * 100).toFixed(0);
            stats += `\n- Context window: ${formatTokensCompact(totalInput)} / ${formatTokensCompact(contextLimit)} tokens (${pct}%)`;
          }
        }
        if (outputLimit) {
          const outPct = ((usage.outputTokens / outputLimit) * 100).toFixed(0);
          stats += `\n- Max output tokens: ${formatTokensCompact(usage.outputTokens)} / ${formatTokensCompact(outputLimit)} output tokens (${outPct}%)`;
        }
      }

      // Cumulative totals: input tokens + cached shown separately
      const totalInputNonCached = usage.inputTokens + usage.cacheCreationTokens;
      const cachedTokens = usage.cacheReadTokens;
      stats += `\n\nTotal input tokens: ${totalInputNonCached.toLocaleString()}`;
      if (cachedTokens > 0) stats += ` + ${cachedTokens.toLocaleString()} cached`;
      stats += `\nTotal output tokens: ${usage.outputTokens.toLocaleString()} output`;
    }
  }

  // Stream vs JSONL comparison — kept for internal diagnostics only in verbose/debug mode
  // Not shown to users per feedback (Issue #1501 PR comment)

  return stats;
};
