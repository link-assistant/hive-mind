#!/usr/bin/env node

/**
 * Test suite for usage-limit.lib.mjs
 * Tests usage limit detection and formatting functionality
 * Related issues:
 *   - https://github.com/link-assistant/hive-mind/issues/942 (original)
 *   - https://github.com/link-assistant/hive-mind/issues/1122 (weekly limit date parsing)
 */

import dayjs from 'dayjs';
import { isUsageLimitError, extractResetTime, extractTimezone, detectUsageLimit, formatUsageLimitMessage, parseUsageLimitJson, parseResetTime, formatRelativeTime, formatResetTimeWithRelative } from '../src/usage-limit.lib.mjs';

/**
 * Helper function to check if a value is a valid dayjs object
 */
function isDayjsObject(value) {
  return value && dayjs.isDayjs(value) && value.isValid();
}

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('\x1b[32m\u2713 PASSED\x1b[0m');
    testsPassed++;
  } catch (error) {
    console.log(`\x1b[31m\u2717 FAILED: ${error.message}\x1b[0m`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`${message}: expected truthy value`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(`${message}: expected falsy value`);
  }
}

// === isUsageLimitError tests ===

runTest('isUsageLimitError: detects "limit reached"', () => {
  assertTrue(isUsageLimitError('Limit reached'), 'Should detect limit reached');
});

runTest('isUsageLimitError: detects Claude-style "resets" message', () => {
  assertTrue(isUsageLimitError('Limit reached · resets 8pm (Europe/Berlin) · turn on /extra-usage'), 'Should detect Claude resets message');
});

runTest('isUsageLimitError: detects usage limit exceeded', () => {
  assertTrue(isUsageLimitError('You have exceeded your rate limit'), 'Should detect rate limit exceeded');
});

runTest('isUsageLimitError: detects session limit reached', () => {
  assertTrue(isUsageLimitError('Session limit reached'), 'Should detect session limit');
});

runTest('isUsageLimitError: returns false for null/undefined', () => {
  assertFalse(isUsageLimitError(null), 'Should return false for null');
  assertFalse(isUsageLimitError(undefined), 'Should return false for undefined');
  assertFalse(isUsageLimitError(''), 'Should return false for empty string');
});

runTest('isUsageLimitError: returns false for normal messages', () => {
  assertFalse(isUsageLimitError('Build completed successfully'), 'Should not detect success message');
  assertFalse(isUsageLimitError('Error: file not found'), 'Should not detect file error');
});

// === extractResetTime tests ===

runTest('extractResetTime: extracts time from "resets 8pm" format', () => {
  const time = extractResetTime('Limit reached · resets 8pm (Europe/Berlin)');
  assertEqual(time, '8:00 PM', 'Should extract 8:00 PM');
});

runTest('extractResetTime: extracts time from "resets 5:00am" format', () => {
  const time = extractResetTime('Limit resets 5:00am');
  assertEqual(time, '5:00 AM', 'Should extract 5:00 AM');
});

runTest('extractResetTime: extracts time from "try again at" format', () => {
  const time = extractResetTime('Please try again at 12:16 PM');
  assertEqual(time, '12:16 PM', 'Should extract 12:16 PM');
});

runTest('extractResetTime: extracts time from 24-hour format', () => {
  const time = extractResetTime('Resets at 17:00');
  assertEqual(time, '5:00 PM', 'Should convert 17:00 to 5:00 PM');
});

runTest('extractResetTime: returns null for no time', () => {
  const time = extractResetTime('Rate limit exceeded');
  assertEqual(time, null, 'Should return null when no time found');
});

runTest('extractResetTime: returns null for invalid input', () => {
  assertEqual(extractResetTime(null), null, 'Should return null for null');
  assertEqual(extractResetTime(undefined), null, 'Should return null for undefined');
});

// === extractResetTime tests for weekly limit date parsing (Issue #1122) ===

runTest('extractResetTime: extracts date+time from "resets Jan 15, 8am" format', () => {
  const time = extractResetTime("You've hit your limit · resets Jan 15, 8am (Europe/Berlin)");
  assertEqual(time, 'Jan 15, 8:00 AM', 'Should extract Jan 15, 8:00 AM');
});

