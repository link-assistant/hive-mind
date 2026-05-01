#!/usr/bin/env node
/**
 * Tests for Issue #1600: Calculation bugs and format unification
 *
 * Tests:
 * 1. Session segment count in model title
 * 2. Removed "Context window:" prefix (unified format)
 * 3. Sub-agent single session detalization (output-only line)
 * 4. Decimal precision in cost calculations
 * 5. Multiple sub-sessions use numbered list
 */

import assert from 'node:assert/strict';
import Decimal from 'decimal.js-light';
import { buildBudgetStatsString } from '../src/claude.budget-stats.lib.mjs';
import { calculateModelCost } from '../src/claude.lib.mjs';

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

// === Test: Session segment count in title ===
console.log('\n📋 Session segment count in model title\n');

test('shows session segment count for primary model with multiple sub-sessions', () => {
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 100000,
        cacheCreationTokens: 0,
        cacheReadTokens: 5000000,
        outputTokens: 40000,
        modelName: 'Claude Opus 4.6',
        modelInfo: { limit: { context: 1000000, output: 128000 } },
        peakContextUsage: 166000,
        costUSD: 28.812422,
      },
    },
    subSessions: [
      { peakContextUsage: 166500, outputTokens: 41400, inputTokens: 50000, cacheCreationTokens: 0, cacheReadTokens: 2000000, messageCount: 10 },
      { peakContextUsage: 167000, outputTokens: 47200, inputTokens: 50000, cacheCreationTokens: 0, cacheReadTokens: 2000000, messageCount: 12 },
      { peakContextUsage: 59400, outputTokens: 9300, inputTokens: 20000, cacheCreationTokens: 0, cacheReadTokens: 1000000, messageCount: 5 },
    ],
  };

  const result = buildBudgetStatsString(tokenUsage);
  assert.ok(result.includes('(3 session segments)'), `Should show session segment count. Got: ${result}`);
});

test('does not show session segment count for single sub-session', () => {
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 100000,
        cacheCreationTokens: 0,
        cacheReadTokens: 5000000,
        outputTokens: 40000,
        modelName: 'Claude Opus 4.6',
        modelInfo: { limit: { context: 1000000, output: 128000 } },
        peakContextUsage: 106300,
        costUSD: 3.41978,
      },
    },
    subSessions: [{ peakContextUsage: 106300, outputTokens: 40000, inputTokens: 100000, cacheCreationTokens: 0, cacheReadTokens: 5000000, messageCount: 20 }],
  };

  const result = buildBudgetStatsString(tokenUsage);
  assert.ok(!result.includes('session segments'), `Should not show session segment count for single session. Got: ${result}`);
});

// === Test: Removed "Context window:" prefix ===
console.log('\n📋 Removed "Context window:" prefix\n');

test('sub-sessions use numbered list without Context window prefix', () => {
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 100000,
        cacheCreationTokens: 0,
        cacheReadTokens: 5000000,
        outputTokens: 40000,
        modelName: 'Claude Opus 4.6',
        modelInfo: { limit: { context: 1000000, output: 128000 } },
        peakContextUsage: 166000,
        costUSD: 28.0,
      },
    },
    subSessions: [
      { peakContextUsage: 166500, outputTokens: 41400, inputTokens: 50000, cacheCreationTokens: 0, cacheReadTokens: 2000000, messageCount: 10 },
      { peakContextUsage: 167000, outputTokens: 47200, inputTokens: 50000, cacheCreationTokens: 0, cacheReadTokens: 2000000, messageCount: 12 },
    ],
  };

  const result = buildBudgetStatsString(tokenUsage);
  assert.ok(!result.includes('Context window:'), `Should not contain "Context window:" prefix. Got: ${result}`);
  assert.ok(result.includes('1. '), 'Should have numbered list');
  assert.ok(result.includes('2. '), 'Should have second numbered item');
});

test('single session uses bullet without Context window prefix', () => {
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 100000,
        cacheCreationTokens: 0,
        cacheReadTokens: 5000000,
        outputTokens: 40000,
        modelName: 'Claude Opus 4.6',
        modelInfo: { limit: { context: 1000000, output: 128000 } },
        peakContextUsage: 106300,
        costUSD: 3.0,
      },
    },
    subSessions: [],
  };

  const result = buildBudgetStatsString(tokenUsage);
  assert.ok(!result.includes('Context window:'), `Should not contain "Context window:" prefix. Got: ${result}`);
});

// === Test: Sub-agent single session shows output detalization ===
console.log('\n📋 Sub-agent single session detalization\n');

test('single sub-agent session shows output detalization when no peak context', () => {
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 100000,
        cacheCreationTokens: 0,
        cacheReadTokens: 5000000,
        outputTokens: 20000,
        modelName: 'Claude Opus 4.6',
        modelInfo: { limit: { context: 1000000, output: 128000 } },
        peakContextUsage: 106000,
        costUSD: 3.0,
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 21400,
        cacheCreationTokens: 0,
        cacheReadTokens: 20700,
        outputTokens: 282,
        modelName: 'Claude Haiku 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
        peakContextUsage: 0,
        costUSD: 0.030241,
      },
    },
    subSessions: [],
  };

  const result = buildBudgetStatsString(tokenUsage);
  // Haiku should show output detalization line
  assert.ok(result.includes('282'), `Should show Haiku output tokens. Got: ${result}`);
  assert.ok(result.includes('64K'), `Should show output limit for Haiku. Got: ${result}`);
  assert.ok(result.includes('0%'), `Should show 0% for small output. Got: ${result}`);
});

