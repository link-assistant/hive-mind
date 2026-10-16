#!/usr/bin/env node

/**
 * Pricing and provider identity for the Formal AI model (issue #2119).
 *
 * `--model formal-ai` routes every request through a local Formal AI model
 * server (`formal-ai with <tool> ...`). The requests never reach OpenCode Zen,
 * OpenAI, Anthropic or Google, so:
 *
 *   - the provider is Link.Assistant, not the provider of whichever agentic CLI
 *     happens to be driving the session;
 *   - the cost is $0.00, so an inherited `total_cost_usd` (claude reported
 *     $0.252315 for a Formal AI session) or a models.dev price lookup for an
 *     unrelated base model is a false positive.
 *
 * Every pricing producer funnels through here so the same numbers appear in
 * logs, GitHub comments and budget statistics.
 */

import { FORMAL_AI_MODEL_ALIAS, FORMAL_AI_PROVIDER_MODEL_ID, isFormalAiModel } from './models/index.mjs';

export const FORMAL_AI_PROVIDER_NAME = 'Link.Assistant';

const ZERO_PRICING = Object.freeze({
  inputPerMillion: 0,
  outputPerMillion: 0,
  cacheReadPerMillion: 0,
  cacheWritePerMillion: 0,
  reasoningPerMillion: 0,
});

const ZERO_BREAKDOWN = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
});

/**
 * Build the pricing record for a Formal AI session.
 *
 * @param {string|null} modelId model id as passed to the tool (alias or `formalai/formal-ai`)
 * @param {Object|null} tokenUsage aggregated token usage, kept so token counts stay reportable
 * @returns {Object} pricing info with a Link.Assistant provider and a $0.00 cost
 */
export const buildFormalAiPricingInfo = (modelId = FORMAL_AI_MODEL_ALIAS, tokenUsage = null) => ({
  modelId: modelId || FORMAL_AI_MODEL_ALIAS,
  modelName: FORMAL_AI_MODEL_ALIAS,
  provider: FORMAL_AI_PROVIDER_NAME,
  // No third-party price applies, so there is no base model to reference.
  originalProvider: null,
  baseModelName: null,
  tokenUsage: tokenUsage || null,
  pricing: { ...ZERO_PRICING },
  breakdown: { ...ZERO_BREAKDOWN },
  totalCostUSD: 0,
  isFreeModel: true,
  isFormalAi: true,
});

/**
 * Normalize a tool result's pricing fields for Formal AI sessions.
 *
 * Tools that report a provider cost of their own (claude's `total_cost_usd`)
 * or that build a static provider record (gemini's "Google", qwen's "Alibaba")
 * would otherwise attribute a Formal AI session to the wrong provider at a
 * non-zero price.
 *
 * @param {Object} params
 * @param {string|null} params.model model requested on the command line
 * @param {Object|null} [params.pricingInfo]
 * @param {number|null} [params.publicPricingEstimate]
 * @param {number|null} [params.anthropicTotalCostUSD]
 * @param {Object|null} [params.tokenUsage] fallback token usage when pricingInfo carries none
 * @returns {{pricingInfo: Object|null, publicPricingEstimate: number|null, anthropicTotalCostUSD: number|null}}
 */
export const applyFormalAiPricingOverride = ({ model, pricingInfo = null, publicPricingEstimate = null, anthropicTotalCostUSD = null, tokenUsage = null }) => {
  if (!lookupServedModelPrice(model)) return { pricingInfo, publicPricingEstimate, anthropicTotalCostUSD };

  const usage = pricingInfo?.tokenUsage || tokenUsage || null;
  // Drop provider-specific cost fields carried by the tool's own record: a
  // Formal AI session was never billed by OpenCode Zen, so a
  // "Calculated by OpenCode Zen" line would be a false positive.
  const { opencodeCost: _opencodeCost, isOpencodeFreeModel: _isOpencodeFreeModel, ...carried } = pricingInfo || {};
  return {
    pricingInfo: { ...carried, ...buildFormalAiPricingInfo(pricingInfo?.modelId || model, usage) },
    publicPricingEstimate: 0,
    // The session never billed Anthropic, so any captured Anthropic cost is a
    // false positive and must not be rendered as a second cost line.
    anthropicTotalCostUSD: null,
  };
};

/**
 * The one place that prices a model served by something other than the tool's
 * own vendor (issue #3279).
 *
 * Every tool used to carry its own "if Formal AI then $0" branch, and Claude
 * Code still reported Anthropic list prices for any other model reached through
 * a non-Anthropic `ANTHROPIC_BASE_URL`. The price belongs to the model that
 * answered, not to the client that asked, so it is keyed by the served model.
 */
export const SERVED_MODEL_PRICES = Object.freeze({
  [FORMAL_AI_MODEL_ALIAS]: Object.freeze({ provider: FORMAL_AI_PROVIDER_NAME, free: true }),
  [FORMAL_AI_PROVIDER_MODEL_ID]: Object.freeze({ provider: FORMAL_AI_PROVIDER_NAME, free: true }),
});

/** Each client's own vendor: the hosts it talks to by default and the models that vendor serves. */
export const TOOL_VENDORS = Object.freeze({
  claude: Object.freeze({ provider: 'Anthropic', hosts: /(^|\.)anthropic\.com$/i, models: /^(anthropic\/)?(claude-|claude$|opus|sonnet|haiku)/i }),
  codex: Object.freeze({ provider: 'OpenAI', hosts: /(^|\.)(openai\.com|chatgpt\.com)$/i, models: /^(openai\/)?(gpt-|o\d|codex|chatgpt)/i }),
});

