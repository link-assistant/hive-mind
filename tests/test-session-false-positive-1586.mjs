#!/usr/bin/env node
/**
 * Tests for issue #1586: False positive active session detection
 *
 * Verifies that hasActiveSessionForUrl() only considers isolation-backed
 * sessions, not plain start-screen sessions that cannot reliably detect
 * completion.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1586
 */

import { trackSession, hasActiveSessionForUrl, getActiveSessionCount } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1586: False positive active session detection');
console.log('='.repeat(60));

// Test 1: Non-isolation session should NOT block hasActiveSessionForUrl
console.log('\n  Non-isolation session should not cause false positive:');

const nonIsoSession = 'solve-linksplatform-Numbers-143-' + Date.now();
trackSession(
  nonIsoSession,
  {
    chatId: 12345,
    messageId: 67890,
    startTime: new Date(),
    url: 'https://github.com/linksplatform/Numbers/pull/143',
    command: 'solve',
    // No isolationBackend — this is a plain start-screen session
  },
  false
);

const nonIsoResult = hasActiveSessionForUrl('https://github.com/linksplatform/Numbers/pull/143', false);
assert(nonIsoResult.isActive === false, 'hasActiveSessionForUrl returns false for non-isolation session');
assert(nonIsoResult.sessionName === null, 'sessionName is null for non-isolation session');

// Test 2: Isolation-backed session SHOULD block hasActiveSessionForUrl
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

// Test 3: Different URL should not match isolation session
console.log('\n  Different URL should not match:');

const diffUrlResult = hasActiveSessionForUrl('https://github.com/test/repo/issues/99', false);
assert(diffUrlResult.isActive === false, 'hasActiveSessionForUrl returns false for different URL');

// Test 4: URL normalization still works with isolation sessions
console.log('\n  URL normalization with isolation sessions:');

const normalizedResult = hasActiveSessionForUrl('https://github.com/test/repo/issues/42/', false);
assert(normalizedResult.isActive === true, 'hasActiveSessionForUrl handles trailing slash for isolation session');

const fragmentResult = hasActiveSessionForUrl('https://github.com/test/repo/issues/42#issuecomment-123', false);
assert(fragmentResult.isActive === true, 'hasActiveSessionForUrl handles fragment for isolation session');

// Test 5: Both sessions are tracked (counting includes all sessions)
console.log('\n  Session count includes all tracked sessions:');

const totalCount = getActiveSessionCount(false);
assert(totalCount >= 2, `Both isolation and non-isolation sessions are tracked in memory (got ${totalCount})`);

// Test 6: Empty URL returns false
console.log('\n  Edge cases:');

const emptyResult = hasActiveSessionForUrl('', false);
assert(emptyResult.isActive === false, 'hasActiveSessionForUrl returns false for empty URL');

const nullResult = hasActiveSessionForUrl(null, false);
assert(nullResult.isActive === false, 'hasActiveSessionForUrl returns false for null URL');

// Test 7: Verbose mode logs correctly for non-isolation skip
console.log('\n  Verbose mode:');

// Capture console output
const originalLog = console.log;
const logMessages = [];
console.log = (...args) => logMessages.push(args.join(' '));

hasActiveSessionForUrl('https://github.com/linksplatform/Numbers/pull/143', true);

console.log = originalLog;

const hasSkipMessage = logMessages.some(msg => msg.includes('Skipping non-isolation session'));
assert(hasSkipMessage, 'Verbose mode logs skip message for non-isolation session');

const hasNoActiveMessage = logMessages.some(msg => msg.includes('No active isolation session'));
assert(hasNoActiveMessage, 'Verbose mode logs "no active isolation session" message');

// Results
printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