runTest('extractResetTime: extracts date+time from "resets January 20, 10:30am" format', () => {
  const time = extractResetTime('Limit reached · resets January 20, 10:30am (UTC)');
  assertEqual(time, 'January 20, 10:30 AM', 'Should extract January 20, 10:30 AM');
});

runTest('extractResetTime: extracts date+time with PM', () => {
  const time = extractResetTime('resets Feb 1, 5pm');
  assertEqual(time, 'Feb 1, 5:00 PM', 'Should extract Feb 1, 5:00 PM');
});

runTest('extractResetTime: extracts date+time with full month name and minutes', () => {
  const time = extractResetTime('resets December 25, 11:59pm');
  assertEqual(time, 'December 25, 11:59 PM', 'Should extract December 25, 11:59 PM');
});

runTest('extractResetTime: extracts date+time for abbreviated months', () => {
  // Test various abbreviated month names
  assertEqual(extractResetTime('resets Mar 10, 9am'), 'Mar 10, 9:00 AM', 'Should extract Mar date');
  assertEqual(extractResetTime('resets Apr 5, 3pm'), 'Apr 5, 3:00 PM', 'Should extract Apr date');
  assertEqual(extractResetTime('resets Sep 30, 12pm'), 'Sep 30, 12:00 PM', 'Should extract Sep date');
  assertEqual(extractResetTime('resets Oct 1, 6am'), 'Oct 1, 6:00 AM', 'Should extract Oct date');
  assertEqual(extractResetTime('resets Nov 15, 7pm'), 'Nov 15, 7:00 PM', 'Should extract Nov date');
});

runTest('extractResetTime: extracts date+time for full month names', () => {
  // Test full month names
  assertEqual(extractResetTime('resets March 10, 9am'), 'March 10, 9:00 AM', 'Should extract March date');
  assertEqual(extractResetTime('resets April 5, 3pm'), 'April 5, 3:00 PM', 'Should extract April date');
  assertEqual(extractResetTime('resets August 20, 2pm'), 'August 20, 2:00 PM', 'Should extract August date');
  assertEqual(extractResetTime('resets September 30, 12pm'), 'September 30, 12:00 PM', 'Should extract September date');
  assertEqual(extractResetTime('resets November 15, 7pm'), 'November 15, 7:00 PM', 'Should extract November date');
});

runTest('extractResetTime: handles date format with comma after day', () => {
  const time = extractResetTime('resets Jan 15, 8am');
  assertEqual(time, 'Jan 15, 8:00 AM', 'Should handle format with comma');
});

runTest('extractResetTime: handles date format without comma', () => {
  const time = extractResetTime('resets Jan 15 8am');
  assertEqual(time, 'Jan 15, 8:00 AM', 'Should handle format without comma');
});

runTest('extractResetTime: prioritizes date+time over time-only patterns', () => {
  // This is the key test - date+time should be matched first, not "8am" alone
  const time = extractResetTime("You've hit your limit · resets Jan 15, 8am (Europe/Berlin) · turn on /extra-usage");
  assertEqual(time, 'Jan 15, 8:00 AM', 'Should prioritize date+time pattern');
});

// === detectUsageLimit tests ===

runTest('detectUsageLimit: returns combined info', () => {
  const result = detectUsageLimit('Limit reached · resets 8pm (Europe/Berlin)');
  assertTrue(result.isUsageLimit, 'Should detect usage limit');
  assertEqual(result.resetTime, '8:00 PM', 'Should extract reset time');
});

runTest('detectUsageLimit: no reset time for non-limit message', () => {
  const result = detectUsageLimit('Build completed');
  assertFalse(result.isUsageLimit, 'Should not detect as limit');
  assertEqual(result.resetTime, null, 'Should not have reset time');
});

// === formatUsageLimitMessage tests (Issue #942 core fix) ===

