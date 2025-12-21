#!/usr/bin/env node

/**
 * Test script to understand Telegram message structure
 * This helps diagnose why isForwardedOrReply is incorrectly identifying messages
 */

// Simulate different Telegram message objects to understand the structure

// Normal message (not forwarded, not reply)
const normalMessage = {
  message_id: 123,
  date: 1760265652,
  text: '/solve https://github.com/owner/repo/issues/1',
  chat: { id: -1002975819706, type: 'supergroup' },
  from: { id: 12345, username: 'testuser' }
};

// Reply message (replying to another message)
const replyMessage = {
  message_id: 124,
  date: 1760265653,
  text: '/solve https://github.com/owner/repo/issues/2',
  chat: { id: -1002975819706, type: 'supergroup' },
  from: { id: 12345, username: 'testuser' },
  reply_to_message: {
    message_id: 123,
    date: 1760265650,
    text: 'Some previous message',
    from: { id: 67890, username: 'otheruser' }
  }
};

// Forwarded message (new API - forward_origin)
const forwardedMessageNew = {
  message_id: 125,
  date: 1760265654,
  text: '/solve https://github.com/owner/repo/issues/3',
  chat: { id: -1002975819706, type: 'supergroup' },
  from: { id: 12345, username: 'testuser' },
  forward_origin: {
    type: 'user',
    sender_user: { id: 99999, username: 'originaluser' },
    date: 1760265640
  }
};

// Old forwarded message format (backward compatibility - might still exist)
const forwardedMessageOld = {
  message_id: 126,
  date: 1760265655,
  text: '/solve https://github.com/owner/repo/issues/4',
  chat: { id: -1002975819706, type: 'supergroup' },
  from: { id: 12345, username: 'testuser' },
  forward_from: { id: 99999, username: 'originaluser' },
  forward_date: 1760265640
};

// Message that is BOTH a reply AND forwarded
const replyAndForwarded = {
  message_id: 127,
  date: 1760265656,
  text: '/solve https://github.com/owner/repo/issues/5',
  chat: { id: -1002975819706, type: 'supergroup' },
  from: { id: 12345, username: 'testuser' },
  reply_to_message: {
    message_id: 123,
    date: 1760265650,
    text: 'Some previous message',
    from: { id: 67890, username: 'otheruser' }
  },
  forward_origin: {
    type: 'user',
    sender_user: { id: 99999, username: 'originaluser' },
    date: 1760265640
  }
};

function isForwardedOrReply_CURRENT(message) {
  if (!message) {
    return false;
  }
  // Check if message is forwarded (has forward_origin field)
  if (message.forward_origin) {
    return true;
  }
  // Check if message is a reply (has reply_to_message field)
  if (message.reply_to_message) {
    return true;
  }
  return false;
}

function isForwardedOrReply_FIXED(message) {
  if (!message) {
    return false;
  }
  // Check if message is forwarded - NEW API (forward_origin)
  if (message.forward_origin) {
    return true;
  }
  // Check if message is forwarded - OLD API (forward_from, forward_from_chat, etc.)
  if (
    message.forward_from ||
    message.forward_from_chat ||
    message.forward_from_message_id ||
    message.forward_signature ||
    message.forward_sender_name ||
    message.forward_date
  ) {
    return true;
  }
  // Check if message is a reply (has reply_to_message field)
  if (message.reply_to_message) {
    return true;
  }
  return false;
}

console.log('Testing different Telegram message types:\n');

console.log('1. Normal message:');
console.log('   Current implementation:', isForwardedOrReply_CURRENT(normalMessage));
console.log('   Fixed implementation:', isForwardedOrReply_FIXED(normalMessage));
console.log('   Expected: false\n');

console.log('2. Reply message:');
console.log('   Current implementation:', isForwardedOrReply_CURRENT(replyMessage));
console.log('   Fixed implementation:', isForwardedOrReply_FIXED(replyMessage));
console.log('   Expected: true\n');

console.log('3. Forwarded message (new API):');
console.log('   Current implementation:', isForwardedOrReply_CURRENT(forwardedMessageNew));
console.log('   Fixed implementation:', isForwardedOrReply_FIXED(forwardedMessageNew));
console.log('   Expected: true\n');

console.log('4. Forwarded message (old API):');
console.log('   Current implementation:', isForwardedOrReply_CURRENT(forwardedMessageOld));
console.log('   Fixed implementation:', isForwardedOrReply_FIXED(forwardedMessageOld));
console.log('   Expected: true');
console.log('   ⚠️  Current implementation MISSES this case!\n');

console.log('5. Reply + Forwarded:');
console.log('   Current implementation:', isForwardedOrReply_CURRENT(replyAndForwarded));
console.log('   Fixed implementation:', isForwardedOrReply_FIXED(replyAndForwarded));
console.log('   Expected: true\n');

console.log('\n📊 Analysis:');
console.log('The current implementation only checks for:');
console.log('  - forward_origin (new API)');
console.log('  - reply_to_message');
console.log('\nBut it MISSES old forwarding fields like:');
console.log('  - forward_from');
console.log('  - forward_from_chat');
console.log('  - forward_date');
console.log('  - etc.');
console.log('\nThis could cause false positives if Telegram includes');
console.log('these fields in certain message types or contexts.');
