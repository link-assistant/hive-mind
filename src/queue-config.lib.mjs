#!/usr/bin/env node

/**
 * Queue Configuration Module
 *
 * Centralized configuration for queue throttling and resource thresholds.
 * This module is used by both telegram-solve-queue.lib.mjs (queue logic)
 * and limits.lib.mjs (display formatting).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1242
 */

// Use use-m to dynamically import modules
if (typeof globalThis.use === 'undefined') {
  try {
    globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
  } catch (error) {
    console.error('❌ Fatal error: Failed to load dependencies for queue configuration');
    console.error(`   ${error.message}`);
    console.error('   This might be due to network issues or missing dependencies.');
    console.error('   Please check your internet connection and try again.');
    process.exit(1);
  }
}

const getenv = await use('getenv');

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

/**
 * Configuration constants for queue throttling
 * All thresholds use ratios (0.0 - 1.0) representing usage percentage
 *
 * IMPORTANT: Running claude processes is NOT a blocking limit by itself.
 * Commands can run in parallel as long as actual limits (CPU, API, etc.) are not exceeded.
 * See: https://github.com/link-assistant/hive-mind/issues/1078
 */
export const QUEUE_CONFIG = {
  // Resource thresholds (usage ratios: 0.0 - 1.0)
  // All thresholds use >= comparison (inclusive)
  RAM_THRESHOLD: parseFloatWithDefault('HIVE_MIND_RAM_THRESHOLD', 0.65), // Enqueue if RAM usage >= 65%
  // CPU threshold uses 5-minute load average, not instantaneous CPU usage
  CPU_THRESHOLD: parseFloatWithDefault('HIVE_MIND_CPU_THRESHOLD', 0.65), // Enqueue if 5-minute load average >= 65% of CPU count
  DISK_THRESHOLD: parseFloatWithDefault('HIVE_MIND_DISK_THRESHOLD', 0.9), // One-at-a-time if disk usage >= 90%, tuned for VM with 100 GB drive

  // API limit thresholds (usage ratios: 0.0 - 1.0)
  // All thresholds use >= comparison (inclusive)
  // Fine-tuned for Claude MAX $200 subscription
  CLAUDE_5_HOUR_SESSION_THRESHOLD: parseFloatWithDefault('HIVE_MIND_CLAUDE_5_HOUR_SESSION_THRESHOLD', 0.65), // One-at-a-time if 5-hour limit >= 65%
  CLAUDE_WEEKLY_THRESHOLD: parseFloatWithDefault('HIVE_MIND_CLAUDE_WEEKLY_THRESHOLD', 0.97), // One-at-a-time if weekly limit >= 97%
  GITHUB_API_THRESHOLD: parseFloatWithDefault('HIVE_MIND_GITHUB_API_THRESHOLD', 0.75), // Enqueue if GitHub >= 75% with parallel claude

  // Timing
  // MIN_START_INTERVAL_MS: Time to allow solve command to start actual claude process
  // This ensures that when API limits are checked, the running process is counted
  MIN_START_INTERVAL_MS: parseIntWithDefault('HIVE_MIND_MIN_START_INTERVAL_MS', 60000), // 1 minute between starts
  CONSUMER_POLL_INTERVAL_MS: parseIntWithDefault('HIVE_MIND_CONSUMER_POLL_INTERVAL_MS', 60000), // 1 minute between queue checks
  MESSAGE_UPDATE_INTERVAL_MS: parseIntWithDefault('HIVE_MIND_MESSAGE_UPDATE_INTERVAL_MS', 60000), // 1 minute between status message updates

  // Process detection
  CLAUDE_PROCESS_NAMES: ['claude'], // Process names to detect
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
  RAM: thresholdToPercent(QUEUE_CONFIG.RAM_THRESHOLD), // Blocks at 65%
  CPU: thresholdToPercent(QUEUE_CONFIG.CPU_THRESHOLD), // Blocks at 65%
  DISK: thresholdToPercent(QUEUE_CONFIG.DISK_THRESHOLD), // One-at-a-time at 90%
  CLAUDE_5_HOUR_SESSION: thresholdToPercent(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD), // One-at-a-time at 65%
  CLAUDE_WEEKLY: thresholdToPercent(QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD), // One-at-a-time at 97%
  GITHUB_API: thresholdToPercent(QUEUE_CONFIG.GITHUB_API_THRESHOLD), // Blocks parallel claude at 75%
};

export default {
  QUEUE_CONFIG,
  DISPLAY_THRESHOLDS,
  thresholdToPercent,
};