runTest('formatUsageLimitMessage: includes session ID and resume command', () => {
  const lines = formatUsageLimitMessage({
    tool: 'Claude',
    resetTime: '8:00 PM',
    sessionId: '4c549ec6-3204-4312-b8e2-5f04113b2f86',
    resumeCommand: './solve.mjs "https://example.com" --resume 4c549ec6-3204-4312-b8e2-5f04113b2f86',
  });

  const message = lines.join('\n');
  assertTrue(message.includes('Usage Limit Reached'), 'Should include header');
  assertTrue(message.includes('Claude'), 'Should include tool name');
  assertTrue(message.includes('8:00 PM'), 'Should include reset time');
  assertTrue(message.includes('4c549ec6-3204-4312-b8e2-5f04113b2f86'), 'Should include session ID');
  assertTrue(message.includes('--resume'), 'Should include resume command');
});

runTest('formatUsageLimitMessage: handles missing reset time', () => {
  const lines = formatUsageLimitMessage({
    tool: 'Claude',
    resetTime: null,
    sessionId: 'test-session',
    resumeCommand: './solve.mjs --resume test-session',
  });

  const message = lines.join('\n');
  assertTrue(message.includes('wait for the limit to reset'), 'Should show wait message');
});

runTest('formatUsageLimitMessage: handles missing session ID', () => {
  const lines = formatUsageLimitMessage({
    tool: 'Claude',
    resetTime: '5:00 AM',
    sessionId: null,
    resumeCommand: null,
  });

  const message = lines.join('\n');
  assertFalse(message.includes('--resume'), 'Should not include resume command without session');
});

// === parseUsageLimitJson tests ===

runTest('parseUsageLimitJson: parses error type JSON', () => {
  const json = JSON.stringify({
    type: 'error',
    message: 'Limit reached · resets 8pm',
  });
  const result = parseUsageLimitJson(json);
  assertEqual(result.type, 'error', 'Should parse error type');
  assertTrue(result.limitInfo.isUsageLimit, 'Should detect limit');
});

runTest('parseUsageLimitJson: parses turn.failed type JSON', () => {
  const json = JSON.stringify({
    type: 'turn.failed',
    error: {
      message: 'Usage limit exceeded',
    },
  });
  const result = parseUsageLimitJson(json);
  assertEqual(result.type, 'turn.failed', 'Should parse turn.failed type');
  assertTrue(result.limitInfo.isUsageLimit, 'Should detect limit');
});

runTest('parseUsageLimitJson: returns null for non-limit errors', () => {
  const json = JSON.stringify({
    type: 'error',
    message: 'File not found',
  });
  const result = parseUsageLimitJson(json);
  assertEqual(result, null, 'Should return null for non-limit error');
});

runTest('parseUsageLimitJson: returns null for invalid JSON', () => {
  const result = parseUsageLimitJson('not json');
  assertEqual(result, null, 'Should return null for invalid JSON');
});

// === parseResetTime tests ===

runTest('parseResetTime: parses time-only format "8:00 PM"', () => {
  const result = parseResetTime('8:00 PM');
  assertTrue(isDayjsObject(result), 'Should return a dayjs object');
  assertEqual(result.hour(), 20, 'Should parse hour correctly (20:00)');
  assertEqual(result.minute(), 0, 'Should parse minutes correctly');
});

runTest('parseResetTime: parses time-only format "5:30 AM"', () => {
  const result = parseResetTime('5:30 AM');
  assertTrue(isDayjsObject(result), 'Should return a dayjs object');
  assertEqual(result.hour(), 5, 'Should parse hour correctly');
  assertEqual(result.minute(), 30, 'Should parse minutes correctly');
});

runTest('parseResetTime: parses time-only format "12:00 PM" (noon)', () => {
  const result = parseResetTime('12:00 PM');
  assertTrue(isDayjsObject(result), 'Should return a dayjs object');
  assertEqual(result.hour(), 12, 'Should parse noon as 12:00');
  assertEqual(result.minute(), 0, 'Should parse minutes correctly');
});

runTest('parseResetTime: parses time-only format "12:00 AM" (midnight)', () => {
  const result = parseResetTime('12:00 AM');
  assertTrue(isDayjsObject(result), 'Should return a dayjs object');
  assertEqual(result.hour(), 0, 'Should parse midnight as 0:00');
  assertEqual(result.minute(), 0, 'Should parse minutes correctly');
});

