#!/usr/bin/env node

/**
 * Unit tests for Telegram bot launcher with exponential backoff retry
 * Tests isRetryableError, calculateRetryDelay, formatDelay, launchBotWithRetry
 *
 * Run with: node tests/test-telegram-bot-launcher.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1240
 */

import {
  isRetryableError,
  calculateRetryDelay,
  formatDelay,
  launchBotWithRetry,
  LAUNCHER_DEFAULTS,
} from '../src/telegram-bot-launcher.lib.mjs';

console.log('='.repeat(80));
console.log('Unit Tests: Telegram Bot Launcher with Retry (Issue #1240)');
console.log('='.repeat(80));
console.log();

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    const result = fn();
    if (result === true) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${name}`);
      console.log(`     Result: ${JSON.stringify(result)}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    const result = await fn();
    if (result === true) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${name}`);
      console.log(`     Result: ${JSON.stringify(result)}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
}

// Helper to create a mock Telegram error
function makeTelegramError(code, message) {
  const err = new Error(message || `${code}: Test error`);
  err.code = code;
  err.response = { ok: false, error_code: code, description: message };
  return err;
}

// Helper to create a mock bot
function makeMockBot({ launchBehavior }) {
  let launchCallCount = 0;
  let deleteWebhookCallCount = 0;
  return {
    telegram: {
      deleteWebhook: async () => {
        deleteWebhookCallCount++;
        return true;
      },
    },
    launch: async () => {
      launchCallCount++;
      const behavior = typeof launchBehavior === 'function' ? launchBehavior(launchCallCount) : launchBehavior;
      if (behavior instanceof Error) throw behavior;
      return behavior;
    },
    get launchCallCount() {
      return launchCallCount;
    },
    get deleteWebhookCallCount() {
      return deleteWebhookCallCount;
    },
  };
}

// ===========================================================================
// Tests for LAUNCHER_DEFAULTS
// ===========================================================================
console.log('\n--- LAUNCHER_DEFAULTS Tests ---\n');

runTest('Default base delay is 1 second', () => {
  return LAUNCHER_DEFAULTS.baseDelayMs === 1000;
});

runTest('Default max delay is 10 minutes', () => {
  return LAUNCHER_DEFAULTS.maxDelayMs === 10 * 60 * 1000;
});

runTest('Default backoff multiplier is 2', () => {
  return LAUNCHER_DEFAULTS.backoffMultiplier === 2;
});

runTest('Default jitter fraction is 0.1 (10%)', () => {
  return LAUNCHER_DEFAULTS.jitterFraction === 0.1;
});

// ===========================================================================
// Tests for isRetryableError()
// ===========================================================================
console.log('\n--- isRetryableError() Tests ---\n');

runTest('Returns false for 401 Unauthorized (invalid token)', () => {
  return isRetryableError(makeTelegramError(401, 'Unauthorized')) === false;
});

runTest('Returns true for 409 Conflict (another instance)', () => {
  return isRetryableError(makeTelegramError(409, 'Conflict: terminated by other getUpdates request')) === true;
});

runTest('Returns true for 429 Rate Limit', () => {
  return isRetryableError(makeTelegramError(429, 'Too Many Requests')) === true;
});

runTest('Returns true for 500 Internal Server Error', () => {
  return isRetryableError(makeTelegramError(500, 'Internal Server Error')) === true;
});

runTest('Returns true for 502 Bad Gateway', () => {
  return isRetryableError(makeTelegramError(502, 'Bad Gateway')) === true;
});

runTest('Returns true for network error (no code)', () => {
  const err = new Error('ECONNRESET');
  return isRetryableError(err) === true;
});

runTest('Returns true for fetch error (no code)', () => {
  const err = new Error('fetch failed');
  err.code = 'ENOTFOUND';
  return isRetryableError(err) === true;
});

runTest('Returns true for unknown error code', () => {
  return isRetryableError(makeTelegramError(418, "I'm a teapot")) === true;
});

// ===========================================================================
// Tests for calculateRetryDelay()
// ===========================================================================
console.log('\n--- calculateRetryDelay() Tests ---\n');

runTest('Attempt 1 returns ~1s (base delay)', () => {
  // With jitter, should be between 1000 and 1100
  const delay = calculateRetryDelay(1, { jitterFraction: 0 });
  return delay === 1000;
});

runTest('Attempt 2 returns ~2s with default multiplier', () => {
  const delay = calculateRetryDelay(2, { jitterFraction: 0 });
  return delay === 2000;
});

