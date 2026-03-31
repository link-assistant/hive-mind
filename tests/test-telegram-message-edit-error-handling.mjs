#!/usr/bin/env node

/**
 * Test suite for Telegram message edit error handling
 * Tests that editMessageText failures are properly caught and don't leave messages stuck
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1062
 */

// Temporarily unset CI to avoid command-stream trace logs in tests
const originalCI = process.env.CI;
delete process.env.CI;

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    const result = testFn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          console.log('✅ PASSED');
          testsPassed++;
        })
        .catch(error => {
          console.log(`❌ FAILED: ${error.message}`);
          testsFailed++;
        });
    }
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

async function runTestAsync(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

// Import the queue library for testing executeItem error handling
const queueLibPath = join(__dirname, '..', 'src', 'telegram-solve-queue.lib.mjs');
const { SolveQueue, getSolveQueue, resetSolveQueue, QueueItemStatus } = await import(queueLibPath);

// Import limits library to reset cache
const limitsLibPath = join(__dirname, '..', 'src', 'limits.lib.mjs');
const { resetLimitCache } = await import(limitsLibPath);

// Test 1: Verify executeItem catches editMessageText errors and logs them
await runTestAsync('executeItem catches editMessageText errors (issue #1062)', async () => {
  resetSolveQueue();
  resetLimitCache();

  // Create a queue with a mock execute callback
  const queue = new SolveQueue({ verbose: true });

  // Track if error was logged
  let errorLogged = false;
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const message = args.join(' ');
    if (message.includes('Failed to update message') && message.includes('[solve_queue]')) {
      errorLogged = true;
    }
    // Still call original for visibility
    originalConsoleError.apply(console, args);
  };

  // Create a mock context with editMessageText that throws
  const mockCtx = {
    telegram: {
      editMessageText: async () => {
        throw new Error('Test: Message too old to edit');
      },
    },
    from: { id: 123 },
  };

  // Set up execute callback that returns success
  queue.executeCallback = async item => {
    return {
      success: true,
      output: 'Started session: test-session\nscreen -R test-session',
    };
  };

  // Enqueue an item with message tracking
  const item = queue.enqueue({
    url: 'https://github.com/owner/repo/issues/1',
    args: ['https://github.com/owner/repo/issues/1'],
    ctx: mockCtx,
    requester: 'User123',
    infoBlock: 'Test info',
    tool: 'claude',
  });

  // Set messageInfo to simulate a real scenario
  item.messageInfo = { chatId: 12345, messageId: 67890 };

  // Execute the item directly
  await queue.executeItem(item);

  // Restore console.error
  console.error = originalConsoleError;

  // Verify error was caught and logged (not thrown)
  if (!errorLogged) {
    throw new Error('editMessageText error should be caught and logged');
  }

  // Verify item still completed successfully (error was handled gracefully)
  if (item.status !== QueueItemStatus.STARTED) {
    throw new Error(`Item should be STARTED, got ${item.status}`);
  }

  queue.stop();
});

// Test 2: Verify executeItem logs errors for failed items too
await runTestAsync('executeItem logs errors for failed items (issue #1062)', async () => {
  resetSolveQueue();
  resetLimitCache();

  const queue = new SolveQueue({ verbose: true });

  // Track if error was logged
  let errorLogged = false;
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const message = args.join(' ');
    if (message.includes('Failed to update error message') && message.includes('[solve_queue]')) {
      errorLogged = true;
    }
    originalConsoleError.apply(console, args);
  };

  // Create a mock context with editMessageText that throws
  const mockCtx = {
    telegram: {
      editMessageText: async () => {
        throw new Error('Test: Network error');
      },
    },
    from: { id: 123 },
  };

  // Set up execute callback that throws an error
  queue.executeCallback = async () => {
    throw new Error('Execution failed');
  };

  // Enqueue an item with message tracking
  const item = queue.enqueue({
    url: 'https://github.com/owner/repo/issues/1',
    args: ['https://github.com/owner/repo/issues/1'],
    ctx: mockCtx,
    requester: 'User123',
    infoBlock: 'Test info',
    tool: 'claude',
  });

  item.messageInfo = { chatId: 12345, messageId: 67890 };

  // Execute the item
  await queue.executeItem(item);

  // Restore console.error
  console.error = originalConsoleError;

  // Error should be logged for the message update failure
  if (!errorLogged) {
    throw new Error('Failed message edit error should be caught and logged');
  }

  // Item should be marked as failed
  if (item.status !== QueueItemStatus.FAILED) {
    throw new Error(`Item should be FAILED, got ${item.status}`);
  }

  queue.stop();
});

