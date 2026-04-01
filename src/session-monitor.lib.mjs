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
let _querySessionStatus = null;
async function getQuerySessionStatus() {
  if (!_querySessionStatus) {
    const mod = await import('./isolation-runner.lib.mjs');
    _querySessionStatus = mod.querySessionStatus;
  }
  return _querySessionStatus;
}

// In-memory session store
const activeSessions = new Map();

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
 * Check if an isolated session is still running using $ --status
 * @param {string} sessionId - UUID of the isolated session
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<boolean>} True if session is still running
 */
async function checkIsolatedSessionRunning(sessionId, verbose = false) {
  try {
    const queryStatus = await getQuerySessionStatus();
    const result = await queryStatus(sessionId, verbose);
    return result.exists && result.status === 'executing';
  } catch (error) {
    if (verbose) {
      console.error(`[VERBOSE] Error checking isolated session ${sessionId}: ${error.message}`);
    }
    return false;
  }
}

/**
 * Get the exit code of a completed isolated session
 * @param {string} sessionId - UUID of the isolated session
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<number|null>} Exit code or null if unknown
 */
async function getIsolatedSessionExitCode(sessionId, verbose = false) {
  try {
    const queryStatus = await getQuerySessionStatus();
    const result = await queryStatus(sessionId, verbose);
    if (result.exists && result.status === 'executed') {
      return result.exitCode;
    }
    return null;
  } catch {
    return null;
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
      // Isolation mode: use $ --status for reliable tracking
      stillRunning = await checkIsolatedSessionRunning(sessionInfo.sessionId, verbose);
      if (!stillRunning) {
        exitCode = await getIsolatedSessionExitCode(sessionInfo.sessionId, verbose);
      }
    } else {
      // Screen mode: use screen -ls for detection
      stillRunning = await checkScreenSessionExists(sessionName);
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
