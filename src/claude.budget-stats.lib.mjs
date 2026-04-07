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
/**
 * Issue #1526: Updated to use single-line context+output format.
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

  const peakContext = usage.peakContextUsage || 0;

  if (hasMultipleSubSessions) {
    for (let i = 0; i < subSessions.length; i++) {
      const sub = subSessions[i];
      const subPeak = sub.peakContextUsage || 0;
      // Issue #1539: Only use peak per-request context for context window display.
      // Cumulative totals across all requests can exceed the context limit and produce
      // impossible percentages (e.g. 250%). When peak is unknown, skip context display.
      const parts = [];
      if (contextLimit && subPeak > 0) {
        const pct = ((subPeak / contextLimit) * 100).toFixed(0);
        parts.push(`${formatNumber(subPeak)} / ${formatNumber(contextLimit)} input tokens (${pct}%)`);
      }
      if (outputLimit) {
        const outPct = ((sub.outputTokens / outputLimit) * 100).toFixed(0);
        parts.push(`${formatNumber(sub.outputTokens)} / ${formatNumber(outputLimit)} output tokens (${outPct}%)`);
      }
      if (parts.length > 0) {
        await log(`        ${i + 1}. Context window: ${parts.join(', ')}`);
      }
    }
  } else if (peakContext > 0) {
    // Single sub-session with known peak: single-line format
    const parts = [];
    if (contextLimit) {
      const pct = ((peakContext / contextLimit) * 100).toFixed(0);
      parts.push(`${formatNumber(peakContext)} / ${formatNumber(contextLimit)} input tokens (${pct}%)`);
    }
    if (outputLimit) {
      const outPct = ((usage.outputTokens / outputLimit) * 100).toFixed(0);
      parts.push(`${formatNumber(usage.outputTokens)} / ${formatNumber(outputLimit)} output tokens (${outPct}%)`);
    }
    if (parts.length > 0) {
      await log(`        Context window: ${parts.join(', ')}`);
    }
  }
  // Issue #1539: When peakContextUsage is unknown, skip context window line entirely.
  // Cumulative totals are shown on the Total line below — no duplication needed.

  // Cumulative totals — single line
  const totalInputNonCached = usage.inputTokens + usage.cacheCreationTokens;
  const cachedTokens = usage.cacheReadTokens;
  let totalLine = `${formatNumber(totalInputNonCached)}`;
  if (cachedTokens > 0) totalLine += ` + ${formatNumber(cachedTokens)} cached`;
  totalLine += ` input tokens, ${formatNumber(usage.outputTokens)} output tokens`;
  // Issue #1539: When peakContextUsage is unknown, embed output percentage in Total line
  if (peakContext === 0 && outputLimit) {
    const outPct = ((usage.outputTokens / outputLimit) * 100).toFixed(0);
    totalLine += ` (${outPct}% of ${formatNumber(outputLimit)} output limit)`;
  }
  await log(`        Total: ${totalLine}`);
};

/**
 * Merge resultModelUsage from Claude Code result JSON into JSONL-based modelUsage map.
 * Issue #1508: The JSONL file may miss sub-agent model entries (e.g., Haiku used internally),
 * while resultModelUsage from the success result event has the authoritative per-model breakdown.
 * @param {Object} modelUsage - Map of model ID to accumulated usage from JSONL parsing
 * @param {Object} resultModelUsage - Per-model usage from Claude Code result JSON event
 */
