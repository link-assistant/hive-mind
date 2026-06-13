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
 *   - Each `solve` process seeds the accumulator once from
 *     `--previous-anthropic-cost` (0 for the first run; the carried-forward
 *     total for an auto-resumed run).
 *   - Every finished Claude process adds its own `total_cost_usd` via
 *     `addAnthropicRunCost`, which also covers the in-process auto-merge loop
 *     (each iteration is a separate Claude process in the same node process).
 *   - The display and the cross-process spawn both read the cumulative total,
 *     so "Calculated by Anthropic" tracks the full session.
 *
 * The accumulation is model-agnostic: it sums dollar figures and never inspects
 * per-token prices, so it is correct for Fable 5, Opus, Sonnet, Haiku, and any
 * future model. See docs/case-studies/issue-1886/ for the full analysis.
 */

// Module-level singleton: the cumulative Anthropic cost for the current logical
// session (this node process plus everything seeded from prior processes).
let cumulativeAnthropicCostUSD = 0;
// Seeding must happen exactly once per node process. The auto-merge loop calls
// runClaude (and therefore the seed helper) repeatedly within a single process;
// re-seeding from the same CLI flag each time would wipe out accumulation.
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
 * Seed the accumulator from the carried-forward previous-run cost, exactly once
 * per node process. Subsequent calls are no-ops so the in-process auto-merge
 * loop does not reset the running total.
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
 * Reset the accumulator. Intended for tests — production code seeds once and
 * accumulates for the lifetime of the process.
 */
export const resetCumulativeAnthropicCost = () => {
  cumulativeAnthropicCostUSD = 0;
  seeded = false;
};
