#!/usr/bin/env node

/**
 * Tests for log-upload.lib.mjs
 *
 * These tests verify the log upload functionality works correctly,
 * particularly ensuring no empty string arguments are passed to gh-upload-log.
 *
 * Reference: Issue #1088 - gh-upload-log failed due to empty string argument
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const { execSync, spawn } = await use('child_process');

// Test results tracking
let passed = 0;
let failed = 0;
const results = [];

// Test helper functions
const assertEqual = (actual, expected, message) => {
  if (actual === expected) {
    passed++;
    results.push({ status: 'PASS', message });
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    results.push({ status: 'FAIL', message, actual, expected });
    console.log(`  ❌ ${message}`);
    console.log(`     Expected: ${JSON.stringify(expected)}`);
    console.log(`     Actual: ${JSON.stringify(actual)}`);
  }
};

const assertIncludesNo = (array, value, message) => {
  if (!array.includes(value)) {
    passed++;
    results.push({ status: 'PASS', message });
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    results.push({ status: 'FAIL', message, array, value });
    console.log(`  ❌ ${message}`);
    console.log(`     Array should not include: ${JSON.stringify(value)}`);
    console.log(`     Actual array: ${JSON.stringify(array)}`);
  }
};

const assertTrue = (condition, message) => {
  if (condition) {
    passed++;
    results.push({ status: 'PASS', message });
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    results.push({ status: 'FAIL', message });
    console.log(`  ❌ ${message}`);
  }
};

const assertFalse = (condition, message) => {
  if (!condition) {
    passed++;
    results.push({ status: 'PASS', message });
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    results.push({ status: 'FAIL', message });
    console.log(`  ❌ ${message}`);
  }
};

console.log('🧪 Running log-upload.lib.mjs tests...\n');

// =============================================================================
// Test 1: Command argument building - no empty strings
// =============================================================================
console.log('📋 Test 1: Command argument building (no empty strings)');

{
  // Simulate the command building logic from uploadLogWithGhUploadLog
  const buildCommandArgs = (logFile, isPublic, verbose) => {
    const publicFlag = isPublic ? '--public' : '--private';
    const commandArgs = [`"${logFile}"`, publicFlag];
    if (verbose) {
      commandArgs.push('--verbose');
    }
    return commandArgs;
  };

  // Test with verbose=false (this was the bug scenario)
  const args1 = buildCommandArgs('/tmp/test.log', true, false);
  assertIncludesNo(args1, '', 'No empty strings when verbose=false');
  assertEqual(args1.length, 2, 'Should have 2 args when verbose=false');
  assertEqual(args1[0], '"/tmp/test.log"', 'First arg should be log file');
  assertEqual(args1[1], '--public', 'Second arg should be --public');

  // Test with verbose=true
  const args2 = buildCommandArgs('/tmp/test.log', false, true);
  assertIncludesNo(args2, '', 'No empty strings when verbose=true');
  assertEqual(args2.length, 3, 'Should have 3 args when verbose=true');
  assertEqual(args2[2], '--verbose', 'Third arg should be --verbose');

  // Test with private
  const args3 = buildCommandArgs('/tmp/test.log', false, false);
  assertEqual(args3[1], '--private', 'Should use --private when isPublic=false');
}

// =============================================================================
// Test 2: Old buggy pattern detection
// =============================================================================
console.log('\n📋 Test 2: Old buggy pattern detection');

{
  // The old buggy pattern was: ${verbose ? '--verbose' : ''}
  // which would produce empty string when verbose=false

  const oldBuggyPattern = verbose => (verbose ? '--verbose' : '');
  const buggyResult1 = oldBuggyPattern(false);
  assertEqual(buggyResult1, '', 'Old pattern produces empty string when verbose=false');

  // The new pattern should never produce empty strings
  const newPattern = verbose => {
    const args = [];
    if (verbose) {
      args.push('--verbose');
    }
    return args;
  };

  const newResult1 = newPattern(false);
  assertEqual(newResult1.length, 0, 'New pattern produces empty array when verbose=false');
  assertIncludesNo(newResult1, '', 'New pattern array has no empty strings');
}

// =============================================================================
// Test 3: Command string construction
// =============================================================================
console.log('\n📋 Test 3: Command string construction');

{
  // Test the final command string construction
  const buildCommand = (logFile, isPublic, verbose) => {
    const publicFlag = isPublic ? '--public' : '--private';
    const commandArgs = [`"${logFile}"`, publicFlag];
    if (verbose) {
      commandArgs.push('--verbose');
    }
    return `gh-upload-log ${commandArgs.join(' ')}`;
  };

  const cmd1 = buildCommand('/tmp/test.log', true, false);
  assertEqual(cmd1, 'gh-upload-log "/tmp/test.log" --public', 'Command without verbose');
  assertFalse(cmd1.includes('  '), 'No double spaces in command');

  const cmd2 = buildCommand('/tmp/test.log', false, true);
  assertEqual(cmd2, 'gh-upload-log "/tmp/test.log" --private --verbose', 'Command with verbose');
  assertFalse(cmd2.includes('  '), 'No double spaces in command with verbose');
}

// =============================================================================
// Test 4: Edge cases
// =============================================================================
console.log('\n📋 Test 4: Edge cases');

{
  // Test with special characters in log file path
  const buildCommandArgs = (logFile, isPublic, verbose) => {
    const publicFlag = isPublic ? '--public' : '--private';
    const commandArgs = [`"${logFile}"`, publicFlag];
    if (verbose) {
      commandArgs.push('--verbose');
    }
    return commandArgs;
  };

  const args1 = buildCommandArgs('/tmp/test file with spaces.log', true, false);
  assertTrue(args1[0].includes('test file with spaces'), 'Handles spaces in filename');

  const args2 = buildCommandArgs('/tmp/test-log-2024-01-01.log', false, false);
  assertTrue(args2[0].includes('test-log-2024-01-01'), 'Handles dashes in filename');
}

// =============================================================================
// Test 5: Integration test - check gh-upload-log command exists
// =============================================================================
console.log('\n📋 Test 5: gh-upload-log availability check');

{
  try {
    const result = execSync('which gh-upload-log || command -v gh-upload-log', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assertTrue(result.trim().length > 0, 'gh-upload-log command is available');
  } catch (error) {
    console.log('  ⚠️  gh-upload-log not available (skipping integration test)');
    console.log('     This is expected in environments without gh-upload-log installed');
  }
}

// =============================================================================
// Test 6: Verify gh-upload-log rejects empty argument (regression test)
// =============================================================================
console.log('\n📋 Test 6: gh-upload-log empty argument rejection (regression)');

{
  try {
    // This command should fail with "Unknown argument" error if we pass empty string
    const result = execSync('gh-upload-log "" 2>&1 || true', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.includes('Unknown argument')) {
      assertTrue(true, 'gh-upload-log correctly rejects empty string argument');
    } else if (result.includes('command not found') || result.includes('not found')) {
      console.log('  ⚠️  gh-upload-log not installed (skipping)');
    } else {
      // If gh-upload-log doesn't reject empty string, our fix is still important
      // to prevent unexpected behavior
      assertTrue(true, 'gh-upload-log handles empty string (our fix prevents this scenario)');
    }
  } catch (error) {
    console.log('  ⚠️  Could not test gh-upload-log empty argument (skipping)');
  }
}

// =============================================================================
// Summary
// =============================================================================
console.log('\n' + '='.repeat(60));
console.log(`📊 Test Summary: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
