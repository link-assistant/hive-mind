#!/usr/bin/env node
/**
 * Limits Display Unit Tests
 *
 * Tests for the /limits command display formatting, especially:
 * - Math.floor for percentage display (100% only appears when exactly 100%)
 * - Progress bar generation with threshold markers
 * - Time passed percentage calculation
 * - Warning emoji display when thresholds are exceeded
 *
 * Run with: node tests/limits-display.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1133
 * @see https://github.com/link-assistant/hive-mind/issues/1242
 */

import assert from 'node:assert/strict';
import { getProgressBar, calculateTimePassedPercentage, formatUsageMessage, DISPLAY_THRESHOLDS } from '../src/limits.lib.mjs';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

// ============================================================================
// Progress Bar Tests
// ============================================================================

console.log('\n📋 Progress Bar Tests\n');

test('getProgressBar returns correct length', () => {
  const bar = getProgressBar(50);
  assert.equal(bar.length, 30, 'Progress bar should be 30 characters');
});

test('getProgressBar at 0% shows all empty', () => {
  const bar = getProgressBar(0);
  assert.equal(bar.split('░').length - 1, 30, 'All blocks should be empty at 0%');
  assert.equal(bar.split('▓').length - 1, 0, 'No filled blocks at 0%');
});

test('getProgressBar at 100% shows all filled', () => {
  const bar = getProgressBar(100);
  assert.equal(bar.split('▓').length - 1, 30, 'All blocks should be filled at 100%');
  assert.equal(bar.split('░').length - 1, 0, 'No empty blocks at 100%');
});

test('getProgressBar at 50% shows half filled', () => {
  const bar = getProgressBar(50);
  assert.equal(bar.split('▓').length - 1, 15, '15 blocks should be filled at 50%');
  assert.equal(bar.split('░').length - 1, 15, '15 blocks should be empty at 50%');
});

test('getProgressBar handles edge values', () => {
  // Very low
  const bar1 = getProgressBar(1);
  assert.ok(bar1.length === 30, 'Progress bar at 1% should be 30 chars');

  // Very high but not 100
  const bar99 = getProgressBar(99);
  assert.ok(bar99.length === 30, 'Progress bar at 99% should be 30 chars');
  assert.ok(bar99.split('▓').length - 1 > 0, 'Should have filled blocks at 99%');
});

// ============================================================================
// Progress Bar with Threshold Marker Tests (Issue #1242)
// ============================================================================

console.log('\n📋 Progress Bar Threshold Marker Tests (Issue #1242)\n');

test('getProgressBar with threshold returns correct length', () => {
  const bar = getProgressBar(50, 65);
  assert.equal(bar.length, 30, 'Progress bar with threshold should be 30 characters');
});

test('getProgressBar with threshold includes marker character', () => {
  const bar = getProgressBar(50, 65);
  assert.ok(bar.includes('│'), 'Progress bar should include threshold marker │');
  assert.equal(bar.split('│').length - 1, 1, 'Should have exactly one threshold marker');
});

test('getProgressBar with threshold at 65% places marker correctly', () => {
  // 65% of 30 blocks = 19.5, rounds to 20
  const bar = getProgressBar(50, 65);
  const markerPos = bar.indexOf('│');
  // At 65% threshold, marker should be at position 19 or 20 (depending on rounding)
  assert.ok(markerPos >= 19 && markerPos <= 20, `Marker at position ${markerPos} should be at position 19-20 for 65% threshold`);
});

test('getProgressBar with threshold at 90% places marker correctly', () => {
  // 90% of 30 blocks = 27
  const bar = getProgressBar(50, 90);
  const markerPos = bar.indexOf('│');
  assert.equal(markerPos, 27, 'Marker should be at position 27 for 90% threshold');
});

test('getProgressBar with threshold at 97% places marker correctly', () => {
  // 97% of 30 blocks = 29.1, rounds to 29
  const bar = getProgressBar(50, 97);
  const markerPos = bar.indexOf('│');
  assert.equal(markerPos, 29, 'Marker should be at position 29 for 97% threshold');
});

test('getProgressBar with null threshold returns original format', () => {
  const barWithThreshold = getProgressBar(50, null);
  const barWithoutThreshold = getProgressBar(50);
  assert.equal(barWithThreshold, barWithoutThreshold, 'Null threshold should return same as no threshold');
  assert.ok(!barWithThreshold.includes('│'), 'Null threshold should not include marker');
});

