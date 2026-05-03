#!/usr/bin/env node

/**
 * Test suite for TELEGRAM_ALLOWED_TOPICS feature (issue #1100)
 * Tests parseLinks/formatLinks in lino.lib.mjs and topic authorization logic
 */

const linoModule = await import('../src/lino.lib.mjs');
const { lino } = linoModule;

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${message}\nExpected: ${expectedStr}\nActual: ${actualStr}`);
  }
}

// ===== parseLinks tests =====

console.log('\n📋 parseLinks Tests\n');

runTest('parseLinks with empty input', () => {
  assertEqual(lino.parseLinks(''), []);
  assertEqual(lino.parseLinks(null), []);
  assertEqual(lino.parseLinks(undefined), []);
});

runTest('parseLinks with single flat pair', () => {
  const result = lino.parseLinks('(\n  -1002975819706 857\n)');
  assertEqual(result, [{ source: -1002975819706, target: 857 }]);
});

runTest('parseLinks with multiple flat pairs', () => {
  const result = lino.parseLinks('(\n  -1002975819706 857\n  -1001234567890 456\n)');
  assertEqual(result, [
    { source: -1002975819706, target: 857 },
    { source: -1001234567890, target: 456 },
  ]);
});

runTest('parseLinks with nested pair format', () => {
  const result = lino.parseLinks('(\n  (-1002975819706 857)\n  (-1001234567890 456)\n)');
  assertEqual(result, [
    { source: -1002975819706, target: 857 },
    { source: -1001234567890, target: 456 },
  ]);
});

runTest('parseLinks with single nested pair', () => {
  const result = lino.parseLinks('(-1002975819706 857)');
  assertEqual(result.length, 1);
  assertEqual(result[0].source, -1002975819706);
  assertEqual(result[0].target, 857);
});

// ===== formatLinks tests =====

console.log('\n📋 formatLinks Tests\n');

runTest('formatLinks with empty input', () => {
  assertEqual(lino.formatLinks([]), '()');
  assertEqual(lino.formatLinks(null), '()');
  assertEqual(lino.formatLinks(undefined), '()');
});

runTest('formatLinks with single pair', () => {
  const result = lino.formatLinks([{ source: -1002975819706, target: 857 }]);
  assertEqual(result, '(\n  -1002975819706 857\n)');
});

runTest('formatLinks with multiple pairs', () => {
  const result = lino.formatLinks([
    { source: -1002975819706, target: 857 },
    { source: -1001234567890, target: 456 },
  ]);
  assertEqual(result, '(\n  -1002975819706 857\n  -1001234567890 456\n)');
});

runTest('parseLinks -> formatLinks roundtrip', () => {
  const input = '(\n  -1002975819706 857\n  -1001234567890 456\n)';
  const parsed = lino.parseLinks(input);
  const formatted = lino.formatLinks(parsed);
  assertEqual(formatted, input);
});

// ===== Topic authorization logic tests =====

console.log('\n📋 Topic Authorization Logic Tests\n');

// Simulate the authorization logic from telegram-bot.mjs
function createIsTopicAuthorized(allowedChats, allowedTopics) {
  function isChatAuthorized(chatId) {
    if (!allowedChats) return true;
    return allowedChats.includes(chatId);
  }
  return function isTopicAuthorized(ctx) {
    if (isChatAuthorized(ctx.chat?.id)) return true;
    if (!allowedTopics || allowedTopics.length === 0) return false;
    const chatId = ctx.chat?.id;
    const topicId = ctx.message?.message_thread_id;
    return allowedTopics.some(pair => pair.source === chatId && pair.target === topicId);
  };
}

runTest('no restrictions - all authorized', () => {
  const isAuth = createIsTopicAuthorized(null, null);
  const ctx = { chat: { id: 123 }, message: { message_thread_id: 456 } };
  assertEqual(isAuth(ctx), true);
});

runTest('chat in allowedChats - all topics allowed', () => {
  const isAuth = createIsTopicAuthorized([123], null);
  const ctx = { chat: { id: 123 }, message: { message_thread_id: 456 } };
  assertEqual(isAuth(ctx), true);
});

runTest('chat NOT in allowedChats, no topics configured - denied', () => {
  const isAuth = createIsTopicAuthorized([999], null);
  const ctx = { chat: { id: 123 }, message: { message_thread_id: 456 } };
  assertEqual(isAuth(ctx), false);
});

runTest('chat NOT in allowedChats, topic allowed - authorized', () => {
  const topics = [{ source: 123, target: 456 }];
  const isAuth = createIsTopicAuthorized([999], topics);
  const ctx = { chat: { id: 123 }, message: { message_thread_id: 456 } };
  assertEqual(isAuth(ctx), true);
});

runTest('chat NOT in allowedChats, wrong topic - denied', () => {
  const topics = [{ source: 123, target: 789 }];
  const isAuth = createIsTopicAuthorized([999], topics);
  const ctx = { chat: { id: 123 }, message: { message_thread_id: 456 } };
  assertEqual(isAuth(ctx), false);
});

runTest('topic authorized with parsed links notation', () => {
  const topics = lino.parseLinks('(\n  -1002975819706 857\n)');
  const isAuth = createIsTopicAuthorized([], topics);
  const ctx = { chat: { id: -1002975819706 }, message: { message_thread_id: 857 } };
  assertEqual(isAuth(ctx), true);
});

runTest('topic not authorized - different chat', () => {
  const topics = lino.parseLinks('(\n  -1002975819706 857\n)');
  const isAuth = createIsTopicAuthorized([], topics);
  const ctx = { chat: { id: -9999999 }, message: { message_thread_id: 857 } };
  assertEqual(isAuth(ctx), false);
});

runTest('chat-level auth overrides topic-level', () => {
  const topics = [{ source: 123, target: 789 }]; // topic 456 not listed
  const isAuth = createIsTopicAuthorized([123], topics); // but chat 123 is allowed
  const ctx = { chat: { id: 123 }, message: { message_thread_id: 456 } };
  assertEqual(isAuth(ctx), true); // chat-level wins
});

runTest('no message_thread_id (non-topic message) with topic restrictions', () => {
  const topics = [{ source: 123, target: 456 }];
  const isAuth = createIsTopicAuthorized([], topics);
  const ctx = { chat: { id: 123 }, message: {} };
  assertEqual(isAuth(ctx), false); // no topic ID, can't match
});

runTest('backward compatibility - only allowedChats, no topics', () => {
  const isAuth = createIsTopicAuthorized([123, 456], null);
  const ctxAllowed = { chat: { id: 123 }, message: {} };
  const ctxDenied = { chat: { id: 999 }, message: {} };
  assertEqual(isAuth(ctxAllowed), true);
  assertEqual(isAuth(ctxDenied), false);
});

// ===== Summary =====

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log(`${'='.repeat(50)}\n`);

process.exit(testsFailed > 0 ? 1 : 0);
