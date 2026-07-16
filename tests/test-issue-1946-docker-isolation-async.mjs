#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #1946: when the Telegram bot launches a task with `--isolation docker`,
 * the session UUID + isolation backend must be surfaced (and the session
 * tracked) *immediately* — before the potentially hour-long docker image pull /
 * container startup finishes — so the run is addressable by /watch, /log and
 * /status during the whole startup window. Previously the UUID and isolation
 * were only shown (and the session only tracked) AFTER the blocking start-command
 * launch returned, leaving an info-less "🔄 Starting..." up for the entire pull.
 */

import assert from 'assert/strict';
import { formatStartingWorkSessionMessage } from '../src/work-session-formatting.lib.mjs';
import { buildExecuteAndUpdateMessage } from '../src/telegram-command-execution.lib.mjs';

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

const SESSION = '08ec853a-158a-4314-83e9-c6365670fe4c';

// --- formatStartingWorkSessionMessage ----------------------------------------

await test('starting message omits session block when no session is known yet', () => {
  const msg = formatStartingWorkSessionMessage({ infoBlock: 'Issue: x' });
  assert.ok(msg.includes('Starting'), 'keeps the Starting header');
  assert.ok(!msg.includes('Session:'), 'no Session line without a session name');
  assert.ok(!msg.includes('Isolation:'), 'no Isolation line without a session name');
  assert.ok(msg.includes('Issue: x'), 'keeps the info block');
});

await test('starting message surfaces session UUID + isolation when known', () => {
  const msg = formatStartingWorkSessionMessage({ sessionName: SESSION, isolationBackend: 'docker', infoBlock: 'Issue: x' });
  assert.ok(msg.includes('Starting'), 'keeps the Starting header');
  assert.ok(msg.includes(`\`${SESSION}\``), 'shows the session UUID');
  assert.ok(/Isolation: `docker`/.test(msg), 'shows the isolation backend');
  assert.ok(msg.includes('Issue: x'), 'keeps the info block');
});

await test('starting message shows the session even when no isolation backend is passed', () => {
  const msg = formatStartingWorkSessionMessage({ sessionName: SESSION });
  assert.ok(msg.includes(`\`${SESSION}\``), 'shows the session UUID');
  assert.ok(!msg.includes('Isolation:'), 'no Isolation line when backend is null');
});

// --- executeAndUpdateMessage ordering ----------------------------------------

function makeHarness({ launchResult, launchDeferred }) {
  const edits = [];
  const events = [];
  const tracked = new Map();
  const untracked = [];

  const ctx = {
    from: { id: 7 },
    chat: { id: 42 },
    telegram: {
      editMessageText: async (_chatId, _msgId, _inline, text) => {
        edits.push(text);
        events.push({ type: 'edit', text });
      },
    },
  };
  const startingMessage = { chat: { id: 42 }, message_id: 100 };

  const iso = {
    backend: 'docker',
    runner: {
      generateSessionId: () => SESSION,
      executeWithIsolation: async () => {
        events.push({ type: 'launch-start' });
        const res = launchDeferred ? await launchDeferred : launchResult;
        events.push({ type: 'launch-end' });
        return res;
      },
    },
  };

  const deps = {
    resolveIsolation: async () => iso,
    ISOLATION_BACKEND: 'docker',
    isolationRunner: {},
    VERBOSE: false,
    executeStartScreen: async () => ({ success: false }),
    trackSession: (name, info) => {
      tracked.set(name, info);
      events.push({ type: 'track', name });
    },
    untrackSession: name => {
      untracked.push(name);
      events.push({ type: 'untrack', name });
    },
    AUTO_WATCH_MESSAGE: false,
    startAutoTerminalWatchForSession: async () => {},
    bot: {},
    formatExecutingWorkSessionMessage: ({ sessionName }) => `EXECUTING ${sessionName}`,
    formatStartingWorkSessionMessage,
  };

  const run = buildExecuteAndUpdateMessage(deps);
  return { ctx, startingMessage, run, edits, events, tracked, untracked };
}

await test('session is tracked and shown BEFORE the (blocking) launch resolves', async () => {
  let resolveLaunch;
  const launchDeferred = new Promise(r => {
    resolveLaunch = r;
  });
  const h = makeHarness({ launchDeferred });

  const promise = h.run(h.ctx, h.startingMessage, 'solve', ['https://github.com/o/r/issues/1'], 'Issue: x', 'docker');

  // Let the synchronous prelude + the first awaited safeEdit run, but do NOT
  // resolve the launch yet — this models the long image-pull window.
  await new Promise(r => setImmediate(r));

  assert.ok(h.tracked.has(SESSION), 'session is tracked while the container is still starting');
  const startingEdit = h.edits.find(e => e.includes(SESSION));
  assert.ok(startingEdit, 'the message already shows the session UUID during startup');
  assert.ok(/Isolation: `docker`/.test(startingEdit), 'the startup message shows the docker isolation backend');

  const trackIdx = h.events.findIndex(e => e.type === 'track');
  const launchEndIdx = h.events.findIndex(e => e.type === 'launch-end');
  assert.ok(trackIdx >= 0, 'a track event was emitted');
  assert.ok(launchEndIdx === -1, 'the launch has not finished yet when the session is already visible');

  resolveLaunch({ success: true, sessionId: SESSION, output: 'ok' });
  await promise;

  // After success the session stays tracked and the message advances to executing.
  assert.ok(h.tracked.has(SESSION), 'session remains tracked after a successful launch');
  assert.equal(h.untracked.length, 0, 'a successful launch never untracks the session');
  assert.ok(
    h.edits.some(e => e === `EXECUTING ${SESSION}`),
    'message advances to the executing state'
  );
});

await test('a failed launch untracks the optimistically tracked session', async () => {
  const h = makeHarness({ launchResult: { success: false, sessionId: SESSION, output: '', error: 'boom' } });

  await h.run(h.ctx, h.startingMessage, 'solve', ['https://github.com/o/r/issues/1'], 'Issue: x', 'docker');

  assert.deepEqual(h.untracked, [SESSION], 'the phantom session is untracked');
  const trackIdx = h.events.findIndex(e => e.type === 'track');
  const untrackIdx = h.events.findIndex(e => e.type === 'untrack');
  assert.ok(trackIdx >= 0 && untrackIdx > trackIdx, 'untrack happens after the optimistic track');
  assert.ok(
    h.edits.some(e => /boom/.test(e)),
    'the error is surfaced to the user'
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