runTest('parseResetTime: parses date+time format "Jan 15, 8:00 AM"', () => {
  const result = parseResetTime('Jan 15, 8:00 AM');
  assertTrue(isDayjsObject(result), 'Should return a dayjs object');
  assertEqual(result.month(), 0, 'Should parse January as month 0');
  assertEqual(result.date(), 15, 'Should parse day correctly');
  assertEqual(result.hour(), 8, 'Should parse hour correctly');
  assertEqual(result.minute(), 0, 'Should parse minutes correctly');
});

runTest('parseResetTime: parses date+time format with full month "January 15, 8:00 AM"', () => {
  const result = parseResetTime('January 15, 8:00 AM');
  assertTrue(isDayjsObject(result), 'Should return a dayjs object');
  assertEqual(result.month(), 0, 'Should parse January as month 0');
  assertEqual(result.date(), 15, 'Should parse day correctly');
});

runTest('parseResetTime: parses date+time format "Dec 25, 11:59 PM"', () => {
  const result = parseResetTime('Dec 25, 11:59 PM');
  assertTrue(isDayjsObject(result), 'Should return a dayjs object');
  assertEqual(result.month(), 11, 'Should parse December as month 11');
  assertEqual(result.date(), 25, 'Should parse day correctly');
  assertEqual(result.hour(), 23, 'Should parse hour correctly (23:59)');
  assertEqual(result.minute(), 59, 'Should parse minutes correctly');
});

runTest('parseResetTime: parses all abbreviated month names', () => {
  const months = [
    { str: 'Jan 1, 12:00 PM', month: 0 },
    { str: 'Feb 1, 12:00 PM', month: 1 },
    { str: 'Mar 1, 12:00 PM', month: 2 },
    { str: 'Apr 1, 12:00 PM', month: 3 },
    { str: 'May 1, 12:00 PM', month: 4 },
    { str: 'Jun 1, 12:00 PM', month: 5 },
    { str: 'Jul 1, 12:00 PM', month: 6 },
    { str: 'Aug 1, 12:00 PM', month: 7 },
    { str: 'Sep 1, 12:00 PM', month: 8 },
    { str: 'Oct 1, 12:00 PM', month: 9 },
    { str: 'Nov 1, 12:00 PM', month: 10 },
    { str: 'Dec 1, 12:00 PM', month: 11 },
  ];
  for (const { str, month } of months) {
    const result = parseResetTime(str);
    assertTrue(isDayjsObject(result), `Should parse ${str}`);
    assertEqual(result.month(), month, `Should parse ${str} month correctly`);
  }
});

runTest('parseResetTime: parses Sept abbreviation', () => {
  const result = parseResetTime('Sept 15, 3:00 PM');
  assertTrue(isDayjsObject(result), 'Should return a dayjs object');
  assertEqual(result.month(), 8, 'Should parse Sept as September (month 8)');
});

runTest('parseResetTime: returns null for invalid input', () => {
  assertEqual(parseResetTime(null), null, 'Should return null for null');
  assertEqual(parseResetTime(undefined), null, 'Should return null for undefined');
  assertEqual(parseResetTime(''), null, 'Should return null for empty string');
  assertEqual(parseResetTime('invalid'), null, 'Should return null for invalid string');
});

runTest('parseResetTime: returns null for invalid format', () => {
  assertEqual(parseResetTime('8 PM'), null, 'Should return null for missing colon');
  assertEqual(parseResetTime('8:00'), null, 'Should return null for missing AM/PM');
});

// === formatRelativeTime tests ===

runTest('formatRelativeTime: returns "now" for past dates', () => {
  const pastDate = new Date(Date.now() - 1000);
  const result = formatRelativeTime(pastDate);
  assertEqual(result, 'now', 'Should return "now" for past dates');
});

runTest('formatRelativeTime: formats minutes only', () => {
  const futureDate = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  const result = formatRelativeTime(futureDate);
  assertTrue(result.includes('m'), 'Should include minutes');
  assertFalse(result.includes('h'), 'Should not include hours for <1 hour');
  assertFalse(result.includes('d'), 'Should not include days');
});

runTest('formatRelativeTime: formats hours and minutes', () => {
  const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000 + 30 * 60 * 1000); // 2h 30m
  const result = formatRelativeTime(futureDate);
  assertTrue(result.includes('h'), 'Should include hours');
  assertTrue(result.includes('m'), 'Should include minutes');
  assertFalse(result.includes('d'), 'Should not include days');
});

