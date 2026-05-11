#!/usr/bin/env node

/**
 * Tests for the /stop <UUID> Telegram command (issue #524).
 *
 * Covers:
 * - extractStopSessionId() — pure UUID resolver from text or replied-to message.
 * - registerStartStopCommands() dispatcher — UUID-mode bypasses the
 *   forwarded/reply rejection used by the chat-level pause flow, while bare
 *   /stop continues to follow the existing pause flow (#1081).
 *
 * Run with: node tests/test-issue-524-stop-uuid.mjs
 *
 * @hive-mind-test-suite default
 */

import { extractStopSessionId, registerStartStopCommands } from '../src/telegram-start-stop-command.lib.mjs';
import { makeAsserts, makeStubBot, makeStopCtx as makeCtx, makeStopOptions as makeOptions } from './test-telegram-stop-helpers.mjs';

console.log('='.repeat(80));
console.log('Unit Tests: /stop <UUID> command (Issue #524)');
console.log('='.repeat(80));

const { counts, assert, assertEqual } = makeAsserts();

// ----- extractStopSessionId --------------------------------------------------
console.log('\n--- extractStopSessionId() ---');

assertEqual(extractStopSessionId('/stop 4d934f71-4cdb-4b8c-b474-582116d12c12', null), { sessionId: '4d934f71-4cdb-4b8c-b474-582116d12c12', source: 'argument' }, 'extracts UUID passed as a positional argument');

assertEqual(extractStopSessionId('/stop@MyBot 4d934f71-4cdb-4b8c-b474-582116d12c12', null), { sessionId: '4d934f71-4cdb-4b8c-b474-582116d12c12', source: 'argument' }, 'strips /stop@botname prefix before searching for UUID');

assertEqual(extractStopSessionId('/stop 4D934F71-4CDB-4B8C-B474-582116D12C12', null), { sessionId: '4d934f71-4cdb-4b8c-b474-582116d12c12', source: 'argument' }, 'lowercases extracted UUID');

assertEqual(extractStopSessionId('/stop', { text: '⏳ Executing...\n📊 Session: `4d934f71-4cdb-4b8c-b474-582116d12c12`' }), { sessionId: '4d934f71-4cdb-4b8c-b474-582116d12c12', source: 'reply' }, 'falls back to UUID in replied-to message text');

