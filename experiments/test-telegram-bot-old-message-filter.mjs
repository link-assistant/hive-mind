#!/usr/bin/env node

/**
 * Test: Telegram bot old message filtering
 *
 * Verifies that the bot properly ignores messages sent before it started
 * This prevents processing old/pending messages from before current bot instance startup
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Testing telegram bot old message filtering...\n');

try {
  // Read the telegram bot source
  const botPath = join(__dirname, '..', 'src', 'telegram-bot.mjs');
  const content = await readFile(botPath, 'utf-8');

  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Check for BOT_START_TIME constant
  console.log('Test 1: BOT_START_TIME constant exists');
  if (content.includes('const BOT_START_TIME = Math.floor(Date.now() / 1000)')) {
    console.log('✅ PASSED: BOT_START_TIME constant is defined\n');
    testsPassed++;
  } else {
    console.log('❌ FAILED: BOT_START_TIME constant not found\n');
    testsFailed++;
  }

  // Test 2: Check for isOldMessage function
  console.log('Test 2: isOldMessage function exists');
  if (content.includes('function isOldMessage(ctx)') &&
      content.includes('messageDate < BOT_START_TIME')) {
    console.log('✅ PASSED: isOldMessage function is defined with proper logic\n');
    testsPassed++;
  } else {
    console.log('❌ FAILED: isOldMessage function not found or incorrect\n');
    testsFailed++;
  }

  // Test 3: Check that help command uses isOldMessage
  console.log('Test 3: help command filters old messages');
  const helpStart = content.indexOf("bot.command('help'");
  const helpEnd = content.indexOf("bot.command('solve'", helpStart);
  const helpCommand = content.substring(helpStart, helpEnd);
  if (helpCommand.includes('if (isOldMessage(ctx))')) {
    console.log('✅ PASSED: help command filters old messages\n');
    testsPassed++;
  } else {
    console.log('❌ FAILED: help command does not filter old messages\n');
    testsFailed++;
  }

  // Test 4: Check that solve command uses isOldMessage
  console.log('Test 4: solve command filters old messages');
  const solveStart = content.indexOf("bot.command('solve'");
  const solveEnd = content.indexOf("bot.command('hive'", solveStart);
  const solveCommand = content.substring(solveStart, solveEnd);
  if (solveCommand.includes('if (isOldMessage(ctx))')) {
    console.log('✅ PASSED: solve command filters old messages\n');
    testsPassed++;
  } else {
    console.log('❌ FAILED: solve command does not filter old messages\n');
    testsFailed++;
  }

  // Test 5: Check that hive command uses isOldMessage
  console.log('Test 5: hive command filters old messages');
  const hiveStart = content.indexOf("bot.command('hive'");
  const hiveEnd = content.indexOf("bot.catch(", hiveStart);
  const hiveCommand = content.substring(hiveStart, hiveEnd);
  if (hiveCommand.includes('if (isOldMessage(ctx))')) {
    console.log('✅ PASSED: hive command filters old messages\n');
    testsPassed++;
  } else {
    console.log('❌ FAILED: hive command does not filter old messages\n');
    testsFailed++;
  }

  // Test 6: Check for allowedUpdates in bot.launch()
  console.log('Test 6: bot.launch() configured with allowedUpdates');
  if (content.includes("allowedUpdates: ['message']")) {
    console.log('✅ PASSED: bot.launch() has allowedUpdates configuration\n');
    testsPassed++;
  } else {
    console.log('❌ FAILED: bot.launch() missing allowedUpdates configuration\n');
    testsFailed++;
  }

  // Test 7: Check for dropPendingUpdates in bot.launch()
  console.log('Test 7: bot.launch() configured with dropPendingUpdates');
  if (content.includes('dropPendingUpdates: true')) {
    console.log('✅ PASSED: bot.launch() has dropPendingUpdates configuration\n');
    testsPassed++;
  } else {
    console.log('❌ FAILED: bot.launch() missing dropPendingUpdates configuration\n');
    testsFailed++;
  }

  // Summary
  console.log('═'.repeat(60));
  console.log(`Test Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('═'.repeat(60));

  if (testsFailed > 0) {
    process.exit(1);
  }

  console.log('\n✅ All tests passed! The bot is properly configured to:');
  console.log('   1. Track its startup time');
  console.log('   2. Ignore messages sent before it started');
  console.log('   3. Only receive message updates from Telegram');
  console.log('   4. Drop pending updates on startup');
  console.log('\nThis ensures the bot only processes new messages sent after');
  console.log('the current bot instance started, preventing old command execution.');

} catch (error) {
  console.error('❌ Error during testing:', error.message);
  process.exit(1);
}
