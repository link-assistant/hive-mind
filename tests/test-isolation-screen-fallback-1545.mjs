#!/usr/bin/env node
/**
 * Tests for isolation screen fallback (issue #1545)
 *
 * Tests that:
 * 1. Internal UUID is correctly extracted from $ CLI output
 * 2. Session tracking stores internalUuid
 * 3. isSessionRunning falls back to screen -ls for screen backend
 * 4. Legacy call signatures are preserved
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1545
 */

import { checkScreenSessionRunning, isSessionRunning } from '../src/isolation-runner.lib.mjs';
import { trackSession, getActiveSessionCount } from '../src/session-monitor.lib.mjs';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('Testing isolation screen fallback (issue #1545)');
console.log('='.repeat(60));

// Test 1: extractInternalUuid via executeWithIsolation return value
// We can't directly test the private function, but we can test the regex pattern
// by simulating what it would match
console.log('\n  Internal UUID extraction (regex pattern):');

const sampleOutput = `│ session   6a176d96-59ee-4101-9212-f45147c0bc93
│ start     2026-04-08 07:28:04.135
│
│ isolation screen
│ mode      detached
│ screen    54fc440a-0f4b-44f6-8191-ea630b8f73d0
│
$ solve https://github.com/test/repo/pull/1 --verbose`;

// Simulate the regex from extractInternalUuid
const uuidRegex = /session\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const match = sampleOutput.match(uuidRegex);
assert(match !== null, 'Regex matches session UUID in $ CLI output');
assert(match[1] === '6a176d96-59ee-4101-9212-f45147c0bc93', 'Extracts correct internal UUID (not screen session name)');

// Make sure it doesn't match the screen session name
const screenLineOnly = '│ screen    54fc440a-0f4b-44f6-8191-ea630b8f73d0';
const screenMatch = screenLineOnly.match(uuidRegex);
assert(screenMatch === null, 'Regex does NOT match UUID on "screen" line (only "session" line)');

// Test with no UUID in output
const noUuidOutput = 'some random output without any session info';
const noMatch = noUuidOutput.match(uuidRegex);
assert(noMatch === null, 'Returns null when no UUID found in output');

// Test 2: checkScreenSessionRunning with non-existent session
console.log('\n  checkScreenSessionRunning:');

const screenExists = await checkScreenSessionRunning('non-existent-session-' + Date.now(), false);
assert(screenExists === false, 'Returns false for non-existent screen session');

// Test 3: isSessionRunning with legacy boolean signature
console.log('\n  isSessionRunning legacy signature:');

// This should not crash — verifies backward compatibility
const running = await isSessionRunning('non-existent-' + Date.now(), false);
assert(running === false, 'Legacy call (sessionId, verbose) works and returns false for non-existent session');

// Test 4: isSessionRunning with new options signature
console.log('\n  isSessionRunning new signature:');

const running2 = await isSessionRunning('non-existent-' + Date.now(), { backend: 'screen', verbose: false });
assert(running2 === false, 'New call (sessionId, {backend, verbose}) returns false for non-existent session');

const running3 = await isSessionRunning('non-existent-' + Date.now(), { backend: 'screen', internalUuid: 'fake-uuid', verbose: false });
assert(running3 === false, 'New call with internalUuid returns false for non-existent session');

// Test 5: trackSession with internalUuid field
console.log('\n  trackSession with internalUuid:');

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
    internalUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  },
  false
);

const count = getActiveSessionCount(false);
assert(count >= 1, `Session with internalUuid tracked (${count} active)`);

// Results
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('='.repeat(60));

if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) failed!`);
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
