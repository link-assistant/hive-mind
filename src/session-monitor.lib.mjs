/**
 * Session monitoring for Telegram bot
 *
 * Tracks active screen sessions and sends notifications when they complete.
 * This module provides functions for monitoring screen sessions started by
 * /solve and /hive commands in the Telegram bot.
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

// Track active sessions for completion notifications
// Key: session name, Value: { chatId, startTime, url, command }
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
 * Track a new session for completion monitoring
 * @param {string} sessionName - Name of the screen session
 * @param {Object} sessionInfo - Session metadata
 * @param {number} sessionInfo.chatId - Telegram chat ID to notify
 * @param {Date} sessionInfo.startTime - When the session started
 * @param {string} sessionInfo.url - GitHub URL being processed
 * @param {string} sessionInfo.command - Command type (solve/hive)
 */
export function trackSession(sessionName, sessionInfo) {
  activeSessions.set(sessionName, sessionInfo);
}

/**
 * Get the number of active sessions being tracked
 * @returns {number} Number of active sessions
 */
export function getActiveSessionCount() {
  return activeSessions.size;
}

/**
 * Monitor active sessions and send notifications when they complete
 * @param {Object} bot - Telegraf bot instance for sending messages
 * @param {boolean} verbose - Whether to log verbose output
 */
export async function monitorSessions(bot, verbose = false) {
  if (activeSessions.size === 0) {
    return;
  }

  if (verbose) {
    console.log(`[VERBOSE] Checking ${activeSessions.size} active session(s)...`);
  }

  const sessionsToRemove = [];

  for (const [sessionName, sessionInfo] of activeSessions.entries()) {
    const stillExists = await checkScreenSessionExists(sessionName);

    if (!stillExists) {
      console.log(`Session ${sessionName} has finished. Sending notification to chat ${sessionInfo.chatId}`);

      try {
        const endTime = new Date();
        const duration = Math.round((endTime - sessionInfo.startTime) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;

        let message = `✅ *Work Session Completed*\n\n`;
        message += `📊 Session: \`${sessionName}\`\n`;
        message += `⏱️ Duration: ${minutes}m ${seconds}s\n`;
        message += `🔗 URL: ${sessionInfo.url}\n\n`;
        message += `The work session has finished. You can now review the results.`;

        await bot.telegram.sendMessage(sessionInfo.chatId, message, { parse_mode: 'Markdown' });

        sessionsToRemove.push(sessionName);
      } catch (error) {
        console.error(`Failed to send completion notification for ${sessionName}:`, error);
        // Still remove the session to avoid repeated failures
        sessionsToRemove.push(sessionName);
      }
    }
  }

  for (const sessionName of sessionsToRemove) {
    activeSessions.delete(sessionName);
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
  console.log('📊 Session monitoring started (checking every 30 seconds)');
  return timer;
}