export const mergeResultModelUsage = (modelUsage, resultModelUsage) => {
  if (!resultModelUsage || typeof resultModelUsage !== 'object') return;
  for (const [modelId, resultUsage] of Object.entries(resultModelUsage)) {
    if (modelId.startsWith('<') && modelId.endsWith('>')) continue;
    if (!modelUsage[modelId]) {
      modelUsage[modelId] = {
        inputTokens: resultUsage.inputTokens || 0,
        cacheCreationTokens: resultUsage.cacheCreationInputTokens || 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        cacheReadTokens: resultUsage.cacheReadInputTokens || 0,
        outputTokens: resultUsage.outputTokens || 0,
        webSearchRequests: resultUsage.webSearchRequests || 0,
        _sourceResultJson: true,
      };
      if (resultUsage.costUSD != null) {
        modelUsage[modelId]._resultCostUSD = resultUsage.costUSD;
      }
      // Issue #1539: Extract model limits from result JSON for sub-agent models
      // Claude Code's result event includes contextWindow and maxOutputTokens per model,
      // which we use as fallback when modelInfo API is unavailable.
      if (resultUsage.contextWindow) {
        modelUsage[modelId]._resultContextWindow = resultUsage.contextWindow;
      }
      if (resultUsage.maxOutputTokens) {
        modelUsage[modelId]._resultMaxOutputTokens = resultUsage.maxOutputTokens;
      }
    } else {
      const jsonlUsage = modelUsage[modelId];
      const jsonlTotal = jsonlUsage.inputTokens + jsonlUsage.cacheCreationTokens + jsonlUsage.cacheReadTokens + jsonlUsage.outputTokens;
      const resultTotal = (resultUsage.inputTokens || 0) + (resultUsage.cacheCreationInputTokens || 0) + (resultUsage.cacheReadInputTokens || 0) + (resultUsage.outputTokens || 0);
      if (resultTotal > jsonlTotal) {
        jsonlUsage.inputTokens = resultUsage.inputTokens || 0;
        jsonlUsage.cacheCreationTokens = resultUsage.cacheCreationInputTokens || 0;
        jsonlUsage.cacheReadTokens = resultUsage.cacheReadInputTokens || 0;
        jsonlUsage.outputTokens = resultUsage.outputTokens || 0;
        jsonlUsage._sourceResultJson = true;
      }
      if (resultUsage.costUSD != null) {
        jsonlUsage._resultCostUSD = resultUsage.costUSD;
      }
      // Issue #1539: Also extract model limits from result JSON as fallback
      if (resultUsage.contextWindow) {
        jsonlUsage._resultContextWindow = resultUsage.contextWindow;
      }
      if (resultUsage.maxOutputTokens) {
        jsonlUsage._resultMaxOutputTokens = resultUsage.maxOutputTokens;
      }
    }
  }
};

/**
 * Format a token count with K/M suffix for compact display
 * @param {number} tokens - Token count
 * @returns {string} Formatted string like "850K" or "1.5M"
 */
