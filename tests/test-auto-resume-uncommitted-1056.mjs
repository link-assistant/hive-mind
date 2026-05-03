#!/usr/bin/env node

/**
 * Test suite for --auto-resume-on-uncommitted-changes (issue #1056)
 *
 * Verifies the decision helpers in src/auto-resume-uncommitted.lib.mjs:
 *   - threshold parsing from camelCase + dash-cased argv
 *   - feature-flag detection
 *   - worst-utilisation picker across multi-model token usage
 *   - decideAutoResumeOnUncommittedChanges decision tree
 *
 * @hive-mind-test-suite default
 */

import { DEFAULT_MAX_CONTEXT_USAGE_PERCENT, decideAutoResumeOnUncommittedChanges, getAutoResumeMaxContextUsage, isAutoResumeOnUncommittedChangesEnabled, pickWorstContextUtilisation } from '../src/auto-resume-uncommitted.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('\x1b[32m✓ PASSED\x1b[0m');
    testsPassed++;
  } catch (error) {
    console.log(`\x1b[31m✗ FAILED: ${error.message}\x1b[0m`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertClose(actual, expected, message, tolerance = 0.0001) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ~${expected}, got ${actual}`);
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

// === getAutoResumeMaxContextUsage ===

runTest('getAutoResumeMaxContextUsage: returns 50 by default', () => {
  assertEqual(getAutoResumeMaxContextUsage({}), DEFAULT_MAX_CONTEXT_USAGE_PERCENT, 'default threshold');
  assertEqual(DEFAULT_MAX_CONTEXT_USAGE_PERCENT, 50, 'default constant is 50');
});

runTest('getAutoResumeMaxContextUsage: reads camelCase argv', () => {
  const value = getAutoResumeMaxContextUsage({ autoResumeOnUncommittedChangesMaximumContextWindowUsage: 75 });
  assertEqual(value, 75, 'camelCase threshold');
});

runTest('getAutoResumeMaxContextUsage: reads dash-cased argv', () => {
  const value = getAutoResumeMaxContextUsage({ 'auto-resume-on-uncommitted-changes-maximum-context-window-usage': 25 });
  assertEqual(value, 25, 'dash-cased threshold');
});

runTest('getAutoResumeMaxContextUsage: clamps to [0,100]', () => {
  assertEqual(getAutoResumeMaxContextUsage({ autoResumeOnUncommittedChangesMaximumContextWindowUsage: -10 }), 0, 'negative clamps to 0');
  assertEqual(getAutoResumeMaxContextUsage({ autoResumeOnUncommittedChangesMaximumContextWindowUsage: 200 }), 100, 'huge clamps to 100');
});

runTest('getAutoResumeMaxContextUsage: ignores invalid values', () => {
  assertEqual(getAutoResumeMaxContextUsage({ autoResumeOnUncommittedChangesMaximumContextWindowUsage: 'abc' }), 50, 'NaN falls back to default');
  assertEqual(getAutoResumeMaxContextUsage({ autoResumeOnUncommittedChangesMaximumContextWindowUsage: '' }), 50, 'empty string falls back to default');
});

runTest('getAutoResumeMaxContextUsage: parses numeric strings', () => {
  assertEqual(getAutoResumeMaxContextUsage({ autoResumeOnUncommittedChangesMaximumContextWindowUsage: '60' }), 60, 'string number parsed');
});

// === isAutoResumeOnUncommittedChangesEnabled ===

runTest('isAutoResumeOnUncommittedChangesEnabled: false by default', () => {
  assertFalse(isAutoResumeOnUncommittedChangesEnabled({}), 'no flag → disabled');
  assertFalse(isAutoResumeOnUncommittedChangesEnabled({ autoResumeOnUncommittedChanges: false }), 'explicit false → disabled');
});

runTest('isAutoResumeOnUncommittedChangesEnabled: true when camelCase flag set', () => {
  assertTrue(isAutoResumeOnUncommittedChangesEnabled({ autoResumeOnUncommittedChanges: true }), 'camelCase flag enables');
});

runTest('isAutoResumeOnUncommittedChangesEnabled: true when dash-cased flag set', () => {
  assertTrue(isAutoResumeOnUncommittedChangesEnabled({ 'auto-resume-on-uncommitted-changes': true }), 'dash-cased flag enables');
});

// === pickWorstContextUtilisation ===

runTest('pickWorstContextUtilisation: returns null for empty/missing usage', () => {
  assertEqual(pickWorstContextUtilisation(null), null, 'null returns null');
  assertEqual(pickWorstContextUtilisation({}), null, 'empty returns null');
  assertEqual(pickWorstContextUtilisation({ modelUsage: {} }), null, 'empty modelUsage returns null');
});

runTest('pickWorstContextUtilisation: skips models without context limit', () => {
  const usage = {
    modelUsage: {
      'claude-1': { peakContextUsage: 1000, modelInfo: {} },
      'claude-2': { peakContextUsage: 2000 },
    },
  };
  assertEqual(pickWorstContextUtilisation(usage), null, 'no usable limits → null');
});

runTest('pickWorstContextUtilisation: picks the highest-utilisation model', () => {
  const usage = {
    modelUsage: {
      'claude-sonnet-4': { peakContextUsage: 50000, modelInfo: { limit: { context: 200000 } } }, // 25%
      'claude-opus-4': { peakContextUsage: 80000, modelInfo: { limit: { context: 200000 } } }, // 40%
    },
  };
  const worst = pickWorstContextUtilisation(usage);
  assertEqual(worst.peak, 80000, 'picks higher peak');
  assertEqual(worst.limit, 200000, 'matching limit');
  assertClose(worst.ratio, 0.4, 'ratio is 0.4');
});

runTest('pickWorstContextUtilisation: handles single model', () => {
  const usage = {
    modelUsage: {
      'claude-sonnet-4-5': { peakContextUsage: 100000, modelInfo: { limit: { context: 200000 } } },
    },
  };
  const worst = pickWorstContextUtilisation(usage);
  assertEqual(worst.peak, 100000, 'single peak');
  assertEqual(worst.limit, 200000, 'single limit');
  assertClose(worst.ratio, 0.5, 'ratio is 0.5');
});

// === decideAutoResumeOnUncommittedChanges ===

runTest('decide: disabled when flag not set', () => {
  const result = decideAutoResumeOnUncommittedChanges({ argv: {}, sessionId: 'abc', tokenUsage: null });
  assertFalse(result.resume, 'no resume when flag off');
  assertEqual(result.reason, 'disabled', 'reason: disabled');
});

runTest('decide: no_session_id when session ID missing', () => {
  const argv = { autoResumeOnUncommittedChanges: true };
  const result = decideAutoResumeOnUncommittedChanges({ argv, sessionId: null });
  assertFalse(result.resume, 'no resume without session ID');
  assertEqual(result.reason, 'no_session_id', 'reason: no_session_id');
  assertEqual(result.threshold, 50, 'default threshold preserved');
});

runTest('decide: no_context_data still resumes when flag honoured', () => {
  const argv = { autoResumeOnUncommittedChanges: true };
  const result = decideAutoResumeOnUncommittedChanges({ argv, sessionId: 'abc', tokenUsage: null });
  assertTrue(result.resume, 'resume even without context data');
  assertEqual(result.reason, 'no_context_data', 'reason: no_context_data');
});

runTest('decide: ok when usage below threshold', () => {
  const argv = { autoResumeOnUncommittedChanges: true };
  const tokenUsage = {
    modelUsage: {
      'claude-sonnet-4': { peakContextUsage: 50000, modelInfo: { limit: { context: 200000 } } },
    },
  };
  const result = decideAutoResumeOnUncommittedChanges({ argv, sessionId: 'abc', tokenUsage });
  assertTrue(result.resume, 'resume when below threshold');
  assertEqual(result.reason, 'ok', 'reason: ok');
  assertClose(result.usedPercent, 25, 'used percent matches');
  assertEqual(result.peak, 50000, 'peak preserved');
  assertEqual(result.limit, 200000, 'limit preserved');
});

runTest('decide: context_too_full when usage at/above threshold', () => {
  const argv = { autoResumeOnUncommittedChanges: true };
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4': { peakContextUsage: 110000, modelInfo: { limit: { context: 200000 } } }, // 55%
    },
  };
  const result = decideAutoResumeOnUncommittedChanges({ argv, sessionId: 'abc', tokenUsage });
  assertFalse(result.resume, 'no resume above default threshold (50%)');
  assertEqual(result.reason, 'context_too_full', 'reason: context_too_full');
  assertClose(result.usedPercent, 55, 'used percent matches');
});

runTest('decide: threshold honours custom value', () => {
  const argv = {
    autoResumeOnUncommittedChanges: true,
    autoResumeOnUncommittedChangesMaximumContextWindowUsage: 75,
  };
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4': { peakContextUsage: 140000, modelInfo: { limit: { context: 200000 } } }, // 70%
    },
  };
  const result = decideAutoResumeOnUncommittedChanges({ argv, sessionId: 'abc', tokenUsage });
  assertTrue(result.resume, 'resume below higher threshold');
  assertEqual(result.threshold, 75, 'custom threshold reported');
  assertEqual(result.reason, 'ok', 'reason: ok');
});

runTest('decide: threshold boundary — usage equal to threshold blocks resume', () => {
  const argv = {
    autoResumeOnUncommittedChanges: true,
    autoResumeOnUncommittedChangesMaximumContextWindowUsage: 50,
  };
  const tokenUsage = {
    modelUsage: {
      'claude-sonnet-4': { peakContextUsage: 100000, modelInfo: { limit: { context: 200000 } } }, // exactly 50%
    },
  };
  const result = decideAutoResumeOnUncommittedChanges({ argv, sessionId: 'abc', tokenUsage });
  assertFalse(result.resume, 'no resume when usage equals threshold');
  assertEqual(result.reason, 'context_too_full', 'reason: context_too_full');
});

runTest('decide: multi-model picks worst utilisation', () => {
  const argv = {
    autoResumeOnUncommittedChanges: true,
    autoResumeOnUncommittedChangesMaximumContextWindowUsage: 50,
  };
  const tokenUsage = {
    modelUsage: {
      // 10% — would pass on its own
      'claude-haiku': { peakContextUsage: 20000, modelInfo: { limit: { context: 200000 } } },
      // 60% — exceeds threshold
      'claude-opus': { peakContextUsage: 120000, modelInfo: { limit: { context: 200000 } } },
    },
  };
  const result = decideAutoResumeOnUncommittedChanges({ argv, sessionId: 'abc', tokenUsage });
  assertFalse(result.resume, 'multi-model conservative — worst wins');
  assertEqual(result.peak, 120000, 'reports worst peak');
});

console.log('');
console.log(`\x1b[1mResults: ${testsPassed} passed, ${testsFailed} failed\x1b[0m`);
process.exit(testsFailed === 0 ? 0 : 1);
