#!/usr/bin/env node
/**
 * Tests for session-monitor.lib.mjs isolation mode support
 *
 * Tests that session monitor correctly handles both screen-based
 * and isolation-based session tracking.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/380
 */

import { trackSession, getActiveSessionCount, getSessionStats, checkScreenSessionExists } from '../src/session-monitor.lib.mjs';

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

console.log('Testing session-monitor.lib.mjs (isolation support)');
console.log('='.repeat(60));

// Test trackSession with isolation metadata
console.log('\n  trackSession with isolation:');

const testSessionId = 'test-' + Date.now();
trackSession(
  testSessionId,
  {
    chatId: 12345,
    startTime: new Date(),
    url: 'https://github.com/test/repo/issues/1',
    command: 'solve',
    isolationBackend: 'screen',
    sessionId: testSessionId,
  },
  false
);

// Verify session is tracked
const count = getActiveSessionCount(false);
assert(count >= 1, `At least 1 active session tracked (got ${count})`);

// Test getSessionStats with isolation info
console.log('\n  getSessionStats:');

const stats = getSessionStats(false);
assert(typeof stats === 'object', 'Returns an object');
assert(typeof stats.total === 'number', 'Has total count');
assert(typeof stats.executing === 'number', 'Has executing count');
assert(typeof stats.storageType === 'string', 'Has storage type');
assert('isolated' in stats, 'Has isolated count field');

// Test checkScreenSessionExists (should return false for non-existent session)
console.log('\n  checkScreenSessionExists:');

const exists = await checkScreenSessionExists('non-existent-session-' + Date.now());
assert(exists === false, 'Returns false for non-existent screen session');

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
