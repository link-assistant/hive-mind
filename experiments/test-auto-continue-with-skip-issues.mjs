#!/usr/bin/env node

/**
 * Test for --auto-continue default behavior with -s flag (Issue #454)
 *
 * This test verifies:
 * 1. When -s is used alone, --no-auto-continue is automatically passed to solve
 * 2. When -s and --auto-continue are both used explicitly, an error is shown
 * 3. The test from test-hive.mjs still works with -vas flags
 */

import { execSync } from 'child_process';

console.log('Testing auto-continue behavior with -s flag (Issue #454)...\n');

const hivePath = './src/hive.mjs';
let testsPassed = 0;
let testsFailed = 0;

function runTest(testName, testFn) {
  try {
    testFn();
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAIL: ${testName}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

// Test 1: -s alone should work (auto-continue disabled internally)
runTest('hive with -s flag should work', () => {
  try {
    const output = execSync(`${hivePath} https://github.com/test/test -vas --dry-run --no-sentry --skip-tool-check --once 2>&1`, {
      encoding: 'utf8',
      timeout: 15000
    });

    // Should not show conflict error
    if (output.includes('Conflicting options')) {
      throw new Error('Should not show conflict error when using -s alone');
    }

    // Should execute successfully
    if (!output.includes('DRY RUN') && !output.includes('dry-run') && !output.includes('Monitoring Configuration')) {
      throw new Error('Should show dry-run output');
    }
  } catch (error) {
    if (error.status) {
      throw new Error(`Command failed with exit code ${error.status}: ${error.message}`);
    }
    throw error;
  }
});

// Test 2: -s with explicit --auto-continue should show error
runTest('hive with -s and --auto-continue should error', () => {
  try {
    const output = execSync(`${hivePath} https://github.com/test/test -s --auto-continue --dry-run --no-sentry --skip-tool-check --once 2>&1`, {
      encoding: 'utf8',
      timeout: 15000
    });

    // Should show conflict error
    if (!output.includes('Conflicting options')) {
      throw new Error('Should show conflict error when using both -s and --auto-continue');
    }

    if (!output.includes('skip-issues-with-prs') || !output.includes('auto-continue')) {
      throw new Error('Error message should mention both conflicting options');
    }
  } catch (error) {
    // Command should fail with non-zero exit code
    if (error.status === 1 && error.stdout) {
      // This is expected - verify error message is present
      if (!error.stdout.includes('Conflicting options')) {
        throw new Error('Should show conflict error message');
      }
      // This is the expected behavior
      return;
    }

    if (error.status) {
      // Check if stderr contains the error
      const output = error.stdout || error.stderr || '';
      if (output.includes('Conflicting options')) {
        // This is expected
        return;
      }
      throw new Error(`Unexpected exit code ${error.status}: ${error.message}`);
    }
    throw error;
  }

  throw new Error('Command should have failed with conflict error');
});

// Test 3: -s with explicit --no-auto-continue should work
runTest('hive with -s and --no-auto-continue should work', () => {
  try {
    const output = execSync(`${hivePath} https://github.com/test/test -s --no-auto-continue --dry-run --no-sentry --skip-tool-check --once 2>&1`, {
      encoding: 'utf8',
      timeout: 15000
    });

    // Should not show conflict error
    if (output.includes('Conflicting options')) {
      throw new Error('Should not show conflict error with -s and --no-auto-continue');
    }

    // Should execute successfully
    if (!output.includes('DRY RUN') && !output.includes('dry-run') && !output.includes('Monitoring Configuration')) {
      throw new Error('Should show dry-run output');
    }
  } catch (error) {
    if (error.status) {
      throw new Error(`Command failed with exit code ${error.status}: ${error.message}`);
    }
    throw error;
  }
});

// Test 4: Without -s, --auto-continue should be enabled by default
runTest('hive without -s should have auto-continue enabled', () => {
  try {
    const output = execSync(`${hivePath} https://github.com/test/test --dry-run --no-sentry --skip-tool-check --once --verbose 2>&1`, {
      encoding: 'utf8',
      timeout: 15000
    });

    // Should show auto-continue enabled
    if (!output.includes('Auto-Continue: ENABLED')) {
      throw new Error('Should show auto-continue enabled by default');
    }
  } catch (error) {
    if (error.status) {
      throw new Error(`Command failed with exit code ${error.status}: ${error.message}`);
    }
    throw error;
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log('Test Summary:');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed');
  process.exit(1);
}

console.log('\n✅ All tests passed!');
