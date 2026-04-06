#!/usr/bin/env node

/**
 * Test suite for session finish message update (issue #1530)
 *
 * Verifies that:
 * 1. start-screen is called with --auto-terminate so screen sessions
 *    terminate when the command finishes, enabling completion detection
 * 2. The misleading "You will receive a notification" text is not present
 * 3. Session monitoring logs verbose output for debugging
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1530
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Read source files for static analysis
const telegramBotSource = readFileSync(join(__dirname, '..', 'src', 'telegram-bot.mjs'), 'utf-8');
const sessionMonitorSource = readFileSync(join(__dirname, '..', 'src', 'session-monitor.lib.mjs'), 'utf-8');

console.log('Testing session finish message update (issue #1530)');
console.log('='.repeat(60));

// Test 1: --auto-terminate flag is passed to start-screen
runTest('executeWithCommand passes --auto-terminate to start-screen', () => {
  // The executeWithCommand function should include --auto-terminate in the allArgs array
  // so that screen sessions terminate when the command finishes
  assert(telegramBotSource.includes("'--auto-terminate'"), "executeWithCommand should pass '--auto-terminate' flag");

  // Verify it's in the allArgs construction
  assert(telegramBotSource.includes("const allArgs = ['--auto-terminate', command, ...args]"), "allArgs should start with '--auto-terminate' before command and args");
});

// Test 2: No misleading "notification" text in messages
runTest('no misleading notification promise in Telegram message', () => {
  assert(!telegramBotSource.includes('You will receive a notification when the session finishes'), 'Should not contain "You will receive a notification when the session finishes" text');
});

// Test 3: Session monitoring has verbose logging for status checks
runTest('session monitor has verbose logging for screen mode checks', () => {
  assert(sessionMonitorSource.includes('checking screen session existence'), 'Should log when checking screen session existence in verbose mode');
});

runTest('session monitor has verbose logging for isolation mode checks', () => {
  assert(sessionMonitorSource.includes('checking isolation status'), 'Should log when checking isolation status in verbose mode');
});

runTest('session monitor has verbose logging for stillRunning result', () => {
  assert(sessionMonitorSource.includes('stillRunning='), 'Should log stillRunning result in verbose mode');
});

runTest('session monitor has verbose logging for completion notification', () => {
  assert(sessionMonitorSource.includes('sending completion notification'), 'Should log when sending completion notification in verbose mode');
});

// Test 4: Session monitoring still updates message on completion
runTest('session monitor updates message via editMessageText on completion', () => {
  assert(sessionMonitorSource.includes('editMessageText'), 'Should use editMessageText to update the original message on completion');
});

runTest('session monitor sends new message when no messageId available', () => {
  assert(sessionMonitorSource.includes('sendMessage'), 'Should use sendMessage when messageId is not available');
});

// Test 5: Session monitor correctly checks exit code for status
runTest('session monitor shows exit code in failure message', () => {
  assert(sessionMonitorSource.includes('exit code:'), 'Should show exit code in failure status message');
});

// Test 6: Verify the success message still contains session info
runTest('success message still contains session info', () => {
  // The success message should have session name and info block
  assert(telegramBotSource.includes('command started successfully!'), 'Should contain "command started successfully!" in success message');
  assert(telegramBotSource.includes('Session:'), 'Should contain session info in success message');
});

// Results
console.log('\n' + '='.repeat(60));
console.log(`Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total`);
console.log('='.repeat(60));

if (testsFailed > 0) {
  console.error(`\n❌ ${testsFailed} test(s) failed!`);
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