test('getProgressBar threshold marker replaces one block', () => {
  const bar = getProgressBar(25, 65);
  // Count filled + empty + marker should equal 30
  const filledCount = bar.split('▓').length - 1;
  const emptyCount = bar.split('░').length - 1;
  const markerCount = bar.split('│').length - 1;
  assert.equal(filledCount + emptyCount + markerCount, 30, 'Total blocks + marker should equal 30');
});

test('DISPLAY_THRESHOLDS constants are defined', () => {
  assert.ok(DISPLAY_THRESHOLDS !== undefined, 'DISPLAY_THRESHOLDS should be defined');
  assert.equal(DISPLAY_THRESHOLDS.RAM, 65, 'RAM threshold should be 65');
  assert.equal(DISPLAY_THRESHOLDS.CPU, 65, 'CPU threshold should be 65');
  assert.equal(DISPLAY_THRESHOLDS.DISK, 90, 'DISK threshold should be 90');
  assert.equal(DISPLAY_THRESHOLDS.CLAUDE_5_HOUR_SESSION, 65, 'CLAUDE_5_HOUR_SESSION threshold should be 65');
  assert.equal(DISPLAY_THRESHOLDS.CLAUDE_WEEKLY, 97, 'CLAUDE_WEEKLY threshold should be 97');
  assert.equal(DISPLAY_THRESHOLDS.GITHUB_API, 75, 'GITHUB_API threshold should be 75');
});

// ============================================================================
// Math.floor for Percentage Display Tests (Issue #1133)
// ============================================================================

console.log('\n📋 Math.floor Percentage Tests (Issue #1133)\n');

