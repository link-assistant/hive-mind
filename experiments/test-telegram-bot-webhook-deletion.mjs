#!/usr/bin/env node

/**
 * Test: Verify telegram bot deletes webhook before starting polling
 *
 * This test ensures that the bot properly deletes any existing webhook
 * before starting polling mode, which prevents the webhook/polling conflict
 * that causes the bot to not receive messages.
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

console.log('🧪 Testing telegram bot webhook deletion...\n');

// Test 1: Verify deleteWebhook is called before bot.launch()
test('bot.telegram.deleteWebhook() is called before bot.launch()', () => {
  if (!botCode.includes('bot.telegram.deleteWebhook(')) {
    throw new Error('bot.telegram.deleteWebhook() not found in code');
  }

  // Check that deleteWebhook appears before bot.launch
  const deleteWebhookIndex = botCode.indexOf('bot.telegram.deleteWebhook(');
  const launchIndex = botCode.indexOf('bot.launch(');

  if (deleteWebhookIndex === -1) {
    throw new Error('bot.telegram.deleteWebhook() not found');
  }
  if (launchIndex === -1) {
    throw new Error('bot.launch() not found');
  }
  if (deleteWebhookIndex > launchIndex) {
    throw new Error('bot.telegram.deleteWebhook() must be called before bot.launch()');
  }
});

// Test 2: Verify drop_pending_updates is set to true
test('deleteWebhook is called with drop_pending_updates: true', () => {
  const deleteWebhookMatch = botCode.match(/bot\.telegram\.deleteWebhook\(\{[^}]*drop_pending_updates:\s*true[^}]*\}\)/);
  if (!deleteWebhookMatch) {
    throw new Error('deleteWebhook must be called with { drop_pending_updates: true }');
  }
});

// Test 3: Verify promise chain structure
test('deleteWebhook is chained with bot.launch() using .then()', () => {
  const promiseChainPattern = /bot\.telegram\.deleteWebhook\([^)]*\)\s*\.then\(/;
  if (!promiseChainPattern.test(botCode)) {
    throw new Error('deleteWebhook must be chained with .then()');
  }
});

// Test 4: Verify bot.launch() is inside the promise chain
test('bot.launch() is called inside the .then() callback', () => {
  // Look for the pattern: deleteWebhook().then(() => { ... bot.launch() ... })
  const deleteWebhookIndex = botCode.indexOf('bot.telegram.deleteWebhook(');
  const launchIndex = botCode.indexOf('bot.launch(');

  // Extract the section between deleteWebhook and a reasonable distance
  const section = botCode.substring(deleteWebhookIndex, launchIndex + 100);

  if (!section.includes('.then(') || !section.includes('bot.launch(')) {
    throw new Error('bot.launch() must be inside the .then() callback after deleteWebhook()');
  }
});

// Test 5: Verify allowedUpdates configuration is still present
test('bot.launch() includes allowedUpdates: [\'message\']', () => {
  const allowedUpdatesPattern = /allowedUpdates:\s*\['message'\]/;
  if (!allowedUpdatesPattern.test(botCode)) {
    throw new Error('bot.launch() must include allowedUpdates: [\'message\']');
  }
});

// Test 6: Verify dropPendingUpdates configuration is still present
test('bot.launch() includes dropPendingUpdates: true', () => {
  const dropPendingPattern = /dropPendingUpdates:\s*true/;
  if (!dropPendingPattern.test(botCode)) {
    throw new Error('bot.launch() must include dropPendingUpdates: true');
  }
});

// Test 7: Verify error handling
test('Promise chain includes .catch() for error handling', () => {
  const deleteWebhookIndex = botCode.indexOf('bot.telegram.deleteWebhook(');
  const nextBotCommandIndex = botCode.indexOf('process.once', deleteWebhookIndex);
  const section = botCode.substring(deleteWebhookIndex, nextBotCommandIndex);

  if (!section.includes('.catch(')) {
    throw new Error('Promise chain must include .catch() for error handling');
  }
});

console.log('\n' + '='.repeat(50));
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log('='.repeat(50));

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
