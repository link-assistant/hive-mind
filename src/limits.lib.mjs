#!/usr/bin/env node
/**
 * Claude usage limits library
 * Provides functions to fetch and parse Claude usage limits via OAuth API
 */

import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry, execGhWithRetry } from './github-rate-limit.lib.mjs'; // rate-limit marker (#1726): gh API calls flow through $ wrapped by caller. execGhWithRetry adds transient-network retry (#1756).
import { formatLimitResetsAt, formatLimitResetsIn, formatLocalizedCurrentTime, formatLocalizedRelativeTime, formatLocalizedResetTime, localizeCompactDuration, lt, resolveLimitLocale } from './limits-i18n.lib.mjs';
import { formatSubscriptionLines, getCachedClaudeSubscription, getCachedCodexSubscription, getClaudeSubscriptionInfo, getCodexSubscriptionInfo } from './limits-subscription.lib.mjs';
export { getCachedClaudeSubscription, getCachedCodexSubscription, getClaudeSubscriptionInfo, getCodexSubscriptionInfo };
// Initialize dayjs plugins
dayjs.extend(utc);

// Import cache TTL configuration
import { cacheTtl } from './config.lib.mjs';

// Import centralized queue thresholds for progress bar visualization
// This ensures thresholds are consistent between queue logic and display formatting
// See: https://github.com/link-assistant/hive-mind/issues/1242
export { DISPLAY_THRESHOLDS } from './queue-config.lib.mjs';
import { DISPLAY_THRESHOLDS } from './queue-config.lib.mjs';

const execAsync = promisify(exec);

/**
 * Default path to Claude credentials file
 */
export const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');
export const DEFAULT_CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json');
const DEFAULT_CODEX_CONFIG_PATH = join(homedir(), '.codex', 'config.toml');

/**
 * Anthropic OAuth usage API endpoint
 */
const USAGE_API_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const CODEX_USAGE_API_DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api';

export function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;

  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function unixSecondsToIsoDate(seconds) {
  if (seconds === null || seconds === undefined) return null;
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric * 1000).toISOString();
}

function mapCodexWindow(window) {
  const resetsAt = unixSecondsToIsoDate(window?.reset_at);
  return {
    percentage: window?.used_percent ?? null,
    resetTime: formatResetTime(resetsAt),
    resetsAt,
    windowSeconds: window?.limit_window_seconds ?? null,
    resetAfterSeconds: window?.reset_after_seconds ?? null,
  };
}

export async function readCodexAuth(authPath = DEFAULT_CODEX_AUTH_PATH, verbose = false) {
  try {
    const content = await readFile(authPath, 'utf-8');
    const auth = JSON.parse(content);

    if (verbose) {
      console.log('[VERBOSE] /limits Codex auth loaded from:', authPath);
    }

    return auth;
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /limits failed to read Codex auth:', error.message);
    }
    return null;
  }
}

async function getCodexUsageBaseUrl(configPath = DEFAULT_CODEX_CONFIG_PATH, verbose = false) {
  try {
    const content = await readFile(configPath, 'utf-8');
    const match = content.match(/^\s*chatgpt_base_url\s*=\s*["']([^"']+)["']/m);
    if (!match?.[1]) return CODEX_USAGE_API_DEFAULT_BASE_URL;

    const baseUrl = match[1].trim().replace(/\/+$/, '');
    const normalized = baseUrl.endsWith('/backend-api') ? baseUrl : `${baseUrl}/backend-api`;

    if (verbose) {
      console.log('[VERBOSE] /limits Codex base URL loaded from config:', normalized);
    }

    return normalized;
  } catch (error) {
    if (verbose) {
      console.log('[VERBOSE] /limits using default Codex base URL:', CODEX_USAGE_API_DEFAULT_BASE_URL);
      console.log('[VERBOSE] /limits failed to read Codex config:', error.message);
    }
    return CODEX_USAGE_API_DEFAULT_BASE_URL;
  }
}

/**
 * Read Claude credentials from the credentials file
 *
 * @param {string} credentialsPath - Path to credentials file (optional)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Object|null} Credentials object or null if not found
 */
export async function readCredentials(credentialsPath = DEFAULT_CREDENTIALS_PATH, verbose = false) {
  try {
    const content = await readFile(credentialsPath, 'utf-8');
    const credentials = JSON.parse(content);

    if (verbose) {
      console.log('[VERBOSE] /limits credentials loaded from:', credentialsPath);
    }

    return credentials;
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /limits failed to read credentials:', error.message);
    }
    return null;
  }
}

/**
 * Format a retry-after value into a user-friendly message.
 * The retry-after header can be either a number of seconds or an HTTP-date.
 * Handles edge cases like 0, missing, or negative values gracefully.
 *
 * @param {string|null} retryAfter - Value of the retry-after header
 * @returns {string} Formatted message part (e.g., " Resets in 2m 30s (Mar 19, 8:00pm UTC)" or " Try again later.")
 * @see https://github.com/link-assistant/hive-mind/issues/1446
 */
