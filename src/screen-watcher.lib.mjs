// screen-watcher.lib.mjs - Monitor screen sessions and update Telegram messages
// This module provides functionality to watch screen output and update Telegram messages in real-time

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';

const execAsync = promisify(exec);

/**
 * Check if a screen session exists and is running
 * @param {string} sessionName - The name of the screen session
 * @returns {Promise<boolean>} Whether the session exists
 */
export async function isScreenSessionRunning(sessionName) {
  try {
    const { stdout } = await execAsync('screen -ls');
    // Match the session name more precisely to avoid partial matches
    const sessionPattern = new RegExp(`\\t\\d+\\.${sessionName}\\t`, 'm');
    return sessionPattern.test(stdout);
  } catch {
    // screen -ls returns non-zero exit code when no sessions exist
    return false;
  }
}

/**
 * Get the hardcopy output from a screen session
 * Screen's hardcopy command dumps the current visible content to a file
 * @param {string} sessionName - The name of the screen session
 * @returns {Promise<string>} The current screen output
 */
export async function getScreenOutput(sessionName) {
  const tempFile = `/tmp/screen-hardcopy-${sessionName}-${Date.now()}.txt`;

  try {
    // Use screen's hardcopy command to dump current screen content to a file
    await execAsync(`screen -S ${sessionName} -X hardcopy ${tempFile}`);

    // Wait a bit for the file to be written
    await new Promise(resolve => setTimeout(resolve, 100));

    // Read the file content
    const content = await readFile(tempFile, 'utf-8');

    // Clean up the temp file
    await execAsync(`rm -f ${tempFile}`).catch(() => {});

    return content;
  } catch (error) {
    // Clean up on error
    await execAsync(`rm -f ${tempFile}`).catch(() => {});
    throw error;
  }
}

/**
 * Get the last N lines from screen output
 * @param {string} content - The full screen content
 * @param {number} lines - Number of lines to extract from the end
 * @returns {string} The last N lines
 */
export function getLastLines(content, lines = 20) {
  if (!content) return '';

  const allLines = content.split('\n');
  const lastLines = allLines.slice(-lines);

  // Remove leading/trailing empty lines
  while (lastLines.length > 0 && lastLines[0].trim() === '') {
    lastLines.shift();
  }
  while (lastLines.length > 0 && lastLines[lastLines.length - 1].trim() === '') {
    lastLines.pop();
  }

  return lastLines.join('\n');
}

/**
 * Format screen output as a code block for Telegram
 * Telegram has a 4096 character limit for messages
 * @param {string} output - The screen output
 * @param {number} maxLength - Maximum length (default: 3800 to leave room for formatting)
 * @returns {string} Formatted output
 */
export function formatOutputForTelegram(output, maxLength = 3800) {
  let formatted = output;

  if (formatted.length > maxLength) {
    // Truncate and add indicator
    formatted = formatted.slice(-maxLength);
    // Try to start at a line boundary
    const firstNewline = formatted.indexOf('\n');
    if (firstNewline > 0 && firstNewline < 100) {
      formatted = formatted.slice(firstNewline + 1);
    }
    formatted = '...[truncated]\n' + formatted;
  }

  return '```\n' + formatted + '\n```';
}

/**
 * Watch a screen session and update a Telegram message with its output
 * @param {Object} options - Watch options
 * @param {string} options.sessionName - The screen session name
 * @param {Object} options.bot - Telegraf bot instance
 * @param {number} options.chatId - Telegram chat ID
 * @param {number} options.messageId - Telegram message ID to update
 * @param {number} options.interval - Update interval in milliseconds (default: 2000)
 * @param {Function} options.onComplete - Callback when session completes
 * @param {boolean} options.verbose - Enable verbose logging
 * @returns {Object} Control object with stop() method
 */
export function watchScreenSession(options) {
  const {
    sessionName,
    bot,
    chatId,
    messageId,
    interval = 2000,
    onComplete,
    verbose = false
  } = options;

  let isWatching = true;
  let lastOutput = '';
  let lastUpdateTime = 0;
  let updateCount = 0;
  const minUpdateInterval = 1500; // Minimum time between Telegram API calls (rate limiting)

  const watch = async () => {
    while (isWatching) {
      try {
        // Check if session still exists
        const isRunning = await isScreenSessionRunning(sessionName);

        if (!isRunning) {
          if (verbose) {
            console.log(`[screen-watcher] Session ${sessionName} has ended`);
          }
          isWatching = false;
          if (onComplete) {
            await onComplete();
          }
          break;
        }

        // Get current screen output
        const output = await getScreenOutput(sessionName);
        const lastLines = getLastLines(output, 25);

        // Only update if output has changed
        if (lastLines !== lastOutput) {
          const now = Date.now();
          const timeSinceLastUpdate = now - lastUpdateTime;

          // Respect rate limiting
          if (timeSinceLastUpdate >= minUpdateInterval) {
            const formattedOutput = formatOutputForTelegram(lastLines);
            const statusLine = `🔄 Live Terminal Output (Session: \`${sessionName}\`)\nUpdates: ${++updateCount}\n\n`;

            try {
              await bot.telegram.editMessageText(
                chatId,
                messageId,
                null,
                statusLine + formattedOutput,
                { parse_mode: 'Markdown' }
              );

              lastOutput = lastLines;
              lastUpdateTime = now;

              if (verbose) {
                console.log(`[screen-watcher] Updated message (update #${updateCount})`);
              }
            } catch (error) {
              // Ignore "message is not modified" errors
              if (error.message && !error.message.includes('message is not modified')) {
                console.error('[screen-watcher] Error updating message:', error.message);
              }
            }
          }
        }

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, interval));

      } catch (error) {
        console.error('[screen-watcher] Error in watch loop:', error.message);
        // Continue watching despite errors
        await new Promise(resolve => setTimeout(resolve, interval * 2));
      }
    }
  };

  // Start watching in background
  watch().catch(error => {
    console.error('[screen-watcher] Fatal error in watcher:', error);
  });

  // Return control object
  return {
    stop: () => {
      if (verbose) {
        console.log('[screen-watcher] Stop requested');
      }
      isWatching = false;
    }
  };
}

/**
 * Get the log file path for a screen session
 * Assumes logs are saved in a specific location by the solve/hive commands
 * @param {string} sessionName - The screen session name
 * @param {string} logDir - Directory where logs are stored (optional)
 * @returns {string|null} Path to log file or null if not found
 */
export async function findLogFile(sessionName, logDir = null) {
  // Common log patterns
  const patterns = [
    logDir ? `${logDir}/solve-*.log` : null,
    logDir ? `${logDir}/hive-*.log` : null,
    '/tmp/solve-*.log',
    '/tmp/hive-*.log',
    './solve-*.log',
    './hive-*.log'
  ].filter(Boolean);

  for (const pattern of patterns) {
    try {
      const { stdout } = await execAsync(`ls -t ${pattern} 2>/dev/null | head -1`);
      const logFile = stdout.trim();
      if (logFile) {
        return logFile;
      }
    } catch {
      // Pattern didn't match, continue
    }
  }

  return null;
}
