#!/usr/bin/env node

/**
 * Issue #1710: Per-model cost calculation extracted from claude.lib.mjs to
 * keep that file under the 1500-line repo cap. Behaviour is unchanged from
 * the previous in-place implementation.
 */
import Decimal from 'decimal.js-light';
import { SERVER_TOOL_PRICING_USD } from './anthropic-server-tool-pricing.lib.mjs';

/**
 * Calculate USD cost for a model's usage with optional detailed breakdown.
 *
 * Cost components (Issue #1600 uses Decimal for precision):
 *   - input        × cost.input        / 1M
 *   - cacheWrite   × cost.cache_write  / 1M
 *   - cacheRead    × cost.cache_read   / 1M
 *   - output       × cost.output       / 1M
 *   - webSearch    × $0.01 / request   (Issue #1710 — see SERVER_TOOL_PRICING_USD)
 *
 * @param {Object} usage - per-model usage entry
 * @param {Object|null} modelInfo - model-info shape (includes `cost` map)
 * @param {boolean} [includeBreakdown=false] - return `{ total, breakdown }` when true
 * @returns {number|{total: number, breakdown: Object}}
 */
export const calculateModelCost = (usage, modelInfo, includeBreakdown = false) => {
  if (!modelInfo || !modelInfo.cost) {
    return includeBreakdown ? { total: 0, breakdown: null } : 0;
  }
  const cost = modelInfo.cost;
  const million = new Decimal(1000000);
  const breakdown = {
    input: { tokens: 0, costPerMillion: 0, cost: 0 },
    cacheWrite: { tokens: 0, costPerMillion: 0, cost: 0 },
    cacheRead: { tokens: 0, costPerMillion: 0, cost: 0 },
    output: { tokens: 0, costPerMillion: 0, cost: 0 },
    // Issue #1710: server-side tool usage (web_search) is billed per-request,
    // independent of token cost. Without this entry the public-pricing total
    // diverges from Anthropic's reported total by exactly the per-request
    // rate times the request count — the residual quoted in issue #1710.
    webSearch: { requests: 0, costPerRequest: 0, cost: 0 },
  };
  if (usage.inputTokens && cost.input) {
    breakdown.input = {
      tokens: usage.inputTokens,
      costPerMillion: cost.input,
      cost: new Decimal(usage.inputTokens).div(million).mul(new Decimal(cost.input)).toNumber(),
    };
  }
  if (usage.cacheCreationTokens && cost.cache_write) {
    breakdown.cacheWrite = {
      tokens: usage.cacheCreationTokens,
      costPerMillion: cost.cache_write,
      cost: new Decimal(usage.cacheCreationTokens).div(million).mul(new Decimal(cost.cache_write)).toNumber(),
    };
  }
  if (usage.cacheReadTokens && cost.cache_read) {
    breakdown.cacheRead = {
      tokens: usage.cacheReadTokens,
      costPerMillion: cost.cache_read,
      cost: new Decimal(usage.cacheReadTokens).div(million).mul(new Decimal(cost.cache_read)).toNumber(),
    };
  }
  if (usage.outputTokens && cost.output) {
    breakdown.output = {
      tokens: usage.outputTokens,
      costPerMillion: cost.output,
      cost: new Decimal(usage.outputTokens).div(million).mul(new Decimal(cost.output)).toNumber(),
    };
  }
  // Issue #1710: bill web_search requests at the documented per-request rate.
  if (usage.webSearchRequests && SERVER_TOOL_PRICING_USD.web_search.costPerRequest > 0) {
    const perReq = SERVER_TOOL_PRICING_USD.web_search.costPerRequest;
    breakdown.webSearch = {
      requests: usage.webSearchRequests,
      costPerRequest: perReq,
      cost: new Decimal(usage.webSearchRequests).mul(new Decimal(perReq)).toNumber(),
    };
  }
  const totalCost = new Decimal(breakdown.input.cost).plus(breakdown.cacheWrite.cost).plus(breakdown.cacheRead.cost).plus(breakdown.output.cost).plus(breakdown.webSearch.cost).toNumber();
  if (includeBreakdown) {
    return {
      total: totalCost,
      breakdown,
    };
  }
  return totalCost;
};
