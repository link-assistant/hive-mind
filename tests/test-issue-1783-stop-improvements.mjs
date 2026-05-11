#!/usr/bin/env node

/**
 * Tests for /stop command improvements (issue #1783).
 *
 * Covers two behavior changes:
 *
 * 1. When `/stop <url>` cancels a queued task, the original "⏳ Waiting
 *    (claude queue #N)" message is updated in place to show the task was
 *    removed. Previously the dispatcher only sent a fresh ack reply, leaving
 *    the queue card stale.
 *
 * 2. /stop targeted modes (UUID and URL) now allow the original task
 *    REQUESTER to stop their own task, not just the chat creator. This
 *    mirrors /terminal_watch and /watch (PR #1779, commit c2c51faa).
 *
 * Run with: node tests/test-issue-1783-stop-improvements.mjs
 *
 * @hive-mind-test-suite default
 */

import { isStopTargetRequester, updateQueueCardForCancellation, registerStartStopCommands } from '../src/telegram-start-stop-command.lib.mjs';

console.log('='.repeat(80));
console.log('Unit Tests: /stop command improvements (Issue #1783)');
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

const ISSUE_URL = 'https://github.com/link-assistant/hive-mind/issues/1783';
const UUID = '4d934f71-4cdb-4b8c-b474-582116d12c12';
const REQUESTER_ID = 123456;
const OWNER_ID = 999999;
const STRANGER_ID = 777777;

// ---------------------------------------------------------------------------
// isStopTargetRequester()
// ---------------------------------------------------------------------------
console.log('\n--- isStopTargetRequester() ---');

assert(isStopTargetRequester({ userId: REQUESTER_ID, queueItem: { requesterUserId: REQUESTER_ID } }) === true, 'matches when queueItem.requesterUserId equals userId');

assert(isStopTargetRequester({ userId: REQUESTER_ID, sessionInfo: { requesterUserId: REQUESTER_ID } }) === true, 'matches when sessionInfo.requesterUserId equals userId');

assert(isStopTargetRequester({ userId: REQUESTER_ID, queueItem: { requesterUserId: STRANGER_ID } }) === false, 'does NOT match when queueItem requester is a different user');

assert(isStopTargetRequester({ userId: REQUESTER_ID, queueItem: null, sessionInfo: null }) === false, 'returns false when neither queueItem nor sessionInfo is provided');

assert(isStopTargetRequester({ userId: null, queueItem: { requesterUserId: REQUESTER_ID } }) === false, 'returns false when userId is null');

assert(isStopTargetRequester({ userId: REQUESTER_ID, queueItem: { requesterUserId: null } }) === false, 'returns false when queueItem.requesterUserId is null');

assert(isStopTargetRequester({ userId: '123456', queueItem: { requesterUserId: 123456 } }) === true, 'compares as strings so number/string mismatch is tolerated');

// ---------------------------------------------------------------------------
// updateQueueCardForCancellation()
// ---------------------------------------------------------------------------
console.log('\n--- updateQueueCardForCancellation() ---');

{
  // Happy path: edits message at item.messageInfo coordinates.
  const editCalls = [];
  const item = {
    messageInfo: { chatId: -1001, messageId: 555 },
    ctx: {
      telegram: {
        editMessageText: async (cId, mId, _x, text, opts) => {
          editCalls.push({ cId, mId, text, opts });
          return true;
        },
      },
    },
  };
  const ok = await updateQueueCardForCancellation(item, ISSUE_URL, 'claude', '@requester');
  assert(ok === true, 'returns true when edit succeeds');
  assert(editCalls.length === 1, 'calls editMessageText exactly once', { editCalls });
  assert(editCalls[0]?.cId === -1001 && editCalls[0]?.mId === 555, 'edits the message at item.messageInfo coordinates', { editCalls });
  assert(editCalls[0]?.text.includes('Cancelled'), 'card text says Cancelled', { text: editCalls[0]?.text });
  assert(editCalls[0]?.text.includes(ISSUE_URL), 'card text includes the URL', { text: editCalls[0]?.text });
  assert(editCalls[0]?.text.includes('claude'), 'card text mentions the per-tool queue name', { text: editCalls[0]?.text });
  assert(editCalls[0]?.text.includes('@requester'), 'card text mentions who ran /stop', { text: editCalls[0]?.text });
  assert(editCalls[0]?.opts?.parse_mode === 'Markdown', 'uses Markdown parse mode', { opts: editCalls[0]?.opts });
  assert(item.messageInfo === null, 'clears item.messageInfo after a successful edit (terminal state)');
}

