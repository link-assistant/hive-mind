#!/usr/bin/env node

/**
 * Issue #2119: one auto-restart budget for the whole run.
 *
 * The problem
 * -----------
 * Hive Mind had two independent auto-restart subsystems, each with its own
 * counter reading the same `--auto-restart-max-iterations` flag:
 *
 *   - `solve.watch.lib.mjs` restarts on uncommitted changes / feedback and
 *     labels its sessions `🔄 Auto-restart 1/5`;
 *   - `solve.auto-merge.lib.mjs` restarts until the PR is mergeable and labels
 *     its sessions `🔄 Auto-restart triggered (iteration 1)`.
 *
 * `solve.mjs` runs them one after another, so a limit of 5 allowed up to 10 AI
 * sessions, and the two label formats made the published comments look like two
 * unrelated features. In issue #2119 a `--model formal-ai` run that produced
 * only a `.formal-ai/` scratch directory kept restarting on those "uncommitted
 * changes" without ever reaching a visible failure.
 *
 * The fix
 * -------
 * A single process-wide budget shared by both subsystems:
 *
 *   - every AI session started by ANY auto-restart path consumes one iteration;
 *   - every label renders as `N/M` (or `N` when the limit is disabled with 0),
 *     so the limit is always visible;
 *   - once the budget is exhausted the run must actually fail, and the caller
 *     must run fail recovery (auto-commit of whatever is uncommitted) so the
 *     result stays visible instead of being silently discarded.
 *
 * The counter is a module-level singleton for the same reason
 * `anthropic-cost-accumulator.lib.mjs` is: the two subsystems are separate
 * modules invoked sequentially from `solve.mjs` and never see each other's
 * state, and one `solve` process handles exactly one logical run.
 */

import { DEFAULT_AUTO_ITERATION_LIMIT, formatAutoIterationLimit, hasReachedAutoIterationLimit, normalizeAutoIterationLimit } from './auto-iteration-limits.lib.mjs';

// Iterations consumed so far by every auto-restart subsystem in this run.
let iterationsUsed = 0;
// The active limit; 0 means "no limit" (`--auto-restart-max-iterations 0`).
let maxIterations = DEFAULT_AUTO_ITERATION_LIMIT;

/**
 * Start the shared budget for one `solve` run.
 *
 * Safe to call from every entry point: it is idempotent for the same limit, so
 * the watch loop and the auto-merge loop can both claim the budget without the
 * second one resetting the first one's progress.
 *
 * @param {Object} [options]
 * @param {number|string|null} [options.maxIterations] raw `--auto-restart-max-iterations` value
 * @param {boolean} [options.reset=false] force the counter back to zero (new logical run / tests)
 * @returns {number} the normalized limit in effect
 */
export const beginAutoRestartBudget = ({ maxIterations: rawMax, reset = false } = {}) => {
  const normalized = normalizeAutoIterationLimit(rawMax);
  if (reset || normalized !== maxIterations) {
    if (reset) iterationsUsed = 0;
    maxIterations = normalized;
  }
  return maxIterations;
};

/** @returns {number} the normalized limit in effect (0 = unlimited) */
export const getAutoRestartLimit = () => maxIterations;

/** @returns {number} how many AI sessions auto-restart has already consumed */
export const getAutoRestartIterationsUsed = () => iterationsUsed;

/** @returns {number|null} iterations still available, or null when unlimited */
export const getRemainingAutoRestartIterations = () => (maxIterations === 0 ? null : Math.max(0, maxIterations - iterationsUsed));

/**
 * @returns {boolean} true when no further auto-restart session may be started.
 * Always false when the limit is disabled (0).
 */
export const hasExhaustedAutoRestartBudget = () => hasReachedAutoIterationLimit(iterationsUsed, maxIterations);

/**
 * Claim one iteration for an AI session that is about to start.
 * Call this only when a tool execution really follows, so the published `N/M`
 * label matches the number of sessions that actually ran.
 * @returns {number} the 1-based iteration number just claimed
 */
export const consumeAutoRestartIteration = () => {
  iterationsUsed += 1;
  return iterationsUsed;
};

/**
 * Render the shared `N/M` progress label used by every auto-restart message.
 * @param {number} [iteration] the iteration to render; defaults to the current count
 * @returns {string} e.g. `3/5`, or `3` when the limit is disabled
 */
export const formatAutoRestartLabel = (iteration = iterationsUsed) => (maxIterations === 0 ? `${iteration}` : `${iteration}/${maxIterations}`);

/** @returns {string} the configured limit for display (`5` or `unlimited`) */
export const formatAutoRestartLimit = () => formatAutoIterationLimit(maxIterations);

/** Reset the budget. Intended for tests; production code calls `beginAutoRestartBudget`. */
export const resetAutoRestartBudget = () => {
  iterationsUsed = 0;
  maxIterations = DEFAULT_AUTO_ITERATION_LIMIT;
};
