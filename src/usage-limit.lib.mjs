/**
 * Usage Limit Detection Utilities
 *
 * This module provides utilities for detecting and handling usage limit errors
 * from AI tools (Claude, Codex, OpenCode).
 *
 * Related issue: https://github.com/deep-assistant/hive-mind/issues/719
 */

/**
 * Detect if an error message indicates a usage limit has been reached
 *
 * @param {string} message - Error message to analyze
 * @returns {boolean} - True if message indicates usage limit
 */
export function isUsageLimitError(message) {
  if (!message || typeof message !== 'string') {
    return false;
  }

  const lowerMessage = message.toLowerCase();

  // Check for specific usage limit patterns
  const patterns = [
    // Generic
    "you've hit your usage limit",
    'hit your usage limit',
    'you have exceeded your rate limit',
    'usage limit reached',
    'usage limit exceeded',
    'rate_limit_exceeded',
    'rate limit exceeded',
    'limit reached',
    'limit has been reached',
    // Provider-specific phrasings we’ve seen in the wild
    'session limit reached', // Claude
    'weekly limit reached',  // Claude
    'daily limit reached',
    'monthly limit reached',
    'billing hard limit',
    'please try again at',   // Codex/OpenCode style
    'available again at',
    'resets'                 // Claude shows: “∙ resets 5am”
  ];

  return patterns.some(pattern => lowerMessage.includes(pattern));
}

/**
 * Extract reset time from usage limit error message
 *
 * @param {string} message - Error message to analyze
 * @returns {string|null} - Reset time string (e.g., "12:16 PM") or null if not found
 */
export function extractResetTime(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  // Normalize whitespace for easier matching
  const normalized = message.replace(/\s+/g, ' ');

  // Pattern 1: "try again at 12:16 PM"
  const tryAgainMatch = normalized.match(/try again at ([0-9]{1,2}:[0-9]{2}\s*[AP]M)/i);
  if (tryAgainMatch) {
    return tryAgainMatch[1];
  }

  // Pattern 2: "available at 12:16 PM"
  const availableMatch = normalized.match(/available at ([0-9]{1,2}:[0-9]{2}\s*[AP]M)/i);
  if (availableMatch) {
    return availableMatch[1];
  }

  // Pattern 3: "reset at 12:16 PM"
  const resetMatch = normalized.match(/reset at ([0-9]{1,2}:[0-9]{2}\s*[AP]M)/i);
  if (resetMatch) {
    return resetMatch[1];
  }

  // Pattern 4: Claude-style: "resets 5am" or "resets at 5am" (no minutes)
  const resetsAmPmNoMinutes = normalized.match(/resets(?:\s+at)?\s+([0-9]{1,2})\s*([AP]M)/i);
  if (resetsAmPmNoMinutes) {
    const hour = resetsAmPmNoMinutes[1];
    const ampm = resetsAmPmNoMinutes[2].toUpperCase();
    return `${hour}:00 ${ampm}`;
  }

  // Pattern 5: Claude-style with minutes: "resets 5:00am" or "resets at 5:00 am"
  const resetsAmPmWithMinutes = normalized.match(/resets(?:\s+at)?\s+([0-9]{1,2}:[0-9]{2})\s*([AP]M)/i);
  if (resetsAmPmWithMinutes) {
    const time = resetsAmPmWithMinutes[1];
    const ampm = resetsAmPmWithMinutes[2].toUpperCase();
    return `${time} ${ampm}`;
  }

  // Pattern 6: 24-hour time: "resets 17:00" or "resets at 05:00"
  const resets24h = normalized.match(/resets(?:\s+at)?\s+([0-2]?[0-9]):([0-5][0-9])\b/i);
  if (resets24h) {
    let hour = parseInt(resets24h[1], 10);
    const minute = resets24h[2];
    const ampm = hour >= 12 ? 'PM' : 'AM';
    if (hour === 0) hour = 12; // 0 -> 12 AM
    else if (hour > 12) hour -= 12; // 13-23 -> 1-11 PM
    return `${hour}:${minute} ${ampm}`;
  }

  // Pattern 7: "resets 5am" written without space (already partially covered) – ensure we catch compact forms
  const resetsCompact = normalized.match(/resets(?:\s+at)?\s*([0-9]{1,2})(?::([0-9]{2}))?\s*([ap]m)/i);
  if (resetsCompact) {
    const hour = resetsCompact[1];
    const minute = resetsCompact[2] || '00';
    const ampm = resetsCompact[3].toUpperCase();
    return `${hour}:${minute} ${ampm}`;
  }

  // Pattern 8: standalone time like "12:16 PM" (less reliable, so last)
  const timeMatch = normalized.match(/\b([0-9]{1,2}:[0-9]{2}\s*[AP]M)\b/i);
  if (timeMatch) {
    // Normalize spacing in AM/PM
    const t = timeMatch[1].replace(/\s*([AP]M)/i, ' $1');
    return t;
  }

  return null;
}

/**
 * Detect usage limit error and extract all relevant information
 *
 * @param {string} message - Error message to analyze
 * @returns {Object} - { isUsageLimit: boolean, resetTime: string|null }
 */
export function detectUsageLimit(message) {
  const isUsageLimit = isUsageLimitError(message);
  const resetTime = isUsageLimit ? extractResetTime(message) : null;

  return {
    isUsageLimit,
    resetTime
  };
}

/**
 * Format usage limit error message for console output
 *
 * @param {Object} options - Formatting options
 * @param {string} options.tool - Tool name (claude, codex, opencode)
 * @param {string|null} options.resetTime - Time when limit resets
 * @param {string|null} options.sessionId - Session ID for resuming
 * @param {string|null} options.resumeCommand - Command to resume session
 * @returns {string[]} - Array of formatted message lines
 */
export function formatUsageLimitMessage({ tool, resetTime, sessionId, resumeCommand }) {
  const lines = [
    '',
    '⏳ Usage Limit Reached!',
    '',
    `Your ${tool || 'AI tool'} usage limit has been reached.`
  ];

  if (resetTime) {
    lines.push(`The limit will reset at: ${resetTime}`);
  } else {
    lines.push('Please wait for the limit to reset.');
  }

  if (sessionId && resumeCommand) {
    lines.push('');
    lines.push(`📌 Session ID: ${sessionId}`);
    lines.push('');
    lines.push('To resume this session after the limit resets, run:');
    lines.push(`   ${resumeCommand}`);
  }

  lines.push('');

  return lines;
}

/**
 * Check if a message contains both usage limit error and is in JSON format
 * Useful for parsing structured error responses
 *
 * @param {string} line - Line to check
 * @returns {Object|null} - Parsed JSON object if valid, null otherwise
 */
export function parseUsageLimitJson(line) {
  try {
    const data = JSON.parse(line);

    // Check for error in JSON
    if (data.type === 'error' && data.message) {
      if (isUsageLimitError(data.message)) {
        return {
          type: 'error',
          message: data.message,
          limitInfo: detectUsageLimit(data.message)
        };
      }
    }

    // Check for turn.failed with error
    if (data.type === 'turn.failed' && data.error && data.error.message) {
      if (isUsageLimitError(data.error.message)) {
        return {
          type: 'turn.failed',
          message: data.error.message,
          limitInfo: detectUsageLimit(data.error.message)
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}