const formatTokensCompact = tokens => {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(tokens % 1000000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens % 1000 === 0 ? 0 : 1)}K`;
  return tokens.toLocaleString();
};

/**
 * Format sub-sessions list for budget stats display
 * @param {Array} subSessions - Array of sub-session usage objects
 * @param {number|null} contextLimit - Context window limit for the model
 * @param {number|null} outputLimit - Output token limit for the model
 * @returns {string} Formatted sub-sessions string
 */
/**
 * Issue #1526: Format sub-sessions list using numbered single-line format.
 * Each sub-session gets: "N. Context window: X / Y input tokens (Z%), A / B output tokens (W%)"
 */
const formatSubSessionsList = (subSessions, contextLimit, outputLimit) => {
  let result = '';
  for (let i = 0; i < subSessions.length; i++) {
    const sub = subSessions[i];
    // Issue #1539: Only use peak per-request context; skip context display when unknown
    const subPeakContext = sub.peakContextUsage || 0;
    result += formatContextOutputLine(subPeakContext, contextLimit, sub.outputTokens, outputLimit, `${i + 1}. `);
  }
  return result;
};

/**
 * Issue #1526: Build a single-line context window + output tokens string.
 * Issue #1539: Only show context window when peakContext > 0 (per-request peak known).
 * When peakContext is 0 (unknown), context part is omitted to avoid misleading percentages.
 * Format: "- Context window: X / Y input tokens (Z%), A / B output tokens (W%)"
 * @param {number} peakContext - Peak context usage (0 if unknown — context display skipped)
 * @param {number} contextLimit - Context window limit (null if unknown)
 * @param {number} outputTokens - Output tokens used
 * @param {number} outputLimit - Output token limit (null if unknown)
 * @param {string} [prefix='- '] - Line prefix
 * @returns {string} Formatted line or empty string
 */
const formatContextOutputLine = (peakContext, contextLimit, outputTokens, outputLimit, prefix = '- ') => {
  const parts = [];
  if (contextLimit) {
    // Issue #1539: Only use peak per-request context for context window display.
    // When peak is unknown (e.g., model only from result JSON, not in JSONL),
    // skip context display. Cumulative totals across all requests are not valid
    // context window metrics and produce impossible percentages (e.g. 250%).
    if (peakContext > 0) {
      const pct = ((peakContext / contextLimit) * 100).toFixed(0);
      parts.push(`${formatTokensCompact(peakContext)} / ${formatTokensCompact(contextLimit)} input tokens (${pct}%)`);
    }
  }
  if (outputLimit) {
    const outPct = ((outputTokens / outputLimit) * 100).toFixed(0);
    parts.push(`${formatTokensCompact(outputTokens)} / ${formatTokensCompact(outputLimit)} output tokens (${outPct}%)`);
  }
  if (parts.length === 0) return '';
  return `\n${prefix}Context window: ${parts.join(', ')}`;
};

/**
 * Build budget stats string for GitHub PR comments (Issue #1491, #1501, #1508, #1526)
 * Format requested by user: sub-sessions between compactification events,
 * per-model breakdown, cumulative totals with cached tokens shown separately.
 * Issue #1508: When multiple models are used, token and context usage is now split by model.
 * Sub-sessions are shown as a global section (not duplicated per model) since JSONL
 * sub-session tracking is global across all models.
 * Issue #1526: Shorter output format — context window + output tokens on single line.
 * Issue #1539: Only display context window when peak per-request usage is known.
 * Cumulative totals are never used as context window metrics (they can exceed model limits).
 * @param {Object} tokenUsage - Token usage data from calculateSessionTokens or buildAgentBudgetStats
 * @returns {string} Formatted markdown string for PR comment
 */
export const buildBudgetStatsString = tokenUsage => {
  if (!tokenUsage) return '';

  let stats = '\n\n### 📊 **Context and tokens usage:**';

  // Per-model breakdown
  if (tokenUsage.modelUsage) {
    const modelIds = Object.keys(tokenUsage.modelUsage);
    const isMultiModel = modelIds.length > 1;

    // Issue #1508: For multi-model sessions, show sub-sessions once (globally), not per-model
    // Sub-sessions track compactification boundaries which are session-wide, not model-specific
    const subSessions = tokenUsage.subSessions || [];
    const hasMultipleSubSessions = subSessions.length > 1;

    if (isMultiModel && hasMultipleSubSessions) {
      // Issue #1508: For multi-model sessions, show global sub-sessions once (not per-model),
      // since sub-sessions track compactification boundaries which are session-wide.
      // Per-model context/output limits are shown below under each model heading.
      const primaryModelId = modelIds[0];
      const primaryUsage = tokenUsage.modelUsage[primaryModelId];
      stats += formatSubSessionsList(subSessions, primaryUsage.modelInfo?.limit?.context, primaryUsage.modelInfo?.limit?.output);
    }

    for (const modelId of modelIds) {
      const usage = tokenUsage.modelUsage[modelId];
      const modelName = usage.modelName || modelId;
      const contextLimit = usage.modelInfo?.limit?.context;
      const outputLimit = usage.modelInfo?.limit?.output;

      if (isMultiModel) stats += `\n\n**${modelName}:**`;

      const peakContext = usage.peakContextUsage || 0;

      if (!isMultiModel && hasMultipleSubSessions) {
        // Single-model + multiple sub-sessions: show numbered sub-sessions under that model
        stats += formatSubSessionsList(subSessions, contextLimit, outputLimit);
      } else if (peakContext > 0) {
        // Issue #1526: Single line format for context window + output tokens
        stats += formatContextOutputLine(peakContext, contextLimit, usage.outputTokens, outputLimit, '- ');
      }
      // Issue #1539: When peakContextUsage is unknown, skip context window line entirely.
      // Cumulative totals are shown on the Total line below — no duplication needed.

      // Cumulative totals per model: input tokens + cached shown separately
      // Issue #1526: Shorter format — single "Total:" line
      const totalInputNonCached = usage.inputTokens + usage.cacheCreationTokens;
      const cachedTokens = usage.cacheReadTokens;
      let totalLine = `${formatTokensCompact(totalInputNonCached)}`;
      if (cachedTokens > 0) totalLine += ` + ${formatTokensCompact(cachedTokens)} cached`;
      totalLine += ` input tokens, ${formatTokensCompact(usage.outputTokens)} output tokens`;

      // Issue #1539: When peakContextUsage is unknown (no per-request data), embed
      // output token percentage in the Total line so no data is lost.
      if (peakContext === 0 && outputLimit) {
        const outPct = ((usage.outputTokens / outputLimit) * 100).toFixed(0);
        totalLine += ` (${outPct}% of ${formatTokensCompact(outputLimit)} output limit)`;
      }

      // Issue #1508: Show per-model cost when available
      if (usage.costUSD !== null && usage.costUSD !== undefined) {
        totalLine += `, $${usage.costUSD.toFixed(6)} cost`;
      }

      stats += `\n\nTotal: ${totalLine}`;
    }
  }

  return stats;
};

/**
 * Issue #1526: Build budget stats data from Agent CLI token/context information.
 * Converts Agent CLI parsed data into the same format used by calculateSessionTokens
 * so that buildBudgetStatsString can render it uniformly.
 * @param {Object} tokenUsage - Token usage from parseAgentTokenUsage (with context/model info)
 * @param {Object|null} pricingInfo - Pricing info from calculateAgentPricing
 * @returns {Object|null} Budget stats data compatible with buildBudgetStatsString, or null if no data
 */
export const buildAgentBudgetStats = (tokenUsage, pricingInfo) => {
  if (!tokenUsage || tokenUsage.stepCount === 0) return null;

  const modelName = pricingInfo?.modelName || tokenUsage.respondedModelId || tokenUsage.requestedModelId || 'Unknown';
  const modelId = tokenUsage.respondedModelId || tokenUsage.requestedModelId || pricingInfo?.modelId || 'unknown';

  // Use context limits from step_finish events if available, otherwise from pricing model info
  const contextLimit = tokenUsage.contextLimit || pricingInfo?.modelInfo?.limit?.context || null;
  const outputLimit = tokenUsage.outputLimit || pricingInfo?.modelInfo?.limit?.output || null;

  const modelUsageEntry = {
    inputTokens: tokenUsage.inputTokens,
    cacheCreationTokens: tokenUsage.cacheWriteTokens || 0,
    cacheReadTokens: tokenUsage.cacheReadTokens || 0,
    outputTokens: tokenUsage.outputTokens,
    modelName,
    modelInfo: contextLimit || outputLimit ? { limit: { context: contextLimit, output: outputLimit } } : null,
    peakContextUsage: tokenUsage.peakContextUsage || 0,
    costUSD: pricingInfo?.totalCostUSD ?? null,
  };

  return {
    modelUsage: { [modelId]: modelUsageEntry },
    subSessions: [],
    inputTokens: tokenUsage.inputTokens,
    cacheCreationTokens: tokenUsage.cacheWriteTokens || 0,
    cacheReadTokens: tokenUsage.cacheReadTokens || 0,
    outputTokens: tokenUsage.outputTokens,
    totalTokens: tokenUsage.inputTokens + (tokenUsage.cacheWriteTokens || 0) + tokenUsage.outputTokens,
  };
};
