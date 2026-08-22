/**
 * Per-session token/cost accounting for Claude sessions.
 *
 * Reads the Claude Code session JSONL (`~/.claude/projects/<dir>/<id>.jsonl`),
 * deduplicates the stream-json entries, splits the transcript into sub-sessions
 * at each compact boundary, and prices the result through the model info API.
 *
 * Extracted from claude.lib.mjs (issue #2175) so that file stays under the
 * 1350-line early-warning threshold of the CI file-headroom check (long files
 * cause concurrent PR merge conflicts — issue #1593). Behaviour is unchanged;
 * claude.lib.mjs re-exports this function.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2175
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Decimal from 'decimal.js-light';

import { accumulateModelUsage, createEmptySubSessionUsage, getRawRequestInputTokens, mergeResultModelUsage } from './claude.budget-stats.lib.mjs';
import { calculateModelCost } from './claude.cost.lib.mjs';
import { fetchModelInfo } from './model-info.lib.mjs';

export const calculateSessionTokens = async (sessionId, tempDir, resultModelUsage = null, options = {}) => {
  const homeDir = options.homeDir || os.homedir();
  const fetchModelInfoForUsage = options.fetchModelInfo || fetchModelInfo;
  const projectDirName = tempDir.replace(/\//g, '-');
  const sessionFile = path.join(homeDir, '.claude', 'projects', projectDirName, `${sessionId}.jsonl`);
  try {
    await fs.access(sessionFile);
  } catch {
    return null;
  }
  const modelUsage = {};
  // Issue #1501: Deduplicate JSONL entries by message ID (stream-json splits responses)
  const seenMessageIds = new Set();
  let duplicateCount = 0;
  const peakContextByModel = {};
  let globalPeakContext = 0;
  const subSessions = [];
  let currentSubSession = createEmptySubSessionUsage();
  const compactifications = [];
  try {
    const fileContent = await fs.readFile(sessionFile, 'utf8');
    const lines = fileContent.trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
          if (currentSubSession.messageCount > 0) {
            subSessions.push(currentSubSession);
          }
          compactifications.push({
            timestamp: entry.timestamp || null,
            preTokens: entry.compactMetadata?.preTokens || null,
            trigger: entry.compactMetadata?.trigger || 'unknown',
          });
          currentSubSession = createEmptySubSessionUsage();
          continue;
        }
        if (entry.message && entry.message.usage && entry.message.model) {
          // Issue #1501: Skip duplicate JSONL entries (same message ID = same API response)
          const msgId = entry.message.id;
          if (msgId) {
            if (seenMessageIds.has(msgId)) {
              duplicateCount++;
              continue;
            }
            seenMessageIds.add(msgId);
          }
          accumulateModelUsage(modelUsage, entry);
          // Issue #1737: Track peak restored-context input per request.
          // Anthropic splits a request's input into input_tokens,
          // cache_creation_input_tokens, and cache_read_input_tokens; all three
          // count toward "how much context will be restored if I resume here".
          const usage = entry.message.usage;
          const requestContext = getRawRequestInputTokens(usage);
          const model = entry.message.model;
          if (requestContext > (peakContextByModel[model] || 0)) {
            peakContextByModel[model] = requestContext;
          }
          if (requestContext > globalPeakContext) {
            globalPeakContext = requestContext;
          }
          if (usage.input_tokens) currentSubSession.inputTokens += usage.input_tokens;
          if (usage.cache_creation_input_tokens) currentSubSession.cacheCreationTokens += usage.cache_creation_input_tokens;
          if (usage.cache_read_input_tokens) currentSubSession.cacheReadTokens += usage.cache_read_input_tokens;
          if (usage.output_tokens) currentSubSession.outputTokens += usage.output_tokens;
          currentSubSession.messageCount++;
          // Issue #1501: Track peak context and output per sub-session
          if (requestContext > currentSubSession.peakContextUsage) {
            currentSubSession.peakContextUsage = requestContext;
          }
          if ((usage.output_tokens || 0) > currentSubSession.peakOutputUsage) {
            currentSubSession.peakOutputUsage = usage.output_tokens || 0;
          }
        }
      } catch {
        // Skip lines that aren't valid JSON
        continue;
      }
    }
    if (currentSubSession.messageCount > 0) {
      subSessions.push(currentSubSession);
    }
    mergeResultModelUsage(modelUsage, resultModelUsage);
    if (Object.keys(modelUsage).length === 0) {
      return null;
    }
    const modelInfoPromises = Object.keys(modelUsage).map(async modelId => {
      const modelInfo = await fetchModelInfoForUsage(modelId);
      return { modelId, modelInfo };
    });
    const modelInfoResults = await Promise.all(modelInfoPromises);
    const modelInfoMap = {};
    for (const { modelId, modelInfo } of modelInfoResults) {
      if (modelInfo) {
        modelInfoMap[modelId] = modelInfo;
      }
    }
    for (const [modelId, usage] of Object.entries(modelUsage)) {
      const modelInfo = modelInfoMap[modelId];
      // Issue #1501: Attach peak context usage per model
      usage.peakContextUsage = peakContextByModel[modelId] || 0;
      // Calculate cost using pricing API
      if (modelInfo) {
        const costData = calculateModelCost(usage, modelInfo, true);
        usage.costUSD = costData.total;
        usage.costBreakdown = costData.breakdown;
        usage.modelName = modelInfo.name || modelId;
        usage.modelInfo = modelInfo;
      } else {
        usage.costUSD = usage._resultCostUSD ?? null;
        usage.costBreakdown = null;
        usage.modelName = modelId;
        // Issue #1539: Use contextWindow/maxOutputTokens from result JSON as fallback model limits
        const ctx = usage._resultContextWindow,
          out = usage._resultMaxOutputTokens;
        usage.modelInfo = ctx || out ? { limit: { context: ctx || null, output: out || null } } : null;
      }
    }
    let totalInputTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalCacheReadTokens = 0;
    let totalOutputTokens = 0;
    let totalCostDecimal = new Decimal(0);
    let hasCostData = false;
    for (const usage of Object.values(modelUsage)) {
      totalInputTokens += usage.inputTokens;
      totalCacheCreationTokens += usage.cacheCreationTokens;
      totalCacheReadTokens += usage.cacheReadTokens;
      totalOutputTokens += usage.outputTokens;
      if (usage.costUSD !== null) {
        totalCostDecimal = totalCostDecimal.plus(new Decimal(usage.costUSD));
        hasCostData = true;
      }
    }
    const totalTokens = totalInputTokens + totalCacheCreationTokens + totalOutputTokens;
    return {
      modelUsage,
      inputTokens: totalInputTokens,
      cacheCreationTokens: totalCacheCreationTokens,
      cacheReadTokens: totalCacheReadTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
      totalCostUSD: hasCostData ? totalCostDecimal.toNumber() : null,
      // Issue #1501: Peak context usage (max single-request fill) and dedup stats
      peakContextUsage: globalPeakContext,
      duplicateEntriesSkipped: duplicateCount,
      // Issue #1491/#1501: Sub-session and compactification data (always include for display)
      subSessions,
      compactifications: compactifications.length > 0 ? compactifications : null,
    };
  } catch (readError) {
    throw new Error(`Failed to read session file: ${readError.message}`, { cause: readError });
  }
};
