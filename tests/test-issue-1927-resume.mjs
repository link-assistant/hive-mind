#!/usr/bin/env node
/**
 * Tests for resume-after-restart (issue #1927, requirement #2).
 *
 * "Even if telegram bot killed, we should detect restart. And if after bot start
 *  we have commands in `$`, we should try to resume them, if they started before
 *  bot start time."
 *
 * trackSession() mirrors isolation-backed sessions to the durable store; after a
 * simulated restart (reset in-memory state, reload the store) resumeTrackedSessions()
 * re-registers exactly the sessions that started BEFORE the new bot start, so the
 * monitor picks them back up. A session that started after the bot came up cannot
 * be a leftover and is skipped. A completed session was removed from the store and
 * is never resumed.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createSessionStore } from '../src/session-store.lib.mjs';
import { trackSession, monitorSessions, resumeTrackedSessions, setSessionStore, setSessionLogger, getActiveSessionCount, getTrackedSessionInfo, resetSessionMonitorForTests } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1927: resume tracked sessions after restart');
console.log('='.repeat(60));

const BOT_START = Math.floor(new Date('2026-06-14T19:05:00.000Z').getTime() / 1000);
const BEFORE = new Date('2026-06-14T19:00:00.000Z'); // 5 min before bot start
const AFTER = new Date('2026-06-14T19:10:00.000Z'); // 5 min after bot start

function captureLogger() {
  const events = [];
  return { events, event: (type, data) => events.push({ type, data }), debug() {}, info() {}, warn() {}, error() {} };
}

function makeBot() {
  return {
    telegram: {
      editMessageText: async () => {},
      sendMessage: async () => ({ message_id: 1 }),
    },
  };
}

// =============================================================================
// 1. Restart round-trip: a session tracked before "crash" is resumed afterwards.
// =============================================================================
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-resume-'));
  try {
    // --- bot run #1: track an isolation session, then "crash" (lose memory). ---
    const store1 = createSessionStore({ dir });
    resetSessionMonitorForTests();
    setSessionStore(store1);
    trackSession('uuid-before', { chatId: 5, messageId: 7, startTime: BEFORE, url: 'https://github.com/acme/widgets/issues/42', command: 'solve', isolationBackend: 'screen', sessionId: 'uuid-before', logPath: '/var/log/before.log' }, false);
    assert(getActiveSessionCount() === 1, 'run #1 tracks the session in memory');
    assert(store1.load().length === 1, 'run #1 mirrors the session to the durable store');

    // Simulate a hard crash: wipe in-memory state (store survives on disk).
    resetSessionMonitorForTests();
    assert(getActiveSessionCount() === 0, 'after crash the in-memory registry is empty');

    // --- bot run #2: reload the store and resume. ---
    const store2 = createSessionStore({ dir });
    const logger = captureLogger();
    setSessionStore(store2);
    setSessionLogger(logger);
    const result = await resumeTrackedSessions({ botStartTime: BOT_START, verbose: false });
    assert(result.resumed.length === 1, 'resume re-registers the one persisted session');
    assert(result.resumed[0].sessionName === 'uuid-before', 'the resumed session is uuid-before');
    assert(getActiveSessionCount() === 1, 'the resumed session is back in the in-memory registry');
    const info = getTrackedSessionInfo('uuid-before');
    assert(info && info.url === 'https://github.com/acme/widgets/issues/42', 'resumed session retains its url (chat can be notified)');
    assert(info.logPath === '/var/log/before.log', 'resumed session retains its logPath (footer can be read on the next tick)');
    assert(info.startTime instanceof Date, 'resumed session startTime is a Date');
    assert(
      logger.events.some(e => e.type === 'session_resumed' && e.data.sessionName === 'uuid-before'),
      'a session_resumed event is logged with a timestamp-bearing logger'
    );
  } finally {
    resetSessionMonitorForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// =============================================================================
// 2. Only sessions that started BEFORE bot start are resumed (requirement #2).
// =============================================================================
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-resume2-'));
  try {
    const store = createSessionStore({ dir });
    // Persist directly (as a previous run would have left them on disk).
    store.persist('uuid-before', { chatId: 5, startTime: BEFORE, url: 'u1', command: 'solve', isolationBackend: 'screen', sessionId: 'uuid-before' });
    store.persist('uuid-after', { chatId: 5, startTime: AFTER, url: 'u2', command: 'solve', isolationBackend: 'screen', sessionId: 'uuid-after' });

    resetSessionMonitorForTests();
    setSessionStore(store);
    const result = await resumeTrackedSessions({ botStartTime: BOT_START, verbose: false });

    assert(result.resumed.length === 1 && result.resumed[0].sessionName === 'uuid-before', 'only the before-bot-start session is resumed');
    const skippedAfter = result.skipped.find(s => s.sessionName === 'uuid-after');
    assert(skippedAfter && skippedAfter.reason === 'started-after-bot-start', 'the after-bot-start session is skipped with reason "started-after-bot-start"');
    assert(getTrackedSessionInfo('uuid-after') === null, 'the after-bot-start session is NOT registered');
  } finally {
    resetSessionMonitorForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// =============================================================================
// 3. An already-tracked session is not double-registered.
// =============================================================================
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-resume3-'));
  try {
    const store = createSessionStore({ dir });
    resetSessionMonitorForTests();
    setSessionStore(store);
    // Track it live first (also persists).
    trackSession('uuid-live', { chatId: 5, startTime: BEFORE, url: 'u1', command: 'solve', isolationBackend: 'screen', sessionId: 'uuid-live' }, false);
    const result = await resumeTrackedSessions({ botStartTime: BOT_START, verbose: false });
    const skipped = result.skipped.find(s => s.sessionName === 'uuid-live');
    assert(skipped && skipped.reason === 'already-tracked', 'a live session is skipped on resume with reason "already-tracked"');
    assert(getActiveSessionCount() === 1, 'no duplicate registration occurs');
  } finally {
    resetSessionMonitorForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// =============================================================================
// 4. A completed session is removed from the store (via the real monitor path)
//    and never resumed.
// =============================================================================
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-resume4-'));
  try {
    const store1 = createSessionStore({ dir });
    resetSessionMonitorForTests();
    setSessionStore(store1);
    trackSession('uuid-done', { chatId: 5, messageId: 7, startTime: BEFORE, url: 'u1', command: 'solve', isolationBackend: 'screen', sessionId: 'uuid-done' }, false);
    assert(store1.load().length === 1, 'session is persisted while running');

    // It completes successfully — drive the real monitor so completeSession runs
    // and removes it from the durable snapshot.
    await monitorSessions(makeBot(), false, {
      statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 0 }),
    });
    assert(getActiveSessionCount() === 0, 'a successfully-completed session leaves the in-memory registry');
    assert(store1.load().length === 0, 'a completed session is dropped from the durable snapshot');

    // Restart: nothing to resume.
    resetSessionMonitorForTests();
    const store2 = createSessionStore({ dir });
    setSessionStore(store2);
    const result = await resumeTrackedSessions({ botStartTime: BOT_START, verbose: false });
    assert(result.resumed.length === 0, 'a completed session is never resumed');
    assert(getActiveSessionCount() === 0, 'no sessions are re-registered after completion');
  } finally {
    resetSessionMonitorForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// =============================================================================
// 5. With no store configured, resume is a safe no-op.
// =============================================================================
{
  resetSessionMonitorForTests(); // clears the store
  const result = await resumeTrackedSessions({ botStartTime: BOT_START, verbose: false });
  assert(result.resumed.length === 0 && result.skipped.length === 0, 'resume with no store configured is a no-op');
}

resetSessionMonitorForTests();
printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
