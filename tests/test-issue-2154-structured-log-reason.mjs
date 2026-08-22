#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #2154, the timestamped record of a launch that never happened.
 *
 * The bot log that came with the report mixes two streams: structured logger
 * lines, which carry an ISO timestamp,
 *
 * ```
 * 2026-08-12T17:23:21.363Z INFO  EVENT session_tracked {"sessionName":"4750eeff-…","mode":"isolation:docker",…}
 * 2026-08-12T17:23:22.330Z INFO  EVENT session_untracked {"sessionName":"4750eeff-…"}
 * ```
 *
 * and plain console lines, which do not:
 *
 * ```
 * [VERBOSE] Session 4750eeff-… untracked (launch failed before it started)
 * ```
 *
 * A reader of the timestamped stream alone saw a session appear and vanish one
 * second later with no reason given — `session_untracked` carried nothing but
 * the name. These tests pin that the reason, and enough context to identify the
 * failing combination, now travel with the event and with the durable store
 * record.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2154
 */

import assert from 'assert/strict';

import { buildExecuteAndUpdateMessage } from '../src/telegram-command-execution.lib.mjs';
import { formatStartingWorkSessionMessage } from '../src/work-session-formatting.lib.mjs';
import { resetSessionMonitorForTests, setSessionLogger, setSessionStore, trackSession, untrackSession } from '../src/session-monitor.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

const SESSION = '4750eeff-cb3e-470a-a7b6-3a999a804a47';
/** The production failure, verbatim from the issue report. */
const SIDECAR_ERROR = "Formal AI sidecar could not be started, so the task was not launched (issue #2146): Command failed: docker run --detach --name hive-mind-formal-ai …\nUnable to find image 'ghcr.io/link-assistant/formal-ai:0.339.1' locally";

/** A logger and a store shaped like the ones the bot attaches at startup. */
function attachRecorders() {
  const events = [];
  const removals = [];
  setSessionLogger({ event: (type, data) => events.push({ type, data }) });
  setSessionStore({
    persist: () => {},
    remove: (sessionName, meta) => removals.push({ sessionName, meta }),
  });
  return { events, removals };
}

await test('session_untracked records why the session disappeared', async () => {
  resetSessionMonitorForTests();
  const { events, removals } = attachRecorders();

  trackSession(SESSION, { chatId: 42, messageId: 1, startTime: new Date(0), url: 'https://github.com/o/r/issues/1', command: 'solve', tool: 'codex', isolationBackend: 'docker', sessionId: SESSION }, false);
  untrackSession(SESSION, false, { reason: SIDECAR_ERROR });

  const untracked = events.find(entry => entry.type === 'session_untracked');
  assert.ok(untracked, 'the event is still emitted');
  assert.equal(untracked.data.sessionName, SESSION);
  assert.ok(String(untracked.data.reason).includes('formal-ai:0.339.1'), 'the timestamped line now says why');
  assert.equal(untracked.data.tool, 'codex', 'and which tool was refused');
  assert.equal(untracked.data.isolationBackend, 'docker', 'and on which backend');
  assert.equal(untracked.data.command, 'solve');
  assert.equal(untracked.data.url, 'https://github.com/o/r/issues/1');

  assert.equal(removals.length, 1, 'the durable snapshot entry is still removed');
  assert.equal(removals[0].meta.status, 'launch-failed', 'unchanged status');
  assert.ok(String(removals[0].meta.reason).includes('formal-ai:0.339.1'), 'the store record carries the reason too');

  resetSessionMonitorForTests();
});

await test('a caller that gives no reason still gets a well-formed event', async () => {
  resetSessionMonitorForTests();
  const { events } = attachRecorders();

  trackSession(SESSION, { chatId: 42, messageId: 1, startTime: new Date(0), url: 'https://github.com/o/r/issues/1', command: 'solve', isolationBackend: 'docker', sessionId: SESSION }, false);
  untrackSession(SESSION); // the pre-#2154 call shape

  const untracked = events.find(entry => entry.type === 'session_untracked');
  assert.ok(untracked, 'backwards compatible');
  assert.equal(untracked.data.reason, null, 'an absent reason is explicit, not undefined');

  resetSessionMonitorForTests();
});

await test('a blank reason is normalised to null rather than logged as empty', async () => {
  resetSessionMonitorForTests();
  const { events } = attachRecorders();

  trackSession(SESSION, { chatId: 42, messageId: 1, startTime: new Date(0), command: 'solve', isolationBackend: 'docker', sessionId: SESSION }, false);
  untrackSession(SESSION, false, { reason: '   ' });

  assert.equal(events.find(entry => entry.type === 'session_untracked').data.reason, null);

  resetSessionMonitorForTests();
});

await test('the Telegram launch path passes the launch error as the reason', async () => {
  const untracked = [];
  const deps = {
    resolveIsolation: async () => ({
      backend: 'docker',
      runner: {
        generateSessionId: () => SESSION,
        executeWithIsolation: async () => ({ success: false, sessionId: SESSION, error: SIDECAR_ERROR }),
      },
    }),
    ISOLATION_BACKEND: 'docker',
    isolationRunner: {},
    VERBOSE: false,
    executeStartScreen: async () => ({ success: false, error: 'unused' }),
    trackSession: () => {},
    untrackSession: (name, verbose, details) => untracked.push({ name, details }),
    AUTO_WATCH_MESSAGE: false,
    startAutoTerminalWatchForSession: async () => {},
    bot: {},
    formatExecutingWorkSessionMessage: ({ sessionName }) => `EXECUTING ${sessionName}`,
    formatStartingWorkSessionMessage,
  };
  const ctx = { from: { id: 7 }, chat: { id: 42 }, telegram: { editMessageText: async () => {} } };

  const originalError = console.error;
  console.error = () => {};
  try {
    await buildExecuteAndUpdateMessage(deps)(ctx, { chat: { id: 42 }, message_id: 100 }, 'solve', ['https://github.com/o/r/issues/1'], 'Issue: x', 'docker', 'codex');
  } finally {
    console.error = originalError;
  }

  assert.equal(untracked.length, 1, 'the phantom session is still dropped');
  assert.equal(untracked[0].name, SESSION);
  assert.ok(String(untracked[0].details?.reason).includes('formal-ai:0.339.1'), 'and it carries the launch error into the structured log');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