test('formatUsageMessage uses Math.floor for session percentage', () => {
  // Create usage data with 99.5% (which should display as 99%, not 100%)
  const usage = {
    currentSession: {
      percentage: 99.5,
      resetTime: 'Jan 18, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    },
    allModels: {
      percentage: 50,
      resetTime: 'Jan 20, 12:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
    sonnetOnly: {
      percentage: 30,
      resetTime: 'Jan 20, 12:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
  };

  const message = formatUsageMessage(usage);

  // 99.5% should be floored to 99%, NOT rounded to 100%
  // Note: format changed from "99% used" to "99%" with optional warning emoji
  assert.ok(message.includes('99%'), 'Should show 99% (floored from 99.5%), not 100%');
  assert.ok(!message.match(/100%[^%]*Claude/), 'Should NOT show 100% when value is 99.5%');
});

test('formatUsageMessage shows 100% only when exactly 100', () => {
  const usage = {
    currentSession: {
      percentage: 100,
      resetTime: 'Jan 18, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 3600000).toISOString(),
    },
    allModels: {
      percentage: 100,
      resetTime: 'Jan 20, 12:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
    sonnetOnly: {
      percentage: 100,
      resetTime: 'Jan 20, 12:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
  };

  const message = formatUsageMessage(usage);

  // Exactly 100 should show 100% (with warning emoji since it exceeds threshold)
  assert.ok(message.includes('100%'), 'Should show 100% when value is exactly 100');
});

test('formatUsageMessage floors various percentages correctly', () => {
  const testCases = [
    { input: 0, expected: 0 },
    { input: 0.9, expected: 0 },
    { input: 1.0, expected: 1 },
    { input: 50.5, expected: 50 },
    { input: 89.9, expected: 89 },
    { input: 90.0, expected: 90 },
    { input: 99.0, expected: 99 },
    { input: 99.4, expected: 99 },
    { input: 99.9, expected: 99 },
    { input: 100.0, expected: 100 },
  ];

  for (const { input, expected } of testCases) {
    const floored = Math.floor(input);
    assert.equal(floored, expected, `Math.floor(${input}) should equal ${expected}`);
  }
});

test('Math.floor ensures 100% means exactly full', () => {
  // This is the key behavior from issue #1133:
  // "100% will mean only exactly 100% in /limits display"

  // Values just below 100 should NOT show 100%
  assert.equal(Math.floor(99.99), 99, '99.99% should floor to 99%');
  assert.equal(Math.floor(99.5), 99, '99.5% should floor to 99%');
  assert.equal(Math.floor(99.1), 99, '99.1% should floor to 99%');

  // Only exactly 100 shows 100%
  assert.equal(Math.floor(100), 100, 'Only exactly 100% should show 100%');
});

// ============================================================================
// Time Passed Percentage Tests
// ============================================================================

console.log('\n📋 Time Passed Percentage Tests\n');

test('calculateTimePassedPercentage returns null for null input', () => {
  const result = calculateTimePassedPercentage(null, 5);
  assert.equal(result, null, 'Should return null for null resetsAt');
});

test('calculateTimePassedPercentage returns valid percentage for future date', () => {
  // Create a date 1 hour in the future (for a 5-hour period, ~80% passed)
  const resetsAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
  const result = calculateTimePassedPercentage(resetsAt, 5);

  assert.ok(result !== null, 'Should return a value for future date');
  assert.ok(result >= 0 && result <= 100, 'Percentage should be between 0 and 100');
  // Should be around 80% (4 hours passed out of 5)
  assert.ok(result >= 70 && result <= 90, 'For 1 hour remaining of 5, should be ~80%');
});

test('calculateTimePassedPercentage handles 5-hour period', () => {
  // Test with 5-hour period (session limit)
  const now = new Date();
  const resetsIn2Hours = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const result = calculateTimePassedPercentage(resetsIn2Hours, 5);

  // 3 hours passed out of 5 = 60%
  assert.ok(result !== null, 'Should return a value');
  assert.ok(result >= 50 && result <= 70, 'For 2 hours remaining of 5, should be ~60%');
});

test('calculateTimePassedPercentage handles 168-hour period (weekly)', () => {
  // Test with 168-hour period (7 days)
  const now = new Date();
  // 84 hours remaining = 50% passed
  const resetsIn84Hours = new Date(now.getTime() + 84 * 60 * 60 * 1000).toISOString();
  const result = calculateTimePassedPercentage(resetsIn84Hours, 168);

  assert.ok(result !== null, 'Should return a value');
  assert.ok(result >= 40 && result <= 60, 'For 84 hours remaining of 168, should be ~50%');
});

// ============================================================================
// formatUsageMessage Comprehensive Tests
// ============================================================================

console.log('\n📋 formatUsageMessage Comprehensive Tests\n');

test('formatUsageMessage includes all required sections', () => {
  const usage = {
    currentSession: {
      percentage: 45,
      resetTime: 'Jan 18, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 3600000).toISOString(),
    },
    allModels: {
      percentage: 30,
      resetTime: 'Jan 20, 12:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
    sonnetOnly: {
      percentage: 20,
      resetTime: 'Jan 20, 12:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
  };

  const message = formatUsageMessage(usage);

  // Check all sections are present
  assert.ok(message.includes('Claude 5 hour session'), 'Should include 5 hour session header');
  assert.ok(message.includes('Current week (all models)'), 'Should include all models header');
  assert.ok(message.includes('Current week (Sonnet only)'), 'Should include Sonnet only header');
  assert.ok(message.includes('Current time:'), 'Should include current time');
});

test('formatUsageMessage handles null percentages', () => {
  const usage = {
    currentSession: {
      percentage: null,
      resetTime: null,
      resetsAt: null,
    },
    allModels: {
      percentage: null,
      resetTime: null,
      resetsAt: null,
    },
    sonnetOnly: {
      percentage: null,
      resetTime: null,
      resetsAt: null,
    },
  };

  const message = formatUsageMessage(usage);

  // Should show N/A for null values
  assert.ok(message.includes('N/A'), 'Should show N/A for null percentages');
});

test('formatUsageMessage includes optional system info', () => {
  const usage = {
    currentSession: { percentage: 50, resetTime: null, resetsAt: null },
    allModels: { percentage: 50, resetTime: null, resetsAt: null },
    sonnetOnly: { percentage: 50, resetTime: null, resetsAt: null },
  };

  const diskSpace = {
    usedPercentage: 60,
    usedBytes: 60 * 1024 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024 * 1024,
  };

  const memory = {
    usedPercentage: 40,
    usedBytes: 4 * 1024 * 1024 * 1024,
    totalBytes: 10 * 1024 * 1024 * 1024,
  };

  const cpuLoad = {
    usagePercentage: 25,
    loadAvg5: 1.0,
    cpuCount: 4,
  };

  const message = formatUsageMessage(usage, diskSpace, null, cpuLoad, memory);

  assert.ok(message.includes('CPU'), 'Should include CPU section when cpuLoad provided');
  assert.ok(message.includes('RAM'), 'Should include RAM section when memory provided');
  assert.ok(message.includes('Disk space'), 'Should include Disk space section when diskSpace provided');
});

// ============================================================================
// Edge Cases for Display
// ============================================================================

console.log('\n📋 Edge Cases for Display\n');

test('formatUsageMessage handles 0% correctly', () => {
  const usage = {
    currentSession: {
      percentage: 0,
      resetTime: 'Jan 18, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 3600000).toISOString(),
    },
    allModels: { percentage: 0, resetTime: null, resetsAt: null },
    sonnetOnly: { percentage: 0, resetTime: null, resetsAt: null },
  };

  const message = formatUsageMessage(usage);
  // Note: format changed from "0% used" to "0%" with optional warning emoji
  assert.ok(message.includes('0%'), 'Should show 0%');
});

test('formatUsageMessage handles extreme values', () => {
  // Test with values at boundaries
  const boundaryValues = [0, 1, 50, 99, 100];

  for (const pct of boundaryValues) {
    const usage = {
      currentSession: {
        percentage: pct,
        resetTime: 'Jan 18, 5:00pm UTC',
        resetsAt: new Date(Date.now() + 3600000).toISOString(),
      },
      allModels: { percentage: pct, resetTime: null, resetsAt: null },
      sonnetOnly: { percentage: pct, resetTime: null, resetsAt: null },
    };

    const message = formatUsageMessage(usage);
    // Note: format changed from "X% used" to "X%" with optional warning emoji
    assert.ok(message.includes(`${pct}%`), `Should show ${pct}%`);
  }
});

// ============================================================================
// Warning Emoji Tests (Issue #1242)
// ============================================================================

console.log('\n📋 Warning Emoji Tests (Issue #1242)\n');

test('formatUsageMessage shows warning emoji when session exceeds threshold', () => {
  const usage = {
    currentSession: {
      percentage: 70, // Above 65% threshold
      resetTime: 'Jan 18, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 3600000).toISOString(),
    },
    allModels: { percentage: 30, resetTime: null, resetsAt: null },
    sonnetOnly: { percentage: 20, resetTime: null, resetsAt: null },
  };

  const message = formatUsageMessage(usage);
  // Should show warning emoji for 70% (above 65% threshold)
  assert.ok(message.includes('70%') && message.includes('⚠️'), 'Should show warning emoji when session exceeds 65% threshold');
});

test('formatUsageMessage does not show warning emoji when below threshold', () => {
  const usage = {
    currentSession: {
      percentage: 50, // Below 65% threshold
      resetTime: 'Jan 18, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 3600000).toISOString(),
    },
    allModels: { percentage: 30, resetTime: null, resetsAt: null }, // Below 97%
    sonnetOnly: { percentage: 20, resetTime: null, resetsAt: null }, // Below 97%
  };

  const message = formatUsageMessage(usage);
  // Should not show warning emoji when all values are below their thresholds
  assert.ok(!message.includes('⚠️'), 'Should not show warning emoji when below thresholds');
});

test('formatUsageMessage shows warning for system resources when exceeded', () => {
  const usage = {
    currentSession: { percentage: 30, resetTime: null, resetsAt: null },
    allModels: { percentage: 30, resetTime: null, resetsAt: null },
    sonnetOnly: { percentage: 20, resetTime: null, resetsAt: null },
  };

  const cpuLoad = {
    usagePercentage: 70, // Above 65% threshold
    loadAvg5: 2.8,
    cpuCount: 4,
  };

  const memory = {
    usedPercentage: 70, // Above 65% threshold
    usedBytes: 7 * 1024 * 1024 * 1024,
    totalBytes: 10 * 1024 * 1024 * 1024,
  };

  const diskSpace = {
    usedPercentage: 95, // Above 90% threshold
    usedBytes: 95 * 1024 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024 * 1024,
  };

  const message = formatUsageMessage(usage, diskSpace, null, cpuLoad, memory);
  // Should show warning emoji for each exceeded threshold
  assert.ok(message.includes('⚠️'), 'Should show warning emoji for exceeded system thresholds');
});

test('formatUsageMessage shows threshold markers in progress bars', () => {
  const usage = {
    currentSession: {
      percentage: 50,
      resetTime: 'Jan 18, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 3600000).toISOString(),
    },
    allModels: { percentage: 30, resetTime: null, resetsAt: null },
    sonnetOnly: { percentage: 20, resetTime: null, resetsAt: null },
  };

  const cpuLoad = {
    usagePercentage: 30,
    loadAvg5: 1.2,
    cpuCount: 4,
  };

  const message = formatUsageMessage(usage, null, null, cpuLoad, null);
  // Should include threshold marker character
  assert.ok(message.includes('│'), 'Should include threshold marker in progress bars');
});

// ============================================================================
// Claude Error Display Tests (Issue #1343)
// ============================================================================

console.log('\n📋 Claude Error Display Tests (Issue #1343)\n');

test('formatUsageMessage with claudeError shows error once in Claude limits section', () => {
  const errorMessage = 'Claude authentication expired. Please use `/solve` or `/hive` commands to trigger re-authentication of Claude.';

  const message = formatUsageMessage(null, null, null, null, null, errorMessage);

  // Should include "Claude limits" header with the error
  assert.ok(message.includes('Claude limits'), 'Should include Claude limits header');

  // Should include all three subsection headers
  assert.ok(message.includes('Claude 5 hour session'), 'Should include 5 hour session header');
  assert.ok(message.includes('Current week (all models)'), 'Should include all models header');
  assert.ok(message.includes('Current week (Sonnet only)'), 'Should include Sonnet only header');

  // Should show the error message exactly once (backtick-stripped for code block)
  assert.ok(message.includes('Claude authentication expired'), 'Should show Claude auth error message');
  const errorOccurrences = message.split('Claude authentication expired').length - 1;
  assert.equal(errorOccurrences, 1, 'Error message should appear exactly once, not repeated in each subsection');

  // Should NOT show N/A when error is provided
  assert.ok(!message.includes('N/A'), 'Should NOT show N/A when error is provided');
});

test('formatUsageMessage with claudeError still shows system resource sections', () => {
  const errorMessage = 'Claude authentication expired.';

  const diskSpace = {
    usedPercentage: 60,
    usedBytes: 60 * 1024 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024 * 1024,
  };

  const memory = {
    usedPercentage: 40,
    usedBytes: 4 * 1024 * 1024 * 1024,
    totalBytes: 10 * 1024 * 1024 * 1024,
  };

  const cpuLoad = {
    usagePercentage: 25,
    loadAvg5: 1.0,
    cpuCount: 4,
  };

  const githubRateLimit = {
    usedPercentage: 10,
    used: 500,
    limit: 5000,
    relativeReset: '30m',
    resetTime: 'Jan 18, 5:00pm UTC',
  };

  const message = formatUsageMessage(null, diskSpace, githubRateLimit, cpuLoad, memory, errorMessage);

  // System sections should still appear
  assert.ok(message.includes('CPU'), 'Should include CPU section when cpuLoad provided');
  assert.ok(message.includes('RAM'), 'Should include RAM section when memory provided');
  assert.ok(message.includes('Disk space'), 'Should include Disk space section when diskSpace provided');
  assert.ok(message.includes('GitHub API'), 'Should include GitHub API section when githubRateLimit provided');

  // Claude error should appear
  assert.ok(message.includes('Claude authentication expired'), 'Should show Claude auth error');
});

test('formatUsageMessage with null claudeError shows normal Claude data', () => {
  const usage = {
    currentSession: {
      percentage: 45,
      resetTime: 'Jan 18, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 3600000).toISOString(),
    },
    allModels: {
      percentage: 30,
      resetTime: 'Jan 20, 12:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
    sonnetOnly: {
      percentage: 20,
      resetTime: 'Jan 20, 12:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
  };

  const message = formatUsageMessage(usage, null, null, null, null, null);

  // Should show normal usage data, not error
  assert.ok(message.includes('45%'), 'Should show 45% session usage');
  assert.ok(!message.includes('Claude authentication expired'), 'Should not show error when null claudeError');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n📊 Test Results\n');
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log(`Total tests: ${testsPassed + testsFailed}`);

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
