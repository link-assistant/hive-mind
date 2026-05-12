#!/usr/bin/env node

/**
 * Issue #1710: Anthropic server-side tool pricing.
 *
 * `calculateModelCost` historically only billed token-based usage (input,
 * cache_creation, cache_read, output). When a sub-agent uses Anthropic's
 * server-side web_search tool, the result event reports `webSearchRequests`,
 * which Anthropic bills at $10 / 1 000 searches ($0.01 / request) per
 * <https://platform.claude.com/docs/en/about-claude/pricing#web-search-tool>.
 *
 * Without billing it locally, the public-pricing estimate disagreed with
 * Anthropic's reported `total_cost_usd` by exactly that amount — the
 * "Difference: $0.040000 (+0.16%)" line that issue #1710 quotes.
 *
 * Centralising the constants in this module keeps the source-of-truth in one
 * file: bumping a price is a one-line edit, and `calculateModelCost` /
 * `dumpBudgetTrace` both read from the same map.
 */
export const SERVER_TOOL_PRICING_USD = Object.freeze({
  // $10 per 1 000 searches = $0.01 per request.
  // https://platform.claude.com/docs/en/about-claude/pricing#web-search-tool
  web_search: { costPerRequest: 0.01, source: 'https://platform.claude.com/docs/en/about-claude/pricing#web-search-tool' },
  // web_fetch is currently free for paying customers; kept here for
  // completeness and so a future price change is a one-line edit.
  web_fetch: { costPerRequest: 0, source: 'https://platform.claude.com/docs/en/about-claude/pricing#web-fetch-tool' },
});

/**
 * Returns the per-request USD price for a server-side tool, or 0 if unknown.
 * @param {string} tool - canonical tool name (e.g. "web_search")
 * @returns {number} per-request price in USD
 */
export const getServerToolPrice = tool => SERVER_TOOL_PRICING_USD[tool]?.costPerRequest || 0;