/**
 * @returns {Object|null} the registry entry for a served model id. Model ids
 * are matched case-insensitively, like every other model id hive accepts
 * (issue #3215).
 */
export const lookupServedModelPrice = modelId => {
  if (typeof modelId !== 'string') return null;
  const key = modelId.trim().toLowerCase();
  return Object.hasOwn(SERVED_MODEL_PRICES, key) ? SERVED_MODEL_PRICES[key] : null;
};

/**
 * The pricing record of a model whose price the registry fixes, or null when
 * the tool's own calculator (models.dev) should price it. Every per-tool
 * calculator asks this first instead of carrying its own Formal AI branch.
 */
export const servedModelPricingInfo = (modelId, tokenUsage = null) => (lookupServedModelPrice(modelId) ? buildFormalAiPricingInfo(modelId, tokenUsage) : null);

/** True when `baseUrl` is unset (the client's default) or points at the tool's own vendor. */
export const isVendorEndpoint = ({ tool, baseUrl } = {}) => {
  const vendor = TOOL_VENDORS[tool];
  if (!vendor || !baseUrl) return true;
  try {
    return vendor.hosts.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
};

/** True when the tool's own vendor serves `modelId`, so the vendor's cost applies. */
export const isVendorModel = ({ tool, modelId } = {}) => {
  const vendor = TOOL_VENDORS[tool];
  return Boolean(vendor && modelId && vendor.models.test(String(modelId)));
};

/** Drop a vendor-computed cost from a result model usage map, keeping the token counts. */
const withoutVendorCost = modelUsage => {
  if (!modelUsage || typeof modelUsage !== 'object') return modelUsage ?? null;
  return Object.fromEntries(
    Object.entries(modelUsage).map(([id, usage]) => {
      if (!usage || typeof usage !== 'object') return [id, usage];
      const { costUSD: _costUSD, ...rest } = usage;
      return [id, rest];
    })
  );
};

const hostOf = baseUrl => {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return null;
  }
};

/**
 * Normalize one tool result's cost by the model that served it (issue #3279).
 *
 *   - a model in {@link SERVED_MODEL_PRICES} gets its registry price (Formal AI:
 *     $0.00, Link.Assistant), whichever client drove it;
 *   - a model that is not the tool's vendor's, reached through a non-vendor
 *     endpoint, loses the vendor-computed cost (Claude Code prices every model
 *     at Anthropic list prices). `publicPricingEstimate` becomes null so the
 *     caller prices the served model itself, and a price nobody knows is shown
 *     as unknown rather than as a false Anthropic number;
 *   - anything else, including a router that serves real `claude-*` models
 *     behind its own URL, keeps the cost it had.
 *
 * @param {Object} params
 * @param {string} params.tool hive tool name (claude, codex, agent, ...)
 * @param {string|null} params.model model requested on the command line
 * @param {string[]} [params.servedModels] model ids the session reported as answering
 * @param {string|null} [params.baseUrl] the endpoint the client was pointed at
 * @param {Object} [params.resultModelUsage] per-model usage; returned without vendor costs when they are dropped
 * @returns {{pricingInfo: Object|null, publicPricingEstimate: number|null, anthropicTotalCostUSD: number|null, costSource: string, resultModelUsage?: Object|null}}
 */
export const applyServedModelPricing = ({ tool, model, servedModels = [], baseUrl = null, pricingInfo = null, publicPricingEstimate = null, anthropicTotalCostUSD = null, tokenUsage = null, resultModelUsage = undefined }) => {
  const served = (servedModels || []).filter(Boolean);
  const usageField = resultModelUsage !== undefined ? { resultModelUsage } : {};

  const registryModel = lookupServedModelPrice(model) ? model : served.length > 0 && served.every(lookupServedModelPrice) ? served[0] : null;
  if (registryModel) {
    return { ...applyFormalAiPricingOverride({ model: registryModel, pricingInfo, publicPricingEstimate, anthropicTotalCostUSD, tokenUsage }), ...usageField, costSource: 'served-model-registry' };
  }

  const candidates = served.length > 0 ? served : [model].filter(Boolean);
  const vendorPriced = isVendorEndpoint({ tool, baseUrl }) || (candidates.length > 0 && candidates.every(modelId => isVendorModel({ tool, modelId })));
  if (vendorPriced) return { pricingInfo, publicPricingEstimate, anthropicTotalCostUSD, ...usageField, costSource: 'tool' };

  const servedName = candidates[0] || null;
  return {
    pricingInfo: { ...(pricingInfo || {}), modelId: pricingInfo?.modelId || servedName, modelName: pricingInfo?.modelName || servedName, provider: hostOf(baseUrl) || pricingInfo?.provider || null, tokenUsage: pricingInfo?.tokenUsage || tokenUsage || null, totalCostUSD: null, costSource: 'served-model' },
    publicPricingEstimate: null,
    anthropicTotalCostUSD: null,
    ...(resultModelUsage !== undefined ? { resultModelUsage: withoutVendorCost(resultModelUsage) } : {}),
    costSource: 'served-model',
  };
};

export { isFormalAiModel };
