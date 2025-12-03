#!/usr/bin/env node
/**
 * Claude usage limits library
 * Provides functions to fetch and parse Claude CLI usage limits
 */

import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCallback);

/**
 * Get Claude usage limits by running 'claude /usage' with expect
 * Parses the output to extract:
 * - Current session usage percentage and reset time
 * - Current week (all models) usage percentage and reset date
 * - Current week (Sonnet only) usage percentage and reset date
 *
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Object} Object with success boolean, and either usage data or error message
 */
export async function getClaudeUsageLimits(verbose = false) {
  try {
    // Use expect to run claude /usage interactively
    // The command opens an interactive screen, we need to press Enter and wait for output
    const expectScript = `
expect -c '
  log_user 0
  set timeout 30
  spawn claude /usage
  sleep 5
  send "\\r"
  expect eof
  exit 0
' 2>/dev/null
`;
    const result = await exec(expectScript, { timeout: 60000 });
    const output = result.stdout || '';

    if (verbose) {
      console.log('[VERBOSE] /limits raw output:', output);
    }

    // Parse the output to extract usage information
    // Format from screenshot:
    // Current session
    // [progress bar] XX% used
    // Resets Xpm (UTC)
    //
    // Current week (all models)
    // [progress bar] XX% used
    // Resets [Date], Xpm (UTC)
    //
    // Current week (Sonnet only)
    // [progress bar] XX% used
    // Resets [Date], Xpm (UTC)

    // Extract percentages from output
    const percentageMatches = output.match(/(\d+)%\s*used/g);
    const percentages = percentageMatches
      ? percentageMatches.map(m => parseInt(m.match(/(\d+)/)[1]))
      : [];

    // Extract reset times - look for "Resets" followed by time info
    const resetMatches = output.match(/Resets\s+([^\n]+)/g);
    const resetTimes = resetMatches
      ? resetMatches.map(m => m.replace(/Resets\s+/, '').trim())
      : [];

    if (percentages.length === 0) {
      // Try alternative parsing - percentages might be on separate lines
      const lines = output.split('\n');
      for (const line of lines) {
        const pctMatch = line.match(/(\d+)%/);
        if (pctMatch) {
          percentages.push(parseInt(pctMatch[1]));
        }
      }
    }

    if (percentages.length === 0) {
      return {
        success: false,
        error: 'Could not parse usage information from Claude CLI. Make sure Claude is properly installed and authenticated.'
      };
    }

    // Build the result object
    const usage = {
      currentSession: {
        percentage: percentages[0] || null,
        resetTime: resetTimes[0] || null
      },
      allModels: {
        percentage: percentages[1] || null,
        resetTime: resetTimes[1] || null
      },
      sonnetOnly: {
        percentage: percentages[2] || null,
        resetTime: resetTimes[2] || null
      }
    };

    return {
      success: true,
      usage
    };
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /limits error:', error);
    }
    return {
      success: false,
      error: `Failed to get usage limits: ${error.message}`
    };
  }
}

/**
 * Generate a text-based progress bar for usage percentage
 * @param {number} percentage - Usage percentage (0-100)
 * @returns {string} Text-based progress bar
 */
export function getProgressBar(percentage) {
  const totalBlocks = 10;
  const filledBlocks = Math.round((percentage / 100) * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;
  return '\u2593'.repeat(filledBlocks) + '\u2591'.repeat(emptyBlocks);
}

/**
 * Format Claude usage data into a Telegram-friendly message
 * @param {Object} usage - The usage object from getClaudeUsageLimits
 * @returns {string} Formatted message
 */
export function formatUsageMessage(usage) {
  let message = '*Claude Usage Limits*\n\n';

  // Current session
  message += '*Current session*\n';
  if (usage.currentSession.percentage !== null) {
    const pct = usage.currentSession.percentage;
    const bar = getProgressBar(pct);
    message += `${bar} ${pct}% used\n`;
    if (usage.currentSession.resetTime) {
      message += `Resets ${usage.currentSession.resetTime}\n`;
    }
  } else {
    message += 'N/A\n';
  }
  message += '\n';

  // Current week (all models)
  message += '*Current week (all models)*\n';
  if (usage.allModels.percentage !== null) {
    const pct = usage.allModels.percentage;
    const bar = getProgressBar(pct);
    message += `${bar} ${pct}% used\n`;
    if (usage.allModels.resetTime) {
      message += `Resets ${usage.allModels.resetTime}\n`;
    }
  } else {
    message += 'N/A\n';
  }
  message += '\n';

  // Current week (Sonnet only)
  message += '*Current week (Sonnet only)*\n';
  if (usage.sonnetOnly.percentage !== null) {
    const pct = usage.sonnetOnly.percentage;
    const bar = getProgressBar(pct);
    message += `${bar} ${pct}% used\n`;
    if (usage.sonnetOnly.resetTime) {
      message += `Resets ${usage.sonnetOnly.resetTime}\n`;
    }
  } else {
    message += 'N/A\n';
  }

  return message;
}

export default {
  getClaudeUsageLimits,
  getProgressBar,
  formatUsageMessage
};