assertEqual(extractStopSessionId('/stop', { caption: 'Session: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee finished' }), { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', source: 'reply' }, 'falls back to UUID in replied-to message caption');

assertEqual(extractStopSessionId('/stop 4d934f71-4cdb-4b8c-b474-582116d12c12', { text: 'Session: 11111111-2222-3333-4444-555555555555' }), { sessionId: '4d934f71-4cdb-4b8c-b474-582116d12c12', source: 'argument' }, 'argument UUID wins over replied-to UUID');

assertEqual(extractStopSessionId('/stop', null), { sessionId: null, source: null }, 'bare /stop with no reply returns null sessionId');

assertEqual(extractStopSessionId('/stop please pause this chat', null), { sessionId: null, source: null }, 'free-text reason without UUID returns null sessionId');

assertEqual(extractStopSessionId('/stop 12345', null), { sessionId: null, source: null }, 'non-UUID argument returns null sessionId');

assertEqual(extractStopSessionId('', null), { sessionId: null, source: null }, 'empty text returns null sessionId');

assertEqual(extractStopSessionId(null, undefined), { sessionId: null, source: null }, 'null text + undefined reply returns null sessionId');

// ----- registerStartStopCommands /stop dispatcher ----------------------------
console.log('\n--- registerStartStopCommands() /stop dispatcher ---');

// Test 1: /stop <UUID> in private chat invokes stopIsolatedSession.
{
  let calledWith = null;
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      stopIsolatedSession: async (uuid, verbose) => {
        calledWith = { uuid, verbose };
        return { success: true, output: 'OK', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: '/stop 4d934f71-4cdb-4b8c-b474-582116d12c12', chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(calledWith && calledWith.uuid === '4d934f71-4cdb-4b8c-b474-582116d12c12', '/stop <UUID> calls stopIsolatedSession with the parsed UUID', { calledWith });
  assert(ctx.replies.length === 1, 'sends a single ack reply', { replies: ctx.replies.length });
  assert(ctx.edits.length === 1, 'edits the ack message with the result', { edits: ctx.edits.length });
  assert(ctx.edits[0].text.includes('Stop request sent'), 'success message mentions stop request sent', { text: ctx.edits[0].text });
  assert(ctx.edits[0].text.includes('OK'), 'success message includes stopIsolatedSession output', { text: ctx.edits[0].text });
}

// Test 2: /stop as a reply to a message with a UUID still invokes stopIsolatedSession,
// even though replies are normally rejected by the chat-pause flow (#1081).
{
  let calledWith = null;
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      isForwardedOrReply: () => true, // would reject bare /stop, must NOT block UUID flow
      stopIsolatedSession: async uuid => {
        calledWith = uuid;
        return { success: true, output: '', error: null };
      },
    })
  );
  const ctx = makeCtx({
    text: '/stop',
    repliedTo: { text: '⏳ Executing...\n📊 Session: `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`' },
    chatType: 'private',
  });
  await bot.handlers.stop(ctx);
  assert(calledWith === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'reply-of-/stop with UUID resolves UUID and calls stopIsolatedSession even when isForwardedOrReply returns true', { calledWith });
}

// Test 3: bare /stop (no UUID) does NOT call stopIsolatedSession; falls through to chat-pause flow.
{
  let stopCalled = false;
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      stopIsolatedSession: async () => {
        stopCalled = true;
        return { success: true, output: '', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: '/stop please', chatType: 'supergroup', chatId: -1001 });
  await bot.handlers.stop(ctx);
  assert(!stopCalled, 'bare /stop does NOT call stopIsolatedSession');
}

// Test 4: stopIsolatedSession failure surfaces the error to the user.
{
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      stopIsolatedSession: async () => ({ success: false, output: '', error: 'session not found' }),
    })
  );
  const ctx = makeCtx({ text: '/stop 4d934f71-4cdb-4b8c-b474-582116d12c12', chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(ctx.edits.length === 1, 'failure path edits the ack with the error', { edits: ctx.edits.length });
  assert(ctx.edits[0].text.includes('Failed to stop session'), 'failure message includes Failed to stop session', { text: ctx.edits[0].text });
  assert(ctx.edits[0].text.includes('session not found'), 'failure message includes the underlying error', { text: ctx.edits[0].text });
}

// Test 5: in a group chat, only the chat creator can run /stop <UUID>.
{
  let stopCalled = false;
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      stopIsolatedSession: async () => {
        stopCalled = true;
        return { success: true, output: '', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: '/stop 4d934f71-4cdb-4b8c-b474-582116d12c12', chatType: 'supergroup' });
  ctx.telegram.getChatMember = async () => ({ status: 'member' });
  await bot.handlers.stop(ctx);
  assert(!stopCalled, 'non-creator group member cannot run /stop <UUID>');
  assert(
    ctx.replies.some(r => r.text.includes('only available to the chat owner')),
    'replies with owner-only error',
    { replies: ctx.replies.map(r => r.text) }
  );
}

// Test 6: old messages are ignored.
{
  let stopCalled = false;
  const bot = makeStubBot();
  registerStartStopCommands(
    bot,
    makeOptions({
      isOldMessage: () => true,
      stopIsolatedSession: async () => {
        stopCalled = true;
        return { success: true, output: '', error: null };
      },
    })
  );
  const ctx = makeCtx({ text: '/stop 4d934f71-4cdb-4b8c-b474-582116d12c12', chatType: 'private' });
  await bot.handlers.stop(ctx);
  assert(!stopCalled, 'old /stop messages are ignored');
  assert(ctx.replies.length === 0, 'no reply for old messages');
}

// -------------------------- summary ------------------------------------------
console.log('\n' + '='.repeat(80));
console.log(`Result: ${counts.passed} passed, ${counts.failed} failed`);
console.log('='.repeat(80));
if (counts.failed > 0) {
  process.exit(1);
}
