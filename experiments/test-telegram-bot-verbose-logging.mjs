#!/usr/bin/env node

/**
 * Experiment: Test telegram bot with verbose logging
 *
 * This script verifies that the --verbose flag is properly implemented
 * and provides comprehensive debugging output for diagnosing message reception issues.
 *
 * Testing approach:
 * 1. Verify --verbose CLI flag is recognized
 * 2. Check that VERBOSE constant is properly set
 * 3. Ensure verbose logging is added throughout the bot
 * 4. Validate that bot.on('message') listener is added in verbose mode
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const botFilePath = join(__dirname, '..', 'src', 'telegram-bot.mjs');
const botCode = readFileSync(botFilePath, 'utf-8');

let testsPassed = 0;
let testsFailed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`✅ ${description}`);
    testsPassed++;
  } catch (error) {
    console.error(`❌ ${description}`);
    console.error(`   ${error.message}`);
    testsFailed++;
  }
}

console.log('🧪 Testing telegram bot verbose logging implementation...\n');

// Test 1: Verify --verbose option is defined in yargs
test('--verbose option is defined in yargs config', () => {
  if (!botCode.includes("option('verbose'")) {
    throw new Error('verbose option not found in yargs config');
  }

  const verboseOptionMatch = botCode.match(/\.option\('verbose',\s*\{[^}]*\}/s);
  if (!verboseOptionMatch) {
    throw new Error('verbose option not properly configured');
  }

  const verboseOption = verboseOptionMatch[0];
  if (!verboseOption.includes("type: 'boolean'")) {
    throw new Error('verbose option should be boolean type');
  }
});

// Test 2: Verify VERBOSE constant is defined
test('VERBOSE constant is properly initialized', () => {
  if (!botCode.includes('const VERBOSE')) {
    throw new Error('VERBOSE constant not found');
  }

  const verboseConstMatch = botCode.match(
    /const VERBOSE\s*=\s*argv\.verbose\s*\|\|\s*argv\.v\s*\|\|\s*process\.env\.TELEGRAM_BOT_VERBOSE/
  );
  if (!verboseConstMatch) {
    throw new Error('VERBOSE constant not properly initialized from argv and env');
  }
});

// Test 3: Verify verbose logging in startup sequence
test('Verbose logging added to startup sequence', () => {
  if (!botCode.includes('[VERBOSE] Verbose logging enabled')) {
    throw new Error('Startup verbose logging not found');
  }

  if (!botCode.includes('[VERBOSE] Bot start time')) {
    throw new Error('Bot start time verbose logging not found');
  }
});

// Test 4: Verify bot.on('message') listener for verbose mode
test("bot.on('message') listener added for verbose debugging", () => {
  if (!botCode.includes("bot.on('message'")) {
    throw new Error("bot.on('message') listener not found");
  }

  const messageListenerMatch = botCode.match(/if\s*\(VERBOSE\)\s*\{[\s\S]*?bot\.on\('message'/);
  if (!messageListenerMatch) {
    throw new Error("bot.on('message') listener not wrapped in VERBOSE check");
  }
});

// Test 5: Verify verbose logging in command handlers
test('Verbose logging added to /solve command handler', () => {
  const solveCommandMatch = botCode.match(/bot\.command\('solve'[\s\S]*?executeStartScreen\('solve'/);
  if (!solveCommandMatch) {
    throw new Error('/solve command not found');
  }

  const solveCommand = solveCommandMatch[0];
  if (!solveCommand.includes('[VERBOSE]')) {
    throw new Error('Verbose logging not found in /solve command handler');
  }
});

test('Verbose logging added to /hive command handler', () => {
  const hiveCommandMatch = botCode.match(/bot\.command\('hive'[\s\S]*?executeStartScreen\('hive'/);
  if (!hiveCommandMatch) {
    throw new Error('/hive command not found');
  }

  const hiveCommand = hiveCommandMatch[0];
  if (!hiveCommand.includes('[VERBOSE]')) {
    throw new Error('Verbose logging not found in /hive command handler');
  }
});

test('Verbose logging added to /help command handler', () => {
  const helpCommandMatch = botCode.match(/bot\.command\('help'[\s\S]*?ctx\.reply\(message/);
  if (!helpCommandMatch) {
    throw new Error('/help command not found');
  }

  const helpCommand = helpCommandMatch[0];
  if (!helpCommand.includes('[VERBOSE]')) {
    throw new Error('Verbose logging not found in /help command handler');
  }
});

// Test 6: Verify verbose logging in webhook deletion and bot launch
test('Verbose logging added to webhook deletion sequence', () => {
  // Check for verbose logging before deleteWebhook
  if (!botCode.includes('[VERBOSE] Deleting webhook')) {
    throw new Error('Webhook deletion verbose logging not found');
  }

  // Check for verbose logging in bot launch sequence
  if (!botCode.includes('[VERBOSE] Launching bot')) {
    throw new Error('Bot launch verbose logging not found');
  }

  if (!botCode.includes('[VERBOSE] Polling is active')) {
    throw new Error('Polling active verbose logging not found');
  }
});

// Test 7: Verify all VERBOSE checks use the constant, not env var directly
test('All VERBOSE checks use VERBOSE constant instead of process.env', () => {
  // Find all process.env.TELEGRAM_BOT_VERBOSE references
  const envVarMatches = botCode.match(/process\.env\.TELEGRAM_BOT_VERBOSE/g);

  // Should only appear once in the VERBOSE constant definition
  if (envVarMatches && envVarMatches.length > 1) {
    throw new Error(
      `Found ${envVarMatches.length} references to process.env.TELEGRAM_BOT_VERBOSE, should only be 1 (in VERBOSE constant definition)`
    );
  }
});

// Test 8: Verify detailed logging in isForwardedOrReply function
test('Detailed verbose logging added to isForwardedOrReply function', () => {
  // Check for field inspection logging
  if (!botCode.includes('[VERBOSE] isForwardedOrReply: Checking message fields')) {
    throw new Error('Field checking verbose logging not found in isForwardedOrReply');
  }

  // Check for specific field logging
  if (!botCode.includes('message.forward_origin')) {
    throw new Error('forward_origin logging not found in isForwardedOrReply');
  }

  // Check for detailed trigger logging
  if (!botCode.includes('Triggered by:')) {
    throw new Error('Detailed trigger logging not found in isForwardedOrReply');
  }

  // Check for result logging
  if (
    !botCode.includes('[VERBOSE] isForwardedOrReply: FALSE') ||
    !botCode.includes('[VERBOSE] isForwardedOrReply: TRUE')
  ) {
    throw new Error('Result logging not found in isForwardedOrReply');
  }
});

console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed`);

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed. Please review the implementation.');
  process.exit(1);
}

console.log('\n✅ All tests passed! Verbose logging is properly implemented.');
console.log('\n📋 Summary of changes:');
console.log('  ✓ Added --verbose CLI flag to yargs config');
console.log('  ✓ Added VERBOSE constant based on argv and env var');
console.log("  ✓ Added bot.on('message') listener for debugging");
console.log('  ✓ Added verbose logging throughout command handlers');
console.log('  ✓ Added verbose logging to webhook deletion and bot launch');
console.log('  ✓ Added detailed field inspection in isForwardedOrReply function');
console.log('  ✓ All verbose checks use VERBOSE constant consistently');
console.log('\n🎯 Usage:');
console.log('  hive-telegram-bot --token TOKEN --verbose');
console.log('  hive-telegram-bot --token TOKEN -v');
console.log('  TELEGRAM_BOT_VERBOSE=true hive-telegram-bot --token TOKEN');
console.log('\n🔍 The detailed isForwardedOrReply logging will show:');
console.log('  • All message fields related to forwarding and replies');
console.log('  • Which specific field triggered the filter');
console.log('  • The exact value causing false positives');
