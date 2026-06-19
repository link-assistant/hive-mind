#!/usr/bin/env node

/**
 * Issue #1951: 1-hour prompt-cache writes must use the 2x base-input price.
 *
 * The real issue log reported Claude Opus 4.8 usage where all
 * cache_creation_input_tokens were explicitly tagged as
 * cache_creation.ephemeral_1h_input_tokens. models.dev exposes only the
 * 5-minute cache-write price (`cache_write`, 1.25x input), so the local public
 * pricing estimate undercharged those writes unless the TTL split was used.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import Decimal from 'decimal.js-light';
import { calculateModelCost } from '../src/claude.cost.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`  ${error.message}`);
    testsFailed++;
  }
}

const OPUS_48_PUBLIC_PRICING = {
  cost: {
    input: 5,
    cache_write: 6.25,
    cache_read: 0.5,
    output: 25,
  },
};

const ISSUE_1951_USAGE = {
  inputTokens: 3846,
  cacheCreationTokens: 71030,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 71030,
  cacheReadTokens: 2311299,
  outputTokens: 15398,
  webSearchRequests: 0,
};

console.log('Issue #1951 cache TTL cost tests');

test('calculates the issue log total using 1-hour cache-write pricing', () => {
  const result = calculateModelCost(ISSUE_1951_USAGE, OPUS_48_PUBLIC_PRICING, true);
  const expected = new Decimal(3846).mul(5).plus(new Decimal(71030).mul(10)).plus(new Decimal(2311299).mul(0.5)).plus(new Decimal(15398).mul(25)).div(1000000);

  assert.equal(new Decimal(result.total).toFixed(6), '2.270130');
  assert.equal(new Decimal(result.total).toFixed(6), expected.toFixed(6));
  assert.equal(result.breakdown.cacheWrite1h.tokens, 71030);
  assert.equal(result.breakdown.cacheWrite1h.costPerMillion, 10);
  assert.equal(new Decimal(result.breakdown.cacheWrite1h.cost).toFixed(6), '0.710300');
});

test('keeps aggregate cache-write behavior when no TTL split is available', () => {
  const usage = {
    inputTokens: 1000,
    cacheCreationTokens: 500000,
    cacheReadTokens: 0,
    outputTokens: 100,
  };

  const result = calculateModelCost(usage, OPUS_48_PUBLIC_PRICING, true);

  assert.equal(new Decimal(result.total).toFixed(6), '3.132500');
  assert.equal(result.breakdown.cacheWrite.tokens, 500000);
  assert.equal(result.breakdown.cacheWrite.costPerMillion, 6.25);
});

console.log(`Tests: ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
