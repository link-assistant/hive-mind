#!/usr/bin/env node

/**
 * Tests for /stop <url> against immediately-started detached sessions (issue #1871).
 *
 * Background:
 *   A `/solve` or `/codex` that starts immediately (the queue is empty) is
 *   dispatched straight to a detached isolation session and is removed from the
 *   solve queue's `processing` Map the moment it launches. From that point on
 *   the queue's `findByUrl` no longer knows about the task, so `/stop <url>`
 *   replied "No queued or running task found" even though the task was clearly
 *   running (see the issue screenshots). The session-monitor registry still
 *   knows the URL → start-command-UUID mapping.
 *
 * This test covers:
 *   1. session-monitor `findStoppableSessionByUrl()` — finds a stoppable
 *      isolation session by URL, reports non-isolation sessions as
 *      non-stoppable, and returns null when nothing matches.
 *   2. The `/stop <url>` dispatcher — when the queue has no record but the
 *      session monitor has a running isolation session for the URL, it forwards
 *      CTRL+C to the start-command UUID; queue matches still take precedence;
 *      and the original task requester can stop in a group via session info.
 *
 * Run with: node tests/test-issue-1871-stop-running-session-by-url.mjs
 *
 * @hive-mind-test-suite default
 */

import { registerStartStopCommands } from '../src/telegram-start-stop-command.lib.mjs';
import { trackSession, findStoppableSessionByUrl, resetSessionMonitorForTests } from '../src/session-monitor.lib.mjs';

console.log('='.repeat(80));
console.log('Unit Tests: /stop <url> for immediately-started sessions (Issue #1871)');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

function assert(cond, name, details) {
  if (cond) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    if (details !== undefined) console.log(`     ${JSON.stringify(details)}`);
    failed++;
  }
}

const ISSUE_URL = 'https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/18';
const UUID = '40c5acd9-f9b4-4675-9812-2dffd99b2716';
const REQUESTER_ID = 555;
const STRANGER_ID = 999;

// ---------- findStoppableSessionByUrl --------------------------------------
console.log('\n--- session-monitor.findStoppableSessionByUrl() ---');

resetSessionMonitorForTests();
trackSession(UUID, {
  chatId: -1001,
  startTime: new Date(),
  url: ISSUE_URL,
  command: 'solve',
  isolationBackend: 'screen',
  sessionId: UUID,
  tool: 'codex',
  requesterUserId: REQUESTER_ID,
});

{
  const match = findStoppableSessionByUrl(ISSUE_URL);
  assert(match && match.sessionId === UUID, 'finds the tracked isolation session by exact URL', { match });
  assert(match && match.stoppable === true, 'reports the isolation session as stoppable', { match });
  assert(match && match.sessionInfo?.requesterUserId === REQUESTER_ID, 'exposes sessionInfo for requester authorization', { match });
}

{
  // Trailing slash + fragment should still match (normalizeSessionUrl).
  const match = findStoppableSessionByUrl(ISSUE_URL + '/#issuecomment-1');
  assert(match && match.sessionId === UUID, 'matches despite trailing slash and fragment', { match });
}

{
  const match = findStoppableSessionByUrl('https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/19');
  assert(match === null, 'returns null for a URL with no tracked session', { match });
}

resetSessionMonitorForTests();
trackSession('solve-plain-screen', {
  chatId: -1001,
  startTime: new Date(),
  url: ISSUE_URL,
  command: 'solve',
  // No isolationBackend → plain non-isolation screen session.
  tool: 'claude',
});
{
  const match = findStoppableSessionByUrl(ISSUE_URL);
  assert(match !== null, 'still reports a non-isolation session match', { match });
  assert(match && match.stoppable === false, 'non-isolation session is reported as NOT stoppable', { match });
  assert(match && match.sessionId === null, 'non-isolation session has no UUID to stop', { match });
}

// ---------- dispatcher wiring ----------------------------------------------
console.log('\n--- registerStartStopCommands() /stop <url> via session monitor ---');

function makeStubBot() {
  const handlers = {};
  return {
    handlers,
    command(name, fn) {
      handlers[name] = fn;
    },
    on() {},
  };
}

function makeCtx({ text = '/stop', repliedTo = null, chatType = 'private', chatId = -1001, fromId = REQUESTER_ID } = {}) {
  const replies = [];
  const edits = [];
  return {
    replies,
    edits,
    chat: { id: chatId, type: chatType },
    from: { id: fromId, username: 'tester', first_name: 'Test' },
    message: { message_id: 7, text, date: Math.floor(Date.now() / 1000), reply_to_message: repliedTo },
    reply: async (t, opts) => {
      const r = { chat: { id: chatId }, message_id: 100 + replies.length, text: t, opts };
      replies.push(r);
      return r;
    },
    telegram: {
      getChatMember: async () => ({ status: 'creator' }),
      editMessageText: async (cId, mId, _x, newText, opts) => {
        edits.push({ chatId: cId, messageId: mId, text: newText, opts });
        return true;
      },
    },
  };
}

function makeOptions(overrides = {}) {
  return {
    VERBOSE: false,
    isOldMessage: () => false,
    isForwardedOrReply: () => false,
    isGroupChat: () => true,
    isChatAuthorized: () => true,
    isTopicAuthorized: () => true,
    buildAuthErrorMessage: () => '❌ not authorized',
    addBreadcrumb: () => {},
    isChatStopped: () => false,
    getStoppedChatRejectMessage: () => '❌ stopped',
    ...overrides,
  };
}

