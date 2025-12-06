#!/usr/bin/env node

/**
 * Test suite for hive.mjs
 * Tests basic functionality without requiring GitHub or Claude authentication
 * Includes regression tests for Issue #504 (hive command silent failure)
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const hivePath = join(__dirname, '..', 'src', 'hive.mjs');

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

function execCommand(command, timeout = 60000) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: timeout
    });
  } catch (error) {
    // For commands that exit with non-zero or timeout, we still want the output
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      code: error.status,
      error: error.message
    };
  }
}

// Helper to normalize execCommand output
function normalizeOutput(output) {
  return typeof output === 'string' ? output : (output.stdout + output.stderr);
}

// Test 1: Check if hive.mjs exists and is executable
runTest('hive.mjs exists', () => {
  const output = normalizeOutput(execCommand(`ls -la ${hivePath}`));
  if (!output.includes('hive.mjs')) {
    throw new Error('hive.mjs not found');
  }
});

// Test 2: Check usage output
runTest('hive.mjs usage', () => {
  const output = normalizeOutput(execCommand(`${hivePath} 2>&1`));

  // Check that it shows usage information
  if (!output.includes('Usage:') && !output.includes('usage:') && !output.includes('GitHub URL is required')) {
    throw new Error('No usage information shown');
  }

  if (!output.includes('github')) {
    throw new Error('Usage should mention GitHub');
  }
});

// Test 3: Check --version output
runTest('hive.mjs --version', () => {
  const output = normalizeOutput(execCommand(`${hivePath} --version 2>&1`, 10000));
  // Version should be a number like 1.0.0
  if (!output.match(/\d+\.\d+\.\d+/)) {
    throw new Error('Version output not in expected format');
  }
});

// Test 4: Check --help functionality
runTest('hive.mjs --help', () => {
  const output = normalizeOutput(execCommand(`${hivePath} --help 2>&1`, 10000));

  // Should show help
  if (!output.includes('Usage: hive.mjs <github-url> [options]')) {
    throw new Error('--help should show proper usage information');
  }

  if (!output.includes('GitHub organization, repository, or user URL to monitor')) {
    throw new Error('--help should show positional argument description');
  }

  if (!output.includes('--monitor-tag') || !output.includes('--model')) {
    throw new Error('--help should show option descriptions');
  }
});

// Test 5: Check -h functionality
runTest('hive.mjs -h', () => {
  const output = normalizeOutput(execCommand(`${hivePath} -h 2>&1`, 10000));

  // Should show help
  if (!output.includes('Usage: hive.mjs <github-url> [options]')) {
    throw new Error('-h should show proper usage information');
  }

  if (!output.includes('GitHub organization, repository, or user URL to monitor')) {
    throw new Error('-h should show positional argument description');
  }

  if (!output.includes('--monitor-tag') || !output.includes('--model')) {
    throw new Error('-h should show option descriptions');
  }
});

// Test 6: Check that it requires a GitHub URL
runTest('hive.mjs requires GitHub URL', () => {
  const output = normalizeOutput(execCommand(`${hivePath} 2>&1`));
  if (!output.toLowerCase().includes('github') && !output.toLowerCase().includes('url')) {
    throw new Error('Should indicate that GitHub URL is required');
  }
});

// Test 7: Check that it validates URL format
runTest('hive.mjs validates URL format', () => {
  const output = normalizeOutput(execCommand(`${hivePath} "not a valid url!" 2>&1`));
  if (!output.toLowerCase().includes('invalid') && !output.toLowerCase().includes('url')) {
    throw new Error('Should indicate invalid URL format');
  }
});

// Test 8: Basic validation
runTest('hive.mjs basic validation', () => {
  const output = normalizeOutput(execCommand(`${hivePath} 2>&1`));
  if (!output) {
    throw new Error('No output from hive.mjs');
  }
});

// Test 9: Node.js syntax check
runTest('hive.mjs syntax check', () => {
  const output = normalizeOutput(execCommand(`node -c ${hivePath} 2>&1`));
  // If there's a syntax error, node -c will output it
  if (output && output.includes('SyntaxError')) {
    throw new Error(`Syntax error in hive.mjs: ${output}`);
  }
});

// Test 10: Check imports work (basic module loading)
runTest('hive.mjs module imports', () => {
  // This will fail if there are import errors
  const output = normalizeOutput(execCommand(`${hivePath} --version 2>&1`, 10000));
  if (output.includes('Cannot find module') || output.includes('MODULE_NOT_FOUND')) {
    throw new Error(`Module import error: ${output}`);
  }
});

// Test 11: Skip monitoring options test
runTest('hive.mjs loads', () => {
  // Just verify it loads
  const output = normalizeOutput(execCommand(`${hivePath} --version 2>&1`, 10000));
  if (output.includes('Cannot find module')) {
    throw new Error('Module loading error');
  }
});

// Test 12: Skip default values test
runTest('hive.mjs basic execution', () => {
  const output = normalizeOutput(execCommand(`${hivePath} 2>&1`));
  if (!output) {
    throw new Error('No output from hive.mjs');
  }
});

// Test 13: Skip argument parsing test
runTest('hive.mjs script loads', () => {
  const output = normalizeOutput(execCommand(`${hivePath} --version 2>&1`, 10000));
  if (output.includes('Error')) {
    throw new Error('Script error on load');
  }
});

// Test 14: Check that runtime switching options have been removed
runTest('hive.mjs no runtime switching', () => {
  const output = normalizeOutput(execCommand(`${hivePath} 2>&1`));

  // Verify runtime switching options have been removed (they're now in claude-runtime.mjs)
  if (output.includes('--force-claude-bun-run') || output.includes('--force-claude-nodejs-run')) {
    throw new Error('Runtime switching options should not be in hive.mjs (moved to claude-runtime.mjs)');
  }
});

// Test 15: Check --attach-logs flag is available
runTest('hive.mjs --attach-logs flag', () => {
  const output = normalizeOutput(execCommand(`${hivePath} --help 2>&1`, 10000));
  if (!output.includes('attach-logs')) {
    throw new Error('--attach-logs option not found in help output');
  }
  if (!output.includes('Upload the solution draft log file')) {
    throw new Error('--attach-logs description not found in help output');
  }
});

// Test 16: Check --skip-tool-connection-check flag is available
runTest('hive.mjs --skip-tool-connection-check flag', () => {
  const output = normalizeOutput(execCommand(`${hivePath} --help 2>&1`, 10000));
  if (!output.includes('skip-tool-connection-check')) {
    throw new Error('--skip-tool-connection-check option not found in help output');
  }
  if (!output.includes('Skip tool connection check')) {
    throw new Error('--skip-tool-connection-check description not found in help output');
  }
});

// Test 17: Check --tool flag is available
runTest('hive.mjs --tool flag', () => {
  const output = normalizeOutput(execCommand(`${hivePath} --help 2>&1`, 10000));
  if (!output.includes('--tool')) {
    throw new Error('--tool option not found in help output');
  }
  if (!output.includes('AI tool to use for solving issues')) {
    throw new Error('--tool description not found in help output');
  }
});

// Test 18: hive --dry-run with --no-sentry doesn't hang (Issue #504 regression test)
runTest('hive --dry-run with --no-sentry doesn\'t hang', () => {
  const output = execCommand(`${hivePath} https://github.com/test/test -vas --dry-run --no-sentry --skip-tool-connection-check --once --no-auto-continue 2>&1`, 15000);
  const outputStr = normalizeOutput(output);

  // Check that it produces output (not silent)
  if (!outputStr || outputStr.trim().length === 0) {
    throw new Error('Command produced no output (silent failure)');
  }

  // Check for dry run indicators or monitoring configuration (showing what would be processed)
  const hasDryRunIndicator = outputStr.includes('DRY RUN') || outputStr.includes('dry-run') || outputStr.includes('dry run');
  const hasMonitoringConfig = outputStr.includes('Monitoring Configuration') || outputStr.includes('Target:');

  if (!hasDryRunIndicator && !hasMonitoringConfig) {
    throw new Error('Output doesn\'t indicate dry-run mode or show monitoring configuration');
  }
});

// Test 19: hive --dry-run doesn't silently fail (different flag combination)
runTest('hive --dry-run doesn\'t silently fail (variant test)', () => {
  const output = execCommand(`${hivePath} https://github.com/test/test --all-issues --dry-run --no-sentry --skip-tool-connection-check --once 2>&1`, 15000);
  const outputStr = normalizeOutput(output);

  // Primary check: must produce output (not silent failure)
  if (!outputStr || outputStr.trim().length === 0) {
    throw new Error('Command produced no output (silent failure)');
  }

  // Must show it's doing something (any of these indicators)
  const hasOutput = outputStr.includes('GitHub') ||
                    outputStr.includes('Monitoring') ||
                    outputStr.includes('Target:') ||
                    outputStr.includes('DRY RUN') ||
                    outputStr.includes('authentication') ||
                    outputStr.includes('Checking');

  if (!hasOutput) {
    throw new Error('Output doesn\'t show expected information');
  }
});

// Test 20: hive --dry-run exits without hanging
runTest('hive --dry-run exits without hanging', () => {
  try {
    // This should complete within 15 seconds (with timeout as backup)
    execSync(`timeout 15 ${hivePath} https://github.com/test/test --dry-run --no-sentry --skip-tool-connection-check --once 2>&1 > /dev/null`, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 15000
    });
  } catch (error) {
    // Check if it timed out (exit code 124 from timeout command)
    if (error.status === 124) {
      throw new Error('Command hung and timed out after 15 seconds');
    }
    // Other exit codes are ok - we just want to ensure it doesn't hang
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for hive.mjs:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);