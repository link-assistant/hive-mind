/**
 * Usage Limit Detection Utilities
 *
 * This module provides utilities for detecting and handling usage limit errors
 * from AI tools (Claude, Codex, OpenCode).
 *
 * Related issues:
 *   - https://github.com/link-assistant/hive-mind/issues/719 (original)
 *   - https://github.com/link-assistant/hive-mind/issues/1122 (weekly limit date parsing with timezone)
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

// Initialize dayjs plugins
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

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
 * Extract timezone from usage limit error message
 *
 * Extracts IANA timezone identifiers like "Europe/Berlin", "UTC", "America/New_York"
 * from messages like "resets Jan 15, 8am (Europe/Berlin)"
 *
 * @param {string} message - Error message to analyze
 * @returns {string|null} - Timezone string or null if not found
 */
export function extractTimezone(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  // Pattern: (Timezone) - matches IANA timezone format or "UTC"
  // IANA format: Continent/City or Continent/Region/City
  const timezoneMatch = message.match(/\(([A-Za-z_]+(?:\/[A-Za-z_]+){0,2})\)/);
  if (timezoneMatch) {
    const tz = timezoneMatch[1];
    // Validate it's a recognizable timezone by trying to use it with dayjs
    try {
      const testDate = dayjs().tz(tz);
      if (testDate.isValid()) {
        return tz;
      }
    } catch {
      // Invalid timezone, return null
    }
  }

  return null;
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
 * @returns {Object} - { isUsageLimit: boolean, resetTime: string|null, timezone: string|null }
 */
export function detectUsageLimit(message) {
  const isUsageLimit = isUsageLimitError(message);
  const resetTime = isUsageLimit ? extractResetTime(message) : null;
  const timezone = isUsageLimit ? extractTimezone(message) : null;

  return {
    isUsageLimit,
    resetTime,
    timezone,
  };
}

/**
 * Parse time string and convert to dayjs object using dayjs custom parse format
 *
 * Supports both formats:
 * - Time only: "11:00 PM" → today or tomorrow at that time
 * - Date+time: "Jan 15, 8:00 AM" → specific date at that time
 *
 * Uses dayjs customParseFormat plugin for cleaner parsing.
 *
 * @param {string} timeStr - Time string in format "HH:MM AM/PM" or "Mon DD, HH:MM AM/PM"
 * @param {string|null} tz - Optional IANA timezone (e.g., "Europe/Berlin")
 * @returns {dayjs.Dayjs|null} - dayjs object or null if parsing fails
 */
export function parseResetTime(timeStr, tz = null) {
  if (!timeStr || typeof timeStr !== 'string') {
    return null;
  }

  const now = dayjs();

  // Normalize "Sept" to "Sep" for dayjs compatibility
  const normalized = timeStr.replace(/\bSept\b/gi, 'Sep');

  // Try date+time formats using dayjs custom parse
  // dayjs uses: MMM=Jan, MMMM=January, D=day, h=12-hour, mm=minutes, A=AM/PM
  const dateTimeFormats = ['MMM D, h:mm A', 'MMMM D, h:mm A'];

  for (const format of dateTimeFormats) {
    let parsed;
    if (tz) {
      try {
        // Parse in the specified timezone
        parsed = dayjs.tz(normalized, format, tz);
      } catch {
        parsed = dayjs(normalized, format);
      }
    } else {
      parsed = dayjs(normalized, format);
    }

    if (parsed.isValid()) {
      // dayjs parses without year, so it defaults to current year
      // If the date is in the past, assume next year
      if (parsed.isBefore(now)) {
        parsed = parsed.add(1, 'year');
      }
      return parsed;
    }
  }

  // Try time-only format: "8:00 PM" or "8:00PM"
  const timeOnlyFormats = ['h:mm A', 'h:mmA'];

  for (const format of timeOnlyFormats) {
    let parsed;
    if (tz) {
      try {
        parsed = dayjs.tz(normalized, format, tz);
      } catch {
        parsed = dayjs(normalized, format);
      }
    } else {
      parsed = dayjs(normalized, format);
    }

    if (parsed.isValid()) {
      // For time-only, set to today's date
      parsed = parsed.year(now.year()).month(now.month()).date(now.date());

      // Re-apply timezone after setting date components
      if (tz) {
        try {
          const dateStr = parsed.format('YYYY-MM-DD HH:mm');
          parsed = dayjs.tz(dateStr, tz);
        } catch {
          // Keep the parsed value
        }
      }

      // If the time is in the past today, assume tomorrow
      if (parsed.isBefore(now)) {
        parsed = parsed.add(1, 'day');
      }
      return parsed;
    }
  }

  return null;
}

/**
 * Format relative time (e.g., "in 1h 23m")
 *
 * Uses dayjs for accurate time difference calculations.
 * Accepts both Date objects and dayjs objects.
 *
 * @param {Date|dayjs.Dayjs} resetDate - Date or dayjs object for reset time
 * @returns {string} - Formatted relative time string
 */
export function formatRelativeTime(resetDate) {
  // Accept both Date objects and dayjs objects
  let resetDayjs;
  if (resetDate instanceof Date) {
    resetDayjs = dayjs(resetDate);
  } else if (dayjs.isDayjs(resetDate)) {
    resetDayjs = resetDate;
  } else {
    return '';
  }

  if (!resetDayjs.isValid()) {
    return '';
  }

  const now = dayjs();
  const diffMs = resetDayjs.diff(now);

  if (diffMs <= 0) {
    return 'now';
  }

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
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
 * Example: "in 1h 23m (Jan 15, 7:00 AM UTC)"
 *
 * Uses dayjs for proper timezone conversion to UTC.
 *
 * @param {string} resetTime - Time string in format "HH:MM AM/PM" or "Mon DD, HH:MM AM/PM"
 * @param {string|null} timezone - Optional IANA timezone (e.g., "Europe/Berlin")
 * @returns {string} - Formatted string with relative and absolute UTC time
 */
export function formatResetTimeWithRelative(resetTime, timezone = null) {
  if (!resetTime) {
    return resetTime;
  }

  const resetDate = parseResetTime(resetTime, timezone);
  if (!resetDate) {
    // If we can't parse it, return the original time
    return resetTime;
  }

  const relativeTime = formatRelativeTime(resetDate);

  // Convert to UTC and format
  const utcDate = resetDate.utc();
  const utcTimeStr = utcDate.format('MMM D, h:mm A [UTC]');

  return `${relativeTime} (${utcTimeStr})`;
}

/**
 * Format usage limit error message for console output
 *
 * @param {Object} options - Formatting options
 * @param {string} options.tool - Tool name (claude, codex, opencode)
 * @param {string|null} options.resetTime - Time when limit resets
 * @param {string|null} options.sessionId - Session ID for resuming
 * @param {string|null} options.resumeCommand - Interactive resume command (legacy, for backward compatibility)
 * @param {string|null} options.interactiveResumeCommand - Command to resume in interactive mode
 * @param {string|null} options.autonomousResumeCommand - Command to resume in autonomous mode
 * @returns {string[]} - Array of formatted message lines
 */
export function formatUsageLimitMessage({ tool, resetTime, sessionId, resumeCommand, interactiveResumeCommand, autonomousResumeCommand }) {
  const lines = ['', '⏳ Usage Limit Reached!', '', `Your ${tool || 'AI tool'} usage limit has been reached.`];

  if (resetTime) {
    lines.push(`The limit will reset at: ${resetTime}`);
  } else {
    lines.push('Please wait for the limit to reset.');
  }

  // Support both new (dual command) and legacy (single command) formats
  const interactiveCmd = interactiveResumeCommand || resumeCommand;

  if (sessionId && (interactiveCmd || autonomousResumeCommand)) {
    lines.push('');
    lines.push(`📌 Session ID: ${sessionId}`);
    lines.push('');
    lines.push('To resume this session after the limit resets:');
    if (interactiveCmd) {
      lines.push('');
      lines.push('   Interactive mode (opens Claude Code for user interaction):');
      lines.push(`   ${interactiveCmd}`);
    }
    if (autonomousResumeCommand) {
      lines.push('');
      lines.push('   Autonomous mode (continues work without user interaction):');
      lines.push(`   ${autonomousResumeCommand}`);
    }
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
