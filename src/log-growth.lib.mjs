#!/usr/bin/env node

/**
 * Notice a session log that is running away (issue #2135).
 *
 * The log captured for that issue reached 286 MB / 1,354,845 lines because a
 * single `gh pr diff` answer was mirrored to stdout, copied into the session
 * log by the stdio interceptor, committed as the development log, and so
 * included in the *next* run's diff - each round bigger than the last. Nothing
 * said a word about it until the solve process died on the V8 heap limit.
 *
 * This module keeps a running count of the bytes written to the log and hands
 * back a warning the first time the total crosses each threshold, so the log
 * itself carries the evidence of its own growth.
 *
 * @module log-growth
 */

const MEGABYTE = 1024 * 1024;

/**
 * Sizes a session log has no business reaching.
 *
 * A busy solve session writes single-digit megabytes; the captured runaway
 * session was two orders of magnitude past that. Warning three times (rather
 * than once) keeps the trail readable: the distance between the warnings says
 * how fast the log is growing.
 */
export const LOG_GROWTH_THRESHOLDS = [64 * MEGABYTE, 256 * MEGABYTE, 1024 * MEGABYTE];

const formatBytes = bytes => {
  if (bytes >= 1024 * MEGABYTE) return `${(bytes / (1024 * MEGABYTE)).toFixed(1)} GB`;
  if (bytes >= MEGABYTE) return `${(bytes / MEGABYTE).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
};

/**
 * Create an independent growth tracker.
 *
 * @param {object} [params]
 * @param {number[]} [params.thresholds] - ascending byte counts to warn at.
 * @returns {{record: (bytes: number) => string|null, reset: () => void, total: () => number}}
 *   `record` returns a warning message the first time the running total reaches
 *   the next threshold, and null otherwise.
 */
export const createLogGrowthTracker = ({ thresholds = LOG_GROWTH_THRESHOLDS } = {}) => {
  let total = 0;
  let nextIndex = 0;

  return {
    record(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return null;
      total += bytes;
      if (nextIndex >= thresholds.length || total < thresholds[nextIndex]) return null;

      // Skip past every threshold this write blew through, so a single huge
      // append produces one warning naming the size actually reached.
      while (nextIndex < thresholds.length && total >= thresholds[nextIndex]) nextIndex += 1;

      return `⚠️  Session log has grown to ${formatBytes(total)}. Something is writing very large output into it - mirrored command output (for example a "gh pr diff" of a branch that has logs committed to it) is the usual cause. See docs/case-studies/issue-2135.`;
    },
    reset() {
      total = 0;
      nextIndex = 0;
    },
    total() {
      return total;
    },
  };
};

const defaultTracker = createLogGrowthTracker();

/**
 * Count bytes written to the current session log.
 *
 * @param {number} bytes
 * @returns {string|null} A warning to emit once, or null.
 */
export const recordLogBytes = bytes => defaultTracker.record(bytes);

/**
 * Start counting again - called when a new log file is set.
 */
export const resetLogGrowth = () => defaultTracker.reset();

/**
 * Bytes written to the current session log so far.
 *
 * @returns {number}
 */
export const getLoggedBytes = () => defaultTracker.total();

export default { createLogGrowthTracker, recordLogBytes, resetLogGrowth, getLoggedBytes, LOG_GROWTH_THRESHOLDS };
