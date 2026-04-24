/**
 * Session monitoring for Telegram bot
 *
 * Tracks active sessions (screen-based or isolation-based) and sends
 * notifications when they complete.
 *
 * Two tracking modes:
 * 1. Screen mode (default): Uses `screen -ls` to detect session completion
 * 2. Isolation mode: Uses `$ --status <uuid>` from start-command CLI for reliable tracking
 *
 * Session state is stored in-memory. The `$` CLI (start-command) is accessed
 * purely via its CLI interface, not as a library dependency.
 *
 * @see https://github.com/link-foundation/start
 * @see https://github.com/link-assistant/hive-mind/issues/380
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

// Lazy import for isolation runner (only when needed)
let _isolationRunner = null;
async function getIsolationRunner() {
  if (!_isolationRunner) {
    _isolationRunner = await import('./isolation-runner.lib.mjs');
  }
  return _isolationRunner;
}
// In-memory session store
const activeSessions = new Map();

/**
 * Issue #1586: Timeout for non-isolation sessions.
 * Non-isolation (plain start-screen) sessions cannot reliably detect completion
 * because the screen stays alive via `exec bash`. To prevent false positives
 * that permanently block users, non-isolation sessions are auto-expired after
 * this timeout. This still prevents accidental duplicate commands within the
 * timeout window (5-10 minutes).
 *
 * Once --isolation is fully tested and becomes the default, this timeout
 * mechanism will no longer be needed.
 */
export const NON_ISOLATION_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Check if a screen session exists
 * @param {string} sessionName - Name of the screen session to check
 * @returns {Promise<boolean>} True if session exists, false otherwise
 */
export async function checkScreenSessionExists(sessionName) {
  try {
    const { stdout } = await exec('screen -ls');
    return stdout.includes(sessionName);
  } catch {
    // screen -ls returns exit code 1 when no sessions exist
    return false;
  }
}

/**
 * Track a new session for completion monitoring
 *
 * @param {string} sessionName - Name of the screen session or isolation session UUID
 * @param {Object} sessionInfo - Session metadata
 * @param {number} sessionInfo.chatId - Telegram chat ID to notify
 * @param {number} [sessionInfo.messageId] - Telegram message ID to update on completion
 * @param {Date} sessionInfo.startTime - When the session started
 * @param {string} sessionInfo.url - GitHub URL being processed
 * @param {string} sessionInfo.command - Command type (solve/hive)
 * @param {string} [sessionInfo.isolationBackend] - Isolation backend if using isolation mode
 * @param {string} [sessionInfo.sessionId] - UUID for isolation-based sessions
 * @param {boolean} verbose - Whether to log verbose output
 */
export function trackSession(sessionName, sessionInfo, verbose = false) {
  activeSessions.set(sessionName, sessionInfo);
  if (verbose) {
    const mode = sessionInfo.isolationBackend ? `isolation:${sessionInfo.isolationBackend}` : 'screen';
    console.log(`[VERBOSE] Session ${sessionName} tracked in memory (mode: ${mode})`);
  }
}

/**
 * Get the number of active sessions being tracked
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {number} Number of active sessions
 */
export function getActiveSessionCount(verbose = false) {
  if (verbose) {
    console.log(`[VERBOSE] Active sessions: ${activeSessions.size}`);
  }
  return activeSessions.size;
}

/**
 * Get all active sessions
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Array<{sessionName: string, sessionInfo: Object}>} Array of active sessions
 */
function getActiveSessions(verbose = false) {
  const sessions = [];
  for (const [sessionName, sessionInfo] of activeSessions.entries()) {
    sessions.push({ sessionName, sessionInfo });
  }
  if (verbose) {
    console.log(`[VERBOSE] Retrieved ${sessions.length} active session(s)`);
  }
  return sessions;
}

/**
 * Remove a session from tracking
 * @param {string} sessionName - Name of the session to remove
 * @param {boolean} verbose - Whether to log verbose output
 */
function completeSession(sessionName, exitCode = 0, verbose = false) {
  activeSessions.delete(sessionName);
  if (verbose) {
    console.log(`[VERBOSE] Session ${sessionName} removed from tracking (exit: ${exitCode})`);
  }
}

