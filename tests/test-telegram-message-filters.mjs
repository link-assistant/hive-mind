#!/usr/bin/env node

/**
 * Unit tests for Telegram message filter functions
 * Tests isOldMessage, isGroupChat, isChatAuthorized, isForwardedOrReply
 *
 * These filters determine whether incoming messages should be processed
 * or silently ignored by the bot's command handlers.
 *
 * Run with: node tests/test-telegram-message-filters.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1207
 * @see https://github.com/link-assistant/hive-mind/pull/493
 * @see https://github.com/link-assistant/hive-mind/pull/496
 */

import { isOldMessage, isGroupChat, isChatAuthorized, isForwardedOrReply } from '../src/telegram-message-filters.lib.mjs';

console.log('='.repeat(80));
console.log('Unit Tests: Telegram Message Filters (Issue #1207)');
console.log('='.repeat(80));
console.log();

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    const result = fn();
    if (result === true) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${name}`);
      console.log(`     Result: ${JSON.stringify(result)}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
}

// Helper to create mock context objects
function makeCtx({ chatType = 'supergroup', messageDate = undefined, message = {} } = {}) {
  return {
    chat: chatType ? { id: -100123, type: chatType } : undefined,
    message: {
      date: messageDate,
      ...message,
    },
  };
}

// ===========================================================================
// Tests for isOldMessage()
// ===========================================================================
console.log('\n--- isOldMessage() Tests ---\n');

runTest('Returns false when message has no date', () => {
  const ctx = makeCtx({});
  return isOldMessage(ctx, 1000000) === false;
});

runTest('Returns true when message date is before bot start time', () => {
  const ctx = makeCtx({ messageDate: 999999 });
  return isOldMessage(ctx, 1000000) === true;
});

runTest('Returns false when message date equals bot start time', () => {
  const ctx = makeCtx({ messageDate: 1000000 });
  return isOldMessage(ctx, 1000000) === false;
});

runTest('Returns false when message date is after bot start time', () => {
  const ctx = makeCtx({ messageDate: 1000001 });
  return isOldMessage(ctx, 1000000) === false;
});

runTest('Returns false when message is undefined', () => {
  const ctx = { message: undefined };
  return isOldMessage(ctx, 1000000) === false;
});

// ===========================================================================
// Tests for isGroupChat()
// ===========================================================================
console.log('\n--- isGroupChat() Tests ---\n');

runTest('Returns true for group chat', () => {
  const ctx = makeCtx({ chatType: 'group' });
  return isGroupChat(ctx) === true;
});

runTest('Returns true for supergroup chat', () => {
  const ctx = makeCtx({ chatType: 'supergroup' });
  return isGroupChat(ctx) === true;
});

runTest('Returns false for private chat', () => {
  const ctx = makeCtx({ chatType: 'private' });
  return isGroupChat(ctx) === false;
});

runTest('Returns false for channel', () => {
  const ctx = makeCtx({ chatType: 'channel' });
  return isGroupChat(ctx) === false;
});

runTest('Returns false when chat is undefined', () => {
  const ctx = { chat: undefined };
  return isGroupChat(ctx) === false;
});

// ===========================================================================
// Tests for isChatAuthorized()
// ===========================================================================
console.log('\n--- isChatAuthorized() Tests ---\n');

runTest('Returns true when allowedChats is null (no restrictions)', () => {
  return isChatAuthorized(123, null) === true;
});

runTest('Returns true when allowedChats is undefined (no restrictions)', () => {
  return isChatAuthorized(123, undefined) === true;
});

runTest('Returns true when chat ID is in allowed list', () => {
  return isChatAuthorized(123, [123, 456, 789]) === true;
});

runTest('Returns false when chat ID is NOT in allowed list', () => {
  return isChatAuthorized(999, [123, 456, 789]) === false;
});

runTest('Returns false when allowed list is empty', () => {
  return isChatAuthorized(123, []) === false;
});

runTest('Works with negative chat IDs (supergroups)', () => {
  return isChatAuthorized(-100123456, [-100123456, -100789012]) === true;
});

// ===========================================================================
// Tests for isForwardedOrReply()
// ===========================================================================
console.log('\n--- isForwardedOrReply() Tests ---\n');

// --- Normal messages (should NOT be filtered) ---
console.log('\n  Normal messages:\n');

