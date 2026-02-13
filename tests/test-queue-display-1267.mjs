#!/usr/bin/env node
/**
 * Tests for Issue #1267 fixes:
 *   - formatDuration human-readable time formatting
 *   - Queue display: per-queue grouping, max 5 items
 *   - "used" label on progress bars below threshold
 *
 * Run with: node tests/test-queue-display-1267.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1267
 */

import assert from 'node:assert/strict';
import { SolveQueue, resetSolveQueue, formatDuration } from '../src/telegram-solve-queue.lib.mjs';

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

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

function beforeEach() {
  resetSolveQueue();
}

console.log('='.repeat(80));
console.log('Tests: Issue #1267 - Queue Display & Progress Bar Fixes');
console.log('='.repeat(80));

// ============================================================================
// formatDuration Tests
// ============================================================================

console.log('\n📋 formatDuration Tests\n');

test('formatDuration formats seconds correctly', () => {
  assert.equal(formatDuration(0), '0s', 'Zero should show 0s');
  assert.equal(formatDuration(500), '0s', 'Less than a second should show 0s');
  assert.equal(formatDuration(1000), '1s', '1 second');
  assert.equal(formatDuration(45000), '45s', '45 seconds');
});

test('formatDuration formats minutes and seconds', () => {
  assert.equal(formatDuration(60000), '1m', '1 minute exactly');
  assert.equal(formatDuration(135000), '2m 15s', '2 minutes 15 seconds');
  assert.equal(formatDuration(3599000), '59m 59s', '59 minutes 59 seconds');
});

test('formatDuration formats hours, minutes, and seconds', () => {
  assert.equal(formatDuration(3600000), '1h', '1 hour exactly');
  assert.equal(formatDuration(20603000), '5h 43m 23s', '5 hours 43 minutes 23 seconds');
  assert.equal(formatDuration(86399000), '23h 59m 59s', '23 hours 59 minutes 59 seconds');
});

test('formatDuration formats days', () => {
  assert.equal(formatDuration(86400000), '1d', '1 day exactly');
  assert.equal(formatDuration(97920000 + 5000), '1d 3h 12m 5s', '1 day 3 hours 12 minutes 5 seconds');
});

test('formatDuration handles negative values gracefully', () => {
  assert.equal(formatDuration(-1000), '0s', 'Negative should show 0s');
});

// ============================================================================
// Queue Display Tests (per-queue grouping)
// ============================================================================

console.log('\n📋 Queue Display Tests\n');

await asyncTest('formatStatus shows all queues even when empty', async () => {
  beforeEach();
  const queue = new SolveQueue();

  const status = await queue.formatStatus();
  assert.ok(status.includes('Queues'), 'Should show Queues header');
  assert.ok(status.includes('claude'), 'Should show claude queue');
  assert.ok(status.includes('agent'), 'Should show agent queue');
  assert.ok(status.includes('pending: 0'), 'Should show 0 pending for empty queues');
  // Processing count should come from pgrep (actual running processes)
  assert.ok(status.includes('processing:'), 'Should show processing count');

  queue.stop();
});

await asyncTest('formatDetailedStatus groups items by tool queue', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '',
    requester: 'testuser',
    infoBlock: 'Test',
    tool: 'claude',
  });
  queue.enqueue({
    url: 'https://github.com/test/repo/issues/2',
    args: '',
    requester: 'testuser',
    infoBlock: 'Test',
    tool: 'agent',
  });
  queue.enqueue({
    url: 'https://github.com/test/repo/issues/3',
    args: '',
    requester: 'testuser',
    infoBlock: 'Test',
    tool: 'claude',
  });

  const status = await queue.formatDetailedStatus();

  // Should show both queues with correct counts
  assert.ok(status.includes('claude'), 'Should include claude queue');
  assert.ok(status.includes('agent'), 'Should include agent queue');
  assert.ok(status.includes('pending: 2'), 'Should show 2 pending for claude');
  assert.ok(status.includes('pending: 1'), 'Should show 1 pending for agent');
  // Processing count should come from pgrep (actual running processes)
  assert.ok(status.includes('processing:'), 'Should show processing count');
  // Items should show human-readable time, not raw seconds
  assert.ok(!status.includes('s)') || status.includes('0s)'), 'Should use human-readable time format');

  queue.stop();
});

