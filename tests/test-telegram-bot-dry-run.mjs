#!/usr/bin/env node
// Test script to verify telegram-bot --dry-run mode for issue #487
// Tests that the exact command from issue #487 now passes with --dry-run

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('Testing telegram-bot --dry-run mode...\n');

function runTest(testName, args, expectedSuccess) {
  return new Promise(resolve => {
    console.log(`\n--- Test: ${testName} ---`);
    console.log('Command:', `hive-telegram-bot ${args.join(' ')}`);

    const proc = spawn('node', [join(projectRoot, 'src/telegram-bot.mjs'), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000
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
      console.log('⚠️  Test timed out (killed after 8s)');
    }, 8000);

    proc.on('close', code => {
      clearTimeout(timeout);

      const output = stdout + stderr;
      const hasDryRunSuccess = output.includes('Dry-run mode: All validations passed');
      const hasValidationFailure =
        output.includes('❌ Invalid') ||
        output.includes('Unknown option:') ||
        (output.includes('Error:') && !hasDryRunSuccess);
      const validatedSolve = output.includes('Validating solve overrides');
      const validatedHive = output.includes('Validating hive overrides');

      let passed = false;
      let reason = '';

      if (expectedSuccess) {
        // Success if we got the dry-run success message and exit code 0 (or null from timeout but with success message)
        if (hasDryRunSuccess && (code === 0 || code === null)) {
          passed = true;
          reason = 'Validation passed as expected';
        } else if (code !== 0 && !hasDryRunSuccess) {
          reason = `Exit code ${code} without dry-run success message`;
        } else if (hasValidationFailure) {
          reason = 'Has validation error (should not have)';
        } else {
          reason = `Unexpected result: code=${code}, hasDryRunSuccess=${hasDryRunSuccess}`;
        }
      } else {
        // Failure expected - should have non-zero exit code OR validation error
        if (code !== 0 || hasValidationFailure) {
          passed = true;
          reason = 'Has expected validation error';
        } else {
          reason = 'Should have validation error but does not';
        }
      }

      console.log(`Exit code: ${code}`);
      console.log(`Result: ${passed ? '✅ PASSED' : '❌ FAILED'} - ${reason}`);

      if (!passed || process.env.VERBOSE) {
        console.log('\n--- Output ---');
        console.log(output);
        console.log('--- End Output ---\n');
      }

      resolve({ passed, reason, testName, code, output });
    });

    proc.on('error', error => {
      clearTimeout(timeout);
      console.log(`❌ FAILED - Process error: ${error.message}`);
      resolve({ passed: false, reason: error.message, testName, code: -1 });
    });
  });
}

async function main() {
  const tests = [
    // Test 1: The exact command from issue #487
    {
      name: 'Issue #487: Exact command with --dry-run',
      args: [
        '--token',
        '8490528355:AAFPBDyYA8pPB1Uzl9eD7wbt9Gsj1LAaOEM',
        '--allowed-chats',
        '(-1002975819706 -1002861722681)',
        '--no-hive',
        '--solve-overrides',
        `(
  --auto-continue
  --attach-logs
  --verbose
  --no-tool-check
)`,
        '--dry-run'
      ],
      shouldPass: true
    },

    // Test 2: --dry-run with valid solve-overrides
    {
      name: 'Valid solve-overrides with --dry-run',
      args: ['--token', 'test_token_123', '--solve-overrides', '(--auto-continue --attach-logs)', '--dry-run'],
      shouldPass: true
    },

    // Test 3: --dry-run with valid hive-overrides
    {
      name: 'Valid hive-overrides with --dry-run',
      args: ['--token', 'test_token_123', '--hive-overrides', '(--verbose --all-issues)', '--dry-run'],
      shouldPass: true
    },

    // Test 4: --dry-run with both commands disabled
    {
      name: 'Both commands disabled with --dry-run',
      args: ['--token', 'test_token_123', '--no-hive', '--no-solve', '--dry-run'],
      shouldPass: true
    },

    // Test 5: --dry-run with invalid solve-overrides (should fail)
    {
      name: 'Invalid solve-overrides with --dry-run (should fail)',
      args: ['--token', 'test_token_123', '--solve-overrides', '(--invalid-option-xyz)', '--dry-run'],
      shouldPass: false
    },

    // Test 6: --dry-run with invalid hive-overrides (should fail)
    {
      name: 'Invalid hive-overrides with --dry-run (should fail)',
      args: ['--token', 'test_token_123', '--hive-overrides', '(--invalid-option-abc)', '--dry-run'],
      shouldPass: false
    },

    // Test 7: --no-hive with solve-overrides (from related issue #484)
    {
      name: 'Issue #484: --no-hive with solve-overrides',
      args: ['--token', 'test_token_123', '--no-hive', '--solve-overrides', '(--auto-continue --verbose)', '--dry-run'],
      shouldPass: true
    },

    // Test 8: --no-solve with hive-overrides
    {
      name: '--no-solve with hive-overrides',
      args: ['--token', 'test_token_123', '--no-solve', '--hive-overrides', '(--verbose)', '--dry-run'],
      shouldPass: true
    },

    // Test 9: Test with allowed-chats in lino format
    {
      name: 'Complex allowed-chats with --dry-run',
      args: [
        '--token',
        'test_token_123',
        '--allowed-chats',
        `(
  -1001234567890
  -1009876543210
  123456789
)`,
        '--dry-run'
      ],
      shouldPass: true
    },

    // Test 10: All options together (realistic scenario)
    {
      name: 'Full configuration with --dry-run',
      args: [
        '--token',
        'test_token_123',
        '--allowed-chats',
        '(-1001234567890 -1009876543210)',
        '--solve-overrides',
        '(--auto-continue --attach-logs --verbose)',
        '--hive-overrides',
        '(--verbose --all-issues)',
        '--dry-run'
      ],
      shouldPass: true
    }
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
    console.log('\n📝 The command from issue #487 now works correctly with --dry-run:');
    console.log(
      '   hive-telegram-bot --token ... --allowed-chats "(...)" --no-hive --solve-overrides "(...)" --dry-run'
    );
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
