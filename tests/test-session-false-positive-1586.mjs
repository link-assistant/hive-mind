#!/usr/bin/env node
/**
 * Tests for issue #1586: False positive active session detection
 *
 * Verifies that:
 * - Non-isolation sessions block duplicate URLs within the timeout window
 * - Non-isolation sessions auto-expire after the timeout
 * - Isolation sessions always block (no timeout)
 * - URL normalization works correctly
 * - Edge cases are handled
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1586
 */

import { trackSession, hasActiveSessionForUrl, getActiveSessionCount, NON_ISOLATION_SESSION_TIMEOUT_MS } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1586: False positive active session detection');
console.log('='.repeat(60));

// Test 1: Non-isolation session WITHIN timeout should block hasActiveSessionForUrl
console.log('\n  Non-isolation session within timeout should block:');

const nonIsoSession = 'solve-linksplatform-Numbers-143-' + Date.now();
trackSession(
  nonIsoSession,
  {
    chatId: 12345,
    messageId: 67890,
    startTime: new Date(), // just started — well within timeout
    url: 'https://github.com/linksplatform/Numbers/pull/143',
    command: 'solve',
    // No isolationBackend — this is a plain start-screen session
  },
  false
);

const nonIsoResult = hasActiveSessionForUrl('https://github.com/linksplatform/Numbers/pull/143', false);
assert(nonIsoResult.isActive === true, 'hasActiveSessionForUrl returns true for non-isolation session within timeout');
assert(nonIsoResult.sessionName === nonIsoSession, 'sessionName matches non-isolation session within timeout');

// Test 2: Non-isolation session PAST timeout should NOT block
console.log('\n  Non-isolation session past timeout should not block:');

const expiredSession = 'solve-expired-session-' + Date.now();
trackSession(
  expiredSession,
  {
    chatId: 12345,
    messageId: 67890,
    startTime: new Date(Date.now() - NON_ISOLATION_SESSION_TIMEOUT_MS - 1000), // started 10min+1s ago
    url: 'https://github.com/test/repo/pull/999',
    command: 'solve',
    // No isolationBackend — non-isolation session
  },
  false
);

const expiredResult = hasActiveSessionForUrl('https://github.com/test/repo/pull/999', false);
assert(expiredResult.isActive === false, 'hasActiveSessionForUrl returns false for expired non-isolation session');
assert(expiredResult.sessionName === null, 'sessionName is null for expired non-isolation session');

// Test 3: Isolation-backed session SHOULD block hasActiveSessionForUrl (no timeout)
console.log('\n  Isolation session should correctly block duplicate URL:');

const isoSession = 'iso-session-' + Date.now();
trackSession(
  isoSession,
  {
    chatId: 11111,
    messageId: 22222,
    startTime: new Date(),
    url: 'https://github.com/test/repo/issues/42',
    command: 'solve',
    isolationBackend: 'screen',
    sessionId: isoSession,
  },
  false
);

const isoResult = hasActiveSessionForUrl('https://github.com/test/repo/issues/42', false);
assert(isoResult.isActive === true, 'hasActiveSessionForUrl returns true for isolation session');
assert(isoResult.sessionName === isoSession, `sessionName matches isolation session (got ${isoResult.sessionName})`);

// Test 4: Old isolation session should still block (no timeout for isolation)
console.log('\n  Old isolation session should still block (no timeout):');

const oldIsoSession = 'iso-old-session-' + Date.now();
trackSession(
  oldIsoSession,
  {
    chatId: 11111,
    messageId: 22222,
    startTime: new Date(Date.now() - NON_ISOLATION_SESSION_TIMEOUT_MS - 60000), // well past timeout
    url: 'https://github.com/test/repo/issues/77',
    command: 'solve',
    isolationBackend: 'docker',
    sessionId: oldIsoSession,
  },
  false
);

const oldIsoResult = hasActiveSessionForUrl('https://github.com/test/repo/issues/77', false);
assert(oldIsoResult.isActive === true, 'hasActiveSessionForUrl returns true for old isolation session (no timeout)');