runTest('formatRelativeTime: formats days, hours and minutes', () => {
  const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000); // 2d 5h
  const result = formatRelativeTime(futureDate);
  assertTrue(result.includes('d'), 'Should include days');
  assertTrue(result.includes('h'), 'Should include hours');
});

runTest('formatRelativeTime: returns empty string for invalid input', () => {
  assertEqual(formatRelativeTime(null), '', 'Should return empty string for null');
  assertEqual(formatRelativeTime(undefined), '', 'Should return empty string for undefined');
  assertEqual(formatRelativeTime('not a date'), '', 'Should return empty string for non-Date');
});

// === formatResetTimeWithRelative tests ===

runTest('formatResetTimeWithRelative: returns original time if parsing fails', () => {
  const result = formatResetTimeWithRelative('invalid');
  assertEqual(result, 'invalid', 'Should return original time for invalid input');
});

runTest('formatResetTimeWithRelative: returns null/undefined as-is', () => {
  assertEqual(formatResetTimeWithRelative(null), null, 'Should return null');
  assertEqual(formatResetTimeWithRelative(undefined), undefined, 'Should return undefined');
});

runTest('formatResetTimeWithRelative: formats valid time with relative and UTC', () => {
  // Note: This test uses a time far in the future to avoid time-zone issues
  const result = formatResetTimeWithRelative('8:00 PM');
  assertTrue(result.includes('in'), 'Should include "in" prefix for relative time');
  assertTrue(result.includes('UTC'), 'Should include UTC time');
  assertTrue(result.includes('('), 'Should include parentheses');
  assertTrue(result.includes(')'), 'Should include closing parentheses');
});

// === Negative test cases ===

runTest('extractResetTime: does not match invalid date formats', () => {
  // These should NOT match the date pattern and fall through to time-only patterns
  assertEqual(extractResetTime('resets 32 Jan, 8am'), null, 'Should not match invalid day');
  assertEqual(extractResetTime('resets Xyz 15, 8am'), null, 'Should not match invalid month');
});

runTest('isUsageLimitError: does not match unrelated messages', () => {
  assertFalse(isUsageLimitError('Resetting configuration...'), 'Should not match "resetting"');
  assertFalse(isUsageLimitError('The limit is 100'), 'Should not match partial "limit"');
});

// === extractTimezone tests (Issue #1122) ===

runTest('extractTimezone: extracts Europe/Berlin timezone', () => {
  const tz = extractTimezone("You've hit your limit · resets Jan 15, 8am (Europe/Berlin)");
  assertEqual(tz, 'Europe/Berlin', 'Should extract Europe/Berlin');
});

runTest('extractTimezone: extracts UTC timezone', () => {
  const tz = extractTimezone('Limit reached · resets 8pm (UTC)');
  assertEqual(tz, 'UTC', 'Should extract UTC');
});

runTest('extractTimezone: extracts America/New_York timezone', () => {
  const tz = extractTimezone('Limit reached · resets 5pm (America/New_York)');
  assertEqual(tz, 'America/New_York', 'Should extract America/New_York');
});

runTest('extractTimezone: returns null for invalid timezone', () => {
  const tz = extractTimezone('Limit reached · resets 8pm (InvalidTz)');
  assertEqual(tz, null, 'Should return null for invalid timezone');
});

runTest('extractTimezone: returns null for no timezone', () => {
  const tz = extractTimezone('Limit reached · resets 8pm');
  assertEqual(tz, null, 'Should return null when no timezone');
});

runTest('extractTimezone: returns null for null/undefined input', () => {
  assertEqual(extractTimezone(null), null, 'Should return null for null');
  assertEqual(extractTimezone(undefined), null, 'Should return null for undefined');
});

// === parseResetTime with timezone tests (Issue #1122) ===

runTest('parseResetTime: parses with Europe/Berlin timezone', () => {
  const result = parseResetTime('Jan 15, 8:00 AM', 'Europe/Berlin');
  assertTrue(isDayjsObject(result), 'Should return a dayjs object');
  // The internal time should be in Europe/Berlin timezone
  assertEqual(result.hour(), 8, 'Should have local hour 8');
  // UTC should be 1 hour behind (Europe/Berlin is UTC+1 in winter)
  assertEqual(result.utc().hour(), 7, 'UTC hour should be 7');
});

