#!/usr/bin/env node
/**
 * Issue #17: command-stream emits trace logs in CI environments
 *
 * Problem: When CI environment variable is set to 'true', command-stream emits
 * verbose trace logs to stderr that interfere with JSON parsing and test output.
 *
 * Environment: Any environment where process.env.CI === 'true'
 * - GitHub Actions (sets CI=true automatically)
 * - GitLab CI
 * - CircleCI
 * - Jenkins with CI plugin
 * - Local testing with CI=true
 *
 * Affected: All commands executed via command-stream's $ function
 * Severity: Critical - breaks JSON parsing, test assertions, output validation
 */

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');

console.log('=== Issue #17: Trace Logs in CI Environments ===\n');

console.log('Environment detection:');
console.log(`  CI: ${process.env.CI || 'false'}`);
console.log(`  GITHUB_ACTIONS: ${process.env.GITHUB_ACTIONS || 'false'}`);
console.log(`  RUNNER_OS: ${process.env.RUNNER_OS || 'local'}`);
console.log('');

// Test 1: Silent execution with mirror:false
console.log('Test 1: Silent execution with mirror:false and capture:true');
console.log('-----------------------------------------------------------');

const $silent = $({ mirror: false, capture: true });

try {
  console.log('Executing: echo "test output"');
  const result = await $silent`echo "test output"`;
  console.log('Result:', result.stdout || result);
  console.log('✅ No trace logs visible in normal environment\n');
} catch (error) {
  console.log('❌ Error:', error.message);
}

// Test 2: Command with JSON output
console.log('Test 2: JSON output command');
console.log('----------------------------');

try {
  console.log('Executing: echo \'{"status":"ok","value":42}\'');
  const result = await $silent`echo '{"status":"ok","value":42}'`;
  const output = result.stdout || result;

  console.log('Raw output:', output);

  // Try to parse as JSON
  try {
    const parsed = JSON.parse(output.toString().trim());
    console.log('Parsed JSON:', parsed);
    console.log('✅ JSON parsing successful\n');
  } catch (parseError) {
    console.log('❌ JSON parsing failed:', parseError.message);
    console.log('Output may contain trace logs\n');
  }
} catch (error) {
  console.log('❌ Command failed:', error.message);
}

// Test 3: Demonstrate the trace log pattern
console.log('Test 3: Trace log pattern in CI');
console.log('--------------------------------');
console.log('In GitHub Actions, command-stream emits logs like:');
console.log('[TRACE 2025-01-14T12:34:56.789Z] ...');
console.log('');
console.log('These appear even with mirror:false and interfere with:');
console.log('- JSON parsing');
console.log('- Output validation');
console.log('- Test assertions\n');

// Test 4: Workaround with stderr redirection
console.log('Test 4: Workaround - Redirect stderr to /dev/null');
console.log('--------------------------------------------------');

try {
  console.log('Executing: echo \'{"status":"ok"}\' 2>/dev/null');
  const result = await $silent`echo '{"status":"ok"}' 2>/dev/null`;
  const output = result.stdout || result;

  try {
    const parsed = JSON.parse(output.toString().trim());
    console.log('Parsed JSON:', parsed);
    console.log('✅ Workaround successful - stderr redirected\n');
  } catch (parseError) {
    console.log('❌ Still failed:', parseError.message);
  }
} catch (error) {
  console.log('❌ Command failed:', error.message);
}

// Test 5: Alternative workaround - Filter output
console.log('Test 5: Alternative workaround - Filter trace logs');
console.log('---------------------------------------------------');

function filterTraceLogs(output) {
  const lines = output.toString().split('\n');
  const filtered = lines.filter(line => {
    // Skip lines that look like trace logs
    if (line.startsWith('[TRACE ')) return false;
    if (line.startsWith('[DEBUG ')) return false;
    if (line.startsWith('[INFO ')) return false;
    return true;
  });
  return filtered.join('\n');
}

const rawOutput = '[TRACE 2025-01-14T12:34:56.789Z] Starting command\n{"status":"ok","value":42}\n[TRACE 2025-01-14T12:34:56.790Z] Command complete';
console.log('Raw output with trace logs:');
console.log(rawOutput);
console.log('');

const filtered = filterTraceLogs(rawOutput);
console.log('Filtered output:');
console.log(filtered);

