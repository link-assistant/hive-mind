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
const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');

/**
 * Anthropic OAuth usage API endpoint
 */
const USAGE_API_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';

/**
 * Read Claude credentials from the credentials file
 *
 * @param {string} credentialsPath - Path to credentials file (optional)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Object|null} Credentials object or null if not found
 */
async function readCredentials(credentialsPath = DEFAULT_CREDENTIALS_PATH, verbose = false) {
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
 * Format an ISO date string to a human-readable reset time using dayjs
 *
 * @param {string} isoDate - ISO date string (e.g., "2025-12-03T17:59:59.626485+00:00")
 * @param {boolean} includeTimezone - Whether to include timezone suffix (default: true)
 * @returns {string} Human-readable reset time (e.g., "Dec 3, 6:59pm UTC")
 */
function formatResetTime(isoDate, includeTimezone = true) {
  if (!isoDate) return null;

  try {
    const date = dayjs(isoDate).utc();
    if (!date.isValid()) return isoDate;

    // dayjs format: MMM=Jan, D=day, h=12-hour, mm=minutes, a=am/pm
    const timeStr = date.format('MMM D, h:mma');
    return includeTimezone ? `${timeStr} UTC` : timeStr;
  } catch {
    return isoDate;
  }
}

/**
 * Format relative time from now to a future date using dayjs
 *
 * @param {string} isoDate - ISO date string
 * @returns {string|null} Relative time string (e.g., "1h 34m" or "6d 20h 13m") or null if date is in the past
 */
function formatRelativeTime(isoDate) {
  if (!isoDate) return null;

  try {
    const now = dayjs();
    const target = dayjs(isoDate);

    if (!target.isValid()) return null;

    const diffMs = target.diff(now);
    if (diffMs < 0) return null; // Past date

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);

    const days = totalDays;
    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;

    // If hours >= 24, show days
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    }

    return `${hours}h ${minutes}m`;
  } catch {
    return null;
  }
}

/**
 * Format current time in UTC using dayjs
 *
 * @returns {string} Current time in UTC (e.g., "Dec 3, 6:45pm UTC")
 */
