/**
 * Session monitoring for Telegram bot
 *
 * Tracks active screen sessions and sends notifications when they complete.
 * This module uses the ExecutionStore from start-command for persistent storage,
 * allowing session tracking to survive bot restarts.
 *
 * @see https://github.com/link-foundation/start
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';

const exec = promisify(execCallback);

// Create require for CommonJS interop
const require = createRequire(import.meta.url);

// Import ExecutionStore from start-command package
// Note: Using subpath import until the package exports are updated
// See: https://github.com/link-foundation/start/issues/44
let ExecutionStore, ExecutionRecord, ExecutionStatus;
try {
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
        useLinks: false, // Don't require clink for the telegram bot
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
 * Track a new session for completion monitoring
 * Uses ExecutionStore for persistent storage if available, falls back to in-memory Map
 *
 * @param {string} sessionName - Name of the screen session
 * @param {Object} sessionInfo - Session metadata
 * @param {number} sessionInfo.chatId - Telegram chat ID to notify
 * @param {Date} sessionInfo.startTime - When the session started
 * @param {string} sessionInfo.url - GitHub URL being processed
 * @param {string} sessionInfo.command - Command type (solve/hive)
 * @param {boolean} verbose - Whether to log verbose output
 */
export function trackSession(sessionName, sessionInfo, verbose = false) {
  const store = getExecutionStore(verbose);

  if (store) {
    // Use ExecutionStore for persistent tracking
    const record = new ExecutionRecord({
      uuid: sessionName, // Use session name as UUID for easy lookup
      pid: null, // We don't have the actual PID of the screen session
      status: ExecutionStatus.EXECUTING,
      command: `${sessionInfo.command} ${sessionInfo.url}`,
      logPath: '', // Not applicable for telegram bot sessions
      startTime: sessionInfo.startTime.toISOString(),
      workingDirectory: process.cwd(),
      options: {
        chatId: sessionInfo.chatId,
        url: sessionInfo.url,
        commandType: sessionInfo.command,
        sessionName: sessionName,
      },
    });

    try {
      store.save(record);
      if (verbose) {
        console.log(`[VERBOSE] Session ${sessionName} tracked in ExecutionStore`);
      }
    } catch (error) {
      console.error(`Failed to save session ${sessionName} to ExecutionStore:`, error.message);
      // Fall back to in-memory storage
      inMemorySessions.set(sessionName, sessionInfo);
    }
  } else {
    // Fall back to in-memory storage
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
          sessionName: record.uuid,
          sessionInfo: {
            chatId: record.options?.chatId,
            startTime: new Date(record.startTime),
            url: record.options?.url,
            command: record.options?.commandType,
          },
        });
      }
    } catch (error) {
      console.error('Failed to get sessions from ExecutionStore:', error.message);
      // Fall through to in-memory sessions
    }
  }

  // Also include in-memory sessions
  for (const [sessionName, sessionInfo] of inMemorySessions.entries()) {
    // Avoid duplicates
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
      const record = store.get(sessionName);
      if (record) {
        record.complete(exitCode);
        store.save(record);
        if (verbose) {
          console.log(`[VERBOSE] Session ${sessionName} marked as completed in ExecutionStore`);
        }
      }
    } catch (error) {
      console.error(`Failed to complete session ${sessionName} in ExecutionStore:`, error.message);
    }
  }

  // Also remove from in-memory if present
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
    const stillExists = await checkScreenSessionExists(sessionName);

    if (!stillExists) {
      console.log(`Session ${sessionName} has finished. Sending notification to chat ${sessionInfo.chatId}`);

      try {
        const endTime = new Date();
        const startTime = sessionInfo.startTime instanceof Date ? sessionInfo.startTime : new Date(sessionInfo.startTime);
        const duration = Math.round((endTime - startTime) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;

        let message = `✅ *Work Session Completed*\n\n`;
        message += `📊 Session: \`${sessionName}\`\n`;
        message += `⏱️ Duration: ${minutes}m ${seconds}s\n`;
        message += `🔗 URL: ${sessionInfo.url}\n\n`;
        message += `The work session has finished. You can now review the results.`;

        await bot.telegram.sendMessage(sessionInfo.chatId, message, { parse_mode: 'Markdown' });

        // Mark session as completed
        completeSession(sessionName, 0, verbose);
      } catch (error) {
        console.error(`Failed to send completion notification for ${sessionName}:`, error);
        // Still mark the session as completed to avoid repeated failures
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
      return store.getStats();
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
    storageType: 'in-memory',
  };
}