{
  // No messageInfo → no-op, returns false.
  const item = { messageInfo: null, ctx: { telegram: { editMessageText: async () => true } } };
  const ok = await updateQueueCardForCancellation(item, ISSUE_URL, 'claude', '@requester');
  assert(ok === false, 'returns false when item.messageInfo is null');
}

{
  // No ctx → no-op, returns false.
  const item = { messageInfo: { chatId: 1, messageId: 1 }, ctx: null };
  const ok = await updateQueueCardForCancellation(item, ISSUE_URL, 'claude', '@requester');
  assert(ok === false, 'returns false when item.ctx is null');
}

{
  // Edit throws → returns false, original error is logged but swallowed.
  const item = {
    messageInfo: { chatId: -1001, messageId: 555 },
    ctx: {
      telegram: {
        editMessageText: async () => {
          throw new Error('message not found');
        },
      },
    },
  };
  const ok = await updateQueueCardForCancellation(item, ISSUE_URL, 'claude', '@requester');
  assert(ok === false, 'returns false when editMessageText throws');
  // messageInfo is left in place when edit fails so a retry could try again.
  assert(item.messageInfo !== null, 'leaves item.messageInfo untouched on failure');
}

// ---------------------------------------------------------------------------
// Dispatcher integration: /stop <url> updates the queue card on cancel
// ---------------------------------------------------------------------------
console.log('\n--- /stop <url> updates the queue card on cancel-queued ---');

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

