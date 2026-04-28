#!/usr/bin/env node
// Token budget statistics display module
// Extracted from claude.lib.mjs to maintain file line limits

import { formatNumber } from './claude.lib.mjs';
import Decimal from 'decimal.js-light';

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
  // Issue #1710: track Anthropic server-tool usage from per-request JSONL entries
  // so the public-pricing estimate can bill them at the documented per-request rate.
  if (usage.server_tool_use?.web_search_requests) {
    modelUsageMap[model].webSearchRequests += usage.server_tool_use.web_search_requests;
  }
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
        await log(`        ${label}: ${formatNumber(breakdown[key].tokens)} tokens × $${breakdown[key].costPerMillion}/M = $${new Decimal(breakdown[key].cost).toFixed(6)}`);
      }
    }
    // Issue #1710: itemise server-tool charges so the residual that puzzled
    // readers in PR #1707 ($0.04 web_search) is visible in the breakdown.
    if (breakdown.webSearch && breakdown.webSearch.requests > 0) {
      await log(`        Web search: ${breakdown.webSearch.requests} requests × $${breakdown.webSearch.costPerRequest}/req = $${new Decimal(breakdown.webSearch.cost).toFixed(6)}`);
    }
    await log('        ─────────────────────────────────');
    await log(`        Total: $${new Decimal(usage.costUSD).toFixed(6)}`);
  } else if (usage.modelInfo === null) {
    await log('');
    await log('      Cost: Not available (could not fetch pricing)');
  }
};

/**
 * Display cost comparison between public pricing and Anthropic's official cost
 * Issue #1557: Show simplified format when costs match, remove USD suffix
 * @param {number|null} publicCost - Public pricing estimate
 * @param {number|null} anthropicCost - Anthropic's official cost
 * @param {Function} log - Logging function
 */
export const displayCostComparison = async (publicCost, anthropicCost, log) => {
  const hasPublic = publicCost !== null && publicCost !== undefined;
  const hasAnthropic = anthropicCost !== null && anthropicCost !== undefined;
  const publicDec = hasPublic ? new Decimal(publicCost) : null;
  const anthropicDec = hasAnthropic ? new Decimal(anthropicCost) : null;
  // Issue #1703: also collapse to the short form when the rounded difference is below display precision,
  // so reports like "Difference: $-0.000000 (-0.00%)" no longer waste two extra lines.
  if (publicDec && anthropicDec && anthropicDec.minus(publicDec).abs().toFixed(6) === '0.000000') {
    await log(`\n   💰 Cost: $${anthropicDec.toFixed(6)}`);
    return;
  }
  await log('\n   💰 Cost estimation:');
  await log(`      Public pricing estimate: ${publicDec ? `$${publicDec.toFixed(6)}` : 'unknown'}`);
  await log(`      Calculated by Anthropic: ${anthropicDec ? `$${anthropicDec.toFixed(6)}` : 'unknown'}`);
  if (publicDec && anthropicDec) {
    const difference = anthropicDec.minus(publicDec);
    const percentDiff = publicDec.gt(0) ? difference.div(publicDec).mul(100) : new Decimal(0);
    await log(`      Difference:              $${difference.toFixed(6)} (${percentDiff.gt(0) ? '+' : ''}${percentDiff.toFixed(2)}%)`);
  } else {
    await log('      Difference:              unknown');
  }
};

/**
 * Issue #1710: Emit a verbose, machine-friendly trace of every input that
 * feeds the budget-stats renderer for a single model. Hidden behind
 * `{ verbose: true }` so it never pollutes the default log, but always
 * captured when --verbose is set. The trace is what we wished we had had
 * available *before* filing #1710 — it shows peak vs. cumulative side by
 * side, splits cache writes from cache reads, and surfaces server-tool
 * usage (web search) that the public-pricing estimator currently ignores.
 *
 * @param {Object} usage      - Per-model usage entry from `tokenUsage.modelUsage`.
 * @param {Object} tokenUsage - Full token usage object (used only for sub-session count).
 * @param {Function} log      - Async logger (must accept a `{verbose}` options arg).
 */