test('single sub-agent Sonnet session shows output detalization', () => {
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 100000,
        cacheCreationTokens: 0,
        cacheReadTokens: 5000000,
        outputTokens: 20000,
        modelName: 'Claude Opus 4.6',
        modelInfo: { limit: { context: 1000000, output: 128000 } },
        peakContextUsage: 106000,
        costUSD: 3.0,
      },
      'claude-sonnet-4-6': {
        inputTokens: 25600,
        cacheCreationTokens: 0,
        cacheReadTokens: 49000,
        outputTokens: 1800,
        modelName: 'Claude Sonnet 4.6',
        modelInfo: { limit: { context: 200000, output: 64000 } },
        peakContextUsage: 0,
        costUSD: 0.137594,
      },
    },
    subSessions: [],
  };

  const result = buildBudgetStatsString(tokenUsage);
  // Sonnet should show output detalization
  assert.ok(result.includes('1.8K / 64K'), `Should show Sonnet output with limit. Got: ${result}`);
});

// === Test: Decimal precision ===
console.log('\n📋 Decimal precision in cost calculations\n');

test('calculateModelCost uses precise arithmetic', () => {
  const usage = {
    inputTokens: 105300,
    cacheCreationTokens: 0,
    cacheReadTokens: 5200000,
    outputTokens: 26700,
  };
  const modelInfo = {
    cost: {
      input: 15,
      output: 75,
      cache_read: 1.5,
      cache_write: 18.75,
    },
  };

  const result = calculateModelCost(usage, modelInfo, true);
  const expectedInput = new Decimal(105300).div(1000000).mul(15).toNumber();
  const expectedCacheRead = new Decimal(5200000).div(1000000).mul(1.5).toNumber();
  const expectedOutput = new Decimal(26700).div(1000000).mul(75).toNumber();
  const expectedTotal = new Decimal(expectedInput).plus(expectedCacheRead).plus(expectedOutput).toNumber();

  assert.strictEqual(result.breakdown.input.cost, expectedInput, 'Input cost should use Decimal precision');
  assert.strictEqual(result.breakdown.cacheRead.cost, expectedCacheRead, 'Cache read cost should use Decimal precision');
  assert.strictEqual(result.breakdown.output.cost, expectedOutput, 'Output cost should use Decimal precision');
  assert.strictEqual(result.total, expectedTotal, 'Total should use Decimal precision');
});

test('cost display uses Decimal toFixed for consistent formatting', () => {
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 100000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 10000,
        modelName: 'Claude Opus 4.6',
        modelInfo: { limit: { context: 1000000, output: 128000 } },
        peakContextUsage: 100000,
        costUSD: 3.907074,
      },
    },
    subSessions: [],
  };

  const result = buildBudgetStatsString(tokenUsage);
  assert.ok(result.includes('$3.907074 cost'), `Should show precise cost with Decimal. Got: ${result}`);
});

// === Test: Multi-model with sub-agent call count ===
console.log('\n📋 Multi-model format consistency\n');

test('multi-model output with sub-agent calls and single sessions', () => {
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 521300,
        cacheCreationTokens: 0,
        cacheReadTokens: 44800000,
        outputTokens: 126000,
        modelName: 'Claude Opus 4.6',
        modelInfo: { limit: { context: 1000000, output: 128000 } },
        peakContextUsage: 166000,
        costUSD: 28.812422,
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 93800,
        cacheCreationTokens: 0,
        cacheReadTokens: 1700000,
        outputTokens: 14500,
        modelName: 'Claude Haiku 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
        peakContextUsage: 0,
        costUSD: 0.36435,
      },
    },
    subSessions: [
      { peakContextUsage: 166500, outputTokens: 41400, inputTokens: 50000, cacheCreationTokens: 0, cacheReadTokens: 2000000, messageCount: 10 },
      { peakContextUsage: 167000, outputTokens: 47200, inputTokens: 50000, cacheCreationTokens: 0, cacheReadTokens: 2000000, messageCount: 12 },
      { peakContextUsage: 59400, outputTokens: 9300, inputTokens: 20000, cacheCreationTokens: 0, cacheReadTokens: 1000000, messageCount: 5 },
    ],
  };

  const subAgentCalls = [
    { id: '1', description: 'test', model: 'haiku', usage: { inputTokens: 68000, cacheCreationTokens: 0, cacheReadTokens: 900000, outputTokens: 7 } },
    { id: '2', description: 'test2', model: 'haiku', usage: { inputTokens: 41900, cacheCreationTokens: 0, cacheReadTokens: 800000, outputTokens: 4 } },
  ];

  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);

  // Primary model should show session segments
  assert.ok(result.includes('(3 session segments)'), 'Should show session segment count for primary model');
  // Haiku should show sub-agent calls
  assert.ok(result.includes('(2 sub-agent calls)'), 'Should show sub-agent call count for Haiku');
  // No "Context window:" prefix
  assert.ok(!result.includes('Context window:'), 'Should not contain "Context window:" prefix anywhere');
});

// === Summary ===
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