function formatCurrentTime() {
  return dayjs().utc().format('MMM D, h:mma [UTC]');
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
 * Format two byte values into a combined "used/total UNIT used" format
 * @param {number} usedBytes - Used size in bytes
 * @param {number} totalBytes - Total size in bytes
 * @returns {string} Formatted string (e.g., "2.8/11.7 GB used")
 */
function formatBytesRange(usedBytes, totalBytes) {
  if (totalBytes === 0) return '0/0 B used';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  // Determine unit based on total (larger value)
  const i = Math.floor(Math.log(totalBytes) / Math.log(k));
  const usedValue = usedBytes / Math.pow(k, i);
  const totalValue = totalBytes / Math.pow(k, i);
  // Use 1 decimal place for GB and above, none for smaller units
  const decimals = i >= 3 ? 1 : 0;
  return `${usedValue.toFixed(decimals)}/${totalValue.toFixed(decimals)} ${sizes[i]} used`;
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
    const { stdout } = await execAsync('gh api rate_limit 2>/dev/null');
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

    if (verbose) {
      console.log('[VERBOSE] /limits fetching usage from API...');
    }

    // Call the Anthropic OAuth usage API
    const response = await fetch(USAGE_API_ENDPOINT, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-code/2.0.55',
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });

    // Log HTTP response status for debugging (always, not just on error)
    if (verbose) {
      console.log(`[VERBOSE] /limits API HTTP status: ${response.status} ${response.statusText}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      if (verbose) {
        console.error('[VERBOSE] /limits API error:', response.status, errorText);
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
          error: `Rate limited by Claude Usage API. ${retryAfter ? `Retry after: ${retryAfter}s` : 'Try again later.'}`,
        };
      }

      return {
        success: false,
        error: `Failed to fetch usage from API: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();

    if (verbose) {
      console.log('[VERBOSE] /limits API response:', JSON.stringify(data, null, 2));
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
 * @returns {string} Formatted message
 * @see https://github.com/link-assistant/hive-mind/issues/1242
 */
export function formatUsageMessage(usage, diskSpace = null, githubRateLimit = null, cpuLoad = null, memory = null, claudeError = null) {
  // Use code block for monospace font to align progress bars properly
  let message = '```\n';

  // Show current time
  message += `Current time: ${formatCurrentTime()}\n\n`;

  // CPU load section (if provided)
  // Threshold: Blocks new commands when usage >= 65%
  if (cpuLoad) {
    message += 'CPU\n';
    const usedBar = getProgressBar(cpuLoad.usagePercentage, DISPLAY_THRESHOLDS.CPU);
    // Show 'used' label when below threshold, warning emoji when at/above threshold
    // See: https://github.com/link-assistant/hive-mind/issues/1267
    const suffix = cpuLoad.usagePercentage >= DISPLAY_THRESHOLDS.CPU ? ' ⚠️' : ' used';
    message += `${usedBar} ${cpuLoad.usagePercentage}%${suffix}\n`;
    // Show cores used based on 5m load average (e.g., "0.04/6 CPU cores used" or "3/6 CPU cores used")
    // Use parseFloat to strip unnecessary trailing zeros (3.00 -> 3, 0.10 -> 0.1, 0.04 -> 0.04)
    message += `${parseFloat(cpuLoad.loadAvg5.toFixed(2))}/${cpuLoad.cpuCount} CPU cores\n\n`;
  }

  // Memory section (if provided)
  // Threshold: Blocks new commands when usage >= 65%
  if (memory) {
    message += 'RAM\n';
    const usedBar = getProgressBar(memory.usedPercentage, DISPLAY_THRESHOLDS.RAM);
    const suffix = memory.usedPercentage >= DISPLAY_THRESHOLDS.RAM ? ' ⚠️' : ' used';
    message += `${usedBar} ${memory.usedPercentage}%${suffix}\n`;
    message += `${formatBytesRange(memory.usedBytes, memory.totalBytes)}\n\n`;
  }

  // Disk space section (if provided)
  // Threshold: One-at-a-time mode when usage >= 90%
  if (diskSpace) {
    message += 'Disk space\n';
    // Show used percentage with progress bar and threshold marker
    const usedBar = getProgressBar(diskSpace.usedPercentage, DISPLAY_THRESHOLDS.DISK);
    const suffix = diskSpace.usedPercentage >= DISPLAY_THRESHOLDS.DISK ? ' ⚠️' : ' used';
    message += `${usedBar} ${diskSpace.usedPercentage}%${suffix}\n`;
    message += `${formatBytesRange(diskSpace.usedBytes, diskSpace.totalBytes)}\n\n`;
  }

  // GitHub API rate limits section (if provided)
  // Threshold: Blocks parallel claude commands when >= 75%
  if (githubRateLimit) {
    message += 'GitHub API\n';
    // Show used percentage with progress bar and threshold marker
    const usedBar = getProgressBar(githubRateLimit.usedPercentage, DISPLAY_THRESHOLDS.GITHUB_API);
    const suffix = githubRateLimit.usedPercentage >= DISPLAY_THRESHOLDS.GITHUB_API ? ' ⚠️' : ' used';
    message += `${usedBar} ${githubRateLimit.usedPercentage}%${suffix}\n`;
    message += `${githubRateLimit.used}/${githubRateLimit.limit} requests\n`;
    if (githubRateLimit.relativeReset) {
      message += `Resets in ${githubRateLimit.relativeReset} (${githubRateLimit.resetTime})\n`;
    } else if (githubRateLimit.resetTime) {
      message += `Resets ${githubRateLimit.resetTime}\n`;
    }
    message += '\n';
  }

  // Claude 5 hour session (five_hour)
  // Threshold: One-at-a-time mode when usage >= 65%
  message += 'Claude 5 hour session\n';
  if (claudeError) {
    message += `${claudeError}\n`;
  } else if (usage && usage.currentSession.percentage !== null) {
    // Add time passed progress bar first (no threshold marker for time)
    const timePassed = calculateTimePassedPercentage(usage.currentSession.resetsAt, 5);
    if (timePassed !== null) {
      const timeBar = getProgressBar(timePassed);
      message += `${timeBar} ${timePassed}% passed\n`;
    }

    // Add usage progress bar second with threshold marker
    // Use Math.floor so 100% only appears when usage is exactly 100%
    // See: https://github.com/link-assistant/hive-mind/issues/1133
    const pct = Math.floor(usage.currentSession.percentage);
    const bar = getProgressBar(pct, DISPLAY_THRESHOLDS.CLAUDE_5_HOUR_SESSION);
    const suffix = pct >= DISPLAY_THRESHOLDS.CLAUDE_5_HOUR_SESSION ? ' ⚠️' : ' used';
    message += `${bar} ${pct}%${suffix}\n`;

    if (usage.currentSession.resetTime) {
      const relativeTime = formatRelativeTime(usage.currentSession.resetsAt);
      if (relativeTime) {
        message += `Resets in ${relativeTime} (${usage.currentSession.resetTime})\n`;
      } else {
        message += `Resets ${usage.currentSession.resetTime}\n`;
      }
    }
  } else {
    message += 'N/A\n';
  }
  message += '\n';

  // Current week (all models / seven_day)
  // Threshold: One-at-a-time mode when usage >= 97%
  message += 'Current week (all models)\n';
  if (claudeError) {
    message += `${claudeError}\n`;
  } else if (usage && usage.allModels.percentage !== null) {
    // Add time passed progress bar first (no threshold marker for time)
    const timePassed = calculateTimePassedPercentage(usage.allModels.resetsAt, 168);
    if (timePassed !== null) {
      const timeBar = getProgressBar(timePassed);
      message += `${timeBar} ${timePassed}% passed\n`;
    }

    // Add usage progress bar second with threshold marker
    // Use Math.floor so 100% only appears when usage is exactly 100%
    // See: https://github.com/link-assistant/hive-mind/issues/1133
    const pct = Math.floor(usage.allModels.percentage);
    const bar = getProgressBar(pct, DISPLAY_THRESHOLDS.CLAUDE_WEEKLY);
    const suffix = pct >= DISPLAY_THRESHOLDS.CLAUDE_WEEKLY ? ' ⚠️' : ' used';
    message += `${bar} ${pct}%${suffix}\n`;

    if (usage.allModels.resetTime) {
      const relativeTime = formatRelativeTime(usage.allModels.resetsAt);
      if (relativeTime) {
        message += `Resets in ${relativeTime} (${usage.allModels.resetTime})\n`;
      } else {
        message += `Resets ${usage.allModels.resetTime}\n`;
      }
    }
  } else {
    message += 'N/A\n';
  }
  message += '\n';

  // Current week (Sonnet only / seven_day_sonnet)
  // Threshold: One-at-a-time mode when usage >= 97% (same as all models)
  message += 'Current week (Sonnet only)\n';
  if (claudeError) {
    message += `${claudeError}\n`;
  } else if (usage && usage.sonnetOnly.percentage !== null) {
    // Add time passed progress bar first (no threshold marker for time)
    const timePassed = calculateTimePassedPercentage(usage.sonnetOnly.resetsAt, 168);
    if (timePassed !== null) {
      const timeBar = getProgressBar(timePassed);
      message += `${timeBar} ${timePassed}% passed\n`;
    }

    // Add usage progress bar second with threshold marker
    // Use Math.floor so 100% only appears when usage is exactly 100%
    // See: https://github.com/link-assistant/hive-mind/issues/1133
    const pct = Math.floor(usage.sonnetOnly.percentage);
    const bar = getProgressBar(pct, DISPLAY_THRESHOLDS.CLAUDE_WEEKLY);
    const suffix = pct >= DISPLAY_THRESHOLDS.CLAUDE_WEEKLY ? ' ⚠️' : ' used';
    message += `${bar} ${pct}%${suffix}\n`;

    if (usage.sonnetOnly.resetTime) {
      const relativeTime = formatRelativeTime(usage.sonnetOnly.resetsAt);
      if (relativeTime) {
        message += `Resets in ${relativeTime} (${usage.sonnetOnly.resetTime})\n`;
      } else {
        message += `Resets ${usage.sonnetOnly.resetTime}\n`;
      }
    }
  } else {
    message += 'N/A\n';
  }

  message += '```';
  return message;
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
  if (verbose) console.log('[VERBOSE] /limits-cache: Cache miss for Claude limits, fetching from API...');
  const result = await getClaudeUsageLimits(verbose);
  if (result.success) cache.set('claude', result, CACHE_TTL.USAGE_API);
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
  const [claude, github, memory, cpu, disk] = await Promise.all([getCachedClaudeLimits(verbose), getCachedGitHubLimits(verbose), getCachedMemoryInfo(verbose), getCachedCpuInfo(verbose), getCachedDiskInfo(verbose)]);
  return { claude, github, memory, cpu, disk };
}

export default {
  // Raw functions (no caching)
  getClaudeUsageLimits,
  getCpuLoadInfo,
  getMemoryInfo,
  getDiskSpaceInfo,
  getGitHubRateLimits,
  getProgressBar,
  calculateTimePassedPercentage,
  formatUsageMessage,
  // Threshold constants for progress bar visualization
  DISPLAY_THRESHOLDS,
  // Cache management
  CACHE_TTL,
  getLimitCache,
  resetLimitCache,
  // Cached functions
  getCachedClaudeLimits,
  getCachedGitHubLimits,
  getCachedMemoryInfo,
  getCachedCpuInfo,
  getCachedDiskInfo,
  getAllCachedLimits,
};
