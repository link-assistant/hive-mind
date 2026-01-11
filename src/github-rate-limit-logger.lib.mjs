#!/usr/bin/env node
/**
 * GitHub Rate Limit Logger Library
 *
 * Provides utilities to log GitHub API rate limit usage during solve command execution.
 * This helps identify expensive operations that consume the most API limits.
 *
 * Usage:
 * - Call logGitHubRateLimits() at key points during solve execution
 * - Rate limits are logged with context (operation name)
 * - Delta tracking shows how many API calls were made between checkpoints
 *
 * @module github-rate-limit-logger.lib
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Track the last known rate limit for delta calculations
let lastRateLimit = null;

// Global flag to enable/disable rate limit logging (disabled by default)
let rateLimitLoggingEnabled = false;

/**
 * Enable or disable rate limit logging globally
 * @param {boolean} enabled - Whether rate limit logging should be enabled
 */
export function setRateLimitLoggingEnabled(enabled) {
  rateLimitLoggingEnabled = enabled;
}

/**
 * Check if rate limit logging is enabled
 * @returns {boolean} Whether rate limit logging is currently enabled
 */
export function isRateLimitLoggingEnabled() {
  return rateLimitLoggingEnabled;
}

/**
 * Reset the last rate limit tracking (useful for fresh sessions)
 */
export function resetRateLimitTracking() {
  lastRateLimit = null;
}

/**
 * Get current GitHub API core rate limit info
 * This is a lightweight call designed for frequent use during solve execution
 *
 * @returns {Promise<Object|null>} Rate limit info or null on error
 */
export async function getGitHubCoreRateLimit() {
  try {
    // Use jq to extract only core rate limit - more efficient than parsing full response
    const { stdout } = await execAsync("gh api rate_limit --jq '.resources.core | {limit, used, remaining, reset}' 2>/dev/null");
    const data = JSON.parse(stdout);

    // Calculate reset time
    const resetDate = new Date(data.reset * 1000);
    const now = new Date();
    const diffMs = resetDate - now;

    let relativeReset = null;
    if (diffMs > 0) {
      const totalMinutes = Math.floor(diffMs / (1000 * 60));
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours > 0) {
        relativeReset = `${hours}h ${minutes}m`;
      } else {
        relativeReset = `${minutes}m`;
      }
    }

    return {
      limit: data.limit,
      used: data.used,
      remaining: data.remaining,
      reset: data.reset,
      resetDate,
      relativeReset,
    };
  } catch (error) {
    // Silently fail - rate limit logging is non-critical
    if (global.verboseMode) {
      console.error('[VERBOSE] Failed to get GitHub rate limit:', error.message);
    }
    return null;
  }
}

/**
 * Format rate limit info for logging
 *
 * @param {Object} rateLimit - Rate limit object from getGitHubCoreRateLimit
 * @param {Object|null} previous - Previous rate limit for delta calculation
 * @returns {string} Formatted rate limit string
 */
function formatRateLimit(rateLimit, previous = null) {
  const usedPercent = Math.round((rateLimit.used / rateLimit.limit) * 100);

  let message = `GitHub API: ${rateLimit.used}/${rateLimit.limit} used (${usedPercent}%)`;

  // Add delta if we have previous data
  if (previous && previous.used !== undefined) {
    const delta = rateLimit.used - previous.used;
    if (delta > 0) {
      message += ` [+${delta} since last check]`;
    } else if (delta === 0) {
      message += ` [no change]`;
    }
    // Negative delta means limit reset happened
  }

  // Add reset time
  if (rateLimit.relativeReset) {
    message += ` (resets in ${rateLimit.relativeReset})`;
  }

  return message;
}

/**
 * Log current GitHub API rate limit with context
 * This is the main function to call during solve execution
 *
 * @param {Object} options - Logging options
 * @param {string} options.context - Description of current operation (e.g., "after repository clone")
 * @param {Function} options.log - Logging function (typically from lib.mjs)
 * @param {boolean} [options.verbose=false] - Whether to include verbose details
 * @param {boolean} [options.showDelta=true] - Whether to show change from last check
 * @returns {Promise<Object|null>} The rate limit info or null if logging is disabled/failed
 */
export async function logGitHubRateLimits(options) {
  const { context, log, verbose = false, showDelta = true } = options;

  // Skip if logging is disabled
  if (!rateLimitLoggingEnabled) {
    return null;
  }

  // Get current rate limit
  const rateLimit = await getGitHubCoreRateLimit();
  if (!rateLimit) {
    if (verbose) {
      await log(`📊 GitHub rate limit check failed (${context})`, { verbose: true });
    }
    return null;
  }

  // Format and log the rate limit
  const previousLimit = showDelta ? lastRateLimit : null;
  const message = formatRateLimit(rateLimit, previousLimit);

  await log(`📊 ${message} [${context}]`);

  // Update last rate limit for future delta calculations
  lastRateLimit = { ...rateLimit };

  return rateLimit;
}

/**
 * Log rate limit summary at the end of a solve session
 * Shows total API calls made during the session
 *
 * @param {Object} options - Logging options
 * @param {Object} options.startLimit - Rate limit at the start of session
 * @param {Function} options.log - Logging function
 * @returns {Promise<void>}
 */
export async function logRateLimitSummary(options) {
  const { startLimit, log } = options;

  // Skip if logging is disabled
  if (!rateLimitLoggingEnabled) {
    return;
  }

  // Get final rate limit
  const endLimit = await getGitHubCoreRateLimit();
  if (!endLimit) {
    return;
  }

  // Calculate total API calls made during session
  let totalApiCalls = 0;
  if (startLimit && startLimit.used !== undefined) {
    // Handle case where limit may have reset during session
    if (endLimit.reset === startLimit.reset) {
      // Same period, simple delta
      totalApiCalls = endLimit.used - startLimit.used;
    } else {
      // Limit reset during session, approximate based on end usage
      totalApiCalls = endLimit.used;
    }
  }

  await log('');
  await log('📊 GitHub API Rate Limit Summary:');
  await log(`   Total API calls this session: ${totalApiCalls >= 0 ? totalApiCalls : 'unknown (limit reset during session)'}`);
  await log(`   Final usage: ${endLimit.used}/${endLimit.limit} (${Math.round((endLimit.used / endLimit.limit) * 100)}%)`);
  await log(`   Remaining: ${endLimit.remaining} requests`);
  if (endLimit.relativeReset) {
    await log(`   Resets in: ${endLimit.relativeReset}`);
  }
}

/**
 * Create a rate limit checkpoint for tracking
 * Call at the start of a session to enable summary at the end
 *
 * @returns {Promise<Object|null>} The rate limit checkpoint or null if failed
 */
export async function createRateLimitCheckpoint() {
  if (!rateLimitLoggingEnabled) {
    return null;
  }
  return await getGitHubCoreRateLimit();
}

export default {
  setRateLimitLoggingEnabled,
  isRateLimitLoggingEnabled,
  resetRateLimitTracking,
  getGitHubCoreRateLimit,
  logGitHubRateLimits,
  logRateLimitSummary,
  createRateLimitCheckpoint,
};
