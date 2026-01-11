#!/usr/bin/env node
/**
 * Test script for the /start and /stop command module
 *
 * This script tests the core functionality of the start-stop command module
 * without requiring a Telegram bot connection.
 *
 * Usage: node experiments/test-start-stop-command.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1081
 */

import { isChatStopped, getChatStopInfo, setChatStopped, getStoppedChats } from '../src/telegram-start-stop-command.lib.mjs';

console.log('🧪 Testing /start and /stop command module\n');

// Test 1: Initial state - no chats stopped
console.log('Test 1: Initial state');
const testChatId1 = -1001234567890;
const testChatId2 = -1009876543210;

console.log(`  Chat ${testChatId1} stopped: ${isChatStopped(testChatId1)}`);
console.log(`  Expected: false`);
console.assert(isChatStopped(testChatId1) === false, 'Chat should not be stopped initially');
console.log('  ✅ Passed\n');

// Test 2: Stop a chat
console.log('Test 2: Stop a chat');
const testUser = { id: 123456789, username: 'testowner', first_name: 'Test' };
setChatStopped(testChatId1, true, testUser);
console.log(`  Chat ${testChatId1} stopped: ${isChatStopped(testChatId1)}`);
console.log(`  Expected: true`);
console.assert(isChatStopped(testChatId1) === true, 'Chat should be stopped after setChatStopped(true)');
console.log('  ✅ Passed\n');

// Test 3: Get stop info
console.log('Test 3: Get stop info');
const stopInfo = getChatStopInfo(testChatId1);
console.log(`  Stop info:`, JSON.stringify(stopInfo, null, 2));
console.assert(stopInfo !== null, 'Stop info should not be null');
console.assert(stopInfo.stoppedBy.id === testUser.id, 'Stopped by user ID should match');
console.assert(stopInfo.stoppedBy.username === testUser.username, 'Stopped by username should match');
console.assert(stopInfo.stoppedAt instanceof Date, 'stoppedAt should be a Date');
console.log('  ✅ Passed\n');

// Test 4: Other chat is not affected
console.log('Test 4: Other chat is not affected');
console.log(`  Chat ${testChatId2} stopped: ${isChatStopped(testChatId2)}`);
console.log(`  Expected: false`);
console.assert(isChatStopped(testChatId2) === false, 'Other chat should not be stopped');
console.log('  ✅ Passed\n');

// Test 5: Get all stopped chats
console.log('Test 5: Get all stopped chats');
const stoppedChats = getStoppedChats();
console.log(`  Stopped chats count: ${stoppedChats.size}`);
console.log(`  Has chat ${testChatId1}: ${stoppedChats.has(testChatId1)}`);
console.assert(stoppedChats.size === 1, 'Should have exactly 1 stopped chat');
console.assert(stoppedChats.has(testChatId1), 'Stopped chats should contain testChatId1');
console.log('  ✅ Passed\n');

// Test 6: Start (un-stop) a chat
console.log('Test 6: Start (un-stop) a chat');
setChatStopped(testChatId1, false);
console.log(`  Chat ${testChatId1} stopped: ${isChatStopped(testChatId1)}`);
console.log(`  Expected: false`);
console.assert(isChatStopped(testChatId1) === false, 'Chat should not be stopped after setChatStopped(false)');
console.log('  ✅ Passed\n');

// Test 7: Stop info is null after starting
console.log('Test 7: Stop info is null after starting');
const stopInfoAfterStart = getChatStopInfo(testChatId1);
console.log(`  Stop info: ${stopInfoAfterStart}`);
console.log(`  Expected: null`);
console.assert(stopInfoAfterStart === null, 'Stop info should be null after starting');
console.log('  ✅ Passed\n');

// Test 8: Stopped chats map is empty after starting all
console.log('Test 8: Stopped chats map is empty');
const stoppedChatsAfter = getStoppedChats();
console.log(`  Stopped chats count: ${stoppedChatsAfter.size}`);
console.assert(stoppedChatsAfter.size === 0, 'Should have 0 stopped chats');
console.log('  ✅ Passed\n');

// Test 9: Multiple chats can be stopped
console.log('Test 9: Multiple chats can be stopped');
setChatStopped(testChatId1, true, testUser);
setChatStopped(testChatId2, true, { id: 987654321, username: 'anotherowner', first_name: 'Another' });
console.log(`  Chat ${testChatId1} stopped: ${isChatStopped(testChatId1)}`);
console.log(`  Chat ${testChatId2} stopped: ${isChatStopped(testChatId2)}`);
console.log(`  Stopped chats count: ${getStoppedChats().size}`);
console.assert(isChatStopped(testChatId1) === true, 'Chat 1 should be stopped');
console.assert(isChatStopped(testChatId2) === true, 'Chat 2 should be stopped');
console.assert(getStoppedChats().size === 2, 'Should have 2 stopped chats');
console.log('  ✅ Passed\n');

// Cleanup
setChatStopped(testChatId1, false);
setChatStopped(testChatId2, false);

console.log('✅ All tests passed!');
