#!/usr/bin/env node

/**
 * Tests for the /stop <url> Telegram command (issue #1780).
 *
 * Covers:
 * - extractStopTarget() — resolves UUID/URL targets from /stop text or
 *   the replied-to message, with UUID > URL and argument > reply priority.
 * - registerStartStopCommands() dispatcher — URL mode looks the URL up in
 *   the in-memory solve queue (via getSolveQueue), cancels queued items,
 *   forwards CTRL+C to running isolated sessions, and degrades gracefully
 *   when the queue isn't wired up.
 *
 * Run with: node tests/test-issue-1780-stop-by-url.mjs
 *
 * @hive-mind-test-suite default
 */

import { extractStopTarget, registerStartStopCommands } from '../src/telegram-start-stop-command.lib.mjs';

console.log('='.repeat(80));
console.log('Unit Tests: /stop <url> command (Issue #1780)');
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

function assertEqual(actual, expected, name) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

const ISSUE_URL = 'https://github.com/link-assistant/hive-mind/issues/1780';
const PR_URL = 'https://github.com/link-assistant/hive-mind/pull/1781';
const UUID = '4d934f71-4cdb-4b8c-b474-582116d12c12';
const OTHER_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ---------- extractStopTarget ----------------------------------------------
console.log('\n--- extractStopTarget() ---');

assertEqual(extractStopTarget(`/stop ${ISSUE_URL}`, null), { kind: 'url', value: ISSUE_URL, source: 'argument' }, 'detects issue URL passed as argument');

assertEqual(extractStopTarget(`/stop ${PR_URL}`, null), { kind: 'url', value: PR_URL, source: 'argument' }, 'detects PR URL passed as argument');

assertEqual(extractStopTarget('/stop@MyBot ' + ISSUE_URL, null), { kind: 'url', value: ISSUE_URL, source: 'argument' }, 'strips /stop@botname prefix before searching for URL');

assertEqual(extractStopTarget('/stop', { text: `⏳ Waiting (codex queue #2)\n${ISSUE_URL}` }), { kind: 'url', value: ISSUE_URL, source: 'reply' }, 'falls back to URL in replied-to message text');

assertEqual(extractStopTarget('/stop', { caption: `Working on ${PR_URL} now` }), { kind: 'url', value: PR_URL, source: 'reply' }, 'falls back to URL in replied-to message caption');

assertEqual(extractStopTarget(`/stop ${UUID}`, { text: ISSUE_URL }), { kind: 'uuid', value: UUID, source: 'argument' }, 'UUID in argument wins over URL in reply');

assertEqual(extractStopTarget(`/stop ${ISSUE_URL}`, { text: `Session: ${UUID}` }), { kind: 'uuid', value: UUID, source: 'reply' }, 'UUID in reply wins over URL in argument');

assertEqual(extractStopTarget('/stop', null), { kind: null, value: null, source: null }, 'bare /stop with no reply returns null');

assertEqual(extractStopTarget('/stop please', null), { kind: null, value: null, source: null }, 'free-text reason without UUID/URL returns null');

assertEqual(extractStopTarget('/stop https://example.com/foo/bar', null), { kind: null, value: null, source: null }, 'non-GitHub URL returns null');

assertEqual(extractStopTarget('/stop https://github.com/owner/repo', null), { kind: null, value: null, source: null }, 'GitHub URL that is not an issue/PR returns null');

// Multiple URLs in reply — first issue/PR URL wins.
assertEqual(extractStopTarget('/stop', { text: `${PR_URL} and also ${ISSUE_URL}` }), { kind: 'url', value: PR_URL, source: 'reply' }, 'first issue/PR URL in reply wins');

// ---------- dispatcher /stop <url> -----------------------------------------
console.log('\n--- registerStartStopCommands() /stop <url> dispatcher ---');

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

