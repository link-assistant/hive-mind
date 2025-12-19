#!/usr/bin/env node
// Test script for telegram-bot hero example configuration with Links Notation (Issue #623)
// Tests that the exact hero example configuration from README.md works with --configuration and --dry-run

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('Testing telegram-bot hero example with Links Notation (Issue #623)...\n');

function runTest(testName, args, expectedSuccess) {
  return new Promise((resolve) => {
    console.log(`\n--- Test: ${testName} ---`);
    console.log('Command:', `hive-telegram-bot ${args.join(' ')}`);

    const proc = spawn('node', [join(projectRoot, 'src/telegram-bot.mjs'), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      console.log('⚠️  Test timed out (killed after 15s)');
    }, 15000);

    proc.on('close', (code) => {
      clearTimeout(timeout);

      const output = stdout + stderr;
      const hasDryRunSuccess = output.includes('Dry-run mode: All validations passed');
      const hasValidationFailure = output.includes('❌ Invalid') ||
                                   output.includes('Unknown option:') ||
                                   (output.includes('Error:') && !hasDryRunSuccess);
      const validatedSolve = output.includes('Validating solve overrides');
      const validatedHive = output.includes('Validating hive overrides');

      let passed = false;
      let reason = '';

      if (expectedSuccess) {
        if (hasDryRunSuccess && (code === 0 || code === null)) {
          passed = true;
          reason = 'Hero configuration validated successfully';
        } else if (code !== 0 && !hasDryRunSuccess) {
          reason = `Exit code ${code} without dry-run success message`;
        } else if (hasValidationFailure) {
          reason = 'Has validation error (should not have)';
        } else {
          reason = `Unexpected result: code=${code}, hasDryRunSuccess=${hasDryRunSuccess}`;
        }
      } else {
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

    proc.on('error', (error) => {
      clearTimeout(timeout);
      console.log(`❌ FAILED - Process error: ${error.message}`);
      resolve({ passed: false, reason: error.message, testName, code: -1 });
    });
  });
}

async function main() {
  const tests = [
    // Test 1: Hero example with --configuration option (Issue #623)
    {
      name: 'Issue #623: Hero example with Links Notation',
      args: [
        '--configuration', `TELEGRAM_BOT_TOKEN: test_token_hero_example
TELEGRAM_ALLOWED_CHATS: (
  -1002975819706
  -1002861722681
)
TELEGRAM_HIVE_OVERRIDES: (
  --all-issues
  --once
  --auto-fork
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
)
TELEGRAM_SOLVE_OVERRIDES: (
  --auto-fork
  --auto-continue
  --attach-logs
  --verbose
  --no-tool-check
)
TELEGRAM_BOT_VERBOSE: true`,
        '--dry-run'
      ],
      shouldPass: true
    },

    // Test 2: Verify individual options are parsed correctly
    {
      name: 'Simplified hero configuration',
      args: [
        '--configuration', `TELEGRAM_BOT_TOKEN: test_token
TELEGRAM_ALLOWED_CHATS: (
  -1002975819706
  -1002861722681
)
TELEGRAM_SOLVE_OVERRIDES: (
  --auto-fork
  --verbose
)`,
        '--dry-run'
      ],
      shouldPass: true
    },

    // Test 3: Verify TELEGRAM_BOT_VERBOSE works
    {
      name: 'Configuration with TELEGRAM_BOT_VERBOSE',
      args: [
        '--configuration', `TELEGRAM_BOT_TOKEN: test_token
TELEGRAM_BOT_VERBOSE: true`,
        '--dry-run'
      ],
      shouldPass: true
    },

    // Test 4: Full hero options with all features
    {
      name: 'Full hero configuration with all options',
      args: [
        '--configuration', `TELEGRAM_BOT_TOKEN: test_token_hero_example
TELEGRAM_ALLOWED_CHATS: (
  -1002975819706
  -1002861722681
)
TELEGRAM_HIVE_OVERRIDES: (
  --all-issues
  --once
  --auto-fork
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
)
TELEGRAM_SOLVE_OVERRIDES: (
  --auto-fork
  --auto-continue
  --attach-logs
  --verbose
  --no-tool-check
)
TELEGRAM_BOT_VERBOSE: true`,
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
    console.log('\n📝 Issue #623 resolved: Hero example with Links Notation works correctly!');
    console.log('   The recommended configuration from README.md has been validated:');
    console.log('   hive-telegram-bot --configuration "TELEGRAM_BOT_TOKEN: ... (full config)" --dry-run');
    console.log('\n💡 Users can now use the Links Notation format for cleaner configuration.');
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
