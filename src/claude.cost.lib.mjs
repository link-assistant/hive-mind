#!/usr/bin/env node

/**
 * Issue #1710: Per-model cost calculation extracted from claude.lib.mjs to
 * keep that file under the 1500-line repo cap. Behaviour is unchanged from
 * the previous in-place implementation.
 */
import Decimal from 'decimal.js-light';
import { SERVER_TOOL_PRICING_USD } from './anthropic-server-tool-pricing.lib.mjs';

const getCacheWrite5mPrice = cost => cost.cache_write_5m ?? cost.cache_write ?? 0;

const getCacheWrite1hPrice = (cost, cacheWrite5mPrice) => {
  if (cost.cache_write_1h !== undefined && cost.cache_write_1h !== null) return cost.cache_write_1h;
  if (cost.input) return new Decimal(cost.input).mul(2).toNumber();
  if (cacheWrite5mPrice) return new Decimal(cacheWrite5mPrice).mul(1.6).toNumber();
  return 0;
};

/**
 * Calculate USD cost for a model's usage with optional detailed breakdown.
 *
 * Cost components (Issue #1600 uses Decimal for precision):
 *   - input        × cost.input        / 1M
 *   - cacheWrite5m × cost.cache_write  / 1M
 *   - cacheWrite1h × (cost.cache_write_1h || cost.input × 2) / 1M
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
    cacheWrite5m: { tokens: 0, costPerMillion: 0, cost: 0 },
    cacheWrite1h: { tokens: 0, costPerMillion: 0, cost: 0 },
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
  const explicitCacheWrite5mTokens = usage.cacheCreation5mTokens || 0;
  const explicitCacheWrite1hTokens = usage.cacheCreation1hTokens || 0;
  const explicitCacheWriteTokens = explicitCacheWrite5mTokens + explicitCacheWrite1hTokens;
  const cacheWriteTokens = Math.max(usage.cacheCreationTokens || 0, explicitCacheWriteTokens);
  const hasCacheWriteTtlSplit = explicitCacheWriteTokens > 0;
  const unsplitCacheWriteTokens = hasCacheWriteTtlSplit ? Math.max(0, cacheWriteTokens - explicitCacheWriteTokens) : cacheWriteTokens;
  const cacheWrite5mTokens = hasCacheWriteTtlSplit ? explicitCacheWrite5mTokens + unsplitCacheWriteTokens : cacheWriteTokens;
  const cacheWrite1hTokens = hasCacheWriteTtlSplit ? explicitCacheWrite1hTokens : 0;
  const cacheWrite5mPrice = getCacheWrite5mPrice(cost);
  const cacheWrite1hPrice = getCacheWrite1hPrice(cost, cacheWrite5mPrice);
  if (cacheWriteTokens && (cacheWrite5mPrice || cacheWrite1hPrice)) {
    const cacheWrite5mCost = new Decimal(cacheWrite5mTokens).div(million).mul(new Decimal(cacheWrite5mPrice)).toNumber();
    const cacheWrite1hCost = new Decimal(cacheWrite1hTokens).div(million).mul(new Decimal(cacheWrite1hPrice)).toNumber();
    const cacheWriteCost = new Decimal(cacheWrite5mCost).plus(new Decimal(cacheWrite1hCost)).toNumber();
    breakdown.cacheWrite = {
      tokens: cacheWriteTokens,
      costPerMillion: hasCacheWriteTtlSplit ? new Decimal(cacheWriteCost).div(new Decimal(cacheWriteTokens)).mul(million).toNumber() : cacheWrite5mPrice,
      cost: cacheWriteCost,
      hasExplicitTtlSplit: hasCacheWriteTtlSplit,
    };
    breakdown.cacheWrite5m = {
      tokens: cacheWrite5mTokens,
      costPerMillion: cacheWrite5mPrice,
      cost: cacheWrite5mCost,
    };
    breakdown.cacheWrite1h = {
      tokens: cacheWrite1hTokens,
      costPerMillion: cacheWrite1hPrice,
      cost: cacheWrite1hCost,
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
