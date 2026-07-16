/**
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';

import { TelegramRateLimitTracker, installTelegramRateLimitTracker } from '../src/telegram-rate-limit.lib.mjs';
import { formatUsageMessage } from '../src/limits.lib.mjs';
import { preloadAllLocales } from '../src/i18n.lib.mjs';

await preloadAllLocales();

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.error(`❌ ${name}: ${error.message}`);
    failed++;
  }
}

console.log('\nTelegram Bot API rate-limit telemetry tests (Issues #2060 and #2070)\n');

await test('tracks global and busiest-group rolling message windows', () => {
  let now = 1_000_000;
  const tracker = new TelegramRateLimitTracker({ now: () => now });

  for (let i = 0; i < 6; i++) tracker.recordRequest('sendMessage', { chat_id: -100123 });
  tracker.recordRequest('getMe', {});

  let snapshot = tracker.getSnapshot();
  assert.equal(snapshot.global.used, 6);
  assert.equal(snapshot.global.limit, 30);
  assert.equal(snapshot.busiestGroup.used, 6);
  assert.equal(snapshot.busiestGroup.limit, 20);
  assert.equal(snapshot.busiestGroup.chatId, '-100123');
  assert.equal(snapshot.totalApiRequests, 7);

  now += 1_001;
  snapshot = tracker.getSnapshot();
  assert.equal(snapshot.global.used, 0, 'One-second global window should expire');
  assert.equal(snapshot.busiestGroup.used, 6, 'One-minute group window should remain');

  now += 59_000;
  snapshot = tracker.getSnapshot();
  assert.equal(snapshot.busiestGroup.used, 0, 'One-minute group window should expire');
});

await test('captures Telegram 429 retry_after responses without swallowing errors', async () => {
  let now = 2_000_000;
  const expected = Object.assign(new Error('429: Too Many Requests'), {
    response: { error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 12 } },
  });
  const telegram = {
    async callApi() {
      throw expected;
    },
  };
  const tracker = new TelegramRateLimitTracker({ now: () => now });
  installTelegramRateLimitTracker(telegram, { tracker });

  await assert.rejects(
    () => telegram.callApi('sendMessage', { chat_id: -42 }),
    error => error === expected
  );
  const snapshot = tracker.getSnapshot();
  assert.equal(snapshot.rateLimitResponses, 1);
  assert.equal(snapshot.lastRateLimit.retryAfterSeconds, 12);
  assert.equal(snapshot.lastRateLimit.method, 'sendMessage');
  assert.equal(snapshot.lastRateLimit.chatId, '-42');
  assert.equal(snapshot.lastRateLimit.retryRemainingSeconds, 12);

  now += 5_000;
  assert.equal(tracker.getSnapshot().lastRateLimit.retryRemainingSeconds, 7);
});

await test('formats only the most constraining Telegram window and observed 429 state in /limits', () => {
  const telegramRateLimit = {
    global: { used: 3, limit: 30, usedPercentage: 10 },
    busiestGroup: { used: 7, limit: 20, usedPercentage: 35, chatId: '-100123' },
    rateLimitResponses: 2,
    lastRateLimit: { retryRemainingSeconds: 8, method: 'sendMessage' },
  };
  const message = formatUsageMessage(null, null, null, null, null, 'Claude unavailable', [], {
    telegramRateLimit,
  });
  const russianMessage = formatUsageMessage(null, null, null, null, null, 'Claude unavailable', [], {
    locale: 'ru',
    telegramRateLimit,
  });
  const chineseMessage = formatUsageMessage(null, null, null, null, null, 'Claude unavailable', [], {
    locale: 'zh',
    telegramRateLimit,
  });
  const hindiMessage = formatUsageMessage(null, null, null, null, null, 'Claude unavailable', [], {
    locale: 'hi',
    telegramRateLimit,
  });

  assert.ok(message.includes('Telegram Bot API\n'));
  assert.ok(!message.includes('local rolling telemetry'));
  assert.ok(message.includes('35% used (busiest group, 1m)'));
  assert.ok(message.includes('7/20 requests'));
  assert.ok(!message.includes('3/30'), 'The less-constraining global window should be hidden');
  assert.equal((message.match(/% used/g) || []).length, 1, 'Telegram should render one progress bar');
  assert.ok(message.includes('429 responses since startup: 2'));
  assert.ok(message.includes('Last 429: sendMessage, retry in 8s'));
  assert.ok(russianMessage.includes('35% использовано (самая активная группа, 1 мин)'));
  assert.ok(russianMessage.includes('7/20 запросов'));
  assert.ok(russianMessage.includes('Ответов 429 с момента запуска: 2'));
  assert.ok(chineseMessage.includes('35% 已用 (最繁忙群组，1 分钟)'));
  assert.ok(chineseMessage.includes('7/20 个请求'));
  assert.ok(hindiMessage.includes('35% उपयोग (सबसे व्यस्त समूह, 1 मिनट)'));
  assert.ok(hindiMessage.includes('7/20 अनुरोध'));
});

await test('selects the global Telegram window when it is more constraining', () => {
  const message = formatUsageMessage(null, null, null, null, null, 'Claude unavailable', [], {
    telegramRateLimit: {
      global: { used: 18, limit: 30, usedPercentage: 60 },
      busiestGroup: { used: 4, limit: 20, usedPercentage: 20, chatId: '-100123' },
      rateLimitResponses: 0,
      lastRateLimit: null,
    },
  });

  assert.ok(message.includes('60% used (global, 1s)'));
  assert.ok(message.includes('18/30 requests'));
  assert.ok(!message.includes('4/20'), 'The less-constraining group window should be hidden');
});

await test('prefers the longer Telegram group window when utilization is tied', () => {
  const message = formatUsageMessage(null, null, null, null, null, 'Claude unavailable', [], {
    telegramRateLimit: {
      global: { used: 0, limit: 30, usedPercentage: 0 },
      busiestGroup: { used: 0, limit: 20, usedPercentage: 0, chatId: null },
      rateLimitResponses: 0,
      lastRateLimit: null,
    },
  });

  assert.ok(message.includes('0% used (busiest group, 1m)'));
  assert.ok(message.includes('0/20 requests'));
  assert.ok(!message.includes('0/30'));
});

console.log(`\nTests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
if (failed > 0) process.exit(1);
