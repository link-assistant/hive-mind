#!/usr/bin/env node
/**
 * Queue Config Unit Tests
 *
 * Tests for the centralized queue-config.lib.mjs module.
 * Verifies that QUEUE_CONFIG and DISPLAY_THRESHOLDS are consistent.
 * Tests configurable threshold strategies (reject, enqueue, dequeue-one-at-a-time).
 *
 * Run with: node tests/queue-config.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1242
 * @see https://github.com/link-assistant/hive-mind/issues/1253
 */

import assert from 'node:assert/strict';
import { QUEUE_CONFIG, DISPLAY_THRESHOLDS, THRESHOLD_STRATEGIES, thresholdToPercent, parseQueueConfig, getStrategy, isRejectStrategy, isEnqueueStrategy, isOneAtATimeStrategy } from '../src/queue-config.lib.mjs';

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
// QUEUE_CONFIG Tests
// ============================================================================

console.log('\n📋 QUEUE_CONFIG Tests\n');

test('QUEUE_CONFIG has all required threshold fields', () => {
  assert.ok(QUEUE_CONFIG.RAM_THRESHOLD !== undefined, 'RAM_THRESHOLD should be defined');
  assert.ok(QUEUE_CONFIG.CPU_THRESHOLD !== undefined, 'CPU_THRESHOLD should be defined');
  assert.ok(QUEUE_CONFIG.DISK_THRESHOLD !== undefined, 'DISK_THRESHOLD should be defined');
  assert.ok(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD !== undefined, 'CLAUDE_5_HOUR_SESSION_THRESHOLD should be defined');
  assert.ok(QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD !== undefined, 'CLAUDE_WEEKLY_THRESHOLD should be defined');
  assert.ok(QUEUE_CONFIG.GITHUB_API_THRESHOLD !== undefined, 'GITHUB_API_THRESHOLD should be defined');
});

test('QUEUE_CONFIG has all required timing fields', () => {
  assert.ok(QUEUE_CONFIG.MIN_START_INTERVAL_MS !== undefined, 'MIN_START_INTERVAL_MS should be defined');
  assert.ok(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS !== undefined, 'CONSUMER_POLL_INTERVAL_MS should be defined');
  assert.ok(QUEUE_CONFIG.MESSAGE_UPDATE_INTERVAL_MS !== undefined, 'MESSAGE_UPDATE_INTERVAL_MS should be defined');
});

test('QUEUE_CONFIG thresholds are valid ratios (0.0 - 1.0)', () => {
  assert.ok(QUEUE_CONFIG.RAM_THRESHOLD >= 0 && QUEUE_CONFIG.RAM_THRESHOLD <= 1, 'RAM_THRESHOLD should be between 0 and 1');
  assert.ok(QUEUE_CONFIG.CPU_THRESHOLD >= 0 && QUEUE_CONFIG.CPU_THRESHOLD <= 1, 'CPU_THRESHOLD should be between 0 and 1');
  assert.ok(QUEUE_CONFIG.DISK_THRESHOLD >= 0 && QUEUE_CONFIG.DISK_THRESHOLD <= 1, 'DISK_THRESHOLD should be between 0 and 1');
  assert.ok(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD >= 0 && QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD <= 1, 'CLAUDE_5_HOUR_SESSION_THRESHOLD should be between 0 and 1');
  assert.ok(QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD >= 0 && QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD <= 1, 'CLAUDE_WEEKLY_THRESHOLD should be between 0 and 1');
  assert.ok(QUEUE_CONFIG.GITHUB_API_THRESHOLD >= 0 && QUEUE_CONFIG.GITHUB_API_THRESHOLD <= 1, 'GITHUB_API_THRESHOLD should be between 0 and 1');
});

test('QUEUE_CONFIG has expected default values', () => {
  assert.equal(QUEUE_CONFIG.RAM_THRESHOLD, 0.65, 'RAM_THRESHOLD should be 0.65');
  assert.equal(QUEUE_CONFIG.CPU_THRESHOLD, 0.65, 'CPU_THRESHOLD should be 0.65');
  assert.equal(QUEUE_CONFIG.DISK_THRESHOLD, 0.9, 'DISK_THRESHOLD should be 0.9');
  assert.equal(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD, 0.65, 'CLAUDE_5_HOUR_SESSION_THRESHOLD should be 0.65');
  assert.equal(QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD, 0.97, 'CLAUDE_WEEKLY_THRESHOLD should be 0.97');
  assert.equal(QUEUE_CONFIG.GITHUB_API_THRESHOLD, 0.75, 'GITHUB_API_THRESHOLD should be 0.75');
});

// ============================================================================
// DISPLAY_THRESHOLDS Tests
// ============================================================================