function makeCtx({ text = '/stop', repliedTo = null, chatType = 'private', chatId = -1001, fromId = REQUESTER_ID, fromUsername = 'requester' } = {}) {
  const replies = [];
  const edits = [];
  return {
    replies,
    edits,
    chat: { id: chatId, type: chatType },
    from: { id: fromId, username: fromUsername, first_name: 'Test' },
    message: {
      message_id: 7,
      text,
      date: Math.floor(Date.now() / 1000),
      reply_to_message: repliedTo,
    },
    reply: async (text, opts) => {
      const r = { chat: { id: chatId }, message_id: 100 + replies.length, text, opts };
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

function makeQueueItem({ id, url, tool, sessionName = null, requesterUserId = null, ctx = null, messageInfo = null }) {
  return { id, url, tool, sessionName, requesterUserId, ctx, messageInfo };
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

{
  // /stop <url> in private chat cancels queued item AND edits the original
  // queue card via item.messageInfo using item.ctx.telegram.editMessageText.
  const queueCardEdits = [];
  const queueCardCtx = {
    telegram: {
      editMessageText: async (cId, mId, _x, text, opts) => {
        queueCardEdits.push({ cId, mId, text, opts });
        return true;
      },
    },
  };
  const queue = makeStubQueue({
    items: [
      makeQueueItem({
        id: 'q-card-1',
        url: ISSUE_URL,
        tool: 'claude',
        ctx: queueCardCtx,
        messageInfo: { chatId: -1001, messageId: 42 },
      }),
    ],
  });

  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      stopIsolatedSession: async () => ({ success: true, output: '', error: null }),
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'private' });
  await bot.handlers.stop(ctx);

  assert(queue.cancelCalls.length === 1 && queue.cancelCalls[0] === 'q-card-1', 'queued item is cancelled', { calls: queue.cancelCalls });
  assert(queueCardEdits.length === 1, 'queue card is edited via item.ctx.telegram.editMessageText', { queueCardEdits });
  assert(queueCardEdits[0]?.cId === -1001 && queueCardEdits[0]?.mId === 42, 'queue card edit uses item.messageInfo coordinates', { queueCardEdits });
  assert(queueCardEdits[0]?.text.includes('Cancelled'), 'queue card text says Cancelled', { text: queueCardEdits[0]?.text });
  assert(queueCardEdits[0]?.text.includes(ISSUE_URL), 'queue card text includes the URL');
  assert(
    ctx.replies.some(r => r.text.includes('Removed queued task') && r.text.includes(ISSUE_URL)),
    'dispatcher still sends the ack reply',
    { replies: ctx.replies.map(r => r.text) }
  );
}

{
  // When item has no messageInfo (e.g., already cleared), cancel still works
  // and we still send the ack reply — no crash, no edits.
  const queueCardEdits = [];
  const queueCardCtx = {
    telegram: {
      editMessageText: async (_cId, _mId, _x, _text, _opts) => {
        queueCardEdits.push({});
        return true;
      },
    },
  };
  const queue = makeStubQueue({
    items: [
      makeQueueItem({
        id: 'q-card-2',
        url: ISSUE_URL,
        tool: 'claude',
        ctx: queueCardCtx,
        messageInfo: null,
      }),
    ],
  });

  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      stopIsolatedSession: async () => ({ success: true, output: '', error: null }),
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'private' });
  await bot.handlers.stop(ctx);

  assert(queue.cancelCalls.length === 1, 'queued item is still cancelled when messageInfo is missing');
  assert(queueCardEdits.length === 0, 'no queue card edit attempted when messageInfo is null');
  assert(
    ctx.replies.some(r => r.text.includes('Removed queued task')),
    'ack reply is still sent',
    { replies: ctx.replies.map(r => r.text) }
  );
}

// ---------------------------------------------------------------------------
// Dispatcher integration: task requester can /stop <url> in a group chat
// ---------------------------------------------------------------------------
console.log('\n--- /stop <url>: requester can stop their own task in a group ---');

{
  // Requester runs /stop in a group; they are NOT the chat creator. Should be
  // allowed because the queue item's requesterUserId matches ctx.from.id.
  const queue = makeStubQueue({
    items: [
      makeQueueItem({
        id: 'q-req-1',
        url: ISSUE_URL,
        tool: 'codex',
        requesterUserId: REQUESTER_ID,
      }),
    ],
  });
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'supergroup', fromId: REQUESTER_ID });
  // Even if Telegram says they are a regular member, the requester check
  // should still let them through.
  ctx.telegram.getChatMember = async () => ({ status: 'member' });

  await bot.handlers.stop(ctx);

  assert(queue.cancelCalls.length === 1 && queue.cancelCalls[0] === 'q-req-1', 'task requester can cancel their own queued task in a group', { calls: queue.cancelCalls });
  assert(
    ctx.replies.some(r => r.text.includes('Removed queued task')),
    'dispatcher sends the ack reply',
    { replies: ctx.replies.map(r => r.text) }
  );
  assert(!ctx.replies.some(r => r.text.includes('only available to the chat owner')), 'no owner-only rejection for the requester', { replies: ctx.replies.map(r => r.text) });
}

{
  // Stranger (not the requester, not the creator) still cannot /stop someone
  // else's task in a group.
  const queue = makeStubQueue({
    items: [
      makeQueueItem({
        id: 'q-req-2',
        url: ISSUE_URL,
        tool: 'codex',
        requesterUserId: REQUESTER_ID,
      }),
    ],
  });
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'supergroup', fromId: STRANGER_ID });
  ctx.telegram.getChatMember = async () => ({ status: 'member' });

  await bot.handlers.stop(ctx);

  assert(queue.cancelCalls.length === 0, 'stranger cannot cancel a task they did not start', { calls: queue.cancelCalls });
  assert(
    ctx.replies.some(r => r.text.includes('only available to the chat owner or the user who started this task')),
    'rejection message mentions both the chat owner and the requester',
    { replies: ctx.replies.map(r => r.text) }
  );
}

