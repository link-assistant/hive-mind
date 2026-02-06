#!/usr/bin/env node
// Test that all solve options accepted in TELEGRAM_SOLVE_OVERRIDES are also
// accepted in TELEGRAM_HIVE_OVERRIDES (via hive config).
// This ensures issue #1209 doesn't regress: solve-passthrough options must
// be available in hive config (either via auto-registration or hive-only definitions).

// This test uses the actual exported data structures from the config modules
// to verify option parity, instead of regex parsing. This makes the test
// resilient to the auto-registration approach (issue #1209).

import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';

console.log('Testing hive-solve option parity...\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

const solveOptionNames = Object.keys(SOLVE_OPTION_DEFINITIONS);
const passthroughNames = new Set(getSolvePassthroughOptionNames());

// Options that are intentionally solve-only and should NOT be in hive config
// (they don't make sense as passthrough because they are session-specific)
const solveOnlyExceptions = new Set([
  'resume', // session-specific, not applicable to hive workflow
  'working-directory', // session-specific, hive manages its own directories
  'only-prepare-command', // debug option, solve-specific
  'session-type', // internal hidden option for session tracking
]);

// Test 1: All solve options (except exceptions) should be passthrough
runTest('all solve options are passthrough (or in exception list)', () => {
  const missing = [];
  for (const opt of solveOptionNames) {
    if (!passthroughNames.has(opt) && !solveOnlyExceptions.has(opt)) {
      missing.push(opt);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Solve options not available as passthrough: ${missing.join(', ')}\n` + `Either add them to SOLVE_OPTION_DEFINITIONS or to solveOnlyExceptions in this test.`);
  }
});

// Test 2: Verify solve options count is reasonable (guard against import failure)
runTest('solve config has reasonable number of options', () => {
  if (solveOptionNames.length < 30) {
    throw new Error(`Expected at least 30 solve options, got ${solveOptionNames.length}. Import may be broken.`);
  }
});

// Test 3: Verify passthrough options count is reasonable
runTest('hive passthrough has reasonable number of options', () => {
  if (passthroughNames.size < 30) {
    throw new Error(`Expected at least 30 passthrough options, got ${passthroughNames.size}. Import may be broken.`);
  }
});

// Test 4: Specific options from issue #1209 should be passthrough
runTest('--gitkeep-file is passthrough', () => {
  if (!passthroughNames.has('gitkeep-file')) {
    throw new Error('gitkeep-file not in passthrough options');
  }
});

runTest('--claude-file is passthrough', () => {
  if (!passthroughNames.has('claude-file')) {
    throw new Error('claude-file not in passthrough options');
  }
});

runTest('--auto-gitkeep-file is passthrough', () => {
  if (!passthroughNames.has('auto-gitkeep-file')) {
    throw new Error('auto-gitkeep-file not in passthrough options');
  }
});

runTest('--tokens-budget-stats is passthrough', () => {
  if (!passthroughNames.has('tokens-budget-stats')) {
    throw new Error('tokens-budget-stats not in passthrough options');
  }
});

runTest('--base-branch is passthrough', () => {
  if (!passthroughNames.has('base-branch')) {
    throw new Error('base-branch not in passthrough options');
  }
});

// Test 5: Solve-only exceptions should NOT be in passthrough
runTest('solve-only options are excluded from passthrough', () => {
  const leaked = [];
  for (const opt of solveOnlyExceptions) {
    if (passthroughNames.has(opt)) {
      leaked.push(opt);
    }
  }
  if (leaked.length > 0) {
    throw new Error(`Solve-only options leaked into passthrough: ${leaked.join(', ')}`);
  }
});

// Test 6: SOLVE_OPTION_DEFINITIONS should be the source of truth
runTest('SOLVE_OPTION_DEFINITIONS contains all expected options', () => {
  const expectedOptions = [
    'verbose',
    'fork',
    'auto-fork',
    'attach-logs',
    'dry-run',
    'tool',
    // 'model' is intentionally NOT in SOLVE_OPTION_DEFINITIONS because it has
    // a dynamic default function that can't be shared as plain data.
    // It is defined inline in createYargsConfig instead.
    'sentry',
    'watch',
    'auto-merge',
  ];
  const missing = expectedOptions.filter(opt => !(opt in SOLVE_OPTION_DEFINITIONS));
  if (missing.length > 0) {
    throw new Error(`Expected options missing from SOLVE_OPTION_DEFINITIONS: ${missing.join(', ')}`);
  }
});

// Summary
console.log(`\n=== Test Summary ===`);
console.log(`Total: ${testsPassed + testsFailed} | ✅ Passed: ${testsPassed} | ❌ Failed: ${testsFailed}`);

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
}
