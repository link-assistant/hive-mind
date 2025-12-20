#!/usr/bin/env node
/**
 * Test script to verify endWorkSession correctly skips posting comment when logs are attached
 * This test validates the fix for issue #665 (duplicate finishing status comments)
 */

// Mock the global object
global.owner = 'test-owner';
global.repo = 'test-repo';

// Mock command-stream $ function
let commandLog = [];
const mockDollar = (strings, ...values) => {
  const command = strings.reduce((acc, str, i) => {
    return acc + str + (values[i] || '');
  }, '');

  commandLog.push(command);

  // Mock response
  return Promise.resolve({
    code: 0,
    stdout: { toString: () => 'true' },
    stderr: { toString: () => '' }
  });
};

// Mock log function
let logMessages = [];
const mockLog = async (message, options = {}) => {
  logMessages.push({ message, options });
  console.log(message);
};

// Mock formatAligned function
const mockFormatAligned = (icon, label, value, indent = 0) => {
  const indentation = '  '.repeat(indent);
  return `${indentation}${icon} ${label} ${value}`;
};

// Test cases
async function runTests() {
  console.log('\n=== Testing endWorkSession function ===\n');

  // Import the function
  const sessionModule = await import('../src/solve.session.lib.mjs');
  const { endWorkSession } = sessionModule;

  // Test 1: With logsAttached = true (should skip comment)
  console.log('Test 1: logsAttached = true (should skip end comment)');
  commandLog = [];
  logMessages = [];

  await endWorkSession({
    isContinueMode: true,
    prNumber: 123,
    argv: { watch: true },
    log: mockLog,
    formatAligned: mockFormatAligned,
    $: mockDollar,
    logsAttached: true
  });

  const hasCommentCommand = commandLog.some(cmd => cmd.includes('gh pr comment'));
  const hasSkipMessage = logMessages.some(log =>
    log.message.includes('Skipping') && log.message.includes('logs already attached')
  );

  console.log('  Commands executed:', commandLog.length);
  console.log('  Has comment command:', hasCommentCommand);
  console.log('  Has skip message:', hasSkipMessage);
  console.log('  Result:', !hasCommentCommand && hasSkipMessage ? '✅ PASS' : '❌ FAIL');

  // Test 2: With logsAttached = false (should post comment)
  console.log('\nTest 2: logsAttached = false (should post end comment)');
  commandLog = [];
  logMessages = [];

  await endWorkSession({
    isContinueMode: true,
    prNumber: 123,
    argv: { watch: true },
    log: mockLog,
    formatAligned: mockFormatAligned,
    $: mockDollar,
    logsAttached: false
  });

  const hasCommentCommand2 = commandLog.some(cmd => cmd.includes('gh pr comment'));
  const hasPostedMessage = logMessages.some(log =>
    log.message.includes('Posted') && log.message.includes('Work session end comment')
  );

  console.log('  Commands executed:', commandLog.length);
  console.log('  Has comment command:', hasCommentCommand2);
  console.log('  Has posted message:', hasPostedMessage);
  console.log('  Result:', hasCommentCommand2 && hasPostedMessage ? '✅ PASS' : '❌ FAIL');

  // Test 3: Default parameter (logsAttached not provided, should default to false)
  console.log('\nTest 3: logsAttached not provided (should default to false and post comment)');
  commandLog = [];
  logMessages = [];

  await endWorkSession({
    isContinueMode: true,
    prNumber: 123,
    argv: { watch: true },
    log: mockLog,
    formatAligned: mockFormatAligned,
    $: mockDollar
    // logsAttached not provided - should default to false
  });

  const hasCommentCommand3 = commandLog.some(cmd => cmd.includes('gh pr comment'));
  const hasPostedMessage3 = logMessages.some(log =>
    log.message.includes('Posted') && log.message.includes('Work session end comment')
  );

  console.log('  Commands executed:', commandLog.length);
  console.log('  Has comment command:', hasCommentCommand3);
  console.log('  Has posted message:', hasPostedMessage3);
  console.log('  Result:', hasCommentCommand3 && hasPostedMessage3 ? '✅ PASS' : '❌ FAIL');

  // Test 4: Not in continue mode (should not post comment regardless)
  console.log('\nTest 4: Not in continue mode (should not post any comment)');
  commandLog = [];
  logMessages = [];

  await endWorkSession({
    isContinueMode: false,
    prNumber: 123,
    argv: { watch: true },
    log: mockLog,
    formatAligned: mockFormatAligned,
    $: mockDollar,
    logsAttached: false
  });

  const hasCommentCommand4 = commandLog.some(cmd => cmd.includes('gh pr comment'));

  console.log('  Commands executed:', commandLog.length);
  console.log('  Has comment command:', hasCommentCommand4);
  console.log('  Result:', !hasCommentCommand4 ? '✅ PASS' : '❌ FAIL');

  console.log('\n=== All tests completed ===\n');
}

// Run tests
runTests().catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
});