{
  // Chat owner can still /stop tasks they did not start themselves.
  const queue = makeStubQueue({
    items: [
      makeQueueItem({
        id: 'q-req-3',
        url: ISSUE_URL,
        tool: 'codex',
        requesterUserId: REQUESTER_ID,
      }),
    ],
  });
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'supergroup', fromId: OWNER_ID });
  ctx.telegram.getChatMember = async () => ({ status: 'creator' });

  await bot.handlers.stop(ctx);

  assert(queue.cancelCalls.length === 1, 'chat owner can still cancel any task in a group');
}

// ---------------------------------------------------------------------------
// Dispatcher integration: task requester can /stop <UUID> in a group chat
// ---------------------------------------------------------------------------
console.log('\n--- /stop <UUID>: requester can stop their own session in a group ---');

{
  let stopCalledWith = null;
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      // No queue lookup needed for UUID path.
      stopIsolatedSession: async uuid => {
        stopCalledWith = uuid;
        return { success: true, output: '', error: null };
      },
      getTrackedSessionInfo: () => ({ requesterUserId: REQUESTER_ID, chatId: -1001 }),
    })
  );
  const ctx = makeCtx({ text: `/stop ${UUID}`, chatType: 'supergroup', fromId: REQUESTER_ID });
  ctx.telegram.getChatMember = async () => ({ status: 'member' });

  await bot.handlers.stop(ctx);

  assert(stopCalledWith === UUID, 'requester can /stop their own session by UUID', { stopCalledWith });
  assert(!ctx.replies.some(r => r.text.includes('only available to the chat owner')), 'no owner-only rejection for the session requester', { replies: ctx.replies.map(r => r.text) });
}

{
  // Stranger cannot stop a session by UUID in a group.
  let stopCalledWith = null;
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      stopIsolatedSession: async uuid => {
        stopCalledWith = uuid;
        return { success: true, output: '', error: null };
      },
      getTrackedSessionInfo: () => ({ requesterUserId: REQUESTER_ID, chatId: -1001 }),
    })
  );
  const ctx = makeCtx({ text: `/stop ${UUID}`, chatType: 'supergroup', fromId: STRANGER_ID });
  ctx.telegram.getChatMember = async () => ({ status: 'member' });

  await bot.handlers.stop(ctx);

  assert(stopCalledWith === null, 'stranger cannot stop a session they did not start by UUID', { stopCalledWith });
  assert(
    ctx.replies.some(r => r.text.includes('only available to the chat owner or the user who started this task')),
    'rejection message mentions owner or requester',
    { replies: ctx.replies.map(r => r.text) }
  );
}

{
  // When getTrackedSessionInfo throws, dispatcher falls back to owner-only
  // check and does not crash.
  let stopCalledWith = null;
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      stopIsolatedSession: async uuid => {
        stopCalledWith = uuid;
        return { success: true, output: '', error: null };
      },
      getTrackedSessionInfo: () => {
        throw new Error('session monitor down');
      },
    })
  );
  const ctx = makeCtx({ text: `/stop ${UUID}`, chatType: 'supergroup', fromId: OWNER_ID });
  ctx.telegram.getChatMember = async () => ({ status: 'creator' });

  await bot.handlers.stop(ctx);

  assert(stopCalledWith === UUID, 'chat owner can still /stop UUID even when session lookup fails', { stopCalledWith });
}

// -------------------------- summary ----------------------------------------
console.log('\n' + '='.repeat(80));
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('='.repeat(80));
if (failed > 0) {
  process.exit(1);
}