runTest('Attempt 3 returns ~4s with default multiplier', () => {
  const delay = calculateRetryDelay(3, { jitterFraction: 0 });
  return delay === 4000;
});

runTest('Attempt 10 returns ~512s with default multiplier', () => {
  const delay = calculateRetryDelay(10, { jitterFraction: 0 });
  return delay === 512000;
});

runTest('Delay is capped at maxDelayMs', () => {
  const delay = calculateRetryDelay(100, { jitterFraction: 0, maxDelayMs: 600000 });
  return delay === 600000;
});

runTest('Custom base delay is respected', () => {
  const delay = calculateRetryDelay(1, { baseDelayMs: 5000, jitterFraction: 0 });
  return delay === 5000;
});

runTest('Custom multiplier is respected', () => {
  const delay = calculateRetryDelay(3, { baseDelayMs: 1000, backoffMultiplier: 3, jitterFraction: 0 });
  // 1000 * 3^2 = 9000
  return delay === 9000;
});

runTest('Jitter adds up to jitterFraction of delay', () => {
  // Run multiple times to verify jitter is within bounds
  for (let i = 0; i < 50; i++) {
    const delay = calculateRetryDelay(1, { baseDelayMs: 1000, jitterFraction: 0.1 });
    if (delay < 1000 || delay > 1100) return false;
  }
  return true;
});

runTest('Zero jitter means exact delay', () => {
  const delay = calculateRetryDelay(5, { jitterFraction: 0 });
  return delay === 16000; // 1000 * 2^4
});

runTest('Backoff schedule matches expected values (no jitter)', () => {
  const expected = [1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 512000, 600000];
  for (let i = 0; i < expected.length; i++) {
    const delay = calculateRetryDelay(i + 1, { jitterFraction: 0, maxDelayMs: 600000 });
    if (delay !== expected[i]) {
      console.log(`     Attempt ${i + 1}: expected ${expected[i]}, got ${delay}`);
      return false;
    }
  }
  return true;
});

// ===========================================================================
// Tests for formatDelay()
// ===========================================================================
console.log('\n--- formatDelay() Tests ---\n');

runTest('Formats 1000ms as "1s"', () => {
  return formatDelay(1000) === '1s';
});

runTest('Formats 500ms as "1s" (rounds up)', () => {
  return formatDelay(500) === '1s';
});

runTest('Formats 30000ms as "30s"', () => {
  return formatDelay(30000) === '30s';
});

runTest('Formats 60000ms as "1m"', () => {
  return formatDelay(60000) === '1m';
});

runTest('Formats 90000ms as "1m 30s"', () => {
  return formatDelay(90000) === '1m 30s';
});

runTest('Formats 600000ms as "10m"', () => {
  return formatDelay(600000) === '10m';
});

runTest('Formats 0ms as "0s"', () => {
  return formatDelay(0) === '0s';
});

runTest('Formats 125000ms as "2m 5s"', () => {
  return formatDelay(125000) === '2m 5s';
});

// ===========================================================================
// Tests for launchBotWithRetry()
// ===========================================================================
console.log('\n--- launchBotWithRetry() Tests ---\n');

console.log('  Success cases:\n');

await runAsyncTest('Succeeds on first attempt with no errors', async () => {
  const bot = makeMockBot({ launchBehavior: undefined }); // resolves with undefined
  await launchBotWithRetry(bot, { dropPendingUpdates: true });
  return bot.launchCallCount === 1 && bot.deleteWebhookCallCount === 1;
});

await runAsyncTest('Calls deleteWebhook before launch', async () => {
  const callOrder = [];
  const bot = {
    telegram: {
      deleteWebhook: async () => {
        callOrder.push('deleteWebhook');
        return true;
      },
    },
    launch: async () => {
      callOrder.push('launch');
    },
  };
  await launchBotWithRetry(bot, {});
  return callOrder[0] === 'deleteWebhook' && callOrder[1] === 'launch';
});

console.log('\n  Retry cases:\n');

await runAsyncTest('Retries on 409 Conflict and succeeds on 2nd attempt', async () => {
  const bot = makeMockBot({
    launchBehavior: (callCount) => {
      if (callCount === 1) throw makeTelegramError(409, 'Conflict: terminated by other getUpdates request');
      return undefined; // success on 2nd attempt
    },
  });
  await launchBotWithRetry(bot, {}, { baseDelayMs: 10, jitterFraction: 0 });
  return bot.launchCallCount === 2 && bot.deleteWebhookCallCount === 2;
});