function makeStubQueue({ items = [], processing = [] } = {}) {
  const cancelCalls = [];
  return {
    cancelCalls,
    items,
    processing,
    findByUrl(url) {
      return items.find(i => i.url === url) || processing.find(i => i.url === url) || null;
    },
    cancel(id) {
      const idx = items.findIndex(i => i.id === id);
      if (idx !== -1) {
        cancelCalls.push(id);
        items.splice(idx, 1);
        return true;
      }
      return false;
    },
  };
}

// Test 1: the exact issue scenario — empty queue, running isolation session.
{
  let stopCalledWith = null;
  const queue = makeStubQueue({}); // queue knows nothing (task already dispatched)
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      findRunningSessionByUrl: () => ({ sessionName: UUID, sessionId: UUID, sessionInfo: { requesterUserId: REQUESTER_ID }, isolationBackend: 'screen', stoppable: true }),
      stopIsolatedSession: async uuid => {
        stopCalledWith = uuid;
        return { success: true, output: 'sent SIGINT', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(stopCalledWith === UUID, '/stop <url> forwards CTRL+C to the running isolation session UUID', { stopCalledWith });
  assert(queue.cancelCalls.length === 0, 'queue.cancel is not called (nothing was queued)', { calls: queue.cancelCalls });
  assert(
    ctx.edits.some(e => e.text.includes('Stop request sent')),
    'edits the ack with success message',
    { edits: ctx.edits.map(e => e.text) }
  );
}

// Test 2: queued item still takes precedence over a stale session-monitor hit.
{
  let stopCalled = false;
  const queue = makeStubQueue({ items: [{ id: 'q-1', url: ISSUE_URL, tool: 'codex' }] });
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      findRunningSessionByUrl: () => ({ sessionName: UUID, sessionId: UUID, sessionInfo: {}, isolationBackend: 'screen', stoppable: true }),
      stopIsolatedSession: async () => {
        stopCalled = true;
        return { success: true, output: '', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(queue.cancelCalls.length === 1, 'queued item is cancelled', { calls: queue.cancelCalls });
  assert(!stopCalled, 'CTRL+C is NOT forwarded when the task is still queued');
}

// Test 3: in a group, the original requester (non-owner) can stop via session info.
{
  let stopCalledWith = null;
  const queue = makeStubQueue({});
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      findRunningSessionByUrl: () => ({ sessionName: UUID, sessionId: UUID, sessionInfo: { requesterUserId: REQUESTER_ID }, isolationBackend: 'screen', stoppable: true }),
      stopIsolatedSession: async uuid => {
        stopCalledWith = uuid;
        return { success: true, output: '', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'supergroup', fromId: REQUESTER_ID });
  ctx.telegram.getChatMember = async () => ({ status: 'member' }); // not the owner
  await bot.handlers.stop(ctx);
  assert(stopCalledWith === UUID, 'task requester (non-owner) stops their own running session in a group', { stopCalledWith });
}

// Test 4: a stranger (non-owner, non-requester) is rejected.
{
  let stopCalled = false;
  const queue = makeStubQueue({});
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      findRunningSessionByUrl: () => ({ sessionName: UUID, sessionId: UUID, sessionInfo: { requesterUserId: REQUESTER_ID }, isolationBackend: 'screen', stoppable: true }),
      stopIsolatedSession: async () => {
        stopCalled = true;
        return { success: true, output: '', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'supergroup', fromId: STRANGER_ID });
  ctx.telegram.getChatMember = async () => ({ status: 'member' });
  await bot.handlers.stop(ctx);
  assert(!stopCalled, 'stranger cannot stop someone else’s running session');
  assert(
    ctx.replies.some(r => r.text.includes('only available to the chat owner')),
    'stranger gets owner-or-requester rejection',
    { replies: ctx.replies.map(r => r.text) }
  );
}

// Test 5: a running but non-isolation session yields the friendly explanation.
{
  let stopCalled = false;
  const queue = makeStubQueue({});
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      findRunningSessionByUrl: () => ({ sessionName: 'solve-plain', sessionId: null, sessionInfo: {}, isolationBackend: null, stoppable: false }),
      stopIsolatedSession: async () => {
        stopCalled = true;
        return { success: true, output: '', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(!stopCalled, 'non-isolation running session does not call stopIsolatedSession');
  assert(
    ctx.replies.some(r => r.text.includes('not started with an isolation backend')),
    'replies with the isolation-backend explanation',
    { replies: ctx.replies.map(r => r.text) }
  );
}

// Test 6: nothing queued and nothing tracked → not-found message.
{
  const queue = makeStubQueue({});
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      findRunningSessionByUrl: () => null,
      stopIsolatedSession: async () => ({ success: true, output: '', error: null }),
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(
    ctx.replies.some(r => r.text.includes('No queued or running task found')),
    'replies with not-found when neither queue nor session monitor knows the URL',
    { replies: ctx.replies.map(r => r.text) }
  );
}

// Test 7: no solve queue, but a running isolation session is tracked → still stops.
{
  let stopCalledWith = null;
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      // no getSolveQueue at all
      findRunningSessionByUrl: () => ({ sessionName: UUID, sessionId: UUID, sessionInfo: {}, isolationBackend: 'screen', stoppable: true }),
      stopIsolatedSession: async uuid => {
        stopCalledWith = uuid;
        return { success: true, output: '', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(stopCalledWith === UUID, '/stop <url> stops a tracked session even without a solve queue', { stopCalledWith });
}

// -------------------------- summary ------------------------------------------
console.log('\n' + '='.repeat(80));
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('='.repeat(80));
if (failed > 0) {
  process.exit(1);
}
