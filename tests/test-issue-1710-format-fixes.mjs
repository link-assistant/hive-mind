#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #1710 — locks the four "strange things" the issue lists to fixtures
 * built from real numbers captured in
 * `docs/case-studies/issue-1710/facts.md`.
 *
 * Each section below maps 1:1 onto a requirement from
 * `docs/case-studies/issue-1710/solution-plans.md`:
 *
 *   R1 — `calculateModelCost` bills web_search at $10 / 1k requests, so the
 *        public-pricing total reconciles with Anthropic's reported total.
 *   R2 — Haiku sub-session line shows an input-tokens phrase even when
 *        `peakContextUsage === 0` (sub-agent traffic).
 *   R3 — The bullet line is labelled "peak request:" so a reader does not
 *        try to reconcile it with the cumulative Total figure.
 *   R4 — The Total line always splits cache writes / cache reads as their
 *        own categories whenever either is present.
 *   R5 — Peak per-request context is `input + cache_creation` (cache reads
 *        excluded), so the bullet figure is reconcilable with the cumulative
 *        non-cached input figure.
 *
 * Numbers below come from `facts.md` § 1 (Anthropic-reported per-model
 * usage from the PR #1707 result event).
 */

import assert from 'node:assert/strict';
import { buildBudgetStatsString } from '../src/claude.budget-stats.lib.mjs';
import { calculateModelCost } from '../src/claude.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.message}`);
    testsFailed++;
  }
};

// ---------------------------------------------------------------------------
// Real numbers from facts.md (PR #1707 run; line ~66725 of solution-draft-log).
// ---------------------------------------------------------------------------

const HAIKU_45 = {
  modelInfo: {
    name: 'Claude Haiku 4.5',
    cost: { input: 1.0, output: 5.0, cache_read: 0.1, cache_write: 1.25 },
    limit: { context: 200_000, output: 64_000 },
  },
};

const OPUS_47 = {
  modelInfo: {
    name: 'Claude Opus 4.7',
    cost: { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 6.25 },
    limit: { context: 1_000_000, output: 128_000 },
  },
};

console.log('\n📋 R1 — web_search billed at documented per-request rate\n');

test('Haiku web_search 4 requests adds exactly $0.04', () => {
  const usage = {
    inputTokens: 77_969,
    cacheCreationTokens: 57_580,
    cacheReadTokens: 0,
    outputTokens: 4_176,
    webSearchRequests: 4,
  };
  const result = calculateModelCost(usage, HAIKU_45.modelInfo, true);
  // Token-only: 77 969 × $1/M + 57 580 × $1.25/M + 4 176 × $5/M
  // = 0.077969 + 0.071975 + 0.020880 = 0.170824
  // Plus web_search 4 × $0.01 = 0.04 → total 0.210824 — matches Anthropic's
  // result_event cost in facts.md (0.210824).
  assert.strictEqual(result.breakdown.webSearch.requests, 4, 'breakdown should include 4 web_search requests');
  assert.strictEqual(result.breakdown.webSearch.cost, 0.04, 'breakdown should bill 4 × $0.01 = $0.04');
  assert.ok(Math.abs(result.total - 0.210824) < 1e-9, `total should reconcile with Anthropic-reported 0.210824, got ${result.total}`);
});

test('zero web_search requests does not add cost', () => {
  const usage = {
    inputTokens: 690,
    cacheCreationTokens: 341_517,
    cacheReadTokens: 42_679_751,
    outputTokens: 79_567,
    webSearchRequests: 0,
  };
  const result = calculateModelCost(usage, OPUS_47.modelInfo, true);
  assert.strictEqual(result.breakdown.webSearch.cost, 0, 'no web_search cost when count is 0');
});

console.log('\n📋 R2 — Haiku sub-session line includes an input-tokens phrase\n');

test('Haiku sub-agent (peakContext=0) renders cumulative input phrase', () => {
  // From facts.md § 1: Haiku had cacheCreationTokens=57580, cacheReadTokens=0.
  // Old behavior: only output line ("4.2K / 64K (7%) output tokens").
  // New behavior: also surface input via the cumulative phrase.
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-7': {
        inputTokens: 690,
        cacheCreationTokens: 341_517,
        cacheReadTokens: 42_679_751,
        outputTokens: 79_567,
        modelName: 'Claude Opus 4.7',
        modelInfo: OPUS_47.modelInfo,
        peakContextUsage: 278_218,
        costUSD: 25.466982,
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 77_969,
        cacheCreationTokens: 57_580,
        cacheReadTokens: 0,
        outputTokens: 4_176,
        modelName: 'Claude Haiku 4.5',
        modelInfo: HAIKU_45.modelInfo,
        peakContextUsage: 0,
        costUSD: 0.210824,
      },
    },
    subSessions: [],
  };

  const result = buildBudgetStatsString(tokenUsage);
  // The Haiku line must mention input AND output now (not just output).
  // Cache writes are visible as their own category per R4.
  assert.match(result, /Claude Haiku 4\.5/);
  assert.match(result, /\(78\.0K new \+ 57\.6K cache writes\) input tokens, 4\.2K \/ 64K \(7%\) output tokens/, `expected combined input+output bullet for Haiku, got: ${result}`);
});

