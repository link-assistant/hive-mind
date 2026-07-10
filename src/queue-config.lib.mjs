#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

/**
 * Queue Configuration Module
 *
 * Centralized configuration for queue throttling and resource thresholds.
 * This module is used by both telegram-solve-queue.lib.mjs (queue logic)
 * and limits.lib.mjs (display formatting).
 *
 * Supports three handling strategies per threshold:
 * - 'reject': Immediately reject the command, no queueing
 * - 'enqueue': Block and wait in queue until metric drops below threshold
 * - 'dequeue-one-at-a-time': Allow exactly one command, block subsequent
 *
 * Configuration can be provided via:
 * 1. HIVE_MIND_QUEUE_CONFIG environment variable (links notation format)
 * 2. Individual environment variables (e.g., HIVE_MIND_DISK_THRESHOLD)
 * 3. Built-in defaults
 *
 * Priority: HIVE_MIND_QUEUE_CONFIG > individual env vars > defaults
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1242
 * @see https://github.com/link-assistant/hive-mind/issues/1253
 * @see https://github.com/link-assistant/hive-mind/issues/1981
 */

// Use use-m to dynamically import modules
if (typeof globalThis.use === 'undefined') {
  try {
    await ensureUseM();
  } catch (error) {
    console.error('❌ Fatal error: Failed to load dependencies for queue configuration');
    console.error(`   ${error.message}`);
    console.error('   This might be due to network issues or missing dependencies.');
    console.error('   Please check your internet connection and try again.');
    process.exit(1);
  }
}

// Issue #1710 / #1712: use-m occasionally hands back a truncated/corrupt global
// package on hosted CI (npm install -g flake — manifests as ERR_INVALID_PACKAGE_CONFIG,
// "Failed to resolve the path", or SyntaxError mid-import). useWithRetry deletes
// the broken install dir and re-fetches.
const { useWithRetry } = await import('./use-with-retry.lib.mjs');
const getenvModule = await useWithRetry(globalThis.use, 'getenv');
// Node 24 CJS/ESM interop may return the whole module object instead of the function directly
const getenv = typeof getenvModule === 'function' ? getenvModule : getenvModule.default || getenvModule;
const linoModule = await useWithRetry(globalThis.use, 'links-notation');
const LinoParser = linoModule.Parser || linoModule.default?.Parser;

/**
 * Valid threshold handling strategies
 * @type {readonly ['reject', 'enqueue', 'dequeue-one-at-a-time']}
 */
export const THRESHOLD_STRATEGIES = Object.freeze(['reject', 'enqueue', 'dequeue-one-at-a-time']);

/**
 * Validate a threshold strategy value
 * @param {string} strategy - The strategy to validate
 * @param {string} defaultStrategy - Default strategy if invalid
 * @returns {string} Valid strategy
 */
function validateStrategy(strategy, defaultStrategy = 'enqueue') {
  if (!strategy || !THRESHOLD_STRATEGIES.includes(strategy)) {
    return defaultStrategy;
  }
  return strategy;
}

/**
 * Normalize metric name from links notation format to camelCase
 * Examples: 'disk' -> 'disk', 'ram' -> 'ram', 'claude-5-hour' -> 'claude5Hour'
 * @param {string} name - Metric name in kebab-case
 * @returns {string} Metric name in normalized form
 */
