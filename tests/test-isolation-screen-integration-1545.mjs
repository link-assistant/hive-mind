#!/usr/bin/env node
/**
 * Integration tests for isolation screen session monitoring (Issue #1545)
 *
 * Simulates the actual screen isolation workflow to verify:
 * 1. `$ --status <session-name>` correctly finds sessions by --session name
 * 2. Running sessions are detected as 'executing' (not falsely 'executed')
 * 3. Completed sessions are detected as 'executed'
 * 4. `screen -ls` fallback correctly detects running sessions
 * 5. isSessionRunning returns correct values for active/finished sessions
 *
 * Requires: start-command ($ CLI) and screen.
 * Skips gracefully if either tool is unavailable (e.g., in CI without screen).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1545
 * @see https://github.com/link-foundation/start/pull/102
 */

import { execSync } from 'child_process';
import { querySessionStatus, checkScreenSessionRunning, isSessionRunning, executeWithIsolation } from '../src/isolation-runner.lib.mjs';
import { assert, skip, printSummary, getFailCount } from './test-helpers.mjs';

/**
 * Check if a tool is available
 */
function isToolAvailable(name) {
  try {
    execSync(`which ${name}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a condition with timeout
 */
async function waitFor(fn, timeoutMs = 5000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

console.log('Integration tests: isolation screen session monitoring (Issue #1545)');
console.log('='.repeat(70));

const hasScreen = isToolAvailable('screen');
const hasStartCommand = isToolAvailable('$');

console.log(`\n  Prerequisites:`);
console.log(`    screen:        ${hasScreen ? '✅ available' : '❌ not found'}`);
console.log(`    start-command:  ${hasStartCommand ? '✅ available' : '❌ not found'}`);

if (hasStartCommand) {
  try {
    const version = execSync('$ --version 2>&1', { encoding: 'utf-8' }).split('\n')[0];
    console.log(`    version:        ${version}`);
  } catch {
    console.log(`    version:        unknown`);
  }
}

if (!hasScreen || !hasStartCommand) {
  console.log('\n  ⚠️  Screen or start-command not available — running unit-only tests');
}

// === UNIT TESTS (always run) ===
console.log('\n--- Unit tests (no external tools required) ---');

// Test 1: querySessionStatus handles non-existent session gracefully
console.log('\n  querySessionStatus with non-existent session:');
const nonExistResult = await querySessionStatus('non-existent-' + Date.now(), false);
assert(nonExistResult.exists === false, 'Returns exists=false for non-existent session');
assert(nonExistResult.status === null, 'Returns status=null for non-existent session');

// Test 2: isSessionRunning with screen backend returns false for non-existent
console.log('\n  isSessionRunning screen backend (non-existent):');
const notRunning = await isSessionRunning('non-existent-' + Date.now(), { backend: 'screen', verbose: false });
assert(notRunning === false, 'Returns false for non-existent screen session');

// Test 3: isSessionRunning without backend returns false for non-existent
console.log('\n  isSessionRunning no backend (non-existent):');
const notRunning2 = await isSessionRunning('non-existent-' + Date.now(), { verbose: false });
assert(notRunning2 === false, 'Returns false for non-existent session without backend');

// Test 4: checkScreenSessionRunning returns false for non-existent
console.log('\n  checkScreenSessionRunning (non-existent):');
const screenCheck = await checkScreenSessionRunning('non-existent-' + Date.now(), false);
assert(screenCheck === false, 'Returns false for non-existent screen session');

// Test 5: Legacy boolean signature still works
console.log('\n  Legacy boolean signature:');
const legacyResult = await isSessionRunning('non-existent-' + Date.now(), true);
assert(legacyResult === false, 'Legacy (sessionId, boolean) returns false for non-existent');

// === INTEGRATION TESTS (require screen + start-command) ===
if (hasScreen && hasStartCommand) {
  console.log('\n--- Integration tests (screen + start-command) ---');

  const sessionName = `test-1545-${Date.now()}`;

  // Test 6: Execute command with screen isolation
  console.log('\n  executeWithIsolation (screen backend):');
  const execResult = await executeWithIsolation('sleep', ['5'], {
    backend: 'screen',
    sessionId: sessionName,
    verbose: false,
  });
  assert(execResult.success === true, `Execution started successfully (session: ${sessionName})`);
  assert(execResult.sessionId === sessionName, 'Session ID matches requested name');

  // Give screen session a moment to initialize
  await new Promise(r => setTimeout(r, 1000));

  // Test 7: $ --status finds session by name (the core fix from start PR #102)
  console.log('\n  querySessionStatus by session name (start-command v0.25.2 fix):');
  const statusWhileRunning = await querySessionStatus(sessionName, false);
  assert(statusWhileRunning.exists === true, '$ --status finds session by --session name');
  assert(statusWhileRunning.status === 'executing', `Session status is "executing" while running (got: ${statusWhileRunning.status})`);

  // Test 8: checkScreenSessionRunning detects running session
  console.log('\n  checkScreenSessionRunning (running session):');
  const screenRunning = await checkScreenSessionRunning(sessionName, false);
  assert(screenRunning === true, 'screen -ls detects running session');

  // Test 9: isSessionRunning correctly detects running session
  console.log('\n  isSessionRunning (running session, screen backend):');
  const isRunning = await isSessionRunning(sessionName, { backend: 'screen', verbose: false });
  assert(isRunning === true, 'isSessionRunning returns true for running session');

  // Test 10: isSessionRunning without backend still works via $ --status
  console.log('\n  isSessionRunning (running session, no backend):');
  const isRunningNoBackend = await isSessionRunning(sessionName, { verbose: false });
  assert(isRunningNoBackend === true, 'isSessionRunning returns true via $ --status alone');

  // Wait for session to complete (sleep 5 + buffer)
  console.log('\n  Waiting for session to complete...');
  const sessionEnded = await waitFor(async () => !(await checkScreenSessionRunning(sessionName, false)), 10000, 1000);
  assert(sessionEnded === true, 'Session completed within timeout');

  // Test 11: isSessionRunning returns false after completion
  console.log('\n  isSessionRunning (after completion):');
  const afterComplete = await isSessionRunning(sessionName, { backend: 'screen', verbose: false });
  assert(afterComplete === false, 'isSessionRunning returns false after session completes');

  // Test 12: querySessionStatus shows executed after completion
  console.log('\n  querySessionStatus (after completion):');
  const statusAfter = await querySessionStatus(sessionName, false);
  if (statusAfter.exists) {
    assert(statusAfter.status === 'executed', `Session status is "executed" after completion (got: ${statusAfter.status})`);
  } else {
    // Some versions may not persist status — still acceptable
    skip('Status not persisted after completion (acceptable)');
  }
} else {
  // Skip integration tests
  const integrationTests = ['executeWithIsolation (screen backend)', 'querySessionStatus by session name (start-command v0.25.2 fix)', 'checkScreenSessionRunning (running session)', 'isSessionRunning (running session, screen backend)', 'isSessionRunning (running session, no backend)', 'isSessionRunning (after completion)', 'querySessionStatus (after completion)'];
  for (const test of integrationTests) {
    skip(`${test} — requires screen + start-command`);
  }
}

// Results
printSummary(70);

if (getFailCount() > 0) {
  process.exit(1);
}
