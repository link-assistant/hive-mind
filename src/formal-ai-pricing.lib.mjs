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

import { FORMAL_AI_MODEL_ALIAS, isFormalAiModel } from './models/index.mjs';

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
 * Wrap a `(modelId, tokenUsage) => pricingInfo` calculator so Formal AI model
 * ids short-circuit to the free Link.Assistant record instead of being priced
 * against models.dev.
 *
 * @param {Function} calculatePricing the tool's own pricing calculator
 * @returns {Function} wrapped calculator with the same signature
 */
export const withFormalAiPricing =
  calculatePricing =>
  async (modelId, tokenUsage, ...rest) => {
    if (isFormalAiModel(modelId)) return buildFormalAiPricingInfo(modelId, tokenUsage);
    return calculatePricing(modelId, tokenUsage, ...rest);
  };

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
  if (!isFormalAiModel(model)) return { pricingInfo, publicPricingEstimate, anthropicTotalCostUSD };

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

export { isFormalAiModel };