console.log('\n📋 DISPLAY_THRESHOLDS Tests\n');

test('DISPLAY_THRESHOLDS has all required fields', () => {
  assert.ok(DISPLAY_THRESHOLDS.RAM !== undefined, 'RAM should be defined');
  assert.ok(DISPLAY_THRESHOLDS.CPU !== undefined, 'CPU should be defined');
  assert.ok(DISPLAY_THRESHOLDS.DISK !== undefined, 'DISK should be defined');
  assert.ok(DISPLAY_THRESHOLDS.CLAUDE_5_HOUR_SESSION !== undefined, 'CLAUDE_5_HOUR_SESSION should be defined');
  assert.ok(DISPLAY_THRESHOLDS.CLAUDE_WEEKLY !== undefined, 'CLAUDE_WEEKLY should be defined');
  assert.ok(DISPLAY_THRESHOLDS.GITHUB_API !== undefined, 'GITHUB_API should be defined');
});

test('DISPLAY_THRESHOLDS values are percentages (0 - 100)', () => {
  assert.ok(DISPLAY_THRESHOLDS.RAM >= 0 && DISPLAY_THRESHOLDS.RAM <= 100, 'RAM should be between 0 and 100');
  assert.ok(DISPLAY_THRESHOLDS.CPU >= 0 && DISPLAY_THRESHOLDS.CPU <= 100, 'CPU should be between 0 and 100');
  assert.ok(DISPLAY_THRESHOLDS.DISK >= 0 && DISPLAY_THRESHOLDS.DISK <= 100, 'DISK should be between 0 and 100');
  assert.ok(DISPLAY_THRESHOLDS.CLAUDE_5_HOUR_SESSION >= 0 && DISPLAY_THRESHOLDS.CLAUDE_5_HOUR_SESSION <= 100, 'CLAUDE_5_HOUR_SESSION should be between 0 and 100');
  assert.ok(DISPLAY_THRESHOLDS.CLAUDE_WEEKLY >= 0 && DISPLAY_THRESHOLDS.CLAUDE_WEEKLY <= 100, 'CLAUDE_WEEKLY should be between 0 and 100');
  assert.ok(DISPLAY_THRESHOLDS.GITHUB_API >= 0 && DISPLAY_THRESHOLDS.GITHUB_API <= 100, 'GITHUB_API should be between 0 and 100');
});

test('DISPLAY_THRESHOLDS has expected default values', () => {
  assert.equal(DISPLAY_THRESHOLDS.RAM, 65, 'RAM should be 65');
  assert.equal(DISPLAY_THRESHOLDS.CPU, 65, 'CPU should be 65');
  assert.equal(DISPLAY_THRESHOLDS.DISK, 90, 'DISK should be 90');
  assert.equal(DISPLAY_THRESHOLDS.CLAUDE_5_HOUR_SESSION, 65, 'CLAUDE_5_HOUR_SESSION should be 65');
  assert.equal(DISPLAY_THRESHOLDS.CLAUDE_WEEKLY, 97, 'CLAUDE_WEEKLY should be 97');
  assert.equal(DISPLAY_THRESHOLDS.GITHUB_API, 75, 'GITHUB_API should be 75');
});

// ============================================================================
// Consistency Tests
// ============================================================================

console.log('\n📋 Consistency Tests (Issue #1242)\n');

test('DISPLAY_THRESHOLDS are derived from QUEUE_CONFIG', () => {
  // Verify that DISPLAY_THRESHOLDS values match QUEUE_CONFIG values converted to percentages
  assert.equal(DISPLAY_THRESHOLDS.RAM, thresholdToPercent(QUEUE_CONFIG.RAM_THRESHOLD), 'RAM should match QUEUE_CONFIG');
  assert.equal(DISPLAY_THRESHOLDS.CPU, thresholdToPercent(QUEUE_CONFIG.CPU_THRESHOLD), 'CPU should match QUEUE_CONFIG');
  assert.equal(DISPLAY_THRESHOLDS.DISK, thresholdToPercent(QUEUE_CONFIG.DISK_THRESHOLD), 'DISK should match QUEUE_CONFIG');
  assert.equal(DISPLAY_THRESHOLDS.CLAUDE_5_HOUR_SESSION, thresholdToPercent(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD), 'CLAUDE_5_HOUR_SESSION should match QUEUE_CONFIG');
  assert.equal(DISPLAY_THRESHOLDS.CLAUDE_WEEKLY, thresholdToPercent(QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD), 'CLAUDE_WEEKLY should match QUEUE_CONFIG');
  assert.equal(DISPLAY_THRESHOLDS.GITHUB_API, thresholdToPercent(QUEUE_CONFIG.GITHUB_API_THRESHOLD), 'GITHUB_API should match QUEUE_CONFIG');
});