// Test 5: Different URL should not match isolation session
console.log('\n  Different URL should not match:');

const diffUrlResult = hasActiveSessionForUrl('https://github.com/test/repo/issues/99', false);
assert(diffUrlResult.isActive === false, 'hasActiveSessionForUrl returns false for different URL');

// Test 6: URL normalization still works with isolation sessions
console.log('\n  URL normalization with isolation sessions:');

const normalizedResult = hasActiveSessionForUrl('https://github.com/test/repo/issues/42/', false);
assert(normalizedResult.isActive === true, 'hasActiveSessionForUrl handles trailing slash for isolation session');

const fragmentResult = hasActiveSessionForUrl('https://github.com/test/repo/issues/42#issuecomment-123', false);
assert(fragmentResult.isActive === true, 'hasActiveSessionForUrl handles fragment for isolation session');

// Test 7: Session count includes all tracked sessions (non-expired)
console.log('\n  Session count includes all tracked sessions:');

const totalCount = getActiveSessionCount(false);
assert(totalCount >= 3, `Multiple sessions are tracked in memory (got ${totalCount})`);

// Test 8: Empty URL returns false
console.log('\n  Edge cases:');

const emptyResult = hasActiveSessionForUrl('', false);
assert(emptyResult.isActive === false, 'hasActiveSessionForUrl returns false for empty URL');

const nullResult = hasActiveSessionForUrl(null, false);
assert(nullResult.isActive === false, 'hasActiveSessionForUrl returns false for null URL');

// Test 9: Timeout constant is reasonable (5-10 minutes as per issue)
console.log('\n  Timeout constant validation:');

assert(NON_ISOLATION_SESSION_TIMEOUT_MS >= 5 * 60 * 1000, `Timeout is at least 5 minutes (got ${NON_ISOLATION_SESSION_TIMEOUT_MS / 60000}min)`);
assert(NON_ISOLATION_SESSION_TIMEOUT_MS <= 10 * 60 * 1000, `Timeout is at most 10 minutes (got ${NON_ISOLATION_SESSION_TIMEOUT_MS / 60000}min)`);

// Test 10: Verbose mode logs correctly for timeout behavior
console.log('\n  Verbose mode:');

// Track a fresh non-isolation session for verbose testing
const verboseSession = 'verbose-test-session-' + Date.now();
trackSession(
  verboseSession,
  {
    chatId: 99999,
    startTime: new Date(),
    url: 'https://github.com/test/verbose/pull/1',
    command: 'solve',
  },
  false
);

const originalLog = console.log;
const logMessages = [];
console.log = (...args) => logMessages.push(args.join(' '));

hasActiveSessionForUrl('https://github.com/test/verbose/pull/1', true);

console.log = originalLog;

const hasTimeoutMessage = logMessages.some(msg => msg.includes('still within timeout') || msg.includes('remaining'));
assert(hasTimeoutMessage, 'Verbose mode logs timeout remaining for non-isolation session');

// Test 11: Verbose mode for expired session
const expiredVerboseSession = 'expired-verbose-' + Date.now();
trackSession(
  expiredVerboseSession,
  {
    chatId: 99999,
    startTime: new Date(Date.now() - NON_ISOLATION_SESSION_TIMEOUT_MS - 5000),
    url: 'https://github.com/test/verbose-expired/pull/2',
    command: 'solve',
  },
  false
);

const logMessages2 = [];
console.log = (...args) => logMessages2.push(args.join(' '));

hasActiveSessionForUrl('https://github.com/test/verbose-expired/pull/2', true);

console.log = originalLog;

const hasExpiredMessage = logMessages2.some(msg => msg.includes('expired'));
assert(hasExpiredMessage, 'Verbose mode logs expiry message for timed-out non-isolation session');

// Test 12: Expired session is actually removed from tracking
const expiredSessionStillTracked = hasActiveSessionForUrl('https://github.com/test/verbose-expired/pull/2', false);
assert(expiredSessionStillTracked.isActive === false, 'Expired session is removed from tracking after being checked');

// Results
printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
