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
 * Normalize an issue/PR URL for de-duplication: drop a trailing slash, drop any
 * `#fragment`, and lowercase. Two URLs that point at the same issue/PR collapse
 * to the same key so an item that is both in the queue's in-memory `processing`
 * Map and in the tracked-session list is listed only once (issue #1837).
 *
 * @param {string} url
 * @returns {string}
 */
function normalizeQueueUrl(url) {
  return typeof url === 'string' ? url.replace(/\/+$/, '').replace(/#.*$/, '').toLowerCase() : '';
}

/**
 * Build the list of tasks a tool is actively *executing* for the detailed queue
 * status, by merging the queue's in-memory `processing` items with the
 * externally-tracked running sessions (detached screen/isolation work),
 * de-duplicated by issue/PR URL.
 *
 * This is the fix for the follow-up on issue #1837: once a task is dispatched to
 * a detached session the queue's own `processing` Map is emptied, so the running
 * task — although still counted via `pgrep`/`$ --status` — was never listed.
 * Pulling the tracked running sessions in here makes executing tasks show up as
 * clickable links again.
 *
 * @param {object} opts
 * @param {Iterable} [opts.processingItems] - `this.processing.values()` (each with `tool`, `url`, `status`, `getWaitTime()`).
 * @param {Array} [opts.sessionItems] - Tracked running sessions (`{url, tool, startTime, status}`).
 * @param {string} opts.tool - Tool key to filter by.
 * @param {number} [opts.now] - Current epoch ms (injectable for tests).
 * @returns {Array<{url: string, queueStatus: (string|null), waitMs: number}>}
 */
export function collectExecutingItems({ processingItems = [], sessionItems = [], tool, now = Date.now() }) {
  const byKey = new Map();

  for (const item of processingItems) {
    if (item.tool !== tool) continue;
    const key = normalizeQueueUrl(item.url) || item.id;
    byKey.set(key, {
      url: item.url,
      queueStatus: item.status || null,
      waitMs: typeof item.getWaitTime === 'function' ? item.getWaitTime() : 0,
    });
  }

  for (const session of sessionItems) {
    if ((session.tool || 'claude') !== tool) continue;
    if (!session.url) continue; // can't render a clickable link without a URL
    const key = normalizeQueueUrl(session.url);
    if (key && byKey.has(key)) continue; // already represented by an in-memory item
    const startMs = session.startTime ? new Date(session.startTime).getTime() : null;
    byKey.set(key || session.sessionName, {
      url: session.url,
      // Tracked sessions report a backend status (e.g. 'executing'); fall back to
      // the generic "processing" label rendered by formatQueueProcessingItems.
      queueStatus: null,
      waitMs: startMs && !Number.isNaN(startMs) ? Math.max(0, now - startMs) : 0,
    });
  }

  return [...byKey.values()];
}

/**
 * Render the per-tool "executing" lines for the detailed queue status as a
 * compact, de-duplicated list (issue #1891):
 *
 *   `• owner/repo#number (▶️ 2h 14m 16s)`
 *
 * The ▶️ emoji replaces the repeated literal "processing" status word that
 * appeared on every line in the old format. Items are listed in full by
 * default; pass a finite `max` to cap them with a localized "... and N more"
 * line.
 *
 * @param {object} opts
 * @param {Array} opts.items - Output of {@link collectExecutingItems}.
 * @param {number} [opts.max=Infinity] - Maximum items before collapsing.
 * @param {string|null} opts.locale - Locale for labels/durations.
 * @returns {string} The formatted lines (empty string when no items).
 */
export function formatQueueExecutingItems({ items, max = Infinity, locale }) {
  if (!items || items.length === 0) return '';
  let out = '';
  for (const item of items.slice(0, max)) {
    out += `  • ${formatQueueItemLink(item.url)} (▶️ ${formatDuration(item.waitMs, { locale })})\n`;
  }
  if (items.length > max) {
    out += `    ... ${lt('queue_and_more', { count: items.length - max }, { locale })}\n`;
  }
  return out;
}

/**
 * Backwards-compatible alias for {@link formatQueueExecutingItems}.
 * @deprecated Use {@link formatQueueExecutingItems}.
 */
export const formatQueueProcessingItems = formatQueueExecutingItems;

/**
 * Render the per-tool "pending/waiting" lines for the detailed queue status as a
 * compact list (issue #1891):
 *
 *   `• owner/repo#number (⏳ 5m 2s)`
 *
 * The per-item waiting *reason* is deliberately omitted here — it is almost
 * always identical across pending items, so the caller shows it once for the
 * whole tool instead of repeating it on every line.
 *
 * @param {object} opts
 * @param {Array<{url: string, waitMs: number}>} opts.items - Pending items.
 * @param {number} [opts.max=Infinity] - Maximum items before collapsing.
 * @param {string|null} opts.locale - Locale for labels/durations.
 * @returns {string} The formatted lines (empty string when no items).
 */
export function formatQueuePendingItems({ items, max = Infinity, locale }) {
  if (!items || items.length === 0) return '';
  let out = '';
  for (const item of items.slice(0, max)) {
    out += `  • ${formatQueueItemLink(item.url)} (⏳ ${formatDuration(item.waitMs, { locale })})\n`;
  }
  if (items.length > max) {
    out += `    ... ${lt('queue_and_more', { count: items.length - max }, { locale })}\n`;
  }
  return out;
}

/**
 * Lazy wrapper around session-monitor's `getRunningSessionItems` so the queue
 * can list executing detached sessions without a static import (mirrors how the
 * queue lazily loads isolation-session counts). Returns an empty list on error
 * so the detailed status still renders (issue #1837).
 *
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Array>}
 */
export async function getRunningSessionItems(verbose = false) {
  try {
    const { getRunningSessionItems: impl } = await import('./session-monitor.lib.mjs');
    return await impl(verbose);
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /solve_queue error getting running session items:', error.message);
    }
    return [];
  }
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
