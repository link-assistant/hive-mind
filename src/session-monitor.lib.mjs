/**
 * Session monitoring for Telegram bot
 *
 * Tracks active sessions (screen-based or isolation-based) and sends
 * notifications when they complete.
 *
 * Two tracking modes:
 * 1. Screen mode (default): Uses `screen -ls` to detect session completion
 * 2. Isolation mode: Uses `$ --status <uuid>` from start-command for reliable tracking
 *
 * @see https://github.com/link-foundation/start
 * @see https://github.com/link-assistant/hive-mind/issues/380
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';

const exec = promisify(execCallback);
const require = createRequire(import.meta.url);

// Import ExecutionStore from start-command package
let ExecutionStore, ExecutionRecord, ExecutionStatus;
try {
  const executionStoreModule = require('start-command/execution-store');
  ExecutionStore = executionStoreModule.ExecutionStore;
  ExecutionRecord = executionStoreModule.ExecutionRecord;
  ExecutionStatus = executionStoreModule.ExecutionStatus;
} catch {
  try {
    // Fallback to subpath import
    const executionStoreModule = require('start-command/src/lib/execution-store.js');
    ExecutionStore = executionStoreModule.ExecutionStore;
    ExecutionRecord = executionStoreModule.ExecutionRecord;
    ExecutionStatus = executionStoreModule.ExecutionStatus;
  } catch (error) {
    console.warn('Warning: Could not load ExecutionStore from start-command. Falling back to in-memory storage.');
    console.warn('Install start-command to enable persistent session tracking: npm install start-command');
    console.warn('Error:', error.message);
    ExecutionStore = null;
    ExecutionRecord = null;
    ExecutionStatus = null;
  }
}

// Lazy import for isolation runner (only when needed)
let _querySessionStatus = null;
async function getQuerySessionStatus() {
  if (!_querySessionStatus) {
    const mod = await import('./isolation-runner.lib.mjs');
    _querySessionStatus = mod.querySessionStatus;
  }
  return _querySessionStatus;
}

// Configuration for the telegram bot session store
const TELEGRAM_BOT_APP_FOLDER = path.join(os.homedir(), '.hive-mind', 'telegram-sessions');

// Global execution store instance (lazy initialized)
let executionStore = null;

// Fallback in-memory store when ExecutionStore is not available
const inMemorySessions = new Map();

/**
 * Get or create the execution store instance
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {ExecutionStore|null} The execution store instance or null if not available
 */
function getExecutionStore(verbose = false) {
  if (!ExecutionStore) {
    return null;
  }

  if (!executionStore) {
    try {
      executionStore = new ExecutionStore({
        appFolder: TELEGRAM_BOT_APP_FOLDER,
        verbose: verbose,
        useLinks: false,
      });
      if (verbose) {
        console.log(`[VERBOSE] ExecutionStore initialized at ${TELEGRAM_BOT_APP_FOLDER}`);
      }
    } catch (error) {
      console.error('Failed to initialize ExecutionStore:', error.message);
      return null;
    }
  }

  return executionStore;
}

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
 * Uses ExecutionStore for persistent storage if available, falls back to in-memory Map
 *
 * @param {string} sessionName - Name of the screen session or isolation session UUID
 * @param {Object} sessionInfo - Session metadata
 * @param {number} sessionInfo.chatId - Telegram chat ID to notify
 * @param {Date} sessionInfo.startTime - When the session started
 * @param {string} sessionInfo.url - GitHub URL being processed
 * @param {string} sessionInfo.command - Command type (solve/hive)
 * @param {string} [sessionInfo.isolationBackend] - Isolation backend if using isolation mode
 * @param {string} [sessionInfo.sessionId] - UUID for isolation-based sessions
 * @param {boolean} verbose - Whether to log verbose output
 */
export function trackSession(sessionName, sessionInfo, verbose = false) {
  const store = getExecutionStore(verbose);

  if (store) {
    const record = new ExecutionRecord({
      uuid: sessionInfo.sessionId || sessionName,
      pid: null,
      status: ExecutionStatus.EXECUTING,
      command: `${sessionInfo.command} ${sessionInfo.url}`,
      logPath: '',
      startTime: sessionInfo.startTime.toISOString(),
      workingDirectory: process.cwd(),
      options: {
        chatId: sessionInfo.chatId,
        url: sessionInfo.url,
        commandType: sessionInfo.command,
        sessionName: sessionName,
        isolationBackend: sessionInfo.isolationBackend || null,
        sessionId: sessionInfo.sessionId || null,
      },
    });

    try {
      store.save(record);
      if (verbose) {
        const mode = sessionInfo.isolationBackend ? `isolation:${sessionInfo.isolationBackend}` : 'screen';
        console.log(`[VERBOSE] Session ${sessionName} tracked in ExecutionStore (mode: ${mode})`);
      }
    } catch (error) {
      console.error(`Failed to save session ${sessionName} to ExecutionStore:`, error.message);
      inMemorySessions.set(sessionName, sessionInfo);
    }
  } else {
    inMemorySessions.set(sessionName, sessionInfo);
    if (verbose) {
      console.log(`[VERBOSE] Session ${sessionName} tracked in memory (ExecutionStore not available)`);
    }
  }
}

