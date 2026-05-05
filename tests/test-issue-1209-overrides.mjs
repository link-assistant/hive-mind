#!/usr/bin/env node
// Test script to verify issue #1209 fix: solve options are accepted in overrides
// Tests that --gitkeep-file and other solve-passthrough options work in
// TELEGRAM_SOLVE_OVERRIDES and TELEGRAM_HIVE_OVERRIDES

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('Testing issue #1209: solve options in overrides...\n');

function runTest(testName, args, expectedSuccess) {
  return new Promise(resolve => {
    console.log(`\n--- Test: ${testName} ---`);

    const proc = spawn('node', [join(projectRoot, 'src/telegram-bot.mjs'), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
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
      console.log('⚠️  Test timed out (killed after 12s)');
    }, 12000);

    proc.on('close', code => {
      clearTimeout(timeout);

      const output = stdout + stderr;
      const hasDryRunSuccess = output.includes('Dry-run mode: All validations passed');
      const hasValidationFailure = output.includes('❌ Invalid') || output.includes('Unknown argument') || (output.includes('Error:') && !hasDryRunSuccess);

      let passed = false;
      let reason = '';

      if (expectedSuccess) {
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
    // Test 1: --gitkeep-file in solve-overrides (the exact issue scenario with correct spelling)
    {
      name: 'Issue #1209: --gitkeep-file in solve-overrides',
      args: ['--token', 'test_token_123', '--solve-overrides', '(--attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --tokens-budget-stats --gitkeep-file)', '--no-hive', '--dry-run'],
      shouldPass: true,
    },

    // Test 2: --getkeep-file (typo) should still fail with helpful error
    {
      name: 'Issue #1209: --getkeep-file (typo) should fail',
      args: ['--token', 'test_token_123', '--solve-overrides', '(--getkeep-file)', '--no-hive', '--dry-run'],
      shouldPass: false,
    },

    // Test 3: --gitkeep-file in hive-overrides (should now pass)
    {
      name: 'Issue #1209: --gitkeep-file in hive-overrides',
      args: ['--token', 'test_token_123', '--hive-overrides', '(--verbose --all-issues --gitkeep-file)', '--no-solve', '--dry-run'],
      shouldPass: true,
    },

    // Test 4: --claude-file in hive-overrides (should now pass)
    {
      name: 'Issue #1209: --claude-file in hive-overrides',
      args: ['--token', 'test_token_123', '--hive-overrides', '(--verbose --claude-file)', '--no-solve', '--dry-run'],
      shouldPass: true,
    },

    // Test 5: --auto-gitkeep-file in hive-overrides (should now pass)
    {
      name: 'Issue #1209: --auto-gitkeep-file in hive-overrides',
      args: ['--token', 'test_token_123', '--hive-overrides', '(--verbose --no-auto-gitkeep-file)', '--no-solve', '--dry-run'],
      shouldPass: true,
    },

    // Test 6: --auto-close-pull-request-on-fail in hive-overrides
    {
      name: 'Issue #1209: --auto-close-pull-request-on-fail in hive-overrides',
      args: ['--token', 'test_token_123', '--hive-overrides', '(--auto-close-pull-request-on-fail)', '--no-solve', '--dry-run'],
      shouldPass: true,
    },

    // Test 7: --enable-workspaces in hive-overrides
    {
      name: 'Issue #1209: --enable-workspaces in hive-overrides',
      args: ['--token', 'test_token_123', '--hive-overrides', '(--enable-workspaces)', '--no-solve', '--dry-run'],
      shouldPass: true,
    },

    // Test 8: --base-branch in hive-overrides
    {
      name: 'Issue #1209: --base-branch in hive-overrides',
      args: ['--token', 'test_token_123', '--hive-overrides', '(--base-branch develop)', '--no-solve', '--dry-run'],
      shouldPass: true,
    },

    // Test 9: --playwright-mcp-auto-cleanup in hive-overrides
    {
      name: 'Issue #1209: --no-playwright-mcp-auto-cleanup in hive-overrides',
      args: ['--token', 'test_token_123', '--hive-overrides', '(--no-playwright-mcp-auto-cleanup)', '--no-solve', '--dry-run'],
      shouldPass: true,
    },

    // Test 10: Multiple solve-passthrough options in hive-overrides
    {
      name: 'Issue #1209: Multiple solve-passthrough options in hive-overrides',
      args: ['--token', 'test_token_123', '--hive-overrides', '(--verbose --gitkeep-file --auto-resume-on-errors --auto-restart-on-limit-reset --prompt-subagents-via-agent-commander)', '--no-solve', '--dry-run'],
      shouldPass: true,
    },

    // Test 11: Full configuration from issue #1209 (corrected spelling)
    {
      name: 'Issue #1209: Full corrected configuration',
      args: [
        '--token',
        'test_token_123',
        '--allowed-chats',
        '(-1002975819706 -1002861722681)',
        '--solve-overrides',
        `(
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
  --gitkeep-file
)`,
        '--hive-overrides',
        `(
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
  --gitkeep-file
)`,
        '--dry-run',
      ],
      shouldPass: true,
    },
  ];

  const results = [];
  for (const test of tests) {
    const result = await runTest(test.name, test.args, test.shouldPass);
    results.push(result);
  }

  // Summary
  console.log('\n\n=== Test Summary ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Total: ${results.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ❌ ${r.testName}: ${r.reason}`);
    }
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