export function formatRetryAfterMessage(retryAfter) {
  if (retryAfter === null || retryAfter === undefined) {
    return ' Try again later.';
  }

  // Try to parse as number of seconds first
  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds) && seconds > 0) {
    // Calculate reset time from now + seconds
    const resetAt = dayjs().add(seconds, 'second').utc();
    const resetTimeStr = resetAt.format('MMM D, h:mma');

    // Format relative time
    const totalMinutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    let relativeStr;
    if (hours > 0) {
      relativeStr = `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      relativeStr = remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    } else {
      relativeStr = `${remainingSeconds}s`;
    }

    return ` Resets in ${relativeStr} (${resetTimeStr} UTC)`;
  }

  // Try to parse as HTTP-date (e.g., "Wed, 21 Oct 2015 07:28:00 GMT")
  const retryDate = dayjs(retryAfter);
  if (retryDate.isValid()) {
    const diffMs = retryDate.diff(dayjs());
    if (diffMs > 0) {
      const totalMinutes = Math.floor(diffMs / (1000 * 60));
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const relativeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      const resetTimeStr = retryDate.utc().format('MMM D, h:mma');
      return ` Resets in ${relativeStr} (${resetTimeStr} UTC)`;
    }
  }

  // Fallback for 0, negative, or unparseable values - don't show misleading info
  return ' Try again later.';
}

/**
 * Format an ISO date string to a human-readable reset time using dayjs
 *
 * @param {string} isoDate - ISO date string (e.g., "2025-12-03T17:59:59.626485+00:00")
 * @param {boolean} includeTimezone - Whether to include timezone suffix (default: true)
 * @returns {string} Human-readable reset time (e.g., "Dec 3, 6:59pm UTC")
 */
function formatResetTime(isoDate, includeTimezone = true, options = {}) {
  return formatLocalizedResetTime(isoDate, includeTimezone, options);
}

function formatRelativeTime(isoDate, options = {}) {
  return formatLocalizedRelativeTime(isoDate, options);
}

/**
 * Format current time in UTC using dayjs
 *
 * @returns {string} Current time in UTC (e.g., "Dec 3, 6:45pm UTC")
 */
function formatCurrentTime(options = {}) {
  return formatLocalizedCurrentTime(options);
}

/**
 * Format bytes into human-readable size
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "19.3 GB")
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  // Use 1 decimal place for GB and above, none for smaller units
  const decimals = i >= 3 ? 1 : 0;
  return `${value.toFixed(decimals)} ${sizes[i]}`;
}

/**
 * @param {number} usedBytes - Used size in bytes
 * @param {number} totalBytes - Total size in bytes
 * @param {Object|string} options - Optional locale options
 * @returns {string} Formatted string (e.g., "2.8/11.7 GB used")
 */
function formatBytesRange(usedBytes, totalBytes, options = {}) {
  const usedLabel = lt('used', {}, options);
  if (totalBytes === 0) return `0/0 B ${usedLabel}`;
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  // Determine unit based on total (larger value)
  const i = Math.floor(Math.log(totalBytes) / Math.log(k));
  const usedValue = usedBytes / Math.pow(k, i);
  const totalValue = totalBytes / Math.pow(k, i);
  // Use 1 decimal place for GB and above, none for smaller units
  const decimals = i >= 3 ? 1 : 0;
  return `${usedValue.toFixed(decimals)}/${totalValue.toFixed(decimals)} ${sizes[i]} ${usedLabel}`;
}

function formatRoundedNumber(value, decimals = 2) {
  return parseFloat(value.toFixed(decimals));
}

function getDisplayCpuCoresUsed(loadAvg5, cpuCount) {
  const boundedLoad = Math.min(Math.max(loadAvg5, 0), cpuCount);
  return formatRoundedNumber(boundedLoad);
}

function hasLimitPercentage(window) {
  return window?.percentage !== null && window?.percentage !== undefined;
}

function getLocalizedResetTime(window, options = {}) {
  if (!window) return null;
  return formatResetTime(window.resetsAt, true, options) || window.resetTime || null;
}

function getLocalizedRelativeReset(window, options = {}, fallbackRelative = null) {
  return formatRelativeTime(window?.resetsAt, options) || localizeCompactDuration(fallbackRelative, options);
}

/**
 * Get GitHub API rate limits by calling gh api rate_limit
 * Returns rate limit info for core, search, graphql, and other resources
 *
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Object} Object with success boolean, and either rate limit data or error message
 */
export async function getGitHubRateLimits(verbose = false) {
  try {
    // #1756: route through execGhWithRetry for transient 5xx; skip rate-limit retry budget (this is the endpoint we'd consult to know about rate limits).
    const { stdout } = await execGhWithRetry('gh api rate_limit 2>/dev/null', { label: 'gh api rate_limit', maxAttempts: 1 });
    const data = JSON.parse(stdout);

    if (verbose) {
      console.log('[VERBOSE] /limits GitHub rate limit response:', JSON.stringify(data, null, 2));
    }

    // Extract the core rate limit (most important for general API usage)
    const core = data.resources?.core;
    if (!core) {
      return {
        success: false,
        error: 'Could not parse GitHub rate limit response',
      };
    }

    // Calculate remaining percentage
    const usedPercentage = core.limit > 0 ? Math.round((core.used / core.limit) * 100) : 0;
    const remainingPercentage = 100 - usedPercentage;

    // Format reset time from Unix timestamp
    const resetDate = new Date(core.reset * 1000);
    const resetTimeFormatted = formatResetTime(resetDate.toISOString());

    // Calculate relative time until reset
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

    if (verbose) {
      console.log(`[VERBOSE] /limits GitHub API: ${core.remaining}/${core.limit} remaining (${remainingPercentage}% available)`);
    }

    return {
      success: true,
      githubRateLimit: {
        limit: core.limit,
        used: core.used,
        remaining: core.remaining,
        usedPercentage,
        remainingPercentage,
        resetTimestamp: core.reset,
        resetTime: resetTimeFormatted,
        relativeReset,
        resetsAt: resetDate.toISOString(),
      },
    };
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /limits GitHub rate limit error:', error);
    }
    return {
      success: false,
      error: `Failed to get GitHub rate limits: ${error.message}`,
    };
  }
}

/**
 * Get CPU load average information
 * Returns 1-minute, 5-minute, and 15-minute load averages
 *
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Object} Object with success boolean, and either CPU load data or error message
 */
export async function getCpuLoadInfo(verbose = false) {
  try {
    let loadAvg1, loadAvg5, loadAvg15, cpuCount;

    if (process.platform === 'win32') {
      // Windows: Get CPU count and approximate load
      const { stdout: cpuStdout } = await execAsync('wmic cpu get NumberOfCores /format:value 2>nul');
      const coresMatch = cpuStdout.match(/NumberOfCores=(\d+)/);
      cpuCount = coresMatch ? parseInt(coresMatch[1]) : 1;

      // Windows doesn't have load average, use current CPU usage as approximation
      const { stdout: loadStdout } = await execAsync('wmic cpu get LoadPercentage /format:value 2>nul');
      const loadMatch = loadStdout.match(/LoadPercentage=(\d+)/);
      const currentLoad = loadMatch ? (parseFloat(loadMatch[1]) / 100) * cpuCount : 0;
      loadAvg1 = loadAvg5 = loadAvg15 = currentLoad;
    } else {
      // Unix-like systems (Linux, macOS)
      const { stdout: loadStdout } = await execAsync('cat /proc/loadavg 2>/dev/null || uptime');
      const numbers = loadStdout.match(/[\d.]+/g);

      if (numbers && numbers.length >= 3) {
        loadAvg1 = parseFloat(numbers[0]);
        loadAvg5 = parseFloat(numbers[1]);
        loadAvg15 = parseFloat(numbers[2]);
      }

      // Get CPU count
      if (process.platform === 'darwin') {
        const { stdout: cpuStdout } = await execAsync('sysctl -n hw.ncpu 2>/dev/null');
        cpuCount = parseInt(cpuStdout.trim()) || 1;
      } else {
        const { stdout: cpuStdout } = await execAsync('nproc 2>/dev/null || grep -c processor /proc/cpuinfo 2>/dev/null');
        cpuCount = parseInt(cpuStdout.trim()) || 1;
      }
    }

    if (isNaN(loadAvg1) || isNaN(cpuCount)) {
      return {
        success: false,
        error: 'Failed to parse CPU load information',
      };
    }

    // Calculate usage percentage based on 5-minute load average vs CPU count
    // Load average of 1.0 per CPU = 100% utilization
    // Using 5m average for consistency with solve queue (see issue #1137)
    const usagePercentage = Math.min(100, Math.round((loadAvg5 / cpuCount) * 100));
    const usedCpuCores = getDisplayCpuCoresUsed(loadAvg5, cpuCount);

    if (verbose) {
      console.log(`[VERBOSE] /limits CPU load: ${loadAvg1.toFixed(2)} (1m), ${loadAvg5.toFixed(2)} (5m), ${loadAvg15.toFixed(2)} (15m), ${cpuCount} CPUs, ${usagePercentage}% used`);
    }

    return {
      success: true,
      cpuLoad: {
        loadAvg1,
        loadAvg5,
        loadAvg15,
        cpuCount,
        usagePercentage,
        usedCpuCores,
      },
    };
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /limits CPU load error:', error);
    }
    return {
      success: false,
      error: `Failed to get CPU load info: ${error.message}`,
    };
  }
}

/**
 * Get RAM/memory usage information
 * Returns total, used, and available memory with usage percentage
 *
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Object} Object with success boolean, and either memory data or error message
 */
export async function getMemoryInfo(verbose = false) {
  try {
    let totalMB, usedMB, availableMB;

    if (process.platform === 'darwin') {
      // macOS: use vm_stat and sysctl
      const { stdout: memTotal } = await execAsync('sysctl -n hw.memsize 2>/dev/null');
      const totalBytes = parseInt(memTotal.trim());
      totalMB = Math.round(totalBytes / (1024 * 1024));

      const { stdout: vmStat } = await execAsync('vm_stat 2>/dev/null');
      const pageSize = 4096; // Default page size on macOS
      const freeMatch = vmStat.match(/Pages free:\s+(\d+)/);
      const inactiveMatch = vmStat.match(/Pages inactive:\s+(\d+)/);
      const speculativeMatch = vmStat.match(/Pages speculative:\s+(\d+)/);

      const freePages = freeMatch ? parseInt(freeMatch[1]) : 0;
      const inactivePages = inactiveMatch ? parseInt(inactiveMatch[1]) : 0;
      const speculativePages = speculativeMatch ? parseInt(speculativeMatch[1]) : 0;

      // Available = free + inactive + speculative (approximately)
      availableMB = Math.round(((freePages + inactivePages + speculativePages) * pageSize) / (1024 * 1024));
      usedMB = totalMB - availableMB;
    } else if (process.platform === 'win32') {
      // Windows: use wmic
      const { stdout } = await execAsync('wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /format:value 2>nul');
      const freeMatch = stdout.match(/FreePhysicalMemory=(\d+)/);
      const totalMatch = stdout.match(/TotalVisibleMemorySize=(\d+)/);

      if (freeMatch && totalMatch) {
        const freeKB = parseInt(freeMatch[1]);
        const totalKB = parseInt(totalMatch[1]);
        totalMB = Math.round(totalKB / 1024);
        availableMB = Math.round(freeKB / 1024);
        usedMB = totalMB - availableMB;
      }
    } else {
      // Linux: use /proc/meminfo
      const { stdout } = await execAsync("grep -E '^(MemTotal|MemAvailable):' /proc/meminfo 2>/dev/null");
      const totalMatch = stdout.match(/MemTotal:\s+(\d+)/);
      const availableMatch = stdout.match(/MemAvailable:\s+(\d+)/);

      if (totalMatch && availableMatch) {
        const totalKB = parseInt(totalMatch[1]);
        const availableKB = parseInt(availableMatch[1]);
        totalMB = Math.round(totalKB / 1024);
        availableMB = Math.round(availableKB / 1024);
        usedMB = totalMB - availableMB;
      }
    }

    if (isNaN(totalMB) || isNaN(usedMB) || isNaN(availableMB)) {
      return {
        success: false,
        error: 'Failed to parse memory information',
      };
    }

    // Calculate used percentage
    const usedPercentage = Math.round((usedMB / totalMB) * 100);

    if (verbose) {
      console.log(`[VERBOSE] /limits memory: ${usedMB}MB used of ${totalMB}MB total (${usedPercentage}% used)`);
    }

    return {
      success: true,
      memory: {
        totalMB,
        usedMB,
        availableMB,
        totalBytes: totalMB * 1024 * 1024,
        usedBytes: usedMB * 1024 * 1024,
        availableBytes: availableMB * 1024 * 1024,
        usedPercentage,
        freePercentage: 100 - usedPercentage,
        totalFormatted: formatBytes(totalMB * 1024 * 1024),
        usedFormatted: formatBytes(usedMB * 1024 * 1024),
        availableFormatted: formatBytes(availableMB * 1024 * 1024),
      },
    };
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /limits memory error:', error);
    }
    return {
      success: false,
      error: `Failed to get memory info: ${error.message}`,
    };
  }
}

/**
 * Get disk space information for the current filesystem
 * Returns total, used, available space and usage percentage
 *
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Object} Object with success boolean, and either disk space data or error message
 */
export async function getDiskSpaceInfo(verbose = false) {
  try {
    let totalMB, usedMB, availableMB, usedPercentage;

    if (process.platform === 'darwin') {
      // macOS: use df with 1024-byte blocks and parse
      const { stdout } = await execAsync("df -k . 2>/dev/null | tail -1 | awk '{print $2, $3, $4}'");
      const [totalKB, usedKB, availableKB] = stdout.trim().split(/\s+/).map(Number);
      totalMB = Math.round(totalKB / 1024);
      usedMB = Math.round(usedKB / 1024);
      availableMB = Math.round(availableKB / 1024);
    } else if (process.platform === 'win32') {
      // Windows: use PowerShell to get drive info
      const { stdout } = await execAsync('powershell -Command "$drive = (Get-Location).Drive; $info = Get-PSDrive -Name $drive.Name; Write-Output \\"$($info.Used) $($info.Free)\\""');
      const [usedBytes, freeBytes] = stdout.trim().split(/\s+/).map(Number);
      const totalBytes = usedBytes + freeBytes;
      totalMB = Math.round(totalBytes / (1024 * 1024));
      usedMB = Math.round(usedBytes / (1024 * 1024));
      availableMB = Math.round(freeBytes / (1024 * 1024));
    } else {
      // Linux: use df with megabyte blocks
      const { stdout } = await execAsync("df -BM . 2>/dev/null | tail -1 | awk '{print $2, $3, $4}'");
      const parts = stdout
        .trim()
        .split(/\s+/)
        .map(s => parseInt(s.replace('M', '')));
      [totalMB, usedMB, availableMB] = parts;
    }

    if (isNaN(totalMB) || isNaN(usedMB) || isNaN(availableMB)) {
      return {
        success: false,
        error: 'Failed to parse disk space information',
      };
    }

    // Calculate used percentage (rounded to nearest integer)
    usedPercentage = Math.round((usedMB / totalMB) * 100);
    // Free percentage is the inverse
    const freePercentage = 100 - usedPercentage;

    if (verbose) {
      console.log(`[VERBOSE] /limits disk space: ${availableMB}MB free of ${totalMB}MB total (${freePercentage}% free)`);
    }

    return {
      success: true,
      diskSpace: {
        totalMB,
        usedMB,
        availableMB,
        totalBytes: totalMB * 1024 * 1024,
        usedBytes: usedMB * 1024 * 1024,
        availableBytes: availableMB * 1024 * 1024,
        usedPercentage,
        freePercentage,
        totalFormatted: formatBytes(totalMB * 1024 * 1024),
        usedFormatted: formatBytes(usedMB * 1024 * 1024),
        availableFormatted: formatBytes(availableMB * 1024 * 1024),
      },
    };
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /limits disk space error:', error);
    }
    return {
      success: false,
      error: `Failed to get disk space info: ${error.message}`,
    };
  }
}

/**
 * Get Claude usage limits by calling the Anthropic OAuth usage API
 * This approach is more reliable than trying to parse CLI output
 * and doesn't require the 'expect' command.
 *
 * Returns usage data for:
 * - Current session (five_hour) usage percentage and reset time
 * - Current week (all models / seven_day) usage percentage and reset date
 * - Current week (Sonnet only / seven_day_sonnet) usage percentage and reset date
 *
 * @param {boolean} verbose - Whether to log verbose output
 * @param {string} credentialsPath - Optional path to credentials file
 * @returns {Object} Object with success boolean, and either usage data or error message
 */
export async function getClaudeUsageLimits(verbose = false, credentialsPath = DEFAULT_CREDENTIALS_PATH) {
  try {
    // Read credentials
    const credentials = await readCredentials(credentialsPath, verbose);

    if (!credentials) {
      return {
        success: false,
        error: 'Could not read Claude credentials. Make sure Claude is properly installed and authenticated.',
      };
    }

    const accessToken = credentials?.claudeAiOauth?.accessToken;

    if (!accessToken) {
      return {
        success: false,
        error: 'No access token found in Claude credentials. Please use `/solve` or `/hive` commands to trigger re-authentication of Claude.',
      };
    }

    const requestHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-code/2.0.55',
      Authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
    };

    if (verbose) {
      console.log('[VERBOSE] /limits fetching usage from API...');
      console.log(`[VERBOSE] /limits API request: GET ${USAGE_API_ENDPOINT}`);
      // Log request headers with sanitized Authorization (show only last 8 chars)
      const sanitizedHeaders = { ...requestHeaders };
      if (sanitizedHeaders.Authorization) {
        const token = sanitizedHeaders.Authorization;
        sanitizedHeaders.Authorization = `Bearer ...${token.slice(-8)}`;
      }
      console.log('[VERBOSE] /limits API request headers:', JSON.stringify(sanitizedHeaders, null, 2));
    }

    // Call the Anthropic OAuth usage API
    const response = await fetch(USAGE_API_ENDPOINT, {
      method: 'GET',
      headers: requestHeaders,
    });

    // Log HTTP response status and headers for debugging (always in verbose mode, not just on error)
    if (verbose) {
      console.log(`[VERBOSE] /limits API HTTP status: ${response.status} ${response.statusText}`);
      // Log all response headers for debugging
      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      console.log('[VERBOSE] /limits API response headers:', JSON.stringify(responseHeaders, null, 2));
    }

    if (!response.ok) {
      const errorText = await response.text();
      if (verbose) {
        console.error('[VERBOSE] /limits API error body:', errorText);
      }

      // Check for specific error conditions
      if (response.status === 401) {
        return {
          success: false,
          error: 'Claude authentication expired. Please use `/solve` or `/hive` commands to trigger re-authentication of Claude.',
        };
      }

      // Check for rate limiting (429 Too Many Requests)
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        return {
          success: false,
          error: `Claude Usage API access has reached rate limit.${formatRetryAfterMessage(retryAfter)}`,
        };
      }

      return {
        success: false,
        error: `Failed to fetch usage from API: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();

    if (verbose) {
      console.log('[VERBOSE] /limits API response body:', JSON.stringify(data, null, 2));
    }

    // Parse the API response
    // API returns:
    // - five_hour: { utilization: number, resets_at: string }
    // - seven_day: { utilization: number, resets_at: string }
    // - seven_day_sonnet: { utilization: number, resets_at: string } (optional)

    const usage = {
      currentSession: {
        percentage: data.five_hour?.utilization ?? null,
        resetTime: formatResetTime(data.five_hour?.resets_at),
        resetsAt: data.five_hour?.resets_at ?? null,
      },
      allModels: {
        percentage: data.seven_day?.utilization ?? null,
        resetTime: formatResetTime(data.seven_day?.resets_at),
        resetsAt: data.seven_day?.resets_at ?? null,
      },
      sonnetOnly: {
        percentage: data.seven_day_sonnet?.utilization ?? null,
        resetTime: formatResetTime(data.seven_day_sonnet?.resets_at),
        resetsAt: data.seven_day_sonnet?.resets_at ?? null,
      },
    };

    return {
      success: true,
      usage,
    };
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /limits error:', error);
    }
    return {
      success: false,
      error: `Failed to get usage limits: ${error.message}`,
    };
  }
}

