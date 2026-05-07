#!/usr/bin/env node
// Test script to verify telegram-bot validation logic for issue #484
// Tests that --no-hive does not require github-url argument

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('Testing telegram-bot validation with --no-hive...\n');

function runTest(testName, args, expectedSuccess) {
  return new Promise(resolve => {
    console.log(`\n--- Test: ${testName} ---`);
    console.log('Args:', args.join(' '));

    const proc = spawn('node', [join(projectRoot, 'src/telegram-bot.mjs'), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => {
      stdout += data.toString();
    });

    proc.stderr.on('data', data => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
    }, 3000);

    proc.on('close', code => {
      clearTimeout(timeout);

      const output = stdout + stderr;
      const hasValidationError = output.includes('Not enough arguments') || output.includes('Expected 1 but received 0') || output.includes('YError');
      const hasInvalidOverridesError = output.includes('Invalid hive-overrides') || output.includes('Invalid solve-overrides');
      const isValidatingHive = output.includes('Validating hive overrides');
      const isValidatingSolve = output.includes('Validating solve overrides');

      let passed = false;
      let reason = '';

      if (expectedSuccess) {
        if (hasValidationError) {
          reason = 'Has validation error (should not have)';
        } else if (hasInvalidOverridesError) {
          reason = 'Has invalid overrides error';
        } else if (testName.includes('--no-hive') && isValidatingHive) {
          reason = 'Should not validate hive overrides when --no-hive is set';
        } else if (testName.includes('--no-solve') && isValidatingSolve) {
          reason = 'Should not validate solve overrides when --no-solve is set';
        } else {
          passed = true;
          reason = 'No validation errors as expected';
        }
      } else {
        if (hasValidationError || hasInvalidOverridesError) {
          passed = true;
          reason = 'Has expected validation error';
        } else {
          reason = 'Should have validation error but does not';
        }
      }

      console.log(`Result: ${passed ? '✅ PASSED' : '❌ FAILED'} - ${reason}`);
      if (!passed) {
        console.log('Output:', output.substring(0, 500));
      }

      resolve({ passed, reason, testName });
    });

    proc.on('error', error => {
      clearTimeout(timeout);
      console.log(`❌ FAILED - Process error: ${error.message}`);
      resolve({ passed: false, reason: error.message, testName });
    });
  });
}

async function main() {
  const tests = [
    // Test 1: --no-hive with solve-overrides (from issue #484)
    {
      name: 'Issue #484: --no-hive with solve-overrides',
      args: ['--token', 'test_token', '--allowed-chats', '(-1 -2)', '--no-hive', '--solve-overrides', '(--auto-continue --attach-logs --verbose --no-tool-check)'],
      shouldPass: true,
    },

    // Test 2: --no-solve with hive-overrides
    {
      name: '--no-solve with hive-overrides',
      args: ['--token', 'test_token', '--allowed-chats', '(-1 -2)', '--no-solve', '--hive-overrides', '(--verbose --all-issues)'],
      shouldPass: true,
    },

    // Test 3: --no-hive and --no-solve together
    {
      name: '--no-hive and --no-solve together',
      args: ['--token', 'test_token', '--allowed-chats', '(-1 -2)', '--no-hive', '--no-solve'],
      shouldPass: true,
    },

    // Test 4: hive enabled with invalid overrides (should fail)
    {
      name: 'hive enabled with invalid overrides',
      args: ['--token', 'test_token', '--allowed-chats', '(-1 -2)', '--hive-overrides', '(--invalid-flag-xyz)'],
      shouldPass: false,
    },

    // Test 5: solve enabled with invalid overrides (should fail)
    {
      name: 'solve enabled with invalid overrides',
      args: ['--token', 'test_token', '--allowed-chats', '(-1 -2)', '--solve-overrides', '(--invalid-flag-xyz)'],
      shouldPass: false,
    },
  ];

  const results = [];
  for (const test of tests) {
    const result = await runTest(test.name, test.args, test.shouldPass);
    results.push(result);
  }

  console.log('\n\n=== SUMMARY ===');
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`${passed}/${total} tests passed`);

  results.forEach(r => {
    console.log(`${r.passed ? '✅' : '❌'} ${r.testName}`);
  });

  if (passed === total) {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