export const dumpBudgetTrace = async (usage, tokenUsage, log) => {
  const modelName = usage.modelName || usage.modelInfo?.name || 'unknown';
  const limit = usage.modelInfo?.limit || {};
  const peak = usage.peakContextUsage || 0;
  const writes5m = usage.cacheCreation5mTokens || 0;
  const writes1h = usage.cacheCreation1hTokens || 0;
  const writes = usage.cacheCreationTokens || 0;
  const reads = usage.cacheReadTokens || 0;
  const inputs = usage.inputTokens || 0;
  const outputs = usage.outputTokens || 0;
  const webSearches = usage.webSearchRequests || 0;
  const subSessionCount = (tokenUsage?.subSessions || []).length;
  const source = usage._sourceResultJson ? 'jsonl + result-event' : 'jsonl';

  await log(`\n      📊 [budget-trace] ${modelName}`, { verbose: true });
  await log(`         peak request:    ${formatNumber(peak)}${limit.context ? ` / ${formatNumber(limit.context)} context` : ''} (largest single-request input + cache_creation + cache_read)`, { verbose: true });
  await log(`         cumulative:      input ${formatNumber(inputs)}, cache_write ${formatNumber(writes)} (5m ${formatNumber(writes5m)} / 1h ${formatNumber(writes1h)}), cache_read ${formatNumber(reads)}, output ${formatNumber(outputs)}`, { verbose: true });
  await log(`         server tools:    web_search ${webSearches}${webSearches > 0 ? ` (= $${(webSearches * 0.01).toFixed(6)} at $10 / 1k searches; not included in calculateModelCost output)` : ''}`, { verbose: true });
  if (usage.costUSD !== null && usage.costUSD !== undefined) {
    await log(`         cost (public):   $${new Decimal(usage.costUSD).toFixed(6)}`, { verbose: true });
  }
  if (usage._resultCostUSD !== null && usage._resultCostUSD !== undefined) {
    await log(`         cost (anthropic result-event): $${new Decimal(usage._resultCostUSD).toFixed(6)}`, { verbose: true });
  }
  await log(`         sub-session count: ${subSessionCount}`, { verbose: true });
  await log(`         data source:     ${source}`, { verbose: true });
};

/**
 * Display token budget statistics (context window usage and ratios)
 * @param {Object} usage - Usage data for a model
 * @param {Object} tokenUsage - Full token usage data (with subSessions)
 * @param {Function} log - Logging function
 */