function normalizeSessionUrl(url) {
  return url.replace(/\/+$/, '').replace(/#.*$/, '').toLowerCase();
}

function isNonIsolationSessionActive(sessionName, sessionInfo, verbose = false) {
  const startTime = sessionInfo.startTime instanceof Date ? sessionInfo.startTime : new Date(sessionInfo.startTime);
  const elapsed = Date.now() - startTime.getTime();
  if (elapsed >= NON_ISOLATION_SESSION_TIMEOUT_MS) {
    if (verbose) {
      console.log(`[VERBOSE] Non-isolation session ${sessionName} expired after ${Math.round(elapsed / 1000)}s (timeout: ${NON_ISOLATION_SESSION_TIMEOUT_MS / 1000}s), removing from tracking`);
    }
    activeSessions.delete(sessionName);
    return false;
  }
  if (verbose) {
    const remainingSec = Math.round((NON_ISOLATION_SESSION_TIMEOUT_MS - elapsed) / 1000);
    console.log(`[VERBOSE] Non-isolation session ${sessionName} still within timeout (${remainingSec}s remaining)`);
  }
  return true;
}

async function getIsolationSessionState(sessionName, sessionInfo, options = {}) {
  const { verbose = false, statusProvider = null } = options;
  const sessionId = sessionInfo.sessionId || sessionName;

  try {
    const runner = await getIsolationRunner();
    const statusResult = statusProvider ? await statusProvider(sessionId, sessionInfo) : await runner.querySessionStatus(sessionId, verbose);

    if (statusResult?.exists && statusResult.status) {
      if (runner.isExecutingSessionStatus(statusResult.status)) {
        return { running: true, exitCode: null, status: statusResult.status, statusResult };
      }
      if (runner.isTerminalSessionStatus(statusResult.status)) {
        return {
          running: false,
          exitCode: statusResult.exitCode !== undefined ? statusResult.exitCode : null,
          status: statusResult.status,
          statusResult,
        };
      }
    }

    const running = await runner.isSessionRunning(sessionId, {
      backend: sessionInfo.isolationBackend,
      verbose,
    });
    return {
      running,
      exitCode: running ? null : (statusResult?.exitCode ?? null),
      status: statusResult?.status || null,
      statusResult,
    };
  } catch (error) {
    if (verbose) {
      console.error(`[VERBOSE] Error refreshing isolated session ${sessionId}: ${error.message}`);
    }
    return { running: false, exitCode: null, status: null, statusResult: null };
  }
}

/**
 * Monitor active sessions and send notifications when they complete
 * @param {Object} bot - Telegraf bot instance for sending messages
 * @param {boolean} verbose - Whether to log verbose output
 */
export async function monitorSessions(bot, verbose = false) {
  const sessions = getActiveSessions(verbose);

  if (sessions.length === 0) {
    return;
  }

  if (verbose) {
    console.log(`[VERBOSE] Checking ${sessions.length} active session(s)...`);
  }

  for (const { sessionName, sessionInfo } of sessions) {
    let stillRunning;
    let exitCode = null;

    if (sessionInfo.isolationBackend && sessionInfo.sessionId) {
      // Isolation mode: use $ --status, with screen -ls only as a fallback
      // when the status record is unavailable. Terminal $ statuses are
      // authoritative so completed screen sessions do not stay blocked.
      const state = await getIsolationSessionState(sessionName, sessionInfo, { verbose });
      stillRunning = state.running;
      exitCode = state.exitCode;
    } else {
      // Issue #1586: Non-isolation screen sessions cannot reliably detect
      // completion because start-screen keeps the screen alive via `exec bash`.
      // Auto-expire after timeout; within timeout, use screen -ls as best-effort.
      const startTime = sessionInfo.startTime instanceof Date ? sessionInfo.startTime : new Date(sessionInfo.startTime);
      const elapsed = Date.now() - startTime.getTime();
      if (elapsed >= NON_ISOLATION_SESSION_TIMEOUT_MS) {
        stillRunning = false;
        if (verbose) {
          console.log(`[VERBOSE] Non-isolation session ${sessionName} expired after ${Math.round(elapsed / 1000)}s (timeout: ${NON_ISOLATION_SESSION_TIMEOUT_MS / 1000}s)`);
        }
      } else {
        stillRunning = await checkScreenSessionExists(sessionName);
        if (verbose) {
          const remainingSec = Math.round((NON_ISOLATION_SESSION_TIMEOUT_MS - elapsed) / 1000);
          console.log(`[VERBOSE] Non-isolation session ${sessionName}: screen -ls says ${stillRunning ? 'running' : 'not found'} (timeout in ${remainingSec}s)`);
        }
      }
    }

    if (!stillRunning) {
      console.log(`Session ${sessionName} has finished. Sending notification to chat ${sessionInfo.chatId}`);

      try {
        const endTime = new Date();
        const startTime = sessionInfo.startTime instanceof Date ? sessionInfo.startTime : new Date(sessionInfo.startTime);
        const duration = Math.round((endTime - startTime) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;

        const statusEmoji = exitCode === null || exitCode === 0 ? '✅' : '❌';
        const statusText = exitCode === null || exitCode === 0 ? 'Completed' : `Failed (exit code: ${exitCode})`;
        const isolationInfo = sessionInfo.isolationBackend ? `\n🔒 Isolation: ${sessionInfo.isolationBackend}` : '';

        let message = `${statusEmoji} *Work Session ${statusText}*\n\n`;
        message += `📊 Session: \`${sessionName}\`\n`;
        message += `⏱️ Duration: ${minutes}m ${seconds}s\n`;
        message += `🔗 URL: ${sessionInfo.url}${isolationInfo}\n\n`;
        message += `The work session has finished. You can now review the results.`;

        // Update the original reply message if messageId is available, otherwise send new message
        if (sessionInfo.messageId) {
          await bot.telegram.editMessageText(sessionInfo.chatId, sessionInfo.messageId, undefined, message, { parse_mode: 'Markdown' });
        } else {
          await bot.telegram.sendMessage(sessionInfo.chatId, message, { parse_mode: 'Markdown' });
        }

        completeSession(sessionName, exitCode || 0, verbose);
      } catch (error) {
        console.error(`Failed to send completion notification for ${sessionName}:`, error);
        completeSession(sessionName, 1, verbose);
      }
    }
  }
}

/**
 * Start the session monitoring interval
 * @param {Object} bot - Telegraf bot instance for sending messages
 * @param {boolean} verbose - Whether to log verbose output
 * @param {number} intervalMs - Monitoring interval in milliseconds (default: 30000)
 * @returns {NodeJS.Timer} The interval timer (can be cleared with clearInterval)
 */
export function startSessionMonitoring(bot, verbose = false, intervalMs = 30000) {
  const timer = setInterval(() => monitorSessions(bot, verbose), intervalMs);
  console.log(`📊 Session monitoring started (checking every ${intervalMs / 1000} seconds, storage: in-memory)`);
  return timer;
}

/**
 * Issue #1567: Check if there's an active session for a given URL.
 * This prevents concurrent sessions on the same PR/issue, which causes
 * iteration number jumps, duplicate "Ready to merge" comments, and other
 * inconsistencies when two auto-restart-until-mergeable processes run
 * simultaneously.
 *
 * Issue #1586: Non-isolation sessions (plain start-screen) cannot reliably
 * detect completion because the screen stays alive via `exec bash`. To avoid
 * permanent false positives, non-isolation sessions are auto-expired after
 * NON_ISOLATION_SESSION_TIMEOUT_MS (10 minutes). Within that window they
 * still block duplicate commands for the same URL, which prevents accidental
 * re-runs. Isolation-backed sessions have no timeout since their completion
 * is reliably detected by monitorSessions().
 *
 * @param {string} url - The GitHub URL to check (issue or PR URL)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {{isActive: boolean, sessionName: string|null}} Whether an active session exists for this URL
 */
export function hasActiveSessionForUrl(url, verbose = false) {
  if (!url) return { isActive: false, sessionName: null };

  // Normalize the URL for comparison (remove trailing slashes, fragments, etc.)
  const normalizedUrl = normalizeSessionUrl(url);

  for (const [sessionName, sessionInfo] of activeSessions.entries()) {
    // Issue #1586: Auto-expire non-isolation sessions after timeout
    if (!sessionInfo.isolationBackend && !isNonIsolationSessionActive(sessionName, sessionInfo, verbose)) {
      continue;
    }
    if (sessionInfo.url && normalizeSessionUrl(sessionInfo.url) === normalizedUrl) {
      if (verbose) {
        const mode = sessionInfo.isolationBackend ? `isolation:${sessionInfo.isolationBackend}` : 'non-isolation (timeout-based)';
        console.log(`[VERBOSE] Found active session for URL ${url}: ${sessionName} (${mode})`);
      }
      return { isActive: true, sessionName };
    }
  }

  if (verbose) {
    console.log(`[VERBOSE] No active session found for URL ${url}`);
  }
  return { isActive: false, sessionName: null };
}

/**
 * Async active-session check for command handlers.
 *
 * Isolation-backed sessions are refreshed through `$ --status` before they
 * block a duplicate URL, so completed screen-isolated runs no longer require
 * waiting for the background polling interval.
 *
 * @param {string} url - The GitHub URL to check
 * @param {boolean} verbose - Whether to log verbose output
 * @param {Object} [options] - Test/support options
 * @param {Function} [options.statusProvider] - Optional `$ --status` provider
 * @returns {Promise<{isActive: boolean, sessionName: string|null, status?: string|null}>}
 */
export async function hasActiveSessionForUrlAsync(url, verbose = false, options = {}) {
  if (!url) return { isActive: false, sessionName: null };

  const normalizedUrl = normalizeSessionUrl(url);

  for (const [sessionName, sessionInfo] of activeSessions.entries()) {
    if (!sessionInfo.url || normalizeSessionUrl(sessionInfo.url) !== normalizedUrl) {
      continue;
    }

    if (!sessionInfo.isolationBackend) {
      if (isNonIsolationSessionActive(sessionName, sessionInfo, verbose)) {
        return { isActive: true, sessionName, status: null };
      }
      continue;
    }

    const state = await getIsolationSessionState(sessionName, sessionInfo, {
      verbose,
      statusProvider: options.statusProvider,
    });
    if (state.running) {
      if (verbose) {
        console.log(`[VERBOSE] Found executing isolated session for URL ${url}: ${sessionName} (status: ${state.status || 'unknown'})`);
      }
      return { isActive: true, sessionName, status: state.status || null };
    }

    if (verbose) {
      console.log(`[VERBOSE] Isolated session ${sessionName} for URL ${url} is no longer running (status: ${state.status || 'unknown'}), allowing retry while monitor sends completion`);
    }
    sessionInfo.lastKnownStatus = state.status || null;
    sessionInfo.lastKnownExitCode = state.exitCode ?? null;
  }

  if (verbose) {
    console.log(`[VERBOSE] No active session found for URL ${url}`);
  }
  return { isActive: false, sessionName: null };
}

/**
 * Refresh tracked isolation sessions and count only those that are executing.
 *
 * @param {boolean} verbose - Whether to log verbose output
 * @param {Object} [options] - Test/support options
 * @param {Function} [options.statusProvider] - Optional `$ --status` provider
 * @returns {Promise<{count: number, sessions: string[], byTool: Object}>}
 */
export async function getRunningTrackedIsolationSessions(verbose = false, options = {}) {
  const sessions = [];
  const byTool = {};

  for (const [sessionName, sessionInfo] of activeSessions.entries()) {
    if (!sessionInfo.isolationBackend) {
      continue;
    }

    const state = await getIsolationSessionState(sessionName, sessionInfo, {
      verbose,
      statusProvider: options.statusProvider,
    });

    if (!state.running) {
      sessionInfo.lastKnownStatus = state.status || null;
      sessionInfo.lastKnownExitCode = state.exitCode ?? null;
      continue;
    }

    const tool = sessionInfo.tool || 'claude';
    sessions.push(sessionName);
    byTool[tool] = (byTool[tool] || 0) + 1;
  }

  return { count: sessions.length, sessions, byTool };
}

/**
 * Get statistics about session tracking
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Object} Statistics object
 */
export function getSessionStats(verbose = false) {
  const sessions = Array.from(activeSessions.values());
  const isolated = sessions.filter(s => s.isolationBackend);

  if (verbose) {
    console.log(`[VERBOSE] Session stats: ${sessions.length} total, ${isolated.length} isolated`);
  }

  return {
    total: activeSessions.size,
    executing: activeSessions.size,
    executed: 0,
    successful: 0,
    failed: 0,
    isolated: isolated.length,
    storageType: 'in-memory',
  };
}
