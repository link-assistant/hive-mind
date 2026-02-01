/**
 * Issue #787: Convert Anthropic's modelUsage data to the same format as calculateSessionTokens returns.
 * This uses the complete data from Claude CLI result (includes all sub-agents),
 * then fetches model.dev pricing to calculate public pricing estimates.
 */
import { fetchModelInfo, calculateModelCost } from './claude.lib.mjs';

/**
 * @param {Object} anthropicModelUsage - modelUsage from Claude CLI result
 * @returns {Object|null} Token usage data in the same format as calculateSessionTokens
 */
export const convertAnthropicModelUsage = async anthropicModelUsage => {
  if (!anthropicModelUsage || typeof anthropicModelUsage !== 'object') return null;
  const modelUsage = {};
  for (const [modelId, data] of Object.entries(anthropicModelUsage)) {
    modelUsage[modelId] = {
      inputTokens: data.inputTokens || 0,
      cacheCreationTokens: data.cacheCreationInputTokens || 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      cacheReadTokens: data.cacheReadInputTokens || 0,
      outputTokens: data.outputTokens || 0,
      webSearchRequests: data.webSearchRequests || 0,
    };
  }
  if (Object.keys(modelUsage).length === 0) return null;
  // Fetch model info and calculate costs (same logic as calculateSessionTokens)
  const modelInfoPromises = Object.keys(modelUsage).map(async modelId => {
    const modelInfo = await fetchModelInfo(modelId);
    return { modelId, modelInfo };
  });
  const modelInfoResults = await Promise.all(modelInfoPromises);
  const modelInfoMap = {};
  for (const { modelId, modelInfo } of modelInfoResults) {
    if (modelInfo) modelInfoMap[modelId] = modelInfo;
  }
  for (const [modelId, usage] of Object.entries(modelUsage)) {
    const modelInfo = modelInfoMap[modelId];
    if (modelInfo) {
      const costData = calculateModelCost(usage, modelInfo, true);
      usage.costUSD = costData.total;
      usage.costBreakdown = costData.breakdown;
      usage.modelName = modelInfo.name || modelId;
      usage.modelInfo = modelInfo;
    } else {
      usage.costUSD = null;
      usage.costBreakdown = null;
      usage.modelName = modelId;
      usage.modelInfo = null;
    }
  }
  let totalInputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUSD = 0;
  let hasCostData = false;
  for (const usage of Object.values(modelUsage)) {
    totalInputTokens += usage.inputTokens;
    totalCacheCreationTokens += usage.cacheCreationTokens;
    totalCacheReadTokens += usage.cacheReadTokens;
    totalOutputTokens += usage.outputTokens;
    if (usage.costUSD !== null) {
      totalCostUSD += usage.costUSD;
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
    totalCostUSD: hasCostData ? totalCostUSD : null,
  };
};