/**
 * Get Codex usage limits through the ChatGPT-authenticated usage endpoint.
 * Mirrors the supported upstream Codex account/rate-limits path.
 *
 * Returns usage data for:
 * - Current session (5-hour) usage percentage and reset time
 * - Current week usage percentage and reset date
 * - Additional metered Codex limits when available
 *
 * @param {boolean} verbose - Whether to log verbose output
 * @param {string} authPath - Optional path to Codex auth.json
 * @param {string|null} baseUrl - Optional backend base URL override
 * @returns {Object} Object with success boolean, and either usage data or error message
 */
export async function getCodexUsageLimits(verbose = false, authPath = DEFAULT_CODEX_AUTH_PATH, baseUrl = null) {
  try {
    const auth = await readCodexAuth(authPath, verbose);

    if (!auth) {
      return {
        success: false,
        error: 'Could not read Codex authentication. Make sure Codex is properly installed and authenticated.',
      };
    }

    if (auth.auth_mode && auth.auth_mode !== 'chatgpt') {
      return {
        success: false,
        error: 'Codex rate limits require ChatGPT authentication. API key auth does not expose account usage windows.',
      };
    }

    const accessToken = auth?.tokens?.access_token;
    if (!accessToken) {
      return {
        success: false,
        error: 'No Codex access token found. Please authenticate Codex with your ChatGPT account.',
      };
    }

    const resolvedBaseUrl = (baseUrl || (await getCodexUsageBaseUrl(undefined, verbose))).replace(/\/+$/, '');
    const usageEndpoint = `${resolvedBaseUrl}/wham/usage`;
    const tokenPayload = decodeJwtPayload(accessToken);
    const requestHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'hive-mind-codex-limits/1.0',
    };

    if (verbose) {
      console.log('[VERBOSE] /limits fetching Codex usage from API...');
      console.log(`[VERBOSE] /limits Codex API request: GET ${usageEndpoint}`);
      console.log('[VERBOSE] /limits Codex auth mode:', auth.auth_mode || 'unknown');
      console.log('[VERBOSE] /limits Codex account id:', auth?.tokens?.account_id || tokenPayload?.['https://api.openai.com/auth']?.chatgpt_account_id || 'unknown');
      console.log('[VERBOSE] /limits Codex plan type:', tokenPayload?.['https://api.openai.com/auth']?.chatgpt_plan_type || 'unknown');
      console.log(
        '[VERBOSE] /limits Codex API request headers:',
        JSON.stringify(
          {
            Accept: requestHeaders.Accept,
            Authorization: `Bearer ...${accessToken.slice(-8)}`,
            'User-Agent': requestHeaders['User-Agent'],
          },
          null,
          2
        )
      );
    }

    const response = await fetch(usageEndpoint, {
      method: 'GET',
      headers: requestHeaders,
    });

    if (verbose) {
      console.log(`[VERBOSE] /limits Codex API HTTP status: ${response.status} ${response.statusText}`);
      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      console.log('[VERBOSE] /limits Codex API response headers:', JSON.stringify(responseHeaders, null, 2));
    }

    if (!response.ok) {
      const errorText = await response.text();
      if (verbose) {
        console.error('[VERBOSE] /limits Codex API error body:', errorText);
      }

      if (response.status === 401) {
        return {
          success: false,
          error: 'Codex authentication expired. Please re-authenticate Codex with your ChatGPT account.',
        };
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        return {
          success: false,
          error: `Codex usage API access has reached rate limit.${formatRetryAfterMessage(retryAfter)}`,
        };
      }

      return {
        success: false,
        error: `Failed to fetch Codex usage from API: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();

    if (verbose) {
      console.log('[VERBOSE] /limits Codex API response body:', JSON.stringify(data, null, 2));
    }

    const usage = {
      currentSession: mapCodexWindow(data?.rate_limit?.primary_window),
      allModels: mapCodexWindow(data?.rate_limit?.secondary_window),
      sonnetOnly: {
        percentage: null,
        resetTime: null,
        resetsAt: null,
      },
    };

    const additionalRateLimits = Array.isArray(data?.additional_rate_limits)
      ? data.additional_rate_limits.map(limit => ({
          limitId: limit?.metered_feature || null,
          limitName: limit?.limit_name || limit?.metered_feature || 'additional',
          currentSession: mapCodexWindow(limit?.rate_limit?.primary_window),
          allModels: mapCodexWindow(limit?.rate_limit?.secondary_window),
          allowed: limit?.rate_limit?.allowed ?? null,
          limitReached: limit?.rate_limit?.limit_reached ?? null,
        }))
      : [];

    return {
      success: true,
      usage,
      planType: data?.plan_type || tokenPayload?.['https://api.openai.com/auth']?.chatgpt_plan_type || null,
      credits: data?.credits || null,
      additionalRateLimits,
      raw: data,
    };
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /limits Codex error:', error);
    }
    return {
      success: false,
      error: `Failed to get Codex usage limits: ${error.message}`,
    };
  }
}

/**
 * Generate a text-based progress bar for usage percentage
 * @param {number} percentage - Usage percentage (0-100)
 * @param {number|null} thresholdPercentage - Optional threshold position to show in the bar (0-100)
 * @returns {string} Text-based progress bar
 * @see https://github.com/link-assistant/hive-mind/issues/1242
 */
export function getProgressBar(percentage, thresholdPercentage = null) {
  const totalBlocks = 30;
  const filledBlocks = Math.round((percentage / 100) * totalBlocks);

  if (thresholdPercentage === null) {
    // No threshold - original behavior
    const emptyBlocks = totalBlocks - filledBlocks;
    return '\u2593'.repeat(filledBlocks) + '\u2591'.repeat(emptyBlocks);
  }

  // With threshold marker
  const thresholdPos = Math.round((thresholdPercentage / 100) * totalBlocks);
  let bar = '';

  for (let i = 0; i < totalBlocks; i++) {
    if (i === thresholdPos) {
      bar += '│'; // Threshold marker (U+2502 Box Drawings Light Vertical)
    } else if (i < filledBlocks) {
      bar += '▓'; // Filled (U+2593)
    } else {
      bar += '░'; // Empty (U+2591)
    }
  }

  return bar;
}

/**
 * Calculate the percentage of time that has passed in a period
 * @param {string} resetsAt - ISO date string when the period resets
 * @param {number} periodHours - Total duration of the period in hours (5 for session, 168 for week)
 * @returns {number|null} Percentage of time passed (0-100) or null if unable to calculate
 */
export function calculateTimePassedPercentage(resetsAt, periodHours) {
  if (!resetsAt) return null;

  try {
    const now = new Date();
    const resetTime = new Date(resetsAt);
    const periodMs = periodHours * 60 * 60 * 1000; // Convert hours to milliseconds

    // Calculate when the period started
    const startTime = new Date(resetTime.getTime() - periodMs);

    // Calculate time passed and total duration
    const timePassed = now.getTime() - startTime.getTime();
    const percentage = Math.max(0, Math.min(100, (timePassed / periodMs) * 100));

    return Math.round(percentage);
  } catch {
    return null;
  }
}

/**
 * Format Claude usage data into a Telegram-friendly message
 * Shows threshold markers in progress bars to indicate where queue behavior changes.
 *
 * @param {Object|null} usage - The usage object from getClaudeUsageLimits, or null if unavailable
 * @param {Object} diskSpace - Optional disk space info from getDiskSpaceInfo
 * @param {Object} githubRateLimit - Optional GitHub rate limit info from getGitHubRateLimits
 * @param {Object} cpuLoad - Optional CPU load info from getCpuLoadInfo
 * @param {Object} memory - Optional memory info from getMemoryInfo
 * @param {string|null} claudeError - Optional error message to show in Claude sections (e.g., auth expired)
 * @param {string[]} extraSections - Optional extra sections to append inside the code block (e.g. queue status)
 * @param {Object|string} options - Optional locale options
 * @returns {string} Formatted message wrapped in a single code block
 * @see https://github.com/link-assistant/hive-mind/issues/1242
 */
export function formatUsageMessage(usage, diskSpace = null, githubRateLimit = null, cpuLoad = null, memory = null, claudeError = null, extraSections = [], options = {}) {
  if (!Array.isArray(extraSections) && extraSections && typeof extraSections === 'object') {
    options = extraSections;
    extraSections = [];
  }
  const locale = resolveLimitLocale(options);
  const subscription = options?.subscription || null;
  const sections = [];

  sections.push(`${lt('current_time', {}, { locale })}: ${formatCurrentTime({ locale })}\n`);

  if (cpuLoad) {
    let section = `${lt('cpu', {}, { locale })}\n`;
    const usedBar = getProgressBar(cpuLoad.usagePercentage, DISPLAY_THRESHOLDS.CPU);
    // Show 'used' label when below threshold, warning emoji when at/above threshold
    // See: https://github.com/link-assistant/hive-mind/issues/1267
    const suffix = cpuLoad.usagePercentage >= DISPLAY_THRESHOLDS.CPU ? ' ⚠️' : ` ${lt('used', {}, { locale })}`;
    section += `${usedBar} ${cpuLoad.usagePercentage}%${suffix}\n`;
    // Linux load average is demand, not bounded CPU time. Keep the cores-used
    // display within CPU capacity and show raw load average only when saturated.
    const usedCpuCores = cpuLoad.usedCpuCores ?? getDisplayCpuCoresUsed(cpuLoad.loadAvg5, cpuLoad.cpuCount);
    let cpuCoresLine = `${formatRoundedNumber(usedCpuCores)}/${cpuLoad.cpuCount} ${lt('cpu_cores_used', {}, { locale })}`;
    if (cpuLoad.loadAvg5 > cpuLoad.cpuCount) {
      cpuCoresLine += ` (${lt('five_min_load_avg', {}, { locale })} ${formatRoundedNumber(cpuLoad.loadAvg5)})`;
    }
    section += `${cpuCoresLine}\n`;
    sections.push(section);
  }

  if (memory) {
    let section = `${lt('ram', {}, { locale })}\n`;
    const usedBar = getProgressBar(memory.usedPercentage, DISPLAY_THRESHOLDS.RAM);
    const suffix = memory.usedPercentage >= DISPLAY_THRESHOLDS.RAM ? ' ⚠️' : ` ${lt('used', {}, { locale })}`;
    section += `${usedBar} ${memory.usedPercentage}%${suffix}\n`;
    section += `${formatBytesRange(memory.usedBytes, memory.totalBytes, { locale })}\n`;
    sections.push(section);
  }

  if (diskSpace) {
    let section = `${lt('disk_space', {}, { locale })}\n`;
    const usedBar = getProgressBar(diskSpace.usedPercentage, DISPLAY_THRESHOLDS.DISK);
    const suffix = diskSpace.usedPercentage >= DISPLAY_THRESHOLDS.DISK ? ' ⚠️' : ` ${lt('used', {}, { locale })}`;
    section += `${usedBar} ${diskSpace.usedPercentage}%${suffix}\n`;
    section += `${formatBytesRange(diskSpace.usedBytes, diskSpace.totalBytes, { locale })}\n`;
    sections.push(section);
  }

  // GitHub API rate limits section (if provided)
  // Threshold: Blocks parallel claude commands when >= 75%
  if (githubRateLimit) {
    let section = `${lt('github_api', {}, { locale })}\n`;
    const usedBar = getProgressBar(githubRateLimit.usedPercentage, DISPLAY_THRESHOLDS.GITHUB_API);
    const suffix = githubRateLimit.usedPercentage >= DISPLAY_THRESHOLDS.GITHUB_API ? ' ⚠️' : ` ${lt('used', {}, { locale })}`;
    section += `${usedBar} ${githubRateLimit.usedPercentage}%${suffix}\n`;
    section += `${githubRateLimit.used}/${githubRateLimit.limit} ${lt('requests', {}, { locale })}\n`;
    const githubResetTime = getLocalizedResetTime(githubRateLimit, { locale });
    const githubRelativeReset = getLocalizedRelativeReset(githubRateLimit, { locale }, githubRateLimit.relativeReset);
    if (githubRelativeReset && githubResetTime) {
      section += `${formatLimitResetsIn(githubRelativeReset, githubResetTime, { locale })}\n`;
    } else if (githubResetTime) {
      section += `${formatLimitResetsAt(githubResetTime, { locale })}\n`;
    }
    sections.push(section);
  }

  // Claude limits section
  // When there's an error (e.g., auth expired), show it once and skip empty subsections
  if (claudeError) {
    sections.push(`${lt('claude_limits', {}, { locale })}\n${claudeError}\n`);
  } else {
    // Claude 5 hour session (five_hour)
    // Threshold: One-at-a-time mode when usage >= 65%
    let sessionSection = `${lt('claude_5_hour_session', {}, { locale })}\n`;
    if (hasLimitPercentage(usage?.currentSession)) {
      const timePassed = calculateTimePassedPercentage(usage.currentSession.resetsAt, 5);
      if (timePassed !== null) {
        const timeBar = getProgressBar(timePassed);
        sessionSection += `${timeBar} ${timePassed}% ${lt('passed', {}, { locale })}\n`;
      }

      // Use Math.floor so 100% only appears when usage is exactly 100%
      // See: https://github.com/link-assistant/hive-mind/issues/1133
      const pct = Math.floor(usage.currentSession.percentage);
      const bar = getProgressBar(pct, DISPLAY_THRESHOLDS.CLAUDE_5_HOUR_SESSION);
      const suffix = pct >= DISPLAY_THRESHOLDS.CLAUDE_5_HOUR_SESSION ? ' ⚠️' : ` ${lt('used', {}, { locale })}`;
      sessionSection += `${bar} ${pct}%${suffix}\n`;

      const sessionResetTime = getLocalizedResetTime(usage.currentSession, { locale });
      if (sessionResetTime) {
        const relativeTime = getLocalizedRelativeReset(usage.currentSession, { locale });
        if (relativeTime) {
          sessionSection += `${formatLimitResetsIn(relativeTime, sessionResetTime, { locale })}\n`;
        } else {
          sessionSection += `${formatLimitResetsAt(sessionResetTime, { locale })}\n`;
        }
      }
    } else {
      sessionSection += `${lt('na', {}, { locale })}\n`;
    }
    sections.push(sessionSection);

    // Current week (all models / seven_day)
    // Threshold: One-at-a-time mode when usage >= 97%
    let allModelsSection = `${lt('current_week_all_models', {}, { locale })}\n`;
    if (hasLimitPercentage(usage?.allModels)) {
      const timePassed = calculateTimePassedPercentage(usage.allModels.resetsAt, 168);
      if (timePassed !== null) {
        const timeBar = getProgressBar(timePassed);
        allModelsSection += `${timeBar} ${timePassed}% ${lt('passed', {}, { locale })}\n`;
      }

      // Use Math.floor so 100% only appears when usage is exactly 100%
      // See: https://github.com/link-assistant/hive-mind/issues/1133
      const pct = Math.floor(usage.allModels.percentage);
      const bar = getProgressBar(pct, DISPLAY_THRESHOLDS.CLAUDE_WEEKLY);
      const suffix = pct >= DISPLAY_THRESHOLDS.CLAUDE_WEEKLY ? ' ⚠️' : ` ${lt('used', {}, { locale })}`;
      allModelsSection += `${bar} ${pct}%${suffix}\n`;

      const allModelsResetTime = getLocalizedResetTime(usage.allModels, { locale });
      if (allModelsResetTime) {
        const relativeTime = getLocalizedRelativeReset(usage.allModels, { locale });
        if (relativeTime) {
          allModelsSection += `${formatLimitResetsIn(relativeTime, allModelsResetTime, { locale })}\n`;
        } else {
          allModelsSection += `${formatLimitResetsAt(allModelsResetTime, { locale })}\n`;
        }
      }
    } else {
      allModelsSection += `${lt('na', {}, { locale })}\n`;
    }
    sections.push(allModelsSection);

    // Current week (Sonnet only / seven_day_sonnet)
    // Threshold: One-at-a-time mode when usage >= 97% (same as all models)
    let sonnetSection = `${lt('current_week_sonnet_only', {}, { locale })}\n`;
    if (hasLimitPercentage(usage?.sonnetOnly)) {
      // Add time passed progress bar first (no threshold marker for time)
      const timePassed = calculateTimePassedPercentage(usage.sonnetOnly.resetsAt, 168);
      if (timePassed !== null) {
        const timeBar = getProgressBar(timePassed);
        sonnetSection += `${timeBar} ${timePassed}% ${lt('passed', {}, { locale })}\n`;
      }

      // Add usage progress bar second with threshold marker
      // Use Math.floor so 100% only appears when usage is exactly 100%
      // See: https://github.com/link-assistant/hive-mind/issues/1133
      const pct = Math.floor(usage.sonnetOnly.percentage);
      const bar = getProgressBar(pct, DISPLAY_THRESHOLDS.CLAUDE_WEEKLY);
      const suffix = pct >= DISPLAY_THRESHOLDS.CLAUDE_WEEKLY ? ' ⚠️' : ` ${lt('used', {}, { locale })}`;
      sonnetSection += `${bar} ${pct}%${suffix}\n`;

      const sonnetResetTime = getLocalizedResetTime(usage.sonnetOnly, { locale });
      if (sonnetResetTime) {
        const relativeTime = getLocalizedRelativeReset(usage.sonnetOnly, { locale });
        if (relativeTime) {
          sonnetSection += `${formatLimitResetsIn(relativeTime, sonnetResetTime, { locale })}\n`;
        } else {
          sonnetSection += `${formatLimitResetsAt(sonnetResetTime, { locale })}\n`;
        }
      }
    } else {
      sonnetSection += `${lt('na', {}, { locale })}\n`;
    }
    sections.push(sonnetSection);

    const subscriptionLines = formatSubscriptionLines(subscription, { locale });
    if (subscriptionLines) sections.push(subscriptionLines);
  }

  // Append any caller-provided extra sections (e.g. queue status) inside the code block
  for (const extra of extraSections) {
    sections.push(extra);
  }

  // Wrap all sections in a single code block for monospace font / aligned progress bars.
  // Sections are separated by blank lines; the trailing newline on each section provides spacing.
  return '```\n' + sections.join('\n') + '```';
}

/**
 * Format Codex usage data into a section suitable for appending to /limits output.
 *
 * @param {Object|null} codexLimits - Result object from getCodexUsageLimits, or null
 * @param {string|null} codexError - Optional error message
 * @param {Object|string} options - Optional locale options
 * @returns {string} Formatted section text
 */
export function formatCodexLimitsSection(codexLimits, codexError = null, options = {}) {
  const locale = resolveLimitLocale(options);
  if (codexError) {
    return `${lt('codex_limits', {}, { locale })}\n${codexError}\n`;
  }

  const usage = codexLimits?.usage || null;
  const additionalRateLimits = codexLimits?.additionalRateLimits || [];
  const credits = codexLimits?.credits || null;
  const planType = codexLimits?.planType || null;
  const subscription = options?.subscription || null;

  let section = `${lt('codex_limits', {}, { locale })}\n`;
  if (planType) {
    section += `${lt('plan', {}, { locale })}: ${planType}\n`;
  }

  let sessionSection = `${lt('codex_5_hour_session', {}, { locale })}\n`;
  if (hasLimitPercentage(usage?.currentSession)) {
    const timePassed = calculateTimePassedPercentage(usage.currentSession.resetsAt, 5);
    if (timePassed !== null) {
      sessionSection += `${getProgressBar(timePassed)} ${timePassed}% ${lt('passed', {}, { locale })}\n`;
    }
    const pct = Math.floor(usage.currentSession.percentage);
    const bar = getProgressBar(pct, DISPLAY_THRESHOLDS.CODEX_5_HOUR_SESSION);
    const suffix = pct >= DISPLAY_THRESHOLDS.CODEX_5_HOUR_SESSION ? ' ⚠️' : ` ${lt('used', {}, { locale })}`;
    sessionSection += `${bar} ${pct}%${suffix}\n`;
    const sessionResetTime = getLocalizedResetTime(usage.currentSession, { locale });
    if (sessionResetTime) {
      const relativeTime = getLocalizedRelativeReset(usage.currentSession, { locale });
      sessionSection += relativeTime ? `${formatLimitResetsIn(relativeTime, sessionResetTime, { locale })}\n` : `${formatLimitResetsAt(sessionResetTime, { locale })}\n`;
    }
  } else {
    sessionSection += `${lt('na', {}, { locale })}\n`;
  }

  let weeklySection = `${lt('current_week_all_models', {}, { locale })}\n`;
  if (hasLimitPercentage(usage?.allModels)) {
    const timePassed = calculateTimePassedPercentage(usage.allModels.resetsAt, 168);
    if (timePassed !== null) {
      weeklySection += `${getProgressBar(timePassed)} ${timePassed}% ${lt('passed', {}, { locale })}\n`;
    }
    const pct = Math.floor(usage.allModels.percentage);
    const bar = getProgressBar(pct, DISPLAY_THRESHOLDS.CODEX_WEEKLY);
    const suffix = pct >= DISPLAY_THRESHOLDS.CODEX_WEEKLY ? ' ⚠️' : ` ${lt('used', {}, { locale })}`;
    weeklySection += `${bar} ${pct}%${suffix}\n`;
    const weeklyResetTime = getLocalizedResetTime(usage.allModels, { locale });
    if (weeklyResetTime) {
      const relativeTime = getLocalizedRelativeReset(usage.allModels, { locale });
      weeklySection += relativeTime ? `${formatLimitResetsIn(relativeTime, weeklyResetTime, { locale })}\n` : `${formatLimitResetsAt(weeklyResetTime, { locale })}\n`;
    }
  } else {
    weeklySection += `${lt('na', {}, { locale })}\n`;
  }

  section += `${sessionSection}\n${weeklySection}`;

  if (additionalRateLimits.length > 0) {
    section += `\n${lt('additional_codex_limits', {}, { locale })}\n`;
    for (const limit of additionalRateLimits) {
      const sessionPct = limit.currentSession?.percentage;
      const weeklyPct = limit.allModels?.percentage;
      const sessionText = sessionPct === null || sessionPct === undefined ? `${lt('session', {}, { locale })} ${lt('na', {}, { locale })}` : `${lt('session', {}, { locale })} ${Math.floor(sessionPct)}%`;
      const weeklyText = weeklyPct === null || weeklyPct === undefined ? `${lt('week', {}, { locale })} ${lt('na', {}, { locale })}` : `${lt('week', {}, { locale })} ${Math.floor(weeklyPct)}%`;
      section += `${limit.limitName}: ${sessionText}, ${weeklyText}\n`;
    }
  }

  if (credits) {
    const creditSummary = credits.unlimited ? lt('unlimited', {}, { locale }) : `${credits.balance ?? '0'} ${lt('balance', {}, { locale })}`;
    section += `\n${lt('codex_credits', {}, { locale })}\n${creditSummary}\n`;
  }

  const subscriptionLines = formatSubscriptionLines(subscription, { locale });
  if (subscriptionLines) section += subscriptionLines;

  return section;
}

// ============================================================================
// Caching Layer
// ============================================================================

/**
 * Cache TTL constants (in milliseconds)
 * Values are loaded from config.lib.mjs which supports environment variable overrides.
 *
 * IMPORTANT: The Claude Usage API has stricter rate limiting than regular APIs.
 * Calling it more frequently than every 20 minutes may result in null values being returned.
 * See: https://github.com/link-assistant/hive-mind/issues/1074
 *
 * Configurable via environment variables:
 * - HIVE_MIND_API_CACHE_TTL_MS: General API cache TTL (default: 180000 = 3 minutes)
 * - HIVE_MIND_USAGE_API_CACHE_TTL_MS: Claude Usage API cache TTL (default: 1200000 = 20 minutes)
 * - HIVE_MIND_SYSTEM_CACHE_TTL_MS: System metrics cache TTL (default: 120000 = 2 minutes)
 */
export const CACHE_TTL = {
  API: cacheTtl.api, // 3 minutes for regular API calls (GitHub)
  USAGE_API: cacheTtl.usageApi, // 20 minutes for Claude Usage API (rate limited)
  SYSTEM: cacheTtl.system, // 2 minutes for system metrics (RAM, CPU, disk)
};

/**
 * Generic cache class with configurable TTL
 */
class LimitCache {
  constructor(defaultTtlMs = CACHE_TTL.API) {
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map();
  }

  get(key, ttlMs) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const effectiveTtl = ttlMs ?? entry.ttlMs ?? this.defaultTtlMs;
    if (Date.now() - entry.timestamp > effectiveTtl) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.cache.set(key, { value, timestamp: Date.now(), ttlMs: ttlMs ?? this.defaultTtlMs });
  }

  clear() {
    this.cache.clear();
  }

  getStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;
    for (const [, entry] of this.cache) {
      const effectiveTtl = entry.ttlMs ?? this.defaultTtlMs;
      if (now - entry.timestamp > effectiveTtl) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }
    return { validEntries, expiredEntries, totalEntries: this.cache.size };
  }
}

let globalCache = null;

export function getLimitCache() {
  if (!globalCache) globalCache = new LimitCache();
  return globalCache;
}

export function resetLimitCache() {
  if (globalCache) {
    globalCache.clear();
    globalCache = null;
  }
}

export async function getCachedClaudeLimits(verbose = false) {
  const cache = getLimitCache();
  // Use USAGE_API TTL (20 minutes) for Claude limits to avoid rate limiting
  // The Claude Usage API returns null values when called too frequently
  // See: https://github.com/link-assistant/hive-mind/issues/1074
  const cached = cache.get('claude', CACHE_TTL.USAGE_API);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached Claude limits (TTL: ' + Math.round(CACHE_TTL.USAGE_API / 60000) + ' minutes)');
    return cached;
  }
  // Also check if we have a cached rate-limit error to avoid hammering a 429'd endpoint
  const cachedError = cache.get('claude-rate-limited', CACHE_TTL.USAGE_API);
  if (cachedError) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached rate-limit error (avoiding repeated 429 requests)');
    return cachedError;
  }
  if (verbose) console.log('[VERBOSE] /limits-cache: Cache miss for Claude limits, fetching from API...');
  const result = await getClaudeUsageLimits(verbose);
  if (result.success) {
    cache.set('claude', result, CACHE_TTL.USAGE_API);
  } else if (result.error && result.error.includes('Rate limited')) {
    // Cache rate-limit errors to prevent hammering the API
    // Use the same 20-minute TTL as successful responses
    // See: https://github.com/link-assistant/hive-mind/issues/1446
    cache.set('claude-rate-limited', result, CACHE_TTL.USAGE_API);
    if (verbose) console.log('[VERBOSE] /limits-cache: Cached rate-limit error for ' + Math.round(CACHE_TTL.USAGE_API / 60000) + ' minutes');
  }
  return result;
}

export async function getCachedCodexLimits(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('codex', CACHE_TTL.USAGE_API);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached Codex limits (TTL: ' + Math.round(CACHE_TTL.USAGE_API / 60000) + ' minutes)');
    return cached;
  }
  const cachedError = cache.get('codex-rate-limited', CACHE_TTL.USAGE_API);
  if (cachedError) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached Codex rate-limit error');
    return cachedError;
  }
  if (verbose) console.log('[VERBOSE] /limits-cache: Cache miss for Codex limits, fetching from API...');
  const result = await getCodexUsageLimits(verbose);
  if (result.success) {
    cache.set('codex', result, CACHE_TTL.USAGE_API);
  } else if (result.error && result.error.includes('rate limit')) {
    cache.set('codex-rate-limited', result, CACHE_TTL.USAGE_API);
    if (verbose) console.log('[VERBOSE] /limits-cache: Cached Codex rate-limit error for ' + Math.round(CACHE_TTL.USAGE_API / 60000) + ' minutes');
  }
  return result;
}

export async function getCachedGitHubLimits(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('github', CACHE_TTL.API);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached GitHub limits');
    return cached;
  }
  const result = await getGitHubRateLimits(verbose);
  if (result.success) cache.set('github', result, CACHE_TTL.API);
  return result;
}

export async function getCachedMemoryInfo(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('memory', CACHE_TTL.SYSTEM);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached memory info');
    return cached;
  }
  const result = await getMemoryInfo(verbose);
  if (result.success) cache.set('memory', result, CACHE_TTL.SYSTEM);
  return result;
}

export async function getCachedCpuInfo(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('cpu', CACHE_TTL.SYSTEM);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached CPU info');
    return cached;
  }
  const result = await getCpuLoadInfo(verbose);
  if (result.success) cache.set('cpu', result, CACHE_TTL.SYSTEM);
  return result;
}

export async function getCachedDiskInfo(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('disk', CACHE_TTL.SYSTEM);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached disk info');
    return cached;
  }
  const result = await getDiskSpaceInfo(verbose);
  if (result.success) cache.set('disk', result, CACHE_TTL.SYSTEM);
  return result;
}

export async function getAllCachedLimits(verbose = false) {
  const [claude, codex, github, memory, cpu, disk, claudeSubscription, codexSubscription] = await Promise.all([getCachedClaudeLimits(verbose), getCachedCodexLimits(verbose), getCachedGitHubLimits(verbose), getCachedMemoryInfo(verbose), getCachedCpuInfo(verbose), getCachedDiskInfo(verbose), getCachedClaudeSubscription(verbose), getCachedCodexSubscription(verbose)]);
  return { claude, codex, github, memory, cpu, disk, claudeSubscription, codexSubscription };
}

export default {
  // Raw functions (no caching)
  getClaudeUsageLimits,
  getCodexUsageLimits,
  getClaudeSubscriptionInfo,
  getCodexSubscriptionInfo,
  getCpuLoadInfo,
  getMemoryInfo,
  getDiskSpaceInfo,
  getGitHubRateLimits,
  getProgressBar,
  calculateTimePassedPercentage,
  formatUsageMessage,
  formatCodexLimitsSection,
  formatRetryAfterMessage,
  // Threshold constants for progress bar visualization
  DISPLAY_THRESHOLDS,
  // Cache management
  CACHE_TTL,
  getLimitCache,
  resetLimitCache,
  // Cached functions
  getCachedClaudeLimits,
  getCachedCodexLimits,
  getCachedClaudeSubscription,
  getCachedCodexSubscription,
  getCachedGitHubLimits,
  getCachedMemoryInfo,
  getCachedCpuInfo,
  getCachedDiskInfo,
  getAllCachedLimits,
};