function makeCtx({ text = '/stop', repliedTo = null, chatType = 'private', chatId = -1001, fromId = 42 } = {}) {
  const replies = [];
  const edits = [];
  return {
    replies,
    edits,
    chat: { id: chatId, type: chatType },
    from: { id: fromId, username: 'tester', first_name: 'Test' },
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

// Test 1: /stop <url> in private chat cancels a queued item.
{
  const queue = makeStubQueue({
    items: [{ id: 'q-1', url: ISSUE_URL, tool: 'codex' }],
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
  assert(queue.cancelCalls.length === 1 && queue.cancelCalls[0] === 'q-1', '/stop <url> cancels matching queued item via queue.cancel(id)', { calls: queue.cancelCalls });
  assert(
    ctx.replies.some(r => r.text.includes('Removed queued task') && r.text.includes(ISSUE_URL)),
    'replies with "Removed queued task" message including URL',
    { replies: ctx.replies.map(r => r.text) }
  );
  assert(
    ctx.replies.some(r => r.text.includes('codex')),
    'reply mentions the per-tool queue name (codex)',
    { replies: ctx.replies.map(r => r.text) }
  );
}

// Test 2: /stop as a reply to a queue card containing a URL still cancels it,
// even though the chat-level pause flow rejects replies (#1081).
{
  const queue = makeStubQueue({
    items: [{ id: 'q-2', url: ISSUE_URL, tool: 'claude' }],
  });
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      isForwardedOrReply: () => true, // would reject bare /stop, must NOT block URL flow
      getSolveQueue: () => queue,
      stopIsolatedSession: async () => ({ success: true, output: '', error: null }),
    })
  );
  const ctx = makeCtx({
    text: '/stop',
    repliedTo: { text: `⏳ Waiting (claude queue #2)\n${ISSUE_URL}` },
    chatType: 'private',
  });
  await bot.handlers.stop(ctx);
  assert(queue.cancelCalls.length === 1 && queue.cancelCalls[0] === 'q-2', 'reply-of-/stop with URL cancels queued item even when isForwardedOrReply returns true', { calls: queue.cancelCalls });
}

// Test 3: /stop <url> for a processing item with UUID-shaped sessionName
// forwards CTRL+C via stopIsolatedSession.
{
  let stopCalledWith = null;
  const queue = makeStubQueue({
    processing: [{ id: 'p-1', url: ISSUE_URL, tool: 'codex', sessionName: UUID }],
  });
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      stopIsolatedSession: async uuid => {
        stopCalledWith = uuid;
        return { success: true, output: 'sent SIGINT', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(queue.cancelCalls.length === 0, 'processing item is NOT cancelled via queue.cancel', { calls: queue.cancelCalls });
  assert(stopCalledWith === UUID, '/stop <url> for processing isolated item forwards UUID to stopIsolatedSession', { stopCalledWith });
  assert(ctx.edits.length === 1 && ctx.edits[0].text.includes('Stop request sent'), 'edits the ack with success message', { edits: ctx.edits });
}

// Test 4: /stop <url> for a processing item without a UUID-shaped sessionName
// (non-isolated screen run) replies with a friendly explanation, does not crash.
{
  let stopCalled = false;
  const queue = makeStubQueue({
    processing: [{ id: 'p-2', url: ISSUE_URL, tool: 'codex', sessionName: 'solve-foo' }],
  });
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      stopIsolatedSession: async () => {
        stopCalled = true;
        return { success: true, output: '', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(!stopCalled, 'non-isolated processing item does not call stopIsolatedSession');
  assert(
    ctx.replies.some(r => r.text.includes('not started with an isolation backend')),
    'replies with "not started with an isolation backend" message',
    { replies: ctx.replies.map(r => r.text) }
  );
}

// Test 5: /stop <url> with no matching queue item replies with not-found message.
{
  const queue = makeStubQueue({});
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
  assert(
    ctx.replies.some(r => r.text.includes('No queued or running task found')),
    'replies with not-found message',
    { replies: ctx.replies.map(r => r.text) }
  );
}

// Test 6: when getSolveQueue is not provided, /stop <url> degrades gracefully.
{
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      stopIsolatedSession: async () => ({ success: true, output: '', error: null }),
      // no getSolveQueue
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(
    ctx.replies.some(r => r.text.includes('no solve queue available')),
    'replies with no-queue message when getSolveQueue is not provided',
    { replies: ctx.replies.map(r => r.text) }
  );
}

// Test 7: in a group chat, only the chat creator can run /stop <url>.
{
  const queue = makeStubQueue({ items: [{ id: 'q-3', url: ISSUE_URL, tool: 'codex' }] });
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      stopIsolatedSession: async () => ({ success: true, output: '', error: null }),
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'supergroup' });
  ctx.telegram.getChatMember = async () => ({ status: 'member' });
  await bot.handlers.stop(ctx);
  assert(queue.cancelCalls.length === 0, 'non-creator group member cannot cancel via /stop <url>', { calls: queue.cancelCalls });
  assert(
    ctx.replies.some(r => r.text.includes('only available to the chat owner')),
    'replies with owner-only error',
    { replies: ctx.replies.map(r => r.text) }
  );
}

// Test 8: old messages are ignored even with a URL.
{
  const queue = makeStubQueue({ items: [{ id: 'q-4', url: ISSUE_URL, tool: 'codex' }] });
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      isOldMessage: () => true,
      getSolveQueue: () => queue,
    })
  );
  const ctx = makeCtx({ text: `/stop ${ISSUE_URL}`, chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(queue.cancelCalls.length === 0, 'old /stop <url> messages do not touch the queue');
  assert(ctx.replies.length === 0, 'no reply for old messages');
}

// Test 9: UUID-in-reply takes precedence over URL-in-argument (sanity check
// that the dispatcher honors the priority documented in extractStopTarget).
{
  let stopCalledWith = null;
  const queue = makeStubQueue({ items: [{ id: 'q-5', url: ISSUE_URL, tool: 'codex' }] });
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      getSolveQueue: () => queue,
      stopIsolatedSession: async uuid => {
        stopCalledWith = uuid;
        return { success: true, output: '', error: null };
      },
    })
  );
  const ctx = makeCtx({
    text: `/stop ${ISSUE_URL}`,
    repliedTo: { text: `Session: ${OTHER_UUID}` },
    chatType: 'private',
  });
  await bot.handlers.stop(ctx);
  assert(stopCalledWith === OTHER_UUID, 'UUID-in-reply takes precedence over URL-in-argument', { stopCalledWith });
  assert(queue.cancelCalls.length === 0, 'queue.cancel is not called when UUID path wins', { calls: queue.cancelCalls });
}

// -------------------------- summary ------------------------------------------
console.log('\n' + '='.repeat(80));
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('='.repeat(80));
if (failed > 0) {
  process.exit(1);
}
