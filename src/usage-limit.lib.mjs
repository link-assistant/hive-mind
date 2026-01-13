/**
 * Usage Limit Detection Utilities
 *
 * This module provides utilities for detecting and handling usage limit errors
 * from AI tools (Claude, Codex, OpenCode).
 *
 * Related issue: https://github.com/link-assistant/hive-mind/issues/719
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
    'weekly limit reached', // Claude
    'daily limit reached',
    'monthly limit reached',
    'billing hard limit',
    'please try again at', // Codex/OpenCode style
    'available again at',
    'resets', // Claude shows: “∙ resets 5am”
  ];

  return patterns.some(pattern => lowerMessage.includes(pattern));
}

/**
 * Extract reset time from usage limit error message
 *
 * Supports both time-only formats (5-hour limits) and date+time formats (weekly limits):
 * - "resets 10pm" → "10:00 PM"
 * - "resets Jan 15, 8am" → "Jan 15, 8:00 AM"
 *
 * @param {string} message - Error message to analyze
 * @returns {string|null} - Reset time string (e.g., "12:16 PM" or "Jan 15, 8:00 AM") or null if not found
 */
export function extractResetTime(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  // Normalize whitespace for easier matching
  const normalized = message.replace(/\s+/g, ' ');

  // Pattern 0: Weekly limit with date - "resets Jan 15, 8am" or "resets January 15, 8:00am"
  // This pattern must come first to avoid partial matches by time-only patterns
  const monthPattern = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const resetsWithDateRegex = new RegExp(`resets\\s+(${monthPattern})\\s+(\\d{1,2}),?\\s+([0-9]{1,2})(?::([0-9]{2}))?\\s*([ap]m)`, 'i');
  const resetsWithDate = normalized.match(resetsWithDateRegex);
  if (resetsWithDate) {
    const month = resetsWithDate[1];
    const day = resetsWithDate[2];
    const hour = resetsWithDate[3];
    const minute = resetsWithDate[4] || '00';
    const ampm = resetsWithDate[5].toUpperCase();
    // Return formatted date+time string for weekly limits
    return `${month} ${day}, ${hour}:${minute} ${ampm}`;
  }

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
    if (hour === 0)
      hour = 12; // 0 -> 12 AM
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
    resetTime,
  };
}

/**
 * Parse time string and convert to Date object
 *
 * Supports both formats:
 * - Time only: "11:00 PM" → today or tomorrow at that time
 * - Date+time: "Jan 15, 8:00 AM" → specific date at that time
 *
 * @param {string} timeStr - Time string in format "HH:MM AM/PM" or "Mon DD, HH:MM AM/PM"
 * @returns {Date|null} - Date object or null if parsing fails
 */
export function parseResetTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return null;
  }

  const now = new Date();

  // Try to match date+time format first (e.g., "Jan 15, 8:00 AM")
  const monthPattern = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const dateTimeRegex = new RegExp(`${monthPattern}\\s+(\\d{1,2}),?\\s+(\\d{1,2}):(\\d{2})\\s*(AM|PM)`, 'i');
  const dateTimeMatch = timeStr.match(dateTimeRegex);

  if (dateTimeMatch) {
    const monthStr = dateTimeMatch[1];
    const day = parseInt(dateTimeMatch[2], 10);
    let hour = parseInt(dateTimeMatch[3], 10);
    const minute = parseInt(dateTimeMatch[4], 10);
    const ampm = dateTimeMatch[5].toUpperCase();

    // Convert month name to month index (0-11)
    const monthMap = {
      jan: 0,
      january: 0,
      feb: 1,
      february: 1,
      mar: 2,
      march: 2,
      apr: 3,
      april: 3,
      may: 4,
      jun: 5,
      june: 5,
      jul: 6,
      july: 6,
      aug: 7,
      august: 7,
      sep: 8,
      sept: 8,
      september: 8,
      oct: 9,
      october: 9,
      nov: 10,
      november: 10,
      dec: 11,
      december: 11,
    };
    const month = monthMap[monthStr.toLowerCase()];
    if (month === undefined) {
      return null;
    }

    // Convert to 24-hour format
    if (ampm === 'PM' && hour !== 12) {
      hour += 12;
    } else if (ampm === 'AM' && hour === 12) {
      hour = 0;
    }

    // Create date for this year (or next year if the date is in the past)
    let year = now.getFullYear();
    let resetDate = new Date(year, month, day, hour, minute, 0, 0);

    // If the date is in the past, assume next year
    if (resetDate <= now) {
      resetDate = new Date(year + 1, month, day, hour, minute, 0, 0);
    }

    return resetDate;
  }

  // Fall back to time-only format (e.g., "11:00 PM" or "11:00PM")
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) {
    return null;
  }

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();

  // Convert to 24-hour format
  if (ampm === 'PM' && hour !== 12) {
    hour += 12;
  } else if (ampm === 'AM' && hour === 12) {
    hour = 0;
  }

  // Create date for today with the parsed time
  const resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);

  // If the time is in the past today, assume it's tomorrow
  if (resetDate <= now) {
    resetDate.setDate(resetDate.getDate() + 1);
  }

  return resetDate;
}

/**
 * Format relative time (e.g., "in 1h 23m")
 *
 * @param {Date} resetDate - Date object for reset time
 * @returns {string} - Formatted relative time string
 */
export function formatRelativeTime(resetDate) {
  if (!resetDate || !(resetDate instanceof Date)) {
    return '';
  }

  const now = new Date();
  const diffMs = resetDate - now;

  if (diffMs <= 0) {
    return 'now';
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  const days = totalDays;
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return `in ${parts.join(' ')}`;
}

/**
 * Format reset time with relative time and UTC time
 * Example: "in 1h 23m (11:00 PM UTC)"
 *
 * @param {string} resetTime - Time string in format "HH:MM AM/PM"
 * @returns {string} - Formatted string with relative and absolute time
 */
export function formatResetTimeWithRelative(resetTime) {
  if (!resetTime) {
    return resetTime;
  }

  const resetDate = parseResetTime(resetTime);
  if (!resetDate) {
    // If we can't parse it, return the original time
    return resetTime;
  }

  const relativeTime = formatRelativeTime(resetDate);

  // Format the UTC time
  const utcHours = resetDate.getUTCHours();
  const utcMinutes = resetDate.getUTCMinutes();
  const utcAmPm = utcHours >= 12 ? 'PM' : 'AM';
  const utcHour12 = utcHours % 12 || 12;
  const utcTimeStr = `${utcHour12}:${String(utcMinutes).padStart(2, '0')} ${utcAmPm} UTC`;

  return `${relativeTime} (${utcTimeStr})`;
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
  const lines = ['', '⏳ Usage Limit Reached!', '', `Your ${tool || 'AI tool'} usage limit has been reached.`];

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
          limitInfo: detectUsageLimit(data.message),
        };
      }
    }

    // Check for turn.failed with error
    if (data.type === 'turn.failed' && data.error && data.error.message) {
      if (isUsageLimitError(data.error.message)) {
        return {
          type: 'turn.failed',
          message: data.error.message,
          limitInfo: detectUsageLimit(data.error.message),
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}
