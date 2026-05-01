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

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
