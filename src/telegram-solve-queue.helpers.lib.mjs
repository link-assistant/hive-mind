#!/usr/bin/env node

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Count running processes by name.
 * @param {string} processName - Process name to search for (e.g., 'claude', 'agent')
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{count: number, processes: string[]}>}
 */
export async function getRunningProcesses(processName, verbose = false) {
  try {
    const { stdout } = await execAsync(`pgrep -l -x ${processName} 2>/dev/null || true`);
    const lines = stdout
      .trim()
      .split('\n')
      .filter(line => line.trim());

    const processes = lines
      .map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          pid: parts[0],
          name: parts.slice(1).join(' ') || processName,
        };
      })
      .filter(p => p.pid);

    if (verbose) {
      console.log(`[VERBOSE] /solve_queue found ${processes.length} running ${processName} processes`);
      if (processes.length > 0) {
        console.log(`[VERBOSE] /solve_queue processes: ${JSON.stringify(processes)}`);
      }
    }

    return {
      count: processes.length,
      processes: processes.map(p => `${p.pid}:${p.name}`),
    };
  } catch (error) {
    if (verbose) {
      console.error(`[VERBOSE] /solve_queue error counting ${processName} processes:`, error.message);
    }
    return { count: 0, processes: [] };
  }
}

/**
 * Count running claude processes.
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{count: number, processes: string[]}>}
 */
export async function getRunningClaudeProcesses(verbose = false) {
  return getRunningProcesses('claude', verbose);
}

/**
 * Count running agent processes.
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{count: number, processes: string[]}>}
 */
export async function getRunningAgentProcesses(verbose = false) {
  return getRunningProcesses('agent', verbose);
}

/**
 * Count running codex processes.
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{count: number, processes: string[]}>}
 */
export async function getRunningCodexProcesses(verbose = false) {
  return getRunningProcesses('codex', verbose);
}

/**
 * Count running qwen processes.
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{count: number, processes: string[]}>}
 */
export async function getRunningQwenProcesses(verbose = false) {
  return getRunningProcesses('qwen', verbose);
}

/**
 * Format a threshold as percentage for display.
 * @param {number} ratio - Ratio (0.0 - 1.0)
 * @returns {string} Formatted percentage
 */
export function formatThresholdPercent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Format milliseconds into human-readable duration.
 * Shows days, hours, minutes, and seconds as appropriate.
 * Examples: "5h 43m 23s", "2m 15s", "45s", "1d 3h 12m 5s"
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Human-readable duration
 * @see https://github.com/link-assistant/hive-mind/issues/1267
 */
export function formatDuration(ms) {
  if (ms < 0) ms = 0;

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

/**
 * Generate human-readable waiting reason based on threshold violation.
 * @param {string} metric - The metric name (ram, cpu, disk, etc.)
 * @param {number} currentValue - Current value (as percentage 0-100)
 * @param {number} threshold - Threshold ratio (0.0 - 1.0)
 * @returns {string} Human-readable reason
 */
export function formatWaitingReason(metric, currentValue, threshold) {
  const thresholdPercent = formatThresholdPercent(threshold);
  const currentPercent = Math.round(currentValue);

  switch (metric) {
    case 'ram':
      return `RAM usage is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'cpu':
      return `CPU usage is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'disk':
      return `Disk usage is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'claude_5_hour_session':
      return `Claude 5 hour session limit is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'claude_weekly':
      return `Claude weekly limit is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'codex_5_hour_session':
      return `Codex 5 hour session limit is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'codex_weekly':
      return `Codex weekly limit is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'github':
      return `GitHub API usage is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'min_interval':
      return 'Minimum interval between commands not reached';
    case 'claude_running':
      return 'Claude process is already running';
    case 'codex_running':
      return 'Codex process is already running';
    case 'qwen_running':
      return 'Qwen Code process is already running';
    default:
      return `${metric} threshold exceeded`;
  }
}