runTest('parseResetTime: parses time-only with timezone', () => {
  const result = parseResetTime('8:00 PM', 'America/New_York');
  assertTrue(isDayjsObject(result), 'Should return a dayjs object');
  assertEqual(result.hour(), 20, 'Should have local hour 20');
});

// === Integration tests: extractResetTime + parseResetTime ===

runTest('Integration: extractResetTime to parseResetTime for time-only', () => {
  const extracted = extractResetTime('Limit reached · resets 8pm (Europe/Berlin)');
  const parsed = parseResetTime(extracted);
  assertTrue(isDayjsObject(parsed), 'Should parse extracted time to dayjs object');
  assertEqual(parsed.hour(), 20, 'Should have correct hour');
});

runTest('Integration: extractResetTime to parseResetTime for date+time (Issue #1122)', () => {
  // This is the main fix for issue #1122
  const extracted = extractResetTime("You've hit your limit · resets Jan 15, 8am (Europe/Berlin)");
  assertEqual(extracted, 'Jan 15, 8:00 AM', 'Should extract date+time correctly');

  const parsed = parseResetTime(extracted);
  assertTrue(isDayjsObject(parsed), 'Should parse extracted date+time to dayjs object');
  assertEqual(parsed.month(), 0, 'Should have January (month 0)');
  assertEqual(parsed.date(), 15, 'Should have day 15');
  assertEqual(parsed.hour(), 8, 'Should have hour 8');
});

runTest('Integration: full pipeline with timezone (Issue #1122)', () => {
  const message = "You've hit your limit · resets Jan 15, 8am (Europe/Berlin)";

  // Extract all components
  const resetTime = extractResetTime(message);
  const timezone = extractTimezone(message);

  assertEqual(resetTime, 'Jan 15, 8:00 AM', 'Should extract reset time');
  assertEqual(timezone, 'Europe/Berlin', 'Should extract timezone');

  // Parse with timezone
  const parsed = parseResetTime(resetTime, timezone);
  assertTrue(isDayjsObject(parsed), 'Should parse to dayjs object');

  // Format with relative time and UTC
  const formatted = formatResetTimeWithRelative(resetTime, timezone);
  assertTrue(formatted.includes('UTC'), 'Should include UTC in output');
  assertTrue(formatted.includes('in'), 'Should include relative time prefix');
});

runTest('Integration: detectUsageLimit includes timezone (Issue #1122)', () => {
  const message = "You've hit your limit · resets Jan 15, 8am (Europe/Berlin)";
  const result = detectUsageLimit(message);

  assertTrue(result.isUsageLimit, 'Should detect usage limit');
  assertEqual(result.resetTime, 'Jan 15, 8:00 AM', 'Should extract reset time');
  assertEqual(result.timezone, 'Europe/Berlin', 'Should extract timezone');
});

// === Agent/OpenCode Zen FreeUsageLimitError tests (Issue #1287) ===

runTest('isUsageLimitError: detects FreeUsageLimitError from Agent/OpenCode Zen', () => {
  // JSON error message from agent
  const errorJson = '{"type":"error","error":{"type":"FreeUsageLimitError","message":"Rate limit exceeded. Please try again later."}}';
  assertTrue(isUsageLimitError(errorJson), 'Should detect FreeUsageLimitError in JSON');

  // Direct error type
  assertTrue(isUsageLimitError('FreeUsageLimitError'), 'Should detect FreeUsageLimitError directly');

  // Case insensitive
  assertTrue(isUsageLimitError('freeusagelimiterror'), 'Should detect lowercase freeusagelimiterror');
});

runTest('detectUsageLimit: detects agent rate limit error message (Issue #1287)', () => {
  const errorMessage = 'Failed after 3 attempts. Last error: Rate limit exceeded. Please try again later.';
  const result = detectUsageLimit(errorMessage);
  assertTrue(result.isUsageLimit, 'Should detect rate limit in error message');
});

// === Summary ===

console.log('\n' + '='.repeat(50));
console.log(`Test results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(50));

if (testsFailed > 0) {
  process.exit(1);
}