// ============================================================================
// thresholdToPercent Tests
// ============================================================================

console.log('\n📋 thresholdToPercent Tests\n');

test('thresholdToPercent converts ratios to percentages correctly', () => {
  assert.equal(thresholdToPercent(0), 0, '0 should convert to 0');
  assert.equal(thresholdToPercent(0.5), 50, '0.5 should convert to 50');
  assert.equal(thresholdToPercent(1), 100, '1 should convert to 100');
  assert.equal(thresholdToPercent(0.65), 65, '0.65 should convert to 65');
  assert.equal(thresholdToPercent(0.97), 97, '0.97 should convert to 97');
  assert.equal(thresholdToPercent(0.75), 75, '0.75 should convert to 75');
});

test('thresholdToPercent rounds correctly', () => {
  assert.equal(thresholdToPercent(0.654), 65, '0.654 should round to 65');
  assert.equal(thresholdToPercent(0.655), 66, '0.655 should round to 66');
  assert.equal(thresholdToPercent(0.999), 100, '0.999 should round to 100');
});

// ============================================================================
// Threshold Strategies Tests (Issue #1253)
// ============================================================================

console.log('\n📋 Threshold Strategies Tests (Issue #1253)\n');

test('THRESHOLD_STRATEGIES contains valid strategies', () => {
  assert.ok(Array.isArray(THRESHOLD_STRATEGIES), 'THRESHOLD_STRATEGIES should be an array');
  assert.equal(THRESHOLD_STRATEGIES.length, 3, 'Should have 3 strategies');
  assert.ok(THRESHOLD_STRATEGIES.includes('reject'), 'Should include reject');
  assert.ok(THRESHOLD_STRATEGIES.includes('enqueue'), 'Should include enqueue');
  assert.ok(THRESHOLD_STRATEGIES.includes('dequeue-one-at-a-time'), 'Should include dequeue-one-at-a-time');
});

test('QUEUE_CONFIG.thresholds has all required metrics', () => {
  assert.ok(QUEUE_CONFIG.thresholds.ram, 'RAM threshold should be defined');
  assert.ok(QUEUE_CONFIG.thresholds.cpu, 'CPU threshold should be defined');
  assert.ok(QUEUE_CONFIG.thresholds.disk, 'DISK threshold should be defined');
  assert.ok(QUEUE_CONFIG.thresholds.claude5Hour, 'Claude 5 hour threshold should be defined');
  assert.ok(QUEUE_CONFIG.thresholds.claudeWeekly, 'Claude weekly threshold should be defined');
  assert.ok(QUEUE_CONFIG.thresholds.githubApi, 'GitHub API threshold should be defined');
});

test('Each threshold has value and strategy properties', () => {
  for (const [metric, config] of Object.entries(QUEUE_CONFIG.thresholds)) {
    assert.ok(typeof config.value === 'number', `${metric} should have numeric value`);
    assert.ok(config.value >= 0 && config.value <= 1, `${metric} value should be between 0 and 1`);
    assert.ok(THRESHOLD_STRATEGIES.includes(config.strategy), `${metric} should have valid strategy`);
  }
});

test('Default strategies are correct', () => {
  assert.equal(QUEUE_CONFIG.thresholds.ram.strategy, 'enqueue', 'RAM default should be enqueue');
  assert.equal(QUEUE_CONFIG.thresholds.cpu.strategy, 'enqueue', 'CPU default should be enqueue');
  assert.equal(QUEUE_CONFIG.thresholds.disk.strategy, 'reject', 'DISK default should be reject (issue #1253)');
  assert.equal(QUEUE_CONFIG.thresholds.claude5Hour.strategy, 'dequeue-one-at-a-time', 'Claude 5h default should be dequeue-one-at-a-time');
  assert.equal(QUEUE_CONFIG.thresholds.claudeWeekly.strategy, 'dequeue-one-at-a-time', 'Claude weekly default should be dequeue-one-at-a-time');
  assert.equal(QUEUE_CONFIG.thresholds.githubApi.strategy, 'enqueue', 'GitHub API default should be enqueue');
});

