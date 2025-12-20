#!/usr/bin/env node

/**
 * Test for forwarded and reply message filtering in telegram bot
 * This test verifies that the bot ignores commands from forwarded messages
 * and reply messages to prevent unintended executions
 */

// Mock isForwardedOrReply function (same as in telegram-bot.mjs)
function isForwardedOrReply(ctx) {
  const message = ctx.message;
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

// Test cases
const tests = [
  {
    name: 'Normal direct message (should not be filtered)',
    ctx: {
      message: {
        text: '/solve https://github.com/test/repo/issues/1'
      }
    },
    expected: false
  },
  {
    name: 'Forwarded message with forward_origin (should be filtered)',
    ctx: {
      message: {
        text: '/solve https://github.com/test/repo/issues/1',
        forward_origin: {
          type: 'user',
          sender_user: {
            id: 12345,
            is_bot: false,
            first_name: 'Test'
          },
          date: 1234567890
        }
      }
    },
    expected: true
  },
  {
    name: 'Reply message (should be filtered)',
    ctx: {
      message: {
        text: '/solve https://github.com/test/repo/issues/1',
        reply_to_message: {
          message_id: 123,
          from: {
            id: 12345,
            is_bot: false,
            first_name: 'Test'
          },
          text: 'Original message'
        }
      }
    },
    expected: true
  },
  {
    name: 'Message with both forward and reply (should be filtered)',
    ctx: {
      message: {
        text: '/solve https://github.com/test/repo/issues/1',
        forward_origin: {
          type: 'user',
          sender_user: {
            id: 12345,
            is_bot: false,
            first_name: 'Test'
          },
          date: 1234567890
        },
        reply_to_message: {
          message_id: 123,
          from: {
            id: 12345,
            is_bot: false,
            first_name: 'Test'
          },
          text: 'Original message'
        }
      }
    },
    expected: true
  },
  {
    name: 'Empty context (should not be filtered)',
    ctx: {},
    expected: false
  },
  {
    name: 'Context with no message (should not be filtered)',
    ctx: {
      message: null
    },
    expected: false
  },
  {
    name: 'Forwarded from hidden user (should be filtered)',
    ctx: {
      message: {
        text: '/hive https://github.com/test/repo',
        forward_origin: {
          type: 'hidden_user',
          sender_user_name: 'Hidden User',
          date: 1234567890
        }
      }
    },
    expected: true
  },
  {
    name: 'Forwarded from channel (should be filtered)',
    ctx: {
      message: {
        text: '/help',
        forward_origin: {
          type: 'channel',
          chat: {
            id: -1001234567890,
            title: 'Test Channel',
            type: 'channel'
          },
          message_id: 456,
          date: 1234567890
        }
      }
    },
    expected: true
  }
];

let passed = 0;
let failed = 0;

console.log('Running telegram forward/reply filter tests...\n');

for (const test of tests) {
  const result = isForwardedOrReply(test.ctx);
  const success = result === test.expected;

  if (success) {
    console.log(`✅ PASS: ${test.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${test.name}`);
    console.log(`  Expected: ${test.expected}`);
    console.log(`  Got:      ${result}`);
    console.log(`  Context:  ${JSON.stringify(test.ctx, null, 2)}`);
    failed++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Total: ${tests.length} tests`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`${'='.repeat(50)}`);

process.exit(failed > 0 ? 1 : 0);