// Test 3: Verify SolveQueue.updateItemMessage catches errors
await runTestAsync('updateItemMessage catches errors (issue #1062)', async () => {
  resetSolveQueue();
  resetLimitCache();

  const queue = new SolveQueue({ verbose: true });

  // Track if error was logged
  let errorLogged = false;
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    const message = args.join(' ');
    if (message.includes('Failed to update message:') && message.includes('[VERBOSE]')) {
      errorLogged = true;
    }
    originalConsoleLog.apply(console, args);
  };

  // Create a mock context with editMessageText that throws
  const mockCtx = {
    telegram: {
      editMessageText: async () => {
        throw new Error('Test: Rate limited');
      },
    },
    from: { id: 123 },
  };

  // Create a mock item
  const item = queue.enqueue({
    url: 'https://github.com/owner/repo/issues/1',
    args: ['https://github.com/owner/repo/issues/1'],
    ctx: mockCtx,
    requester: 'User123',
    infoBlock: 'Test info',
    tool: 'claude',
  });

  item.messageInfo = { chatId: 12345, messageId: 67890 };

  // Call updateItemMessage directly - should not throw
  let didThrow = false;
  try {
    await queue.updateItemMessage(item, 'Test update message');
  } catch {
    didThrow = true;
  }

  // Restore console.log
  console.log = originalConsoleLog;

  if (didThrow) {
    throw new Error('updateItemMessage should catch errors, not throw');
  }

  if (!errorLogged) {
    throw new Error('updateItemMessage should log errors in verbose mode');
  }

  queue.stop();
});

// Test 4: Verify that successful message edit works normally
await runTestAsync('successful message edit works normally', async () => {
  resetSolveQueue();
  resetLimitCache();

  const queue = new SolveQueue({ verbose: false });

  let editCalled = false;
  let editArgs = null;

  // Create a mock context with editMessageText that succeeds
  const mockCtx = {
    telegram: {
      editMessageText: async (chatId, messageId, inline, text, options) => {
        editCalled = true;
        editArgs = { chatId, messageId, text, options };
        return { ok: true };
      },
    },
    from: { id: 123 },
  };

  // Set up execute callback that returns success
  queue.executeCallback = async () => {
    return {
      success: true,
      output: 'Started session: my-session\nscreen -R my-session',
    };
  };

  const item = queue.enqueue({
    url: 'https://github.com/owner/repo/issues/1',
    args: ['https://github.com/owner/repo/issues/1'],
    ctx: mockCtx,
    requester: 'User123',
    infoBlock: 'Test info',
    tool: 'claude',
  });

  item.messageInfo = { chatId: 12345, messageId: 67890 };

  // Execute the item
  await queue.executeItem(item);

  if (!editCalled) {
    throw new Error('editMessageText should be called on success');
  }

  if (editArgs.chatId !== 12345 || editArgs.messageId !== 67890) {
    throw new Error('editMessageText should be called with correct chat/message IDs');
  }

  if (!editArgs.text.includes('successfully')) {
    throw new Error('editMessageText should be called with success message');
  }

  if (!editArgs.text.includes('my-session')) {
    throw new Error('editMessageText should include session name');
  }

  queue.stop();
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for Telegram message edit error handling (issue #1062):`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Cleanup
resetSolveQueue();
resetLimitCache();

// Restore CI if it was set
if (originalCI !== undefined) {
  process.env.CI = originalCI;
}

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
