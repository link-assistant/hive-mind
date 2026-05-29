#!/usr/bin/env node

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { lt } from './limits-i18n.lib.mjs';

const execAsync = promisify(exec);

/**
 * Build a clickable, human-readable link to a queued issue/PR for the
 * /solve_queue (/queue) detailed status (issue #1837).
 *
 * For GitHub issue/PR URLs we render a compact `[owner/repo#number](url)`
 * Markdown link so the list is scannable and clickable. When the label would
 * contain Markdown-special characters (e.g. `_` or `*` in an owner/repo name)
 * that could break Telegram's legacy Markdown parser, we fall back to the bare
 * URL — which Telegram still auto-links and renders as clickable.
 *
 * Non-GitHub or unparseable URLs also fall back to the bare URL.
 *
 * @param {string} url - The issue/PR URL.
 * @returns {string} A Markdown link or bare URL safe for `parse_mode: 'Markdown'`.
 */
export function formatQueueItemLink(url) {
  if (!url || typeof url !== 'string') return String(url ?? '');
  const match = url.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)/i);
  if (!match) return url;
  const [, owner, repo, number] = match;
  const label = `${owner}/${repo}#${number}`;
  // Only build a Markdown link when the label has no Markdown-special chars
  // that would break the legacy parser inside link text. Otherwise the bare
  // URL is still clickable in Telegram.
  if (/^[A-Za-z0-9/#.-]+$/.test(label)) {
    return `[${label}](${url})`;
  }
  return url;
}

/**
 * Render a history section (Completed / Failed) for the detailed queue status
 * as a clickable list, most-recent-first, capped at `max` items with a
 * "... and N more" line (issue #1837).
 *
 * @param {object} opts
 * @param {Array} opts.items - History items (each with `url`, optional `error`).
 * @param {string} opts.emoji - Leading emoji for each row (e.g. '✅' or '❌').
 * @param {string} opts.label - Localized section heading.
 * @param {number} opts.max - Maximum items to list before collapsing.
 * @param {string|null} opts.locale - Locale for the "and N more" label.
 * @param {boolean} [opts.withError] - Append `— error` when the item failed.
 * @returns {string} The formatted section (empty string when no items).
 */
export function formatQueueHistorySection({ items, emoji, label, max, locale, withError = false }) {
  if (!items || items.length === 0) return '';
  let section = `*${label}* (${items.length}):\n`;
  for (const item of [...items].reverse().slice(0, max)) {
    section += `  ${emoji} ${formatQueueItemLink(item.url)}`;
    if (withError && item.error) section += ` — ${item.error}`;
    section += '\n';
  }
  if (items.length > max) {
    section += `    ... ${lt('queue_and_more', { count: items.length - max }, { locale })}\n`;
  }
  return `${section}\n`;
}

/**
 * Count running processes by name.
 * @param {string} processName - Process name to search for (e.g., 'claude', 'agent', 'codex', 'gemini')
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
 * Count running gemini processes.
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{count: number, processes: string[]}>}
 */
export async function getRunningGeminiProcesses(verbose = false) {
  return getRunningProcesses('gemini', verbose);
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
export function formatDuration(ms, options = {}) {
  if (ms < 0) ms = 0;
  const locale = typeof options === 'string' ? options : options?.locale || null;

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const labels =
    locale && locale !== 'en'
      ? {
          day: lt('duration_day_short', {}, { locale }),
          hour: lt('duration_hour_short', {}, { locale }),
          minute: lt('duration_minute_short', {}, { locale }),
          second: lt('duration_second_short', {}, { locale }),
        }
      : {
          day: 'd',
          hour: 'h',
          minute: 'm',
          second: 's',
        };

  const parts = [];
  if (days > 0) parts.push(`${days}${locale && locale !== 'en' ? ' ' : ''}${labels.day}`);
  if (hours > 0) parts.push(`${hours}${locale && locale !== 'en' ? ' ' : ''}${labels.hour}`);
  if (minutes > 0) parts.push(`${minutes}${locale && locale !== 'en' ? ' ' : ''}${labels.minute}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}${locale && locale !== 'en' ? ' ' : ''}${labels.second}`);

  return parts.join(' ');
}

/**
 * Generate human-readable waiting reason based on threshold violation.
 * @param {string} metric - The metric name (ram, cpu, disk, etc.)
 * @param {number} currentValue - Current value (as percentage 0-100)
 * @param {number} threshold - Threshold ratio (0.0 - 1.0)
 * @returns {string} Human-readable reason
 */
export function formatWaitingReason(metric, currentValue, threshold, options = {}) {
  const locale = typeof options === 'string' ? options : options?.locale || null;
  const thresholdPercent = formatThresholdPercent(threshold);
  const currentPercent = Math.round(currentValue);
  const params = { currentPercent, thresholdPercent, metric };

  if (locale && locale !== 'en') {
    switch (metric) {
      case 'ram':
        return lt('reason_ram_usage', params, { locale });
      case 'cpu':
        return lt('reason_cpu_usage', params, { locale });
      case 'disk':
        return lt('reason_disk_usage', params, { locale });
      case 'claude_5_hour_session':
        return lt('reason_claude_5_hour_session', params, { locale });
      case 'claude_weekly':
        return lt('reason_claude_weekly', params, { locale });
      case 'codex_5_hour_session':
        return lt('reason_codex_5_hour_session', params, { locale });
      case 'codex_weekly':
        return lt('reason_codex_weekly', params, { locale });
      case 'github':
        return lt('reason_github_api', params, { locale });
      case 'min_interval':
        return lt('reason_min_interval', params, { locale });
      case 'claude_running':
        return lt('reason_claude_running', params, { locale });
      case 'codex_running':
        return lt('reason_codex_running', params, { locale });
      case 'qwen_running':
        return lt('reason_qwen_running', params, { locale });
      case 'gemini_running':
        return lt('reason_gemini_running', params, { locale });
      default:
        return lt('reason_threshold_exceeded', params, { locale });
    }
  }

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
    case 'gemini_running':
      return 'Gemini CLI process is already running';
    default:
      return `${metric} threshold exceeded`;
  }
}
