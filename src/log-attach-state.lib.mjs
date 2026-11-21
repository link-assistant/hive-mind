#!/usr/bin/env node

/**
 * Issue #2563: what the attached session logs already cover.
 *
 * In link-foundation/command-stream#206 the solution draft log was attached at
 * the end of the AI session. The auto-merge loop then only waited for CI and
 * held the merge back, and the same log was uploaded a second time with no new
 * AI work in it. That second comment also lost the cost estimation and the
 * context and tokens usage, because the re-upload did not receive the usage
 * data the first upload had.
 *
 * Two facts are tracked for the whole process, so every upload path agrees:
 *   - how many AI sessions finished (`classifySessionResult` runs after each
 *     one, for every tool) and how many had finished at the latest successful
 *     log upload: a log is new only when AI work finished after that upload;
 *   - the latest usage data (cost estimation, context and tokens usage, models
 *     used), so an upload that does not carry it still renders the unified
 *     solution draft log format.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2563
 */

/** Fields of `attachLogToGitHub` that one AI session reports: cost estimation, context and tokens usage. */
export const SESSION_USAGE_FIELDS = ['publicPricingEstimate', 'pricingInfo', 'anthropicTotalCostUSD', 'resultModelUsage', 'budgetStatsData'];
/** Fields that describe the whole run, for the models used section (tool, requested model, thinking level). */
export const RUN_FIELDS = ['argv', 'requestedModel', 'tool'];

const pick = (source, fields) => Object.fromEntries(fields.filter(field => source?.[field] !== null && source?.[field] !== undefined).map(field => [field, source[field]]));
const pickUsage = source => pick(source, [...SESSION_USAGE_FIELDS, ...RUN_FIELDS]);

/** An AI session finished: its log is not attached yet, and its usage replaces the previous session's. */
export const recordAiSessionFinished = (toolResult = null, globalState = global) => {
  globalState.aiSessionsFinished = (globalState.aiSessionsFinished || 0) + 1;
  globalState.latestLogUsage = { ...pick(globalState.latestLogUsage, RUN_FIELDS), ...pick(toolResult, SESSION_USAGE_FIELDS) };
};

/** Remember the usage data an upload carried, for later uploads that carry none. */
export const rememberLogUsage = (options, globalState = global) => {
  globalState.latestLogUsage = { ...globalState.latestLogUsage, ...pickUsage(options) };
};

/** Upload options with the missing usage fields taken from the latest known usage. */
export const withLatestLogUsage = (options, globalState = global) => ({ ...options, ...pickUsage({ ...globalState.latestLogUsage, ...pickUsage(options) }) });

/** A log was attached: it covers every AI session finished so far. */
export const recordLogAttached = (globalState = global) => {
  globalState.aiSessionsAtLatestLogAttach = globalState.aiSessionsFinished || 0;
};

/** Whether the latest attached log already covers every finished AI session. */
export const isLatestAiWorkAttached = (globalState = global) => globalState.logAttachedToGitHub === true && globalState.latestLogAttachFailed !== true && (globalState.aiSessionsFinished || 0) <= (globalState.aiSessionsAtLatestLogAttach ?? 0);
