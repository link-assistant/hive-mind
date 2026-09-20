#!/usr/bin/env node

/**
 * Test script for forum topic detection in Telegram bot
 * Tests the isForwardedOrReply function with forum topic messages
 */

// Mock message from a forum topic (like the one in issue #489)
const forumTopicMessage = {
  message_id: 858,
  from: { id: 123456, is_bot: false, first_name: 'User' },
  chat: {
    id: -1002975819706,
    title: 'Pull Request from Hive Mind',
    username: 'hive_mind_pull_requests',
    is_forum: true,
    type: 'supergroup',
  },
  date: 1760270650,
  message_thread_id: 857,
  reply_to_message: {
    message_id: 857,
    from: { id: 1339837872, is_bot: false, first_name: 'Konstantin' },
    chat: {
      id: -1002975819706,
      title: 'Pull Request from Hive Mind',
      username: 'hive_mind_pull_requests',
      is_forum: true,
      type: 'supergroup',
    },
    date: 1759480502,
    message_thread_id: 857,
    forum_topic_created: {
      name: 'Запросы на генерацию Pull Requests',
      icon_color: 16766590,
      icon_custom_emoji_id: '5309832892262654231',
    },
    is_topic_message: true,
  },
  text: '/solve https://github.com/owner/repo/issues/1',
  is_topic_message: true,
};

// Mock message that is an actual user reply (NOT a forum topic)
const actualReplyMessage = {
  message_id: 859,
  from: { id: 123456, is_bot: false, first_name: 'User' },
  chat: { id: -1002975819706, type: 'supergroup' },
  date: 1760270700,
  reply_to_message: {
    message_id: 858,
    from: { id: 789012, is_bot: false, first_name: 'OtherUser' },
    chat: { id: -1002975819706, type: 'supergroup' },
    date: 1760270650,
    text: 'Previous message from another user',
    // No forum_topic_created field
  },
  text: 'This is a reply to another user',
};

// Mock message that is a regular message (no reply)
const regularMessage = {
  message_id: 860,
  from: { id: 123456, is_bot: false, first_name: 'User' },
  chat: { id: -1002975819706, type: 'supergroup' },
  date: 1760270800,
  text: '/solve https://github.com/owner/repo/issues/2',
};

// isForwardedOrReply function (extracted from telegram-bot.mjs for testing)
function isForwardedOrReply(message, VERBOSE = true) {
  if (!message) {
    if (VERBOSE) {
      console.log('[VERBOSE] isForwardedOrReply: No message object');
    }
    return false;
  }

  if (VERBOSE) {
    console.log('[VERBOSE] isForwardedOrReply: Checking message fields...');
    console.log('[VERBOSE]   message.forward_origin:', JSON.stringify(message.forward_origin));
    console.log('[VERBOSE]   message.forward_origin?.type:', message.forward_origin?.type);
    console.log('[VERBOSE]   message.forward_from:', JSON.stringify(message.forward_from));
    console.log('[VERBOSE]   message.forward_from_chat:', JSON.stringify(message.forward_from_chat));
    console.log('[VERBOSE]   message.forward_from_message_id:', message.forward_from_message_id);
    console.log('[VERBOSE]   message.forward_signature:', message.forward_signature);
    console.log('[VERBOSE]   message.forward_sender_name:', message.forward_sender_name);
    console.log('[VERBOSE]   message.forward_date:', message.forward_date);
    console.log('[VERBOSE]   message.reply_to_message:', JSON.stringify(message.reply_to_message));
    console.log('[VERBOSE]   message.reply_to_message?.message_id:', message.reply_to_message?.message_id);
  }

  // Check if message is forwarded (has forward_origin field with actual content)
  if (message.forward_origin && message.forward_origin.type) {
    if (VERBOSE) {
      console.log('[VERBOSE] isForwardedOrReply: TRUE - forward_origin.type exists:', message.forward_origin.type);
    }
    return true;
  }
  // Also check old forwarding API fields for backward compatibility
  if (message.forward_from || message.forward_from_chat || message.forward_from_message_id || message.forward_signature || message.forward_sender_name || message.forward_date) {
    if (VERBOSE) {
      console.log('[VERBOSE] isForwardedOrReply: TRUE - old forwarding API field detected');
    }
    return true;
  }
  // Check if message is a reply (has reply_to_message field with actual content)
  // IMPORTANT: In forum groups, messages in topics have reply_to_message pointing to the topic's
  // first message (with forum_topic_created). These are NOT user replies, just part of the thread.
  if (message.reply_to_message && message.reply_to_message.message_id) {
    // If the reply_to_message is a forum topic creation message, this is NOT a user reply
    if (message.reply_to_message.forum_topic_created) {
      if (VERBOSE) {
        console.log('[VERBOSE] isForwardedOrReply: FALSE - reply is to forum topic creation, not user reply');
        console.log('[VERBOSE]   Forum topic:', message.reply_to_message.forum_topic_created);
      }
      // This is just a message in a forum topic, not a reply to another user
      // Allow the message to proceed
    } else {
      // This is an actual reply to another user's message
      if (VERBOSE) {
        console.log('[VERBOSE] isForwardedOrReply: TRUE - reply_to_message.message_id exists:', message.reply_to_message.message_id);
      }
      return true;
    }
  }

  if (VERBOSE) {
    console.log('[VERBOSE] isForwardedOrReply: FALSE - no forwarding or reply detected');
  }
  return false;
}

console.log('='.repeat(80));
console.log('Test 1: Forum Topic Message (should be FALSE - not filtered)');
console.log('='.repeat(80));
const result1 = isForwardedOrReply(forumTopicMessage);
console.log('Result:', result1);
console.log('Expected: false');
console.log('Status:', result1 === false ? '✅ PASS' : '❌ FAIL');
console.log();

console.log('='.repeat(80));
console.log('Test 2: Actual User Reply Message (should be TRUE - filtered)');
console.log('='.repeat(80));
const result2 = isForwardedOrReply(actualReplyMessage);
console.log('Result:', result2);
console.log('Expected: true');
console.log('Status:', result2 === true ? '✅ PASS' : '❌ FAIL');
console.log();

console.log('='.repeat(80));
console.log('Test 3: Regular Message (should be FALSE - not filtered)');
console.log('='.repeat(80));
const result3 = isForwardedOrReply(regularMessage);
console.log('Result:', result3);
console.log('Expected: false');
console.log('Status:', result3 === false ? '✅ PASS' : '❌ FAIL');
console.log();

console.log('='.repeat(80));
console.log('Summary');
console.log('='.repeat(80));
const allPassed = result1 === false && result2 === true && result3 === false;
console.log('All tests:', allPassed ? '✅ PASSED' : '❌ FAILED');

process.exit(allPassed ? 0 : 1);
