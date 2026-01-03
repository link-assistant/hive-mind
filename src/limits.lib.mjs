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
 * Format an ISO date string to a human-readable reset time
 *
 * @param {string} isoDate - ISO date string (e.g., "2025-12-03T17:59:59.626485+00:00")
 * @param {boolean} includeTimezone - Whether to include timezone suffix (default: true)
 * @returns {string} Human-readable reset time (e.g., "Dec 3, 6:59pm UTC")
 */
function formatResetTime(isoDate, includeTimezone = true) {
  if (!isoDate) return null;

  try {
    const date = new Date(isoDate);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getUTCMonth()];
    const day = date.getUTCDate();
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();

    // Convert 24h to 12h format
    const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const ampm = hours >= 12 ? 'pm' : 'am';

    const timeStr = `${month} ${day}, ${hour12}:${minutes.toString().padStart(2, '0')}${ampm}`;
    return includeTimezone ? `${timeStr} UTC` : timeStr;
  } catch {
    return isoDate;
  }
}

/**
 * Format relative time from now to a future date
 *
 * @param {string} isoDate - ISO date string
 * @returns {string|null} Relative time string (e.g., "1h 34m" or "6d 20h 13m") or null if date is in the past
 */
function formatRelativeTime(isoDate) {
  if (!isoDate) return null;

  try {
    const now = new Date();
    const target = new Date(isoDate);
    const diffMs = target - now;

    // Check for invalid date (NaN)
    if (isNaN(diffMs)) return null;

    if (diffMs < 0) return null; // Past date

    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    // If hours >= 24, show days
    if (totalHours >= 24) {
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      return `${days}d ${hours}h ${minutes}m`;
    }

    return `${totalHours}h ${minutes}m`;
  } catch {
    return null;
  }
}

/**
 * Format current time in UTC
 *
 * @returns {string} Current time in UTC (e.g., "Dec 3, 6:45pm UTC")
 */