runTest('Returns false for normal message (no forwarding or reply fields)', () => {
  const ctx = makeCtx({
    message: { text: '/solve https://github.com/owner/repo/issues/1' },
  });
  return isForwardedOrReply(ctx) === false;
});

runTest('Returns false when message is undefined', () => {
  const ctx = { message: undefined };
  return isForwardedOrReply(ctx) === false;
});

// Issue #493: Empty objects should NOT trigger false positives
runTest('Returns false when forward_origin is empty object {} (issue #493)', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      forward_origin: {},
    },
  });
  return isForwardedOrReply(ctx) === false;
});

runTest('Returns false when reply_to_message is empty object {} (issue #493)', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      reply_to_message: {},
    },
  });
  return isForwardedOrReply(ctx) === false;
});

// --- Forwarded messages (SHOULD be filtered) ---
console.log('\n  Forwarded messages:\n');

runTest('Returns true for forwarded message (new API: forward_origin with type)', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      forward_origin: { type: 'user', sender_user: { id: 123 } },
    },
  });
  return isForwardedOrReply(ctx) === true;
});

runTest('Returns true for forwarded message (old API: forward_from)', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      forward_from: { id: 123, first_name: 'Test' },
    },
  });
  return isForwardedOrReply(ctx) === true;
});

runTest('Returns true for forwarded message (old API: forward_from_chat)', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      forward_from_chat: { id: -100123, type: 'channel' },
    },
  });
  return isForwardedOrReply(ctx) === true;
});

runTest('Returns true for forwarded message (old API: forward_date)', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      forward_date: 1700000000,
    },
  });
  return isForwardedOrReply(ctx) === true;
});

runTest('Returns true for forwarded message (old API: forward_sender_name)', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      forward_sender_name: 'Hidden User',
    },
  });
  return isForwardedOrReply(ctx) === true;
});

runTest('Returns true for forwarded message (old API: forward_signature)', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      forward_signature: 'Channel Author',
    },
  });
  return isForwardedOrReply(ctx) === true;
});

runTest('Returns true for forwarded message (old API: forward_from_message_id)', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      forward_from_message_id: 42,
    },
  });
  return isForwardedOrReply(ctx) === true;
});

// --- Reply messages (SHOULD be filtered) ---
console.log('\n  Reply messages:\n');

runTest('Returns true for reply to another user message', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      reply_to_message: { message_id: 100, text: 'Some user message' },
    },
  });
  return isForwardedOrReply(ctx) === true;
});

runTest('Returns true for reply to bot message', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      reply_to_message: { message_id: 200, from: { id: 999, is_bot: true } },
    },
  });
  return isForwardedOrReply(ctx) === true;
});

// --- Forum topic messages (should NOT be filtered) - Issue #496 ---
console.log('\n  Forum topic messages (issue #496):\n');

runTest('Returns false for message in forum topic (reply_to_message with forum_topic_created)', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      reply_to_message: {
        message_id: 857,
        forum_topic_created: {
          name: 'Pull Request Requests',
          icon_color: 16766590,
        },
      },
    },
  });
  return isForwardedOrReply(ctx) === false;
});

runTest('Returns false for message in forum topic with topic_message and thread_id', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      is_topic_message: true,
      message_thread_id: 857,
      reply_to_message: {
        message_id: 857,
        forum_topic_created: {
          name: 'General',
          icon_color: 7322096,
        },
      },
    },
  });
  return isForwardedOrReply(ctx) === false;
});

// --- Edge cases ---
console.log('\n  Edge cases:\n');

runTest('Returns true for forwarded message in forum topic (forwarding takes priority)', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      forward_origin: { type: 'user', sender_user: { id: 123 } },
      reply_to_message: {
        message_id: 857,
        forum_topic_created: { name: 'Topic', icon_color: 0 },
      },
    },
  });
  return isForwardedOrReply(ctx) === true;
});

runTest('Handles message with forward_origin.type = "hidden_user"', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      forward_origin: { type: 'hidden_user', sender_user_name: 'Hidden' },
    },
  });
  return isForwardedOrReply(ctx) === true;
});

runTest('Handles message with forward_origin.type = "channel"', () => {
  const ctx = makeCtx({
    message: {
      text: '/solve https://github.com/owner/repo/issues/1',
      forward_origin: { type: 'channel', chat: { id: -100123 } },
    },
  });
  return isForwardedOrReply(ctx) === true;
});

// ===========================================================================
// Summary
// ===========================================================================
console.log('\n' + '='.repeat(80));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('='.repeat(80));

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
