/**
 * Shared stubs/fixtures for /stop dispatcher tests
 * (used by tests/test-issue-524-stop-uuid.mjs and
 * tests/test-issue-1783-stop-improvements.mjs).
 *
 * @hive-mind-test-skip
 */

export function makeAsserts() {
  const counts = { passed: 0, failed: 0 };
  const assert = (cond, name, details) => {
    if (cond) {
      console.log(`  ✅ ${name}`);
      counts.passed++;
    } else {
      console.log(`  ❌ ${name}`);
      if (details !== undefined) console.log(`     ${JSON.stringify(details)}`);
      counts.failed++;
    }
  };
  const assertEqual = (actual, expected, name) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    if (pass) {
      console.log(`  ✅ ${name}`);
      counts.passed++;
    } else {
      console.log(`  ❌ ${name}`);
      console.log(`     expected: ${JSON.stringify(expected)}`);
      console.log(`     actual:   ${JSON.stringify(actual)}`);
      counts.failed++;
    }
  };
  return { counts, assert, assertEqual };
}

export function makeStubBot() {
  const handlers = {};
  return {
    handlers,
    command(name, fn) {
      handlers[name] = fn;
    },
    on() {},
  };
}

export function makeStopCtx({ text = '/stop', repliedTo = null, chatType = 'private', chatId = -1001, fromId = 42, fromUsername = 'tester' } = {}) {
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
    reply: async (replyText, opts) => {
      const r = { chat: { id: chatId }, message_id: 100 + replies.length, text: replyText, opts };
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

export function makeStopOptions(overrides = {}) {
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
