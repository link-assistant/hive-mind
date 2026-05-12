#!/usr/bin/env node
/**
 * Tests for isolation screen fallback (issue #1545)
 *
 * Tests that:
 * 1. checkScreenSessionRunning correctly detects non-existent sessions
 * 2. isSessionRunning falls back to screen -ls for screen backend
 * 3. Legacy call signatures are preserved
 * 4. trackSession works with isolation backend info
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1545
 */

import { checkScreenSessionRunning, isSessionRunning } from '../src/isolation-runner.lib.mjs';
import { trackSession, getActiveSessionCount } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing isolation screen fallback (issue #1545)');
console.log('='.repeat(60));

// Test 1: checkScreenSessionRunning with non-existent session
console.log('\n  checkScreenSessionRunning:');

const screenExists = await checkScreenSessionRunning('non-existent-session-' + Date.now(), false);
assert(screenExists === false, 'Returns false for non-existent screen session');

// Test 2: isSessionRunning with legacy boolean signature
console.log('\n  isSessionRunning legacy signature:');

// This should not crash — verifies backward compatibility
const running = await isSessionRunning('non-existent-' + Date.now(), false);
assert(running === false, 'Legacy call (sessionId, verbose) works and returns false for non-existent session');

// Test 3: isSessionRunning with new options signature (backend for screen -ls fallback)
console.log('\n  isSessionRunning new signature:');

const running2 = await isSessionRunning('non-existent-' + Date.now(), { backend: 'screen', verbose: false });
assert(running2 === false, 'New call (sessionId, {backend, verbose}) returns false for non-existent session');

// Test 4: isSessionRunning without backend (no screen -ls fallback)
const running3 = await isSessionRunning('non-existent-' + Date.now(), { verbose: false });
assert(running3 === false, 'Call without backend returns false for non-existent session');

// Test 5: trackSession with isolation backend info
console.log('\n  trackSession with isolation backend:');

const testSid = 'test-1545-' + Date.now();
trackSession(
  testSid,
  {
    chatId: 12345,
    messageId: 67890,
    startTime: new Date(),
    url: 'https://github.com/test/repo/issues/1',
    command: 'solve',
    isolationBackend: 'screen',
    sessionId: testSid,
  },
  false
);

const count = getActiveSessionCount(false);
assert(count >= 1, `Session tracked successfully (${count} active)`);

// Results
printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