/**
 * Issue #1526: Updated to use single-line context+output format.
 * Issue #1710: After the standard rendering, emit a verbose trace of the
 *              raw inputs that fed the renderer (gated behind --verbose),
 *              so future calculation-correctness reports can be triaged
 *              without re-running the session.
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
    // Issue #1600: Unified format — numbered list without "Context window:" prefix.
    // Issue #1710 R3/R5: Peak input is `input + cache_creation` (cache reads
    // are tracked separately on the Total line), and the bullet is now
    // labelled "peak request:" so a reader does not try to reconcile it with
    // the cumulative Total figure.
    for (let i = 0; i < subSessions.length; i++) {
      const sub = subSessions[i];
      const subPeak = sub.peakContextUsage || 0;
      const parts = [];
      if (contextLimit && subPeak > 0) {
        const pct = ((subPeak / contextLimit) * 100).toFixed(0);
        parts.push(`peak request: ${formatNumber(subPeak)} / ${formatNumber(contextLimit)} (${pct}%) input tokens`);
      }
      if (outputLimit) {
        const outPct = ((sub.outputTokens / outputLimit) * 100).toFixed(0);
        parts.push(`${formatNumber(sub.outputTokens)} / ${formatNumber(outputLimit)} (${outPct}%) output tokens`);
      }
      if (parts.length > 0) {
        await log(`        ${i + 1}. ${parts.join(', ')}`);
      }
    }
  } else if (peakContext > 0) {
    const parts = [];
    if (contextLimit) {
      const pct = ((peakContext / contextLimit) * 100).toFixed(0);
      parts.push(`peak request: ${formatNumber(peakContext)} / ${formatNumber(contextLimit)} (${pct}%) input tokens`);
    }
    if (outputLimit) {
      const outPct = ((usage.outputTokens / outputLimit) * 100).toFixed(0);
      parts.push(`${formatNumber(usage.outputTokens)} / ${formatNumber(outputLimit)} (${outPct}%) output tokens`);
    }
    if (parts.length > 0) {
      await log(`        - ${parts.join(', ')}`);
    }
  }

  // Cumulative totals — single line.
  // Issue #1547: Parenthesized cached format and consistent output format.
  // Issue #1710 R4: When cache writes are present, render them as a separate
  // category instead of folding them into the input figure.
  let totalLine = buildCumulativeInputPhrase({
    input: usage.inputTokens || 0,
    cacheWrites: usage.cacheCreationTokens || 0,
    cacheReads: usage.cacheReadTokens || 0,
    format: formatNumber,
  });
  if (peakContext === 0 && outputLimit) {
    const outPct = ((usage.outputTokens / outputLimit) * 100).toFixed(0);
    totalLine += `, ${formatNumber(usage.outputTokens)} / ${formatNumber(outputLimit)} (${outPct}%) output tokens`;
  } else {
    totalLine += `, ${formatNumber(usage.outputTokens)} output tokens`;
  }
  await log(`        Total: ${totalLine}`);

  // Issue #1710: verbose-only, never affects default output.
  await dumpBudgetTrace(usage, tokenUsage, log);
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
 * Issue #1710: Build the cumulative input-tokens phrase for the Total / fallback
 * lines, splitting cache writes and cache reads so neither category is ever
 * silently fused with raw input tokens.
 *
 * Forms (in priority order):
 *   - reads > 0 && writes > 0 → "(X new + W cache writes + Y cache reads) input tokens"
 *   - reads > 0 && writes = 0 → "(X + Y cached) input tokens"        (back-compat shape)
 *   - reads = 0 && writes > 0 → "(X new + W cache writes) input tokens"
 *   - reads = 0 && writes = 0 → "X input tokens"
 *
 * The legacy `(X + Y cached)` shape is preserved when only cache reads exist
 * so we don't churn output for the common Opus-only case. The new explicit
 * forms only appear when cache writes are non-zero (issue #1710 R4).
 *
 * @param {Object} opts
 * @param {number} opts.input - non-cached input tokens (excludes cache writes/reads)
 * @param {number} opts.cacheWrites - cache_creation_input_tokens (cumulative)
 * @param {number} opts.cacheReads - cache_read_input_tokens (cumulative)
 * @param {(n: number) => string} opts.format - formatter (compact or full)
 * @returns {string} the cumulative input phrase, e.g. "(78K new + 57.6K cache writes) input tokens"
 */
export const buildCumulativeInputPhrase = ({ input, cacheWrites, cacheReads, format }) => {
  const w = Math.max(0, cacheWrites || 0);
  const r = Math.max(0, cacheReads || 0);
  const i = Math.max(0, input || 0);
  if (w > 0 && r > 0) {
    return `(${format(i)} new + ${format(w)} cache writes + ${format(r)} cache reads) input tokens`;
  }
  if (w > 0) {
    return `(${format(i)} new + ${format(w)} cache writes) input tokens`;
  }
  if (r > 0) {
    return `(${format(i)} + ${format(r)} cached) input tokens`;
  }
  return `${format(i)} input tokens`;
};

/**
 * Format sub-sessions list for budget stats display
 * @param {Array} subSessions - Array of sub-session usage objects
 * @param {number|null} contextLimit - Context window limit for the model
 * @param {number|null} outputLimit - Output token limit for the model
 * @returns {string} Formatted sub-sessions string
 */
/**
 * Issue #1600: Format sub-sessions list using numbered single-line format.
 * Each sub-session gets: "N. X / Y (Z%) input tokens, A / B (W%) output tokens"
 */
const formatSubSessionsList = (subSessions, contextLimit, outputLimit) => {
  let result = '';
  for (let i = 0; i < subSessions.length; i++) {
    const sub = subSessions[i];
    const subPeakContext = sub.peakContextUsage || 0;
    result += formatContextOutputLine(subPeakContext, contextLimit, sub.outputTokens, outputLimit, `${i + 1}. `);
  }
  return result;
};