function normalizeMetricName(name) {
  if (!name) return '';
  return name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * Parse queue configuration from links notation
 *
 * Format:
 * ```
 * (
 *   (disk (90% reject))
 *   (ram (65% enqueue))
 *   (cpu (65% enqueue))
 *   (claude-5-hour (65% dequeue-one-at-a-time))
 *   (claude-weekly (97% dequeue-one-at-a-time))
 *   (github-api (50% enqueue))
 * )
 * ```
 *
 * @param {string} linoConfig - Configuration in links notation format
 * @returns {Object} Parsed threshold configurations { [metricName]: { value: number, strategy: string } }
 */
export function parseQueueConfig(linoConfig) {
  if (!linoConfig || typeof linoConfig !== 'string') return {};

  try {
    const parser = new LinoParser();
    const parsed = parser.parse(linoConfig);

    if (!parsed || !Array.isArray(parsed) || parsed.length === 0) return {};

    const config = {};

    // The parser returns: [{ id: null, values: [...] }]
    // We need to drill down to find the metric configurations
    const topLink = parsed[0];
    if (!topLink || !topLink.values) return {};

    // Helper to extract all ids from a values array recursively
    function extractIds(values) {
      const ids = [];
      if (!values) return ids;
      for (const v of values) {
        if (v.id) ids.push(v.id);
        if (v.values && v.values.length > 0) {
          ids.push(...extractIds(v.values));
        }
      }
      return ids;
    }

    // Process each item in top-level values
    // Structure can be:
    // - Nested: [{ id: null, values: [{ id: 'disk', ... }, { id: null, values: [{ id: '90%' }, { id: 'reject' }] }] }]
    // - Flat: [{ id: 'disk', ... }, { id: '90%', ... }, { id: 'reject', ... }]
    for (const item of topLink.values) {
      // Check if this is a nested config item (no id at this level)
      if (item.id === null && item.values && item.values.length > 0) {
        // Extract all IDs from this nested structure
        const ids = extractIds(item.values);

        // Find metric name, percentage, and strategy
        let metricName = null;
        let thresholdValue = null;
        let strategy = null;

        for (const id of ids) {
          // Check for percentage
          const percentMatch = id.match(/^(\d+)%$/);
          if (percentMatch) {
            thresholdValue = parseInt(percentMatch[1], 10) / 100;
            continue;
          }

          // Check for strategy
          if (THRESHOLD_STRATEGIES.includes(id)) {
            strategy = id;
            continue;
          }

          // Otherwise it's likely the metric name
          if (!metricName) {
            metricName = id;
          }
        }

        if (metricName && thresholdValue !== null) {
          const normalized = normalizeMetricName(metricName);
          config[normalized] = {
            value: thresholdValue,
            strategy: validateStrategy(strategy),
          };
        }
      }
    }

    return config;
  } catch (error) {
    console.error('[queue-config] Failed to parse HIVE_MIND_QUEUE_CONFIG:', error.message);
    return {};
  }
}

// Helper function to safely parse floats with fallback
const parseFloatWithDefault = (envVar, defaultValue) => {
  const value = getenv(envVar, defaultValue.toString());
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

// Helper function to safely parse integers with fallback
const parseIntWithDefault = (envVar, defaultValue) => {
  const value = getenv(envVar, defaultValue.toString());
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

const MINIMUM_START_INTERVAL_MS = 10 * 60 * 1000;

// Parse links notation config from environment variable (if provided)
const linoConfig = parseQueueConfig(getenv('HIVE_MIND_QUEUE_CONFIG', ''));

/**
 * Get threshold configuration with priority:
 * 1. HIVE_MIND_QUEUE_CONFIG (links notation) - highest priority
 * 2. Individual environment variables
 * 3. Default values
 *
 * @param {string} linoKey - Key in normalized format for lino config (e.g., 'disk', 'ram')
 * @param {string} envVarThreshold - Environment variable for threshold value
 * @param {string} envVarStrategy - Environment variable for strategy
 * @param {number} defaultThreshold - Default threshold value (0.0 - 1.0)
 * @param {string} defaultStrategy - Default strategy
 * @returns {{ value: number, strategy: string }}
 */
function getThresholdConfig(linoKey, envVarThreshold, envVarStrategy, defaultThreshold, defaultStrategy) {
  // Check links notation config first
  if (linoConfig[linoKey]) {
    return {
      value: linoConfig[linoKey].value,
      strategy: linoConfig[linoKey].strategy,
    };
  }

  // Fall back to individual env vars, then defaults
  return {
    value: parseFloatWithDefault(envVarThreshold, defaultThreshold),
    strategy: validateStrategy(getenv(envVarStrategy, ''), defaultStrategy),
  };
}

/**
 * Configuration constants for queue throttling
 * All thresholds use ratios (0.0 - 1.0) representing usage percentage
 *
 * IMPORTANT: Running claude processes is NOT a blocking limit by itself.
 * Commands can run in parallel as long as actual limits (CPU, API, etc.) are not exceeded.
 * See: https://github.com/link-assistant/hive-mind/issues/1078
 *
 * NEW in issue #1253: Each threshold now has a configurable strategy:
 * - 'reject': Immediately reject the command (no queueing)
 * - 'enqueue': Block and wait in queue
 * - 'dequeue-one-at-a-time': Allow one command, block subsequent
 *
 * Issue #1981: disk now defaults to the normal wait/enqueue path at 80% used.
 * Operators can still choose immediate rejection with HIVE_MIND_DISK_STRATEGY=reject.
 */
export const QUEUE_CONFIG = {
  // Threshold configurations with value and strategy
  // Priority: HIVE_MIND_QUEUE_CONFIG > individual env vars > defaults
  thresholds: {
    ram: getThresholdConfig('ram', 'HIVE_MIND_RAM_THRESHOLD', 'HIVE_MIND_RAM_STRATEGY', 0.65, 'enqueue'),
    cpu: getThresholdConfig('cpu', 'HIVE_MIND_CPU_THRESHOLD', 'HIVE_MIND_CPU_STRATEGY', 0.65, 'enqueue'),
    // Issue #1981: wait instead of immediately rejecting when disk crosses 80%.
    disk: getThresholdConfig('disk', 'HIVE_MIND_DISK_THRESHOLD', 'HIVE_MIND_DISK_STRATEGY', 0.8, 'enqueue'),
    claude5Hour: getThresholdConfig('claude5Hour', 'HIVE_MIND_CLAUDE_5_HOUR_SESSION_THRESHOLD', 'HIVE_MIND_CLAUDE_5_HOUR_SESSION_STRATEGY', 0.65, 'dequeue-one-at-a-time'),
    claudeWeekly: getThresholdConfig('claudeWeekly', 'HIVE_MIND_CLAUDE_WEEKLY_THRESHOLD', 'HIVE_MIND_CLAUDE_WEEKLY_STRATEGY', 0.97, 'dequeue-one-at-a-time'),
    codex5Hour: getThresholdConfig('codex5Hour', 'HIVE_MIND_CODEX_5_HOUR_SESSION_THRESHOLD', 'HIVE_MIND_CODEX_5_HOUR_SESSION_STRATEGY', 0.65, 'dequeue-one-at-a-time'),
    codexWeekly: getThresholdConfig('codexWeekly', 'HIVE_MIND_CODEX_WEEKLY_THRESHOLD', 'HIVE_MIND_CODEX_WEEKLY_STRATEGY', 0.97, 'dequeue-one-at-a-time'),
    // Issue #1726: lowered default from 0.75 to 0.50 to start backing off earlier
    // and leave a wider safety margin before the hard 5,000/hr ceiling. Hosted
    // runners hit the ceiling repeatedly with the 75% setting (see
    // docs/case-studies/issue-1726).
    githubApi: getThresholdConfig('githubApi', 'HIVE_MIND_GITHUB_API_THRESHOLD', 'HIVE_MIND_GITHUB_API_STRATEGY', 0.5, 'enqueue'),
  },

  // Legacy flat threshold values for backward compatibility
  // These are derived from thresholds.{metric}.value
  RAM_THRESHOLD: getThresholdConfig('ram', 'HIVE_MIND_RAM_THRESHOLD', 'HIVE_MIND_RAM_STRATEGY', 0.65, 'enqueue').value,
  CPU_THRESHOLD: getThresholdConfig('cpu', 'HIVE_MIND_CPU_THRESHOLD', 'HIVE_MIND_CPU_STRATEGY', 0.65, 'enqueue').value,
  DISK_THRESHOLD: getThresholdConfig('disk', 'HIVE_MIND_DISK_THRESHOLD', 'HIVE_MIND_DISK_STRATEGY', 0.8, 'enqueue').value,
  CLAUDE_5_HOUR_SESSION_THRESHOLD: getThresholdConfig('claude5Hour', 'HIVE_MIND_CLAUDE_5_HOUR_SESSION_THRESHOLD', 'HIVE_MIND_CLAUDE_5_HOUR_SESSION_STRATEGY', 0.65, 'dequeue-one-at-a-time').value,
  CLAUDE_WEEKLY_THRESHOLD: getThresholdConfig('claudeWeekly', 'HIVE_MIND_CLAUDE_WEEKLY_THRESHOLD', 'HIVE_MIND_CLAUDE_WEEKLY_STRATEGY', 0.97, 'dequeue-one-at-a-time').value,
  CODEX_5_HOUR_SESSION_THRESHOLD: getThresholdConfig('codex5Hour', 'HIVE_MIND_CODEX_5_HOUR_SESSION_THRESHOLD', 'HIVE_MIND_CODEX_5_HOUR_SESSION_STRATEGY', 0.65, 'dequeue-one-at-a-time').value,
  CODEX_WEEKLY_THRESHOLD: getThresholdConfig('codexWeekly', 'HIVE_MIND_CODEX_WEEKLY_THRESHOLD', 'HIVE_MIND_CODEX_WEEKLY_STRATEGY', 0.97, 'dequeue-one-at-a-time').value,
  GITHUB_API_THRESHOLD: getThresholdConfig('githubApi', 'HIVE_MIND_GITHUB_API_THRESHOLD', 'HIVE_MIND_GITHUB_API_STRATEGY', 0.5, 'enqueue').value,

  // Timing
  // MIN_START_INTERVAL_MS: Minimum global spacing between task startups.
  // Issue #2015: after resource thresholds clear, starting a backlog in a burst
  // can kill the next batch before host metrics have time to settle.
  MIN_START_INTERVAL_MS: Math.max(parseIntWithDefault('HIVE_MIND_MIN_START_INTERVAL_MS', MINIMUM_START_INTERVAL_MS), MINIMUM_START_INTERVAL_MS), // at least 10 minutes between starts
  CONSUMER_POLL_INTERVAL_MS: parseIntWithDefault('HIVE_MIND_CONSUMER_POLL_INTERVAL_MS', 60000), // 1 minute between queue checks
  MESSAGE_UPDATE_INTERVAL_MS: parseIntWithDefault('HIVE_MIND_MESSAGE_UPDATE_INTERVAL_MS', 60000), // 1 minute between status message updates

  // Process detection
  CLAUDE_PROCESS_NAMES: ['claude'], // Process names to detect

  // Display
  // Maximum number of items shown per section (pending/processing/completed/failed)
  // in the /queue detailed status before collapsing into a
  // "... and N more" line. Keeps the Telegram message under the 4096-char cap.
  // See: https://github.com/link-assistant/hive-mind/issues/1837
  MAX_DISPLAY_ITEMS_PER_QUEUE: parseIntWithDefault('HIVE_MIND_MAX_DISPLAY_ITEMS_PER_QUEUE', 5),
};

/**
 * Convert threshold ratio to percentage for display
 * @param {number} ratio - Threshold ratio (0.0 - 1.0)
 * @returns {number} Percentage value (0 - 100)
 */
export function thresholdToPercent(ratio) {
  return Math.round(ratio * 100);
}

/**
 * Display threshold constants for progress bar visualization
 * These are derived from QUEUE_CONFIG and converted to percentages (0-100)
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1242
 */
export const DISPLAY_THRESHOLDS = {
  RAM: thresholdToPercent(QUEUE_CONFIG.RAM_THRESHOLD),
  CPU: thresholdToPercent(QUEUE_CONFIG.CPU_THRESHOLD),
  DISK: thresholdToPercent(QUEUE_CONFIG.DISK_THRESHOLD),
  CLAUDE_5_HOUR_SESSION: thresholdToPercent(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD),
  CLAUDE_WEEKLY: thresholdToPercent(QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD),
  CODEX_5_HOUR_SESSION: thresholdToPercent(QUEUE_CONFIG.CODEX_5_HOUR_SESSION_THRESHOLD),
  CODEX_WEEKLY: thresholdToPercent(QUEUE_CONFIG.CODEX_WEEKLY_THRESHOLD),
  GITHUB_API: thresholdToPercent(QUEUE_CONFIG.GITHUB_API_THRESHOLD),
};

/**
 * Get strategy for a specific metric
 * @param {string} metric - Metric name (ram, cpu, disk, claude5Hour, claudeWeekly, githubApi)
 * @returns {string} Strategy ('reject', 'enqueue', 'dequeue-one-at-a-time')
 */
export function getStrategy(metric) {
  const threshold = QUEUE_CONFIG.thresholds[metric];
  return threshold ? threshold.strategy : 'enqueue';
}

/**
 * Check if a metric uses the reject strategy
 * @param {string} metric - Metric name
 * @returns {boolean}
 */
export function isRejectStrategy(metric) {
  return getStrategy(metric) === 'reject';
}

/**
 * Check if a metric uses the enqueue strategy
 * @param {string} metric - Metric name
 * @returns {boolean}
 */
export function isEnqueueStrategy(metric) {
  return getStrategy(metric) === 'enqueue';
}

/**
 * Check if a metric uses the dequeue-one-at-a-time strategy
 * @param {string} metric - Metric name
 * @returns {boolean}
 */
export function isOneAtATimeStrategy(metric) {
  return getStrategy(metric) === 'dequeue-one-at-a-time';
}

export default {
  QUEUE_CONFIG,
  DISPLAY_THRESHOLDS,
  THRESHOLD_STRATEGIES,
  thresholdToPercent,
  parseQueueConfig,
  getStrategy,
  isRejectStrategy,
  isEnqueueStrategy,
  isOneAtATimeStrategy,
};