await asyncTest('formatDetailedStatus shows max 5 items per queue', async () => {
  beforeEach();
  const queue = new SolveQueue({ verbose: false });

  // Add 7 items to claude queue
  for (let i = 1; i <= 7; i++) {
    queue.enqueue({
      url: `https://github.com/test/repo/issues/${i}`,
      args: '',
      requester: 'testuser',
      infoBlock: 'Test',
      tool: 'claude',
    });
  }

  const status = await queue.formatDetailedStatus();

  // Should show first 5 items and "... and 2 more"
  assert.ok(status.includes('issues/1'), 'Should show first item');
  assert.ok(status.includes('issues/5'), 'Should show fifth item');
  assert.ok(!status.includes('issues/6'), 'Should not show sixth item');
  assert.ok(status.includes('and 2 more'), 'Should show count of remaining items');

  queue.stop();
});

// ============================================================================
// Used Label Tests (progress bar suffix)
// ============================================================================

console.log('\n📋 Used Label Tests\n');

await asyncTest('formatUsageMessage shows used label on progress bars below threshold', async () => {
  const { formatUsageMessage } = await import('../src/limits.lib.mjs');

  const usage = {
    currentSession: {
      percentage: 30,
      resetTime: 'Jan 18, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 3600000).toISOString(),
    },
    allModels: {
      percentage: 20,
      resetTime: 'Jan 20, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
    sonnetOnly: {
      percentage: 10,
      resetTime: 'Jan 20, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
  };

  const message = formatUsageMessage(
    usage,
    {
      usedPercentage: 50,
      usedBytes: 50 * 1024 * 1024 * 1024,
      totalBytes: 100 * 1024 * 1024 * 1024,
      freePercentage: 50,
    },
    {
      usedPercentage: 10,
      used: 500,
      limit: 5000,
      relativeReset: '30m',
      resetTime: 'Jan 18, 5:30pm UTC',
    },
    { usagePercentage: 25, loadAvg5: 0.5, cpuCount: 2 },
    {
      usedPercentage: 40,
      usedBytes: 4 * 1024 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024 * 1024,
    }
  );

  // All percentages are below threshold, so should show "used" not "⚠️"
  assert.ok(message.includes('25% used'), 'CPU should show "used" label when below threshold');
  assert.ok(message.includes('40% used'), 'RAM should show "used" label when below threshold');
  assert.ok(message.includes('50% used'), 'Disk should show "used" label when below threshold');
  assert.ok(message.includes('10% used'), 'GitHub should show "used" label when below threshold');
  assert.ok(message.includes('30% used'), 'Claude session should show "used" label when below threshold');
});

await asyncTest('formatUsageMessage shows warning emoji on progress bars at/above threshold', async () => {
  const { formatUsageMessage } = await import('../src/limits.lib.mjs');

  const usage = {
    currentSession: {
      percentage: 70,
      resetTime: 'Jan 18, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 3600000).toISOString(),
    },
    allModels: {
      percentage: 98,
      resetTime: 'Jan 20, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
    sonnetOnly: {
      percentage: 10,
      resetTime: 'Jan 20, 5:00pm UTC',
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    },
  };

  const message = formatUsageMessage(
    usage,
    {
      usedPercentage: 95,
      usedBytes: 95 * 1024 * 1024 * 1024,
      totalBytes: 100 * 1024 * 1024 * 1024,
      freePercentage: 5,
    },
    null,
    { usagePercentage: 80, loadAvg5: 4.8, cpuCount: 6 },
    {
      usedPercentage: 75,
      usedBytes: 7.5 * 1024 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024 * 1024,
    }
  );

  // These are above threshold, so should show "⚠️" not "used"
  assert.ok(message.includes('80% ⚠️'), 'CPU should show warning emoji when above threshold');
  assert.ok(message.includes('75% ⚠️'), 'RAM should show warning emoji when above threshold');
  assert.ok(message.includes('95% ⚠️'), 'Disk should show warning emoji when above threshold');
  assert.ok(message.includes('70% ⚠️'), 'Claude session should show warning emoji when above threshold');
  assert.ok(message.includes('98% ⚠️'), 'Claude weekly should show warning emoji when above threshold');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log(`Test Results for Issue #1267:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log(`  Total: ${testsPassed + testsFailed}`);
console.log('='.repeat(80));

process.exit(testsFailed > 0 ? 1 : 0);