/**
 * Issue #1600: Build a single-line context + output tokens string (unified format, no "Context window:" prefix).
 * Issue #1710 R3/R5: The input figure is the peak per-request `input + cache_creation`
 * (cache reads excluded). Labelling it "peak request:" lets readers tell it apart
 * from the cumulative Total line.
 * @param {number} peakContext - Peak context usage (0 if unknown — context display skipped)
 * @param {number} contextLimit - Context window limit (null if unknown)
 * @param {number} outputTokens - Output tokens used
 * @param {number} outputLimit - Output token limit (null if unknown)
 * @param {string} [prefix='- '] - Line prefix
 * @returns {string} Formatted line or empty string
 */
const formatContextOutputLine = (peakContext, contextLimit, outputTokens, outputLimit, prefix = '- ') => {
  const parts = [];
  if (contextLimit && peakContext > 0) {
    const pct = ((peakContext / contextLimit) * 100).toFixed(0);
    parts.push(`peak request: ${formatTokensCompact(peakContext)} / ${formatTokensCompact(contextLimit)} (${pct}%) input tokens`);
  }
  if (outputLimit) {
    const outPct = ((outputTokens / outputLimit) * 100).toFixed(0);
    parts.push(`${formatTokensCompact(outputTokens)} / ${formatTokensCompact(outputLimit)} (${outPct}%) output tokens`);
  }
  if (parts.length === 0) return '';
  return `\n${prefix}${parts.join(', ')}`;
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
/**
 * Issue #1590: Build a map of model short name to sub-agent call count.
 * Sub-agent calls use short model names (e.g., "sonnet", "haiku", "opus")
 * while modelUsage uses full model IDs (e.g., "claude-sonnet-4-6").
 * @param {Array|null} subAgentCalls - Array of {id, description, model} from stream tracking
 * @returns {Object} Map of model short name to call count, e.g., {"sonnet": 12, "haiku": 3}
 */
const buildSubAgentCallCounts = subAgentCalls => {
  if (!subAgentCalls || subAgentCalls.length === 0) return {};
  const counts = {};
  for (const call of subAgentCalls) {
    const model = call.model || 'default';
    counts[model] = (counts[model] || 0) + 1;
  }
  return counts;
};

/**
 * Issue #1590: Match a full model ID to sub-agent call count.
 * Maps full model IDs (e.g., "claude-sonnet-4-6") to short names used in Agent tool
 * (e.g., "sonnet") and returns the call count.
 * @param {string} modelId - Full model ID
 * @param {Object} callCounts - Map from buildSubAgentCallCounts
 * @returns {number} Number of sub-agent calls for this model, or 0 if none
 */
const getSubAgentCallCount = (modelId, callCounts) => {
  if (!callCounts || Object.keys(callCounts).length === 0) return 0;
  // Direct match first (e.g., model short name used as full ID)
  if (callCounts[modelId]) return callCounts[modelId];
  // Match short names to full model IDs:
  // "claude-sonnet-4-6" contains "sonnet", "claude-haiku-4-5-20251001" contains "haiku", etc.
  const modelIdLower = modelId.toLowerCase();
  for (const [shortName, count] of Object.entries(callCounts)) {
    if (modelIdLower.includes(shortName.toLowerCase())) return count;
  }
  return 0;
};

/**
 * Issue #1590: Get sub-agent calls matching a specific model ID.
 * Filters the subAgentCalls array to return only calls whose short model name
 * matches the given full model ID.
 * @param {string} modelId - Full model ID (e.g., "claude-sonnet-4-6")
 * @param {Array|null} subAgentCalls - Array of {id, description, model} from stream tracking
 * @returns {Array} Matching sub-agent calls for this model
 */
const getSubAgentCallsForModel = (modelId, subAgentCalls) => {
  if (!subAgentCalls || subAgentCalls.length === 0) return [];
  const modelIdLower = modelId.toLowerCase();
  return subAgentCalls.filter(call => {
    const shortName = (call.model || 'default').toLowerCase();
    return modelIdLower === shortName || modelIdLower.includes(shortName);
  });
};

export const buildBudgetStatsString = (tokenUsage, subAgentCalls = null) => {
  if (!tokenUsage) return '';

  let stats = '\n\n### 📊 **Context and tokens usage:**';

  // Issue #1590: Build sub-agent call counts per model for per-call breakdown
  // Guard: subAgentCalls must be an array (ignore legacy streamUsage objects passed as second arg)
  const validSubAgentCalls = Array.isArray(subAgentCalls) ? subAgentCalls : null;
  const subAgentCallCounts = buildSubAgentCallCounts(validSubAgentCalls);

  // Per-model breakdown
  if (tokenUsage.modelUsage) {
    const modelIds = Object.keys(tokenUsage.modelUsage);
    const isMultiModel = modelIds.length > 1;

    // Issue #1508: For multi-model sessions, show sub-sessions once (globally), not per-model
    // Sub-sessions track compactification boundaries which are session-wide, not model-specific
    const subSessions = tokenUsage.subSessions || [];
    const hasMultipleSubSessions = subSessions.length > 1;

    for (const modelId of modelIds) {
      const usage = tokenUsage.modelUsage[modelId];
      const modelName = usage.modelName || modelId;
      const contextLimit = usage.modelInfo?.limit?.context;
      const outputLimit = usage.modelInfo?.limit?.output;

      // Issue #1590: Check if this model was used as a sub-agent
      const callCount = getSubAgentCallCount(modelId, subAgentCallCounts);
      const isPrimaryModel = !isMultiModel || modelId === modelIds[0];
      const showSubSessions = hasMultipleSubSessions && isPrimaryModel;

      if (isMultiModel) {
        // Issue #1590: Show sub-agent call count alongside model name
        // Issue #1600: Show session segment count for primary model
        if (callCount > 1) {
          stats += `\n\n**${modelName}:** (${callCount} sub-agent calls)`;
        } else if (showSubSessions) {
          stats += `\n\n**${modelName}:** (${subSessions.length} session segments)`;
        } else {
          stats += `\n\n**${modelName}:**`;
        }
      } else if (showSubSessions) {
        stats += `\n\n**${modelName}:** (${subSessions.length} session segments)`;
      }

      const peakContext = usage.peakContextUsage || 0;

      if (showSubSessions) {
        // Issue #1600: Unified format — no "Context window:" prefix, same format as sub-agent calls
        stats += formatSubSessionsList(subSessions, contextLimit, outputLimit);
      } else if (peakContext > 0) {
        stats += formatContextOutputLine(peakContext, contextLimit, usage.outputTokens, outputLimit, '- ');
      } else if (outputLimit && callCount <= 1) {
        // Issue #1600: Sub-agent single sessions previously showed only an output line.
        // Issue #1710 R2: Always surface the cumulative input information too — sub-agent
        // models (e.g. Haiku) never appear as the responding model in the parent JSONL,
        // so peakContext stays at 0; without this fallback the rendered comment loses
        // the sub-agent's input-token information entirely. Cache writes / reads are
        // split via the same helper used for the Total line so the two lines stay
        // arithmetically consistent.
        const inputPhrase = buildCumulativeInputPhrase({
          input: usage.inputTokens || 0,
          cacheWrites: usage.cacheCreationTokens || 0,
          cacheReads: usage.cacheReadTokens || 0,
          format: formatTokensCompact,
        });
        const outPct = ((usage.outputTokens / outputLimit) * 100).toFixed(0);
        stats += `\n- ${inputPhrase}, ${formatTokensCompact(usage.outputTokens)} / ${formatTokensCompact(outputLimit)} (${outPct}%) output tokens`;
      }

      // Cumulative totals per model: input tokens + cached shown separately.
      // Issue #1710 R4: Cache writes are now their own category (so the displayed
      // "input tokens" figure never silently fuses 1.25× / 2× cache-write tokens
      // with regular 1× input tokens — see issue #1710 root cause D).
      let totalLine = buildCumulativeInputPhrase({
        input: usage.inputTokens || 0,
        cacheWrites: usage.cacheCreationTokens || 0,
        cacheReads: usage.cacheReadTokens || 0,
        format: formatTokensCompact,
      });

      // Issue #1600: Output tokens on Total line — skip percentage if already shown above or aggregated
      if (callCount > 1) {
        totalLine += `, ${formatTokensCompact(usage.outputTokens)} output tokens`;
      } else {
        totalLine += `, ${formatTokensCompact(usage.outputTokens)} output tokens`;
      }

      // Issue #1600: Use Decimal for cost display precision
      if (usage.costUSD !== null && usage.costUSD !== undefined) {
        totalLine += `, $${new Decimal(usage.costUSD).toFixed(6)} cost`;
      }

      // Issue #1590: Show individual sub-agent call list when multiple calls exist
      if (callCount > 1) {
        const matchingCalls = getSubAgentCallsForModel(modelId, validSubAgentCalls);
        const hasActualUsage = matchingCalls.some(c => c.usage && (c.usage.inputTokens > 0 || c.usage.outputTokens > 0 || c.usage.cacheReadTokens > 0 || c.usage.cacheCreationTokens > 0));

        stats += `\n\nSub-agent calls:`;
        if (hasActualUsage) {
          for (let i = 0; i < matchingCalls.length; i++) {
            const call = matchingCalls[i];
            const cu = call.usage || {};
            const callInput = (cu.inputTokens || 0) + (cu.cacheCreationTokens || 0) + (cu.cacheReadTokens || 0);
            const callOutput = cu.outputTokens || 0;
            const parts = [];
            if (contextLimit) {
              const pct = ((callInput / contextLimit) * 100).toFixed(0);
              parts.push(`${formatTokensCompact(callInput)} / ${formatTokensCompact(contextLimit)} (${pct}%) input tokens`);
            } else {
              parts.push(`${formatTokensCompact(callInput)} input tokens`);
            }
            if (outputLimit) {
              const outPct = ((callOutput / outputLimit) * 100).toFixed(0);
              parts.push(`${formatTokensCompact(callOutput)} / ${formatTokensCompact(outputLimit)} (${outPct}%) output tokens`);
            } else {
              parts.push(`${formatTokensCompact(callOutput)} output tokens`);
            }
            stats += `\n${i + 1}. ${parts.join(', ')}`;
          }
        } else {
          // Estimated per-call breakdown when sub-agent stream tracking did not capture
          // per-call usage. Includes everything the model actually saw:
          // input + cache_creation (writes) + cache_read.
          const aggregateInput = (usage.inputTokens || 0) + (usage.cacheCreationTokens || 0) + (usage.cacheReadTokens || 0);
          const avgInput = Math.round(aggregateInput / callCount);
          const avgOutput = Math.round(usage.outputTokens / callCount);
          for (let i = 0; i < matchingCalls.length; i++) {
            const parts = [];
            if (contextLimit) {
              const pct = ((avgInput / contextLimit) * 100).toFixed(0);
              parts.push(`~${formatTokensCompact(avgInput)} / ${formatTokensCompact(contextLimit)} (${pct}%) input tokens`);
            } else {
              parts.push(`~${formatTokensCompact(avgInput)} input tokens`);
            }
            if (outputLimit) {
              const outPct = ((avgOutput / outputLimit) * 100).toFixed(0);
              parts.push(`~${formatTokensCompact(avgOutput)} / ${formatTokensCompact(outputLimit)} (${outPct}%) output tokens`);
            } else {
              parts.push(`~${formatTokensCompact(avgOutput)} output tokens`);
            }
            stats += `\n${i + 1}. ${parts.join(', ')}`;
          }
          stats += `\n\n_Per-call values are estimates (total ÷ ${callCount}). Exact per-call breakdown requires [upstream support](https://github.com/anthropics/claude-code/issues/46520)._`;
        }
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

/**
 * Issue #1590: Creates a fresh sub-agent call entry for tracking per-call token usage
 * @param {Object} item - The tool_use content item from the assistant message
 * @returns {Object} Sub-agent call entry with id, description, model, and empty usage
 */
export const createSubAgentCallEntry = item => {
  const agentInput = item.input || {};
  return {
    id: item.id || null,
    description: agentInput.description || null,
    model: agentInput.model || null,
    usage: {
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      totalTokens: null, // from task_notification
    },
  };
};

/**
 * Issue #1590: Accumulates token usage from a stream event into a sub-agent call entry
 * @param {Object} callEntry - The sub-agent call entry to accumulate into
 * @param {Object} u - The usage object from the stream event
 */
export const accumulateSubAgentUsage = (callEntry, u) => {
  if (u.input_tokens) callEntry.usage.inputTokens += u.input_tokens;
  if (u.cache_creation_input_tokens) callEntry.usage.cacheCreationTokens += u.cache_creation_input_tokens;
  if (u.cache_read_input_tokens) callEntry.usage.cacheReadTokens += u.cache_read_input_tokens;
  if (u.output_tokens) callEntry.usage.outputTokens += u.output_tokens;
};
