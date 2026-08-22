#!/usr/bin/env node

import process from 'node:process';

import { parseResetTime, calculateWaitTime } from '../src/solve.validation.lib.mjs';
import { test, printSummary, getFailCount } from './test-helpers.mjs';

test('parseResetTime accepts time-only format', () => {
  const result = parseResetTime('5:30 AM');
  if (result.hour !== 5 || result.minute !== 30) {
    throw new Error(`Expected 05:30, got ${JSON.stringify(result)}`);
  }
});

test('parseResetTime accepts date+time format from usage-limit output', () => {
  const result = parseResetTime('Apr 17, 4:00 AM');
  if (result.hour !== 4 || result.minute !== 0) {
    throw new Error(`Expected 04:00, got ${JSON.stringify(result)}`);
  }
});

test('calculateWaitTime accepts date+time format from usage-limit output', () => {
  const waitMs = calculateWaitTime('Apr 17, 4:00 AM');
  if (!Number.isFinite(waitMs) || waitMs <= 0) {
    throw new Error(`Expected positive wait time, got ${waitMs}`);
  }
});

// Issue #1869: Codex reports weekly limits with an explicit year, e.g.
// "Jun 11th, 2026 12:27 AM", which usage-limit.lib normalizes to
// "Jun 11, 2026, 12:27 AM". The legacy parser threw "Invalid time format" on the
// trailing year, which crashed the auto-resume flow ("Auto-continue failed").
test('parseResetTime accepts date+year+time format (Issue #1869)', () => {
  const result = parseResetTime('Jun 11, 2026, 12:27 AM');
  if (result.hour !== 0 || result.minute !== 27) {
    throw new Error(`Expected 00:27, got ${JSON.stringify(result)}`);
  }
});

test('calculateWaitTime does not throw on date+year+time format (Issue #1869)', () => {
  // Must not throw "Invalid time format"; the value depends on "now" so we only
  // assert it returns a finite, non-negative number.
  const waitMs = calculateWaitTime('Jun 11, 2026, 12:27 AM');
  if (!Number.isFinite(waitMs) || waitMs < 0) {
    throw new Error(`Expected finite non-negative wait time, got ${waitMs}`);
  }
});

// Issue #1869: For a weekly limit several days out, the wait time MUST reflect the
// full date, not just the time-of-day. The legacy implementation discarded the date
// and scheduled for today/tomorrow, so auto-resume woke up far too early.
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
test('calculateWaitTime respects a multi-day-out reset date (Issue #1869)', () => {
  const threeDaysOut = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const resetStr = `${months[threeDaysOut.getMonth()]} ${threeDaysOut.getDate()}, 10:00 AM`;
  const waitMs = calculateWaitTime(resetStr);
  const waitHours = waitMs / (60 * 60 * 1000);
  // Should be roughly 3 days (48h-84h window allows for the 10:00 AM time-of-day
  // offset). The buggy implementation collapsed this to < 24h.
  if (waitHours < 48 || waitHours > 84) {
    throw new Error(`Expected wait ~3 days for '${resetStr}', got ${waitHours.toFixed(1)}h`);
  }
});

test('calculateWaitTime respects explicit future year (Issue #1869)', () => {
  // Anchor far in the future so the result is deterministic regardless of "now".
  const farFutureYear = new Date().getFullYear() + 2;
  const resetStr = `Jun 11, ${farFutureYear}, 12:27 AM`;
  const waitMs = calculateWaitTime(resetStr);
  const waitDays = waitMs / (24 * 60 * 60 * 1000);
  // At least ~1 year out (365 days). The buggy parser threw or capped at <1 day.
  if (waitDays < 365) {
    throw new Error(`Expected wait >= 365 days for '${resetStr}', got ${waitDays.toFixed(1)} days`);
  }
});

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
