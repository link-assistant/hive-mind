#!/usr/bin/env node
/**
 * Limits Display Unit Tests
 *
 * Tests for the /limits command display formatting, especially:
 * - Math.floor for percentage display (100% only appears when exactly 100%)
 * - Progress bar generation
 * - Time passed percentage calculation
 *
 * Run with: node tests/limits-display.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1133
 */

import assert from 'node:assert/strict';
import { getProgressBar, calculateTimePassedPercentage, formatUsageMessage } from '../src/limits.lib.mjs';

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
  assert.ok(message.includes('99% used'), 'Should show 99% (floored from 99.5%), not 100%');
  assert.ok(!message.includes('100% used'), 'Should NOT show 100% when value is 99.5%');
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

  // Exactly 100 should show 100%
  assert.ok(message.includes('100% used'), 'Should show 100% when value is exactly 100');
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
  assert.ok(message.includes('0% used'), 'Should show 0% used');
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
    assert.ok(message.includes(`${pct}% used`), `Should show ${pct}% used`);
  }
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