try {
  const parsed = JSON.parse(filtered.trim());
  console.log('Parsed JSON:', parsed);
  console.log('✅ Filtering workaround successful\n');
} catch (error) {
  console.log('❌ Parsing failed:', error.message);
}

// Test 6: Simulate CI environment
console.log('Test 6: Simulate CI environment');
console.log('--------------------------------');
console.log('Setting CI environment variables...');

process.env.CI = 'true';
process.env.GITHUB_ACTIONS = 'true';

console.log('Executing command with CI=true...');
try {
  const result = await $silent`echo "CI test"`;
  console.log('Result:', result.stdout || result);
  console.log('Note: Run this script with CI=true to see trace logs');
  console.log('Example: CI=true node issue-17-trace-logs-in-ci.mjs\n');
} catch (error) {
  console.log('Error:', error.message);
}

// Test 7: Real-world example from memory-check.mjs
console.log('Test 7: Real-world memory-check.mjs pattern');
console.log('--------------------------------------------');
console.log('This is how memory-check.mjs fails in CI:');
console.log('');

// Simulate memory-check.mjs JSON output in CI
const simulatedCIOutput = `[TRACE 2025-09-14T13:25:23.048Z] [Initialization] Registering built-in virtual commands
[TRACE 2025-09-14T13:25:23.048Z] [VirtualCommands] registerBuiltins() called
[TRACE 2025-09-14T13:25:23.050Z] [ProcessRunner] Executing virtual command
{
  "ram": {
    "success": true,
    "availableMB": 4886,
    "required": 256,
    "swap": "enabled"
  },
  "disk": {
    "success": true,
    "availableMB": 115498,
    "required": 500
  },
  "success": true
}
[TRACE 2025-09-14T13:25:23.051Z] [ProcessRunner] Cleanup completed`;

console.log('Simulated output with trace logs:');
console.log('```');
console.log(simulatedCIOutput.substring(0, 300) + '...');
console.log('```');
console.log('');

// Show how tests fail
console.log('When tests try to parse this as JSON:');
try {
  JSON.parse(simulatedCIOutput);
  console.log('✅ Parsed successfully (should not happen)');
} catch (error) {
  console.log(`❌ JSON.parse fails: "${error.message}"`);
  console.log('   This is why tests fail in GitHub Actions\n');
}

// Summary
console.log('=== Summary ===\n');
console.log('Problem:');
console.log('  command-stream emits trace logs to stderr when CI=true');
console.log('  These logs appear even with mirror:false and capture:true');
console.log('  Format: [TRACE YYYY-MM-DDTHH:MM:SS.sssZ] [Component] message | {data}');
console.log('');
console.log('Impact:');
console.log('  - Breaks JSON parsing when output is expected to be pure JSON');
console.log('  - Causes test failures in GitHub Actions');
console.log('  - Affects memory-check.mjs, solve.mjs, hive.mjs, and other scripts');
console.log('  - Test commands that use 2>&1 capture trace logs mixed with output');
console.log('');
console.log('Root Cause:');
console.log('  command-stream detects the CI environment variable (CI=true)');
console.log('  and enables verbose trace logging for debugging purposes');
console.log('  This is triggered by: process.env.CI === "true"');
console.log('  Trace logs include: Initialization, VirtualCommands, API calls,');
console.log('  ProcessRunner, StreamEmitter, SignalHandler, AnsiUtils, etc.');
console.log('');
console.log('Workarounds:');
console.log('  1. Redirect stderr to /dev/null in each command: `df -m 2>/dev/null`');
console.log('  2. Filter trace logs from output before parsing (see filterTraceLogs)');
console.log("  3. Don't capture stderr in tests when JSON output expected");
console.log('  4. Unset CI variable temporarily (not recommended in CI)');
console.log('  5. Use execSync from child_process instead of command-stream');
console.log('');
console.log('Limitations of Workarounds:');
console.log('  - Redirecting stderr loses legitimate error messages');
console.log('  - Filtering requires knowing trace log format');
console.log('  - Tests that use 2>&1 still capture trace logs');
console.log('  - Some commands need stderr for diagnostics');
console.log('');
console.log('Recommendation:');
console.log('  command-stream should provide an option to disable trace logs');
console.log('  or respect the mirror:false setting for all output');
console.log('  Example: $({ mirror: false, capture: true, trace: false })');