await runAsyncTest('Retries on network error and succeeds', async () => {
  const bot = makeMockBot({
    launchBehavior: (callCount) => {
      if (callCount === 1) {
        const err = new Error('ECONNRESET');
        err.code = 'ECONNRESET';
        throw err;
      }
      return undefined;
    },
  });
  await launchBotWithRetry(bot, {}, { baseDelayMs: 10, jitterFraction: 0 });
  return bot.launchCallCount === 2;
});

await runAsyncTest('Retries multiple times (409, 500, then success)', async () => {
  const bot = makeMockBot({
    launchBehavior: (callCount) => {
      if (callCount === 1) throw makeTelegramError(409, 'Conflict');
      if (callCount === 2) throw makeTelegramError(500, 'Internal Server Error');
      return undefined; // success on 3rd
    },
  });
  await launchBotWithRetry(bot, {}, { baseDelayMs: 10, jitterFraction: 0 });
  return bot.launchCallCount === 3 && bot.deleteWebhookCallCount === 3;
});

await runAsyncTest('Calls onRetry callback on each retry', async () => {
  const retryLog = [];
  const bot = makeMockBot({
    launchBehavior: (callCount) => {
      if (callCount <= 2) throw makeTelegramError(409, 'Conflict');
      return undefined;
    },
  });
  await launchBotWithRetry(bot, {}, {
    baseDelayMs: 10,
    jitterFraction: 0,
    onRetry: (attempt, error, delayMs) => {
      retryLog.push({ attempt, code: error.code, delayMs });
    },
  });
  return (
    retryLog.length === 2 &&
    retryLog[0].attempt === 1 &&
    retryLog[0].code === 409 &&
    retryLog[0].delayMs === 10 &&
    retryLog[1].attempt === 2 &&
    retryLog[1].delayMs === 20
  );
});

console.log('\n  Non-retryable errors:\n');

await runAsyncTest('Throws immediately on 401 Unauthorized (no retry)', async () => {
  const bot = makeMockBot({
    launchBehavior: makeTelegramError(401, 'Unauthorized'),
  });
  try {
    await launchBotWithRetry(bot, {}, { baseDelayMs: 10 });
    return false; // Should have thrown
  } catch (error) {
    return error.code === 401 && bot.launchCallCount === 1;
  }
});

console.log('\n  AbortSignal cases:\n');

await runAsyncTest('Aborts before first attempt if signal already aborted', async () => {
  const bot = makeMockBot({ launchBehavior: undefined });
  const controller = new AbortController();
  controller.abort();
  try {
    await launchBotWithRetry(bot, {}, { signal: controller.signal });
    return false; // Should have thrown
  } catch (error) {
    return error.message === 'Bot launch aborted' && bot.launchCallCount === 0;
  }
});

await runAsyncTest('Aborts during retry wait', async () => {
  const bot = makeMockBot({
    launchBehavior: (callCount) => {
      if (callCount === 1) throw makeTelegramError(409, 'Conflict');
      return undefined;
    },
  });
  const controller = new AbortController();

  // Abort after a short delay (while the retry wait is happening)
  setTimeout(() => controller.abort(), 50);

  try {
    await launchBotWithRetry(bot, {}, {
      baseDelayMs: 5000, // Long delay so abort happens during wait
      jitterFraction: 0,
      signal: controller.signal,
    });
    return false; // Should have thrown
  } catch (error) {
    return error.message.includes('aborted') && bot.launchCallCount === 1;
  }
});

console.log('\n  deleteWebhook behavior:\n');

await runAsyncTest('Calls deleteWebhook with drop_pending_updates: true', async () => {
  let webhookOptions = null;
  const bot = {
    telegram: {
      deleteWebhook: async (options) => {
        webhookOptions = options;
        return true;
      },
    },
    launch: async () => {},
  };
  await launchBotWithRetry(bot, {});
  return webhookOptions !== null && webhookOptions.drop_pending_updates === true;
});

await runAsyncTest('Retries deleteWebhook + launch together on each attempt', async () => {
  let deleteCount = 0;
  let launchCount = 0;
  const bot = {
    telegram: {
      deleteWebhook: async () => {
        deleteCount++;
        return true;
      },
    },
    launch: async () => {
      launchCount++;
      if (launchCount <= 2) throw makeTelegramError(409, 'Conflict');
    },
  };
  await launchBotWithRetry(bot, {}, { baseDelayMs: 10, jitterFraction: 0 });
  return deleteCount === 3 && launchCount === 3;
});

// ===========================================================================
// Summary
// ===========================================================================
console.log('\n' + '='.repeat(80));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('='.repeat(80));

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