/**
 * Get the number of active sessions being tracked
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {number} Number of active sessions
 */
export function getActiveSessionCount(verbose = false) {
  const store = getExecutionStore(verbose);

  if (store) {
    try {
      const executing = store.getExecuting();
      return executing.length;
    } catch (error) {
      console.error('Failed to get session count from ExecutionStore:', error.message);
      return inMemorySessions.size;
    }
  }

  return inMemorySessions.size;
}

/**
 * Get all active sessions
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Array<{sessionName: string, sessionInfo: Object}>} Array of active sessions
 */
function getActiveSessions(verbose = false) {
  const store = getExecutionStore(verbose);
  const sessions = [];

  if (store) {
    try {
      const executing = store.getExecuting();
      for (const record of executing) {
        sessions.push({
          sessionName: record.options?.sessionName || record.uuid,
          sessionInfo: {
            chatId: record.options?.chatId,
            startTime: new Date(record.startTime),
            url: record.options?.url,
            command: record.options?.commandType,
            isolationBackend: record.options?.isolationBackend || null,
            sessionId: record.options?.sessionId || null,
          },
        });
      }
    } catch (error) {
      console.error('Failed to get sessions from ExecutionStore:', error.message);
    }
  }

  // Also include in-memory sessions
  for (const [sessionName, sessionInfo] of inMemorySessions.entries()) {
    if (!sessions.find(s => s.sessionName === sessionName)) {
      sessions.push({ sessionName, sessionInfo });
    }
  }

  return sessions;
}

/**
 * Mark a session as completed and remove it from tracking
 * @param {string} sessionName - Name of the session to complete
 * @param {number} exitCode - Exit code (0 for success)
 * @param {boolean} verbose - Whether to log verbose output
 */
function completeSession(sessionName, exitCode = 0, verbose = false) {
  const store = getExecutionStore(verbose);

  if (store) {
    try {
      // Try by session name first, then by UUID
      let record = store.get(sessionName);
      if (!record) {
        // Search through executing records for matching sessionName in options
        const executing = store.getExecuting();
        const match = executing.find(r => r.options?.sessionName === sessionName || r.options?.sessionId === sessionName);
        if (match) record = match;
      }
      if (record) {
        record.complete(exitCode);
        store.save(record);
        if (verbose) {
          console.log(`[VERBOSE] Session ${sessionName} marked as completed in ExecutionStore (exit: ${exitCode})`);
        }
      }
    } catch (error) {
      console.error(`Failed to complete session ${sessionName} in ExecutionStore:`, error.message);
    }
  }

  inMemorySessions.delete(sessionName);
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

        await bot.telegram.sendMessage(sessionInfo.chatId, message, { parse_mode: 'Markdown' });

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
  const store = getExecutionStore(verbose);
  const storageType = store ? 'persistent (ExecutionStore)' : 'in-memory';

  const timer = setInterval(() => monitorSessions(bot, verbose), intervalMs);
  console.log(`📊 Session monitoring started (checking every ${intervalMs / 1000} seconds, storage: ${storageType})`);

  // On startup, check for any sessions that were running before the bot restarted
  if (store) {
    const existingSessions = getActiveSessions(verbose);
    if (existingSessions.length > 0) {
      console.log(`📋 Found ${existingSessions.length} session(s) from previous run, resuming monitoring...`);
    }
  }

  return timer;
}

/**
 * Get statistics about session tracking
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Object} Statistics object
 */
export function getSessionStats(verbose = false) {
  const store = getExecutionStore(verbose);

  if (store) {
    try {
      const all = store.getAll();
      const executing = all.filter(r => r.status === 'executing');
      const executed = all.filter(r => r.status === 'executed');
      const successful = executed.filter(r => r.exitCode === 0);
      const failed = executed.filter(r => r.exitCode !== 0);
      const isolated = all.filter(r => r.options?.isolationBackend);

      return {
        total: all.length,
        executing: executing.length,
        executed: executed.length,
        successful: successful.length,
        failed: failed.length,
        isolated: isolated.length,
        storageType: 'persistent',
      };
    } catch (error) {
      console.error('Failed to get stats from ExecutionStore:', error.message);
    }
  }

  return {
    total: inMemorySessions.size,
    executing: inMemorySessions.size,
    executed: 0,
    successful: 0,
    failed: 0,
    isolated: 0,
    storageType: 'in-memory',
  };
}