console.log('\n📋 R3 — bullet labelled "peak request:" to disambiguate from Total\n');

test('Opus single-session bullet is labelled "peak request:"', () => {
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-7': {
        inputTokens: 690,
        cacheCreationTokens: 341_517,
        cacheReadTokens: 42_679_751,
        outputTokens: 79_567,
        modelName: 'Claude Opus 4.7',
        modelInfo: OPUS_47.modelInfo,
        peakContextUsage: 278_218,
        costUSD: 25.466982,
      },
    },
    subSessions: [],
  };
  const result = buildBudgetStatsString(tokenUsage);
  assert.match(result, /peak request: 278\.2K \/ 1M/, `expected peak request label, got: ${result}`);
});

console.log('\n📋 R4 — Total always splits cache writes / cache reads when present\n');

test('Haiku Total preserves writes/reads as separate categories (writes only)', () => {
  // facts.md Haiku case: writes 57580, reads 0.
  // Old: "Total: 135.5K input tokens" (silently fused 77 969 input + 57 580 writes).
  // New: "Total: (78.0K new + 57.6K cache writes) input tokens".
  const tokenUsage = {
    modelUsage: {
      'claude-haiku-4-5-20251001': {
        inputTokens: 77_969,
        cacheCreationTokens: 57_580,
        cacheReadTokens: 0,
        outputTokens: 4_176,
        modelName: 'Claude Haiku 4.5',
        modelInfo: HAIKU_45.modelInfo,
        peakContextUsage: 0,
        costUSD: 0.210824,
      },
    },
    subSessions: [],
  };
  const result = buildBudgetStatsString(tokenUsage);
  assert.match(result, /Total: \(78\.0K new \+ 57\.6K cache writes\) input tokens/, `expected explicit writes split, got: ${result}`);
  // Old fused figure (135.5K) must not appear as a standalone "Total: 135.5K input tokens" line.
  assert.doesNotMatch(result, /Total: 135\.5K input tokens/);
});

test('Opus Total renders three-way split (input + writes + reads)', () => {
  // facts.md Opus case: input 690, writes 341 517, reads 42 679 751.
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-7': {
        inputTokens: 690,
        cacheCreationTokens: 341_517,
        cacheReadTokens: 42_679_751,
        outputTokens: 79_567,
        modelName: 'Claude Opus 4.7',
        modelInfo: OPUS_47.modelInfo,
        peakContextUsage: 278_218,
        costUSD: 25.466982,
      },
    },
    subSessions: [],
  };
  const result = buildBudgetStatsString(tokenUsage);
  assert.match(result, /Total: \(690 new \+ 341\.5K cache writes \+ 42\.7M cache reads\) input tokens/, `expected three-way split, got: ${result}`);
});

test('Total preserves legacy "(X + Y cached)" form when only cache reads exist', () => {
  // Back-compat: when there are no cache writes, keep the familiar `(X + Y cached)` shape.
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-7': {
        inputTokens: 690,
        cacheCreationTokens: 0,
        cacheReadTokens: 42_679_751,
        outputTokens: 79_567,
        modelName: 'Claude Opus 4.7',
        modelInfo: OPUS_47.modelInfo,
        peakContextUsage: 690,
        costUSD: 25.466982,
      },
    },
    subSessions: [],
  };
  const result = buildBudgetStatsString(tokenUsage);
  assert.match(result, /Total: \(690 \+ 42\.7M cached\) input tokens/, `expected legacy form when no writes, got: ${result}`);
});

console.log('\n📋 R5 — peakContext excludes cache reads (sub-sessions input is non-cached)\n');

test('peakContext semantic: bullet is reconcilable with totalInputNonCached', () => {
  // From facts.md: cumulative non-cached for Opus = 690 + 341 517 = 342 207.
  // The peak per-request value (now `input + cache_creation` only) cannot exceed
  // that cumulative figure, which gives the user a sane reconciliation:
  // "the largest single request used N tokens, the run cumulatively used M ≥ N".
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-7': {
        inputTokens: 690,
        cacheCreationTokens: 341_517,
        cacheReadTokens: 42_679_751,
        outputTokens: 79_567,
        modelName: 'Claude Opus 4.7',
        modelInfo: OPUS_47.modelInfo,
        peakContextUsage: 271, // example: a single request was input=1, cache_creation=270 → 271 (excludes cache_read=277_947)
        costUSD: 25.466982,
      },
    },
    subSessions: [],
  };
  const result = buildBudgetStatsString(tokenUsage);
  // Bullet shows the smaller, reconcilable figure
  assert.match(result, /peak request: 271 \/ 1M/);
  // Total shows the cumulative split with cache reads visible
  assert.match(result, /Total: \(690 new \+ 341\.5K cache writes \+ 42\.7M cache reads\) input tokens/);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n📊 Tests: ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
