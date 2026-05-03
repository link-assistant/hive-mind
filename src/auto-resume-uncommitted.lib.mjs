#!/usr/bin/env node

/**
 * Auto-resume on uncommitted changes — decision helpers.
 *
 * Issue #1056: when uncommitted changes are detected and the user has
 * enabled `--auto-resume-on-uncommitted-changes`, we want to call the
 * agent again with `--resume <sessionId>` (preserving context) instead
 * of starting a fresh session — but only when the previous session has
 * not already filled most of its context window. The threshold defaults
 * to 50% of the model's context limit and is configurable via
 * `--auto-resume-on-uncommitted-changes-maximum-context-window-usage`.
 *
 * This module is intentionally tool-agnostic. It does not perform the
 * resume itself — it just decides whether resuming is viable and
 * computes the percentage that the caller can log.
 */

export const DEFAULT_MAX_CONTEXT_USAGE_PERCENT = 50;

/**
 * Read the configured max-context-usage threshold (in percent) from argv.
 *
 * Accepts both the camelCase form populated by yargs
 * (`autoResumeOnUncommittedChangesMaximumContextWindowUsage`) and the
 * dash-cased flag itself, so that programmatic callers and CLI users
 * see the same default.
 *
 * @param {Object} argv - parsed CLI arguments
 * @returns {number} threshold in [0, 100]
 */
export const getAutoResumeMaxContextUsage = (argv = {}) => {
  const candidates = [argv.autoResumeOnUncommittedChangesMaximumContextWindowUsage, argv['auto-resume-on-uncommitted-changes-maximum-context-window-usage']];
  for (const value of candidates) {
    if (value === undefined || value === null || value === '') continue;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed));
  }
  return DEFAULT_MAX_CONTEXT_USAGE_PERCENT;
};

/**
 * Whether `--auto-resume-on-uncommitted-changes` is enabled.
 * @param {Object} argv
 * @returns {boolean}
 */
export const isAutoResumeOnUncommittedChangesEnabled = (argv = {}) => {
  return argv.autoResumeOnUncommittedChanges === true || argv['auto-resume-on-uncommitted-changes'] === true;
};

/**
 * Pick the largest peak-context-input across all models in a token-usage map
 * that has a known model context limit, and return both the peak and the
 * matching limit. We use the worst (highest-utilisation) model so that
 * resuming with multi-model sessions does not silently exceed the threshold
 * for the model that has the smallest remaining headroom.
 *
 * @param {Object|null} tokenUsage - shape returned by calculateSessionTokens
 * @returns {{peak: number, limit: number}|null} null when no model with a known limit was found
 */
export const pickWorstContextUtilisation = tokenUsage => {
  if (!tokenUsage || !tokenUsage.modelUsage) return null;
  let worst = null;
  for (const usage of Object.values(tokenUsage.modelUsage)) {
    const limit = usage?.modelInfo?.limit?.context;
    if (!limit || limit <= 0) continue;
    const peak = usage.peakContextUsage || 0;
    const ratio = peak / limit;
    if (!worst || ratio > worst.ratio) worst = { peak, limit, ratio };
  }
  return worst;
};

/**
 * Decide whether resuming is viable given a session ID and the previous
 * session's token-usage data. Returns a structured result that the caller
 * can log and act on.
 *
 * The decision tree is:
 *   - no auto-resume flag → 'disabled'
 *   - flag set, no session ID known → 'no_session_id'
 *   - flag set, session id known, no usable context-stat data → 'no_context_data'
 *     (we still return resume=true because the user explicitly opted in;
 *      they can lower the threshold or rely on calculateSessionTokens fixes)
 *   - flag set, peak >= threshold → 'context_too_full'
 *   - flag set, peak <  threshold → 'ok'
 *
 * @param {Object} params
 * @param {Object} params.argv - parsed CLI arguments
 * @param {string|null} params.sessionId - the session ID to resume, if any
 * @param {Object|null} params.tokenUsage - result of calculateSessionTokens (may be null)
 * @returns {{resume: boolean, reason: string, threshold: number, usedPercent: number|null, peak: number|null, limit: number|null}}
 */
export const decideAutoResumeOnUncommittedChanges = ({ argv = {}, sessionId = null, tokenUsage = null } = {}) => {
  const threshold = getAutoResumeMaxContextUsage(argv);
  if (!isAutoResumeOnUncommittedChangesEnabled(argv)) {
    return { resume: false, reason: 'disabled', threshold, usedPercent: null, peak: null, limit: null };
  }
  if (!sessionId) {
    return { resume: false, reason: 'no_session_id', threshold, usedPercent: null, peak: null, limit: null };
  }
  const worst = pickWorstContextUtilisation(tokenUsage);
  if (!worst) {
    // Honour the flag even when context stats are unavailable — the user
    // explicitly asked for resume; falling back to restart silently here
    // would defeat the purpose of the flag on early sessions where JSONL
    // hasn't yet been parsed. We surface 'no_context_data' so callers can
    // log a warning.
    return { resume: true, reason: 'no_context_data', threshold, usedPercent: null, peak: null, limit: null };
  }
  const usedPercent = (worst.peak / worst.limit) * 100;
  if (usedPercent >= threshold) {
    return {
      resume: false,
      reason: 'context_too_full',
      threshold,
      usedPercent,
      peak: worst.peak,
      limit: worst.limit,
    };
  }
  return {
    resume: true,
    reason: 'ok',
    threshold,
    usedPercent,
    peak: worst.peak,
    limit: worst.limit,
  };
};

export default {
  DEFAULT_MAX_CONTEXT_USAGE_PERCENT,
  getAutoResumeMaxContextUsage,
  isAutoResumeOnUncommittedChangesEnabled,
  pickWorstContextUtilisation,
  decideAutoResumeOnUncommittedChanges,
};