function formatCurrentTime() {
  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[now.getUTCMonth()];
  const day = now.getUTCDate();
  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();

  // Convert 24h to 12h format
  const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const ampm = hours >= 12 ? 'pm' : 'am';

  return `${month} ${day}, ${hour12}:${minutes.toString().padStart(2, '0')}${ampm} UTC`;
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

    // Calculate usage percentage based on load average vs CPU count
    // Load average of 1.0 per CPU = 100% utilization
    const usagePercentage = Math.min(100, Math.round((loadAvg1 / cpuCount) * 100));

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
 * @returns {string} Text-based progress bar
 */
export function getProgressBar(percentage) {
  const totalBlocks = 30;
  const filledBlocks = Math.round((percentage / 100) * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;
  return '\u2593'.repeat(filledBlocks) + '\u2591'.repeat(emptyBlocks);
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
 * @param {Object} usage - The usage object from getClaudeUsageLimits
 * @param {Object} diskSpace - Optional disk space info from getDiskSpaceInfo
 * @param {Object} githubRateLimit - Optional GitHub rate limit info from getGitHubRateLimits
 * @param {Object} cpuLoad - Optional CPU load info from getCpuLoadInfo
 * @param {Object} memory - Optional memory info from getMemoryInfo
 * @returns {string} Formatted message
 */
export function formatUsageMessage(usage, diskSpace = null, githubRateLimit = null, cpuLoad = null, memory = null) {
  // Use code block for monospace font to align progress bars properly
  let message = '```\n';

  // Show current time
  message += `Current time: ${formatCurrentTime()}\n\n`;

  // CPU load section (if provided)
  if (cpuLoad) {
    message += 'CPU\n';
    const usedBar = getProgressBar(cpuLoad.usagePercentage);
    message += `${usedBar} ${cpuLoad.usagePercentage}% used\n`;
    message += `Load avg: ${cpuLoad.loadAvg1.toFixed(2)} (1m) ${cpuLoad.loadAvg5.toFixed(2)} (5m) ${cpuLoad.loadAvg15.toFixed(2)} (15m)\n`;
    message += `${cpuLoad.cpuCount} CPU core${cpuLoad.cpuCount > 1 ? 's' : ''}\n\n`;
  }

  // Memory section (if provided)
  if (memory) {
    message += 'RAM\n';
    const usedBar = getProgressBar(memory.usedPercentage);
    message += `${usedBar} ${memory.usedPercentage}% used\n`;
    message += `${memory.usedFormatted} used of ${memory.totalFormatted}\n\n`;
  }

  // Disk space section (if provided)
  if (diskSpace) {
    message += 'Disk space\n';
    // Show used percentage with progress bar
    const usedBar = getProgressBar(diskSpace.usedPercentage);
    message += `${usedBar} ${diskSpace.usedPercentage}% used\n`;
    message += `${diskSpace.usedFormatted} used of ${diskSpace.totalFormatted}\n\n`;
  }

  // GitHub API rate limits section (if provided)
  if (githubRateLimit) {
    message += 'GitHub API\n';
    // Show used percentage with progress bar
    const usedBar = getProgressBar(githubRateLimit.usedPercentage);
    message += `${usedBar} ${githubRateLimit.usedPercentage}% used\n`;
    message += `${githubRateLimit.used}/${githubRateLimit.limit} requests used\n`;
    if (githubRateLimit.relativeReset) {
      message += `Resets in ${githubRateLimit.relativeReset} (${githubRateLimit.resetTime})\n`;
    } else if (githubRateLimit.resetTime) {
      message += `Resets ${githubRateLimit.resetTime}\n`;
    }
    message += '\n';
  }

  // Current session (five_hour)
  message += 'Current session\n';
  if (usage.currentSession.percentage !== null) {
    // Add time passed progress bar first
    const timePassed = calculateTimePassedPercentage(usage.currentSession.resetsAt, 5);
    if (timePassed !== null) {
      const timeBar = getProgressBar(timePassed);
      message += `${timeBar} ${timePassed}% passed\n`;
    }

    // Add usage progress bar second
    const pct = usage.currentSession.percentage;
    const bar = getProgressBar(pct);
    message += `${bar} ${pct}% used\n`;

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
  message += 'Current week (all models)\n';
  if (usage.allModels.percentage !== null) {
    // Add time passed progress bar first (168 hours = 7 days)
    const timePassed = calculateTimePassedPercentage(usage.allModels.resetsAt, 168);
    if (timePassed !== null) {
      const timeBar = getProgressBar(timePassed);
      message += `${timeBar} ${timePassed}% passed\n`;
    }

    // Add usage progress bar second
    const pct = usage.allModels.percentage;
    const bar = getProgressBar(pct);
    message += `${bar} ${pct}% used\n`;

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
  message += 'Current week (Sonnet only)\n';
  if (usage.sonnetOnly.percentage !== null) {
    // Add time passed progress bar first (168 hours = 7 days)
    const timePassed = calculateTimePassedPercentage(usage.sonnetOnly.resetsAt, 168);
    if (timePassed !== null) {
      const timeBar = getProgressBar(timePassed);
      message += `${timeBar} ${timePassed}% passed\n`;
    }

    // Add usage progress bar second
    const pct = usage.sonnetOnly.percentage;
    const bar = getProgressBar(pct);
    message += `${bar} ${pct}% used\n`;

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
 */
export const CACHE_TTL = {
  API: 180000, // 3 minutes for API calls (Claude, GitHub)
  SYSTEM: 120000, // 2 minutes for system metrics (RAM, CPU, disk)
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
  const cached = cache.get('claude', CACHE_TTL.API);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached Claude limits');
    return cached;
  }
  const result = await getClaudeUsageLimits(verbose);
  if (result.success) cache.set('claude', result, CACHE_TTL.API);
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
