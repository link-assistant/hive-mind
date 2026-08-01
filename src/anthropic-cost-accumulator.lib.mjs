#!/usr/bin/env node

/**
 * Issue #1886: Cumulative Anthropic cost across resume iterations.
 *
 * Background
 * ----------
 * The "Token Usage Summary" compares two numbers:
 *   - "Public pricing estimate" — computed locally from the session JSONL by
 *     `calculateSessionTokens`. The JSONL accumulates the *entire* logical
 *     session: when a run hits a usage limit and is resumed (either in-process
 *     via the auto-merge loop, or cross-process via
 *     `autoContinueWhenLimitResets` spawning a fresh `solve` with `--resume`),
 *     Claude Code appends to the *same* `<session-id>.jsonl`, so every run's
 *     tokens are present.
 *   - "Calculated by Anthropic" — taken from the `result` event's
 *     `total_cost_usd`. That figure is scoped to a *single* Claude process: it
 *     only covers the tokens that process produced, NOT the tokens inherited
 *     from a previous run that was interrupted by a limit reset.
 *
 * The result is a scope mismatch, not a pricing bug. In issue #1886 the public
 * estimate ($36.085016, full session) was compared against Anthropic's
 * per-process figure ($24.662220, the resumed run only), yielding a misleading
 * "-31.66%" difference even though both numbers are individually correct.
 *
 * The fix
 * -------
 * Accumulate Anthropic's reported cost across resume iterations so the figure
 * shown next to the full-session public estimate covers the same scope. This
 * module is the single source of truth for that running total:
 *
 *   - Each `executeClaude` call starts a scope. Fresh sessions reset it; true
 *     resumes retain it or seed it from `--previous-anthropic-cost` when the
 *     resume crosses a process boundary.
 *   - Every finished Claude process in that logical session adds its own
 *     `total_cost_usd` via `addAnthropicRunCost`.
 *   - The display and the cross-process spawn both read the cumulative total,
 *     so "Calculated by Anthropic" tracks the full session.
 *
 * The accumulation is model-agnostic: it sums dollar figures and never inspects
 * per-token prices, so it is correct for Fable 5, Opus, Sonnet, Haiku, and any
 * future model. See docs/case-studies/issue-1886/ for the full analysis.
 */

import { isFormalAiModel } from './models/index.mjs'; // Issue #2119

// Module-level singleton: the cumulative Anthropic cost for the active logical
// session (including anything seeded by a true resume from a prior process).
let cumulativeAnthropicCostUSD = 0;
// Seeding must happen exactly once per active scope. Resume retries may call the
// seed helper repeatedly; re-seeding from the same CLI flag would wipe out the
// costs already accumulated in this process.
let seeded = false;

/**
 * Coerce an arbitrary value to a non-negative finite USD amount.
 * @param {*} value
 * @returns {number} the sanitized amount, or 0 when not a positive finite number
 */
const toCostAmount = value => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Start accounting for one logical Claude session.
 *
 * A fresh execution owns a new transcript and therefore a new cost scope. A
 * true `--resume` execution continues the active scope (or restores it from
 * `--previous-anthropic-cost` when the resume happens in a child process).
 * Calling this at the public `executeClaude` boundary keeps retries inside one
 * scope while preventing watch-mode and mergeability auto-restarts from
 * inheriting the preceding working session's cost.
 *
 * @param {Object} [options]
 * @param {boolean|string} [options.resume=false] - whether this execution resumes an existing Claude session
 * @param {number|string|null} [options.previousAnthropicCost=0] - cumulative cost restored by a resumed child process
 * @returns {number} the cumulative cost at the start of this execution
 */
export const beginAnthropicCostScope = ({ resume = false, previousAnthropicCost = 0 } = {}) => {
  if (!resume) {
    cumulativeAnthropicCostUSD = 0;
    seeded = true;
    return cumulativeAnthropicCostUSD;
  }
  return seedCumulativeAnthropicCost(previousAnthropicCost);
};

/**
 * Seed the accumulator from the carried-forward previous-run cost, exactly once
 * per active scope. Subsequent calls are no-ops so resume retries do not reset
 * the running total.
 * @param {number|string|null|undefined} previousAnthropicCostUSD
 * @returns {number} the cumulative total after seeding
 */
export const seedCumulativeAnthropicCost = previousAnthropicCostUSD => {
  if (seeded) return cumulativeAnthropicCostUSD;
  cumulativeAnthropicCostUSD = toCostAmount(previousAnthropicCostUSD);
  seeded = true;
  return cumulativeAnthropicCostUSD;
};

/**
 * Add a single Claude process's reported cost to the running total.
 * Non-positive / non-finite inputs (e.g. a null cost when a run was interrupted
 * by a limit before emitting a success result) contribute nothing.
 * @param {number|string|null|undefined} runCostUSD
 * @returns {number} the cumulative total after adding
 */
export const addAnthropicRunCost = runCostUSD => {
  cumulativeAnthropicCostUSD += toCostAmount(runCostUSD);
  return cumulativeAnthropicCostUSD;
};

/**
 * @returns {number} the cumulative Anthropic cost for the current logical session
 */
export const getCumulativeAnthropicCost = () => cumulativeAnthropicCostUSD;

/**
 * @returns {boolean} true once a positive cost has been seeded or accumulated
 */
export const hasCumulativeAnthropicCost = () => cumulativeAnthropicCostUSD > 0;

/**
 * Interpret a Claude `result` event's `total_cost_usd`.
 *
 * Issue #1886: a non-success terminal event (e.g. a usage-limit hit) still
 * reports this process's cost, so it is kept as an accumulation fallback rather
 * than as the authoritative total.
 *
 * Issue #2119: `--model formal-ai` is served by the local Link.Assistant model
 * server, so the session never billed Anthropic. Claude Code nevertheless
 * reports a `total_cost_usd` derived from Anthropic list prices for the model
 * name it sees ($0.252315 in the issue) - a false positive that must not reach
 * the accumulator or the published cost comment.
 *
 * @param {Object} params
 * @param {Object} params.data the parsed `result` stream event
 * @param {string|null} params.model the model requested on the command line
 * @param {Function} params.log logger
 * @returns {Promise<{total?: number, fallback?: number}|null>} the captured cost, or null when none applies
 */
export const captureAnthropicResultCost = async ({ data, model, log }) => {
  const cost = data?.total_cost_usd;
  if (cost === undefined || cost === null) return null;
  if (isFormalAiModel(model)) {
    await log(`💰 Ignoring Anthropic cost $${cost.toFixed(6)} reported for a Formal AI session (Link.Assistant, free)`, { verbose: true });
    return null;
  }
  if (data.subtype === 'success') {
    await log(`💰 Anthropic official cost captured from success result: $${cost.toFixed(6)}`, { verbose: true });
    return { total: cost };
  }
  await log(`💰 Anthropic cost from ${data.subtype || 'unknown'} result kept as fallback for accumulation: $${cost.toFixed(6)}`, { verbose: true });
  return { fallback: cost };
};

/**
 * Reset the accumulator. Intended for tests; production code starts scopes via
 * `beginAnthropicCostScope`.
 */
export const resetCumulativeAnthropicCost = () => {
  cumulativeAnthropicCostUSD = 0;
  seeded = false;
};