test('Legacy flat threshold values match thresholds.*.value', () => {
  assert.equal(QUEUE_CONFIG.RAM_THRESHOLD, QUEUE_CONFIG.thresholds.ram.value, 'RAM_THRESHOLD should match thresholds.ram.value');
  assert.equal(QUEUE_CONFIG.CPU_THRESHOLD, QUEUE_CONFIG.thresholds.cpu.value, 'CPU_THRESHOLD should match thresholds.cpu.value');
  assert.equal(QUEUE_CONFIG.DISK_THRESHOLD, QUEUE_CONFIG.thresholds.disk.value, 'DISK_THRESHOLD should match thresholds.disk.value');
  assert.equal(QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD, QUEUE_CONFIG.thresholds.claude5Hour.value, 'CLAUDE_5_HOUR_SESSION_THRESHOLD should match thresholds.claude5Hour.value');
  assert.equal(QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD, QUEUE_CONFIG.thresholds.claudeWeekly.value, 'CLAUDE_WEEKLY_THRESHOLD should match thresholds.claudeWeekly.value');
  assert.equal(QUEUE_CONFIG.GITHUB_API_THRESHOLD, QUEUE_CONFIG.thresholds.githubApi.value, 'GITHUB_API_THRESHOLD should match thresholds.githubApi.value');
});

// ============================================================================
// parseQueueConfig Tests (Issue #1253)
// ============================================================================

console.log('\n📋 parseQueueConfig Tests (Issue #1253)\n');

test('parseQueueConfig returns empty object for empty input', () => {
  assert.deepEqual(parseQueueConfig(''), {}, 'Empty string should return empty object');
  assert.deepEqual(parseQueueConfig(null), {}, 'Null should return empty object');
  assert.deepEqual(parseQueueConfig(undefined), {}, 'Undefined should return empty object');
});

test('parseQueueConfig parses simple config', () => {
  const config = parseQueueConfig('((disk (90% reject)))');
  assert.ok(config.disk, 'Should have disk config');
  assert.equal(config.disk.value, 0.9, 'Disk value should be 0.9');
  assert.equal(config.disk.strategy, 'reject', 'Disk strategy should be reject');
});

test('parseQueueConfig parses multiple thresholds', () => {
  const config = parseQueueConfig('((disk (90% reject)) (ram (65% enqueue)))');
  assert.ok(config.disk, 'Should have disk config');
  assert.ok(config.ram, 'Should have ram config');
  assert.equal(config.disk.value, 0.9, 'Disk value should be 0.9');
  assert.equal(config.disk.strategy, 'reject', 'Disk strategy should be reject');
  assert.equal(config.ram.value, 0.65, 'RAM value should be 0.65');
  assert.equal(config.ram.strategy, 'enqueue', 'RAM strategy should be enqueue');
});

test('parseQueueConfig normalizes kebab-case metric names', () => {
  const config = parseQueueConfig('((claude-5-hour (65% dequeue-one-at-a-time)) (github-api (75% enqueue)))');
  assert.ok(config.claude5Hour, 'Should normalize claude-5-hour to claude5Hour');
  assert.ok(config.githubApi, 'Should normalize github-api to githubApi');
});

test('parseQueueConfig defaults to enqueue for invalid strategy', () => {
  const config = parseQueueConfig('((disk (90% invalid-strategy)))');
  assert.equal(config.disk.strategy, 'enqueue', 'Invalid strategy should default to enqueue');
});

// ============================================================================
// Strategy Helper Functions Tests (Issue #1253)
// ============================================================================

console.log('\n📋 Strategy Helper Functions Tests (Issue #1253)\n');

test('getStrategy returns correct strategy for each metric', () => {
  assert.equal(getStrategy('ram'), 'enqueue', 'RAM strategy should be enqueue');
  assert.equal(getStrategy('cpu'), 'enqueue', 'CPU strategy should be enqueue');
  assert.equal(getStrategy('disk'), 'reject', 'DISK strategy should be reject');
  assert.equal(getStrategy('claude5Hour'), 'dequeue-one-at-a-time', 'Claude 5h strategy should be dequeue-one-at-a-time');
  assert.equal(getStrategy('claudeWeekly'), 'dequeue-one-at-a-time', 'Claude weekly strategy should be dequeue-one-at-a-time');
  assert.equal(getStrategy('githubApi'), 'enqueue', 'GitHub API strategy should be enqueue');
});

test('getStrategy returns enqueue for unknown metric', () => {
  assert.equal(getStrategy('unknown'), 'enqueue', 'Unknown metric should return enqueue');
});

test('isRejectStrategy works correctly', () => {
  assert.equal(isRejectStrategy('disk'), true, 'Disk should be reject strategy');
  assert.equal(isRejectStrategy('ram'), false, 'RAM should not be reject strategy');
});

test('isEnqueueStrategy works correctly', () => {
  assert.equal(isEnqueueStrategy('ram'), true, 'RAM should be enqueue strategy');
  assert.equal(isEnqueueStrategy('disk'), false, 'Disk should not be enqueue strategy');
});

test('isOneAtATimeStrategy works correctly', () => {
  assert.equal(isOneAtATimeStrategy('claude5Hour'), true, 'Claude 5h should be one-at-a-time strategy');
  assert.equal(isOneAtATimeStrategy('ram'), false, 'RAM should not be one-at-a-time strategy');
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
