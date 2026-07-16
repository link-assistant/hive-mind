/**
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';

import { TelegramRateLimitTracker, classifyTelegramRequest, installTelegramRateLimitTracker } from '../src/telegram-rate-limit.lib.mjs';
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

function makeTracker(start = 1_000_000) {
  const clock = { now: start };
  const tracker = new TelegramRateLimitTracker({ now: () => clock.now });
  const accept = (method, payload = {}) => tracker.recordSuccess(tracker.recordRequest(method, payload));
  const refuse = (method, payload = {}, retryAfter = 8) => tracker.recordError({ response: { error_code: 429, description: `Too Many Requests: retry after ${retryAfter}`, parameters: { retry_after: retryAfter } } }, tracker.recordRequest(method, payload));
  return { tracker, clock, accept, refuse, advance: ms => (clock.now += ms) };
}

function ruleById(snapshot, id) {
  return snapshot.rules.find(rule => rule.id === id) || null;
}

console.log('\nTelegram Bot API rate-limit telemetry tests (Issues #2060 and #2070)\n');

await test('classifies requests by chat_id rather than by a method allow-list', () => {
  assert.equal(classifyTelegramRequest('sendMessage', { chat_id: -100123 }).kind, 'message');
  // Edits share Telegram's sending limits: https://github.com/tdlib/td/issues/3034
  assert.equal(classifyTelegramRequest('editMessageText', { chat_id: -100123 }).kind, 'message');
  assert.equal(classifyTelegramRequest('sendMessage', { chat_id: -100123 }).isGroup, true);
  assert.equal(classifyTelegramRequest('sendMessage', { chat_id: 42 }).isGroup, false);
  // Reads and typing indicators produce no message, so they leave the sending windows alone.
  assert.equal(classifyTelegramRequest('sendChatAction', { chat_id: -100123 }).kind, 'other');
  assert.equal(classifyTelegramRequest('getChat', { chat_id: -100123 }).kind, 'other');
  assert.equal(classifyTelegramRequest('getUpdates', {}).kind, 'other');
});

await test('tracks each documented window separately and expires them independently', () => {
  const { tracker, advance, accept } = makeTracker();

  for (let i = 0; i < 6; i++) accept('sendMessage', { chat_id: -100123 });
  accept('getUpdates', {});

  let snapshot = tracker.getSnapshot();
  assert.equal(snapshot.totalApiRequests, 7);
  assert.equal(snapshot.messageRequests, 6);
  assert.equal(ruleById(snapshot, 'broadcast').used, 6);
  assert.equal(ruleById(snapshot, 'broadcast').limit, 30);
  assert.equal(ruleById(snapshot, 'group').used, 6);
  assert.equal(ruleById(snapshot, 'group').limit, 20);
  assert.equal(ruleById(snapshot, 'chat').chatId, '-100123');
  assert.equal(ruleById(snapshot, 'chat').limit, 60);
  // 'other' has no documented size, so it stays unmeasured instead of inventing a bar.
  assert.equal(ruleById(snapshot, 'other'), null);

  advance(1_001);
  snapshot = tracker.getSnapshot();
  assert.equal(ruleById(snapshot, 'broadcast').used, 0, 'One-second broadcast window should expire');
  assert.equal(ruleById(snapshot, 'group').used, 6, 'One-minute group window should remain');

  advance(59_000);
  snapshot = tracker.getSnapshot();
  assert.equal(ruleById(snapshot, 'group'), null, 'An idle group window has no subject to display');
});

await test('shows the window closest to refusing the next request, counted in requests', () => {
  const { tracker, accept } = makeTracker();

  // 12 messages in one group: 12/20 in the group window leaves 8 requests of
  // headroom, while 12/30 broadcast leaves 18 and 12/60 per chat leaves 48.
  for (let i = 0; i < 12; i++) accept('sendMessage', { chat_id: -100123 });

  const snapshot = tracker.getSnapshot();
  assert.equal(snapshot.display.id, 'group');
  assert.equal(snapshot.display.used, 12);
  assert.equal(snapshot.display.limit, 20);
  assert.equal(snapshot.display.remaining, 8);
});

await test('prefers fewer remaining requests over a higher percentage', () => {
  const { tracker, accept } = makeTracker();

  // 25/30 broadcast is 83% with 5 left; 25/60 per chat is 42% with 35 left.
  // Percentage would pick broadcast either way here, so make the group window
  // the higher percentage but the roomier one by spreading across chats.
  for (let i = 0; i < 25; i++) accept('sendMessage', { chat_id: 1000 + i });

  const snapshot = tracker.getSnapshot();
  assert.equal(snapshot.display.id, 'broadcast');
  assert.equal(snapshot.display.remaining, 5);
  assert.equal(ruleById(snapshot, 'group'), null, 'Private chats are not group chats');
});

await test('raises a limit when Telegram accepts more than the documented value', () => {
  const { tracker, accept } = makeTracker();

  for (let i = 0; i < 22; i++) accept('sendMessage', { chat_id: -100123 });

  const group = ruleById(tracker.getSnapshot(), 'group');
  assert.equal(group.used, 22);
  assert.equal(group.limit, 22, 'Telegram accepted 22, so 20 was too pessimistic');
  assert.equal(group.limitSource, 'observed');
  assert.equal(group.peak, 22);
});

await test('lowers the blamed limit to below the refused count on a 429', () => {
  const { tracker, accept, refuse } = makeTracker();

  for (let i = 0; i < 14; i++) accept('sendMessage', { chat_id: -100123 });
  const observed = refuse('sendMessage', { chat_id: -100123 }, 8);

  assert.equal(observed.ruleId, 'group');
  const snapshot = tracker.getSnapshot();
  assert.equal(snapshot.display.id, 'group');
  assert.equal(snapshot.display.limit, 14, 'The 15th request was refused, so the ceiling is 14');
  assert.equal(snapshot.display.used, 14, 'A refused request never landed in the window');
  assert.equal(snapshot.display.limitSource, 'observed');
  assert.equal(snapshot.display.usedPercentage, 100);
});

await test('learns nothing from a 429 that no modelled window explains', () => {
  const { tracker, accept, refuse } = makeTracker();

  accept('sendMessage', { chat_id: -100123 });
  // Flood control carries penalty state we cannot see, so a 429 on the second
  // message of a minute must not collapse the group limit to 1.
  const observed = refuse('sendMessage', { chat_id: -100123 }, 30);

  assert.equal(observed.ruleId, null);
  assert.equal(observed.retryAfterSeconds, 30);
  const group = ruleById(tracker.getSnapshot(), 'group');
  assert.equal(group.limit, 20);
  assert.equal(group.limitSource, 'documented');
});

await test('measures an otherwise unknown limit only once a 429 proves one exists', () => {
  const { tracker, accept, refuse } = makeTracker();

  for (let i = 0; i < 5; i++) accept('getUpdates', {});
  assert.equal(ruleById(tracker.getSnapshot(), 'other'), null, 'A success proves capacity, never a ceiling');

  refuse('getUpdates', {}, 3);
  const other = ruleById(tracker.getSnapshot(), 'other');
  assert.equal(other.limit, 5, 'The 6th request in the window was refused');
  assert.equal(other.limitSource, 'observed');
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
  assert.equal(snapshot.totalApiRequests, 1);
  assert.equal(snapshot.lastRateLimit.retryAfterSeconds, 12);
  assert.equal(snapshot.lastRateLimit.method, 'sendMessage');
  assert.equal(snapshot.lastRateLimit.chatId, '-42');
  assert.equal(snapshot.lastRateLimit.retryRemainingSeconds, 12);
  assert.equal(snapshot.throttled, true);

  now += 5_000;
  assert.equal(tracker.getSnapshot().lastRateLimit.retryRemainingSeconds, 7);
  now += 8_000;
  assert.equal(tracker.getSnapshot().throttled, false, 'The throttle clears when retry_after elapses');
});

await test('counts successful calls and keeps their results intact', async () => {
  const telegram = {
    async callApi() {
      return { message_id: 7 };
    },
  };
  const tracker = new TelegramRateLimitTracker({ now: () => 3_000_000 });
  installTelegramRateLimitTracker(telegram, { tracker });

  assert.deepEqual(await telegram.callApi('sendMessage', { chat_id: -100123 }), { message_id: 7 });
  const snapshot = tracker.getSnapshot();
  assert.equal(snapshot.totalApiRequests, 1);
  assert.equal(snapshot.rateLimitResponses, 0);
  assert.equal(snapshot.display.used, 1);
  assert.equal(snapshot.display.peak, 1);
});

function renderTelegramSection(telegramRateLimit, locale = null) {
  return formatUsageMessage(null, null, null, null, null, 'Claude unavailable', [], locale ? { locale, telegramRateLimit } : { telegramRateLimit });
}

await test('renders one bar for the most constraining window in every locale', () => {
  const { tracker, accept } = makeTracker();
  for (let i = 0; i < 7; i++) accept('sendMessage', { chat_id: -100123 });
  const snapshot = tracker.getSnapshot();

  const message = renderTelegramSection(snapshot);
  assert.ok(message.includes('Telegram Bot API\n'));
  assert.ok(!message.includes('local rolling telemetry'), 'Issue #2070 asked for the parenthetical to go');
  assert.ok(message.includes('35% used (messages per group, 1m)'));
  assert.ok(message.includes('7/20 requests, peak 7'));
  assert.ok(!message.includes('7/30'), 'The roomier broadcast window should be hidden');
  assert.ok(!message.includes('7/60'), 'The roomier per-chat window should be hidden');
  assert.equal((message.match(/% used/g) || []).length, 1, 'Telegram should render one progress bar');
  assert.ok(message.includes('429 responses since startup: 0'));
  assert.ok(!message.includes('Last 429'), 'There has been no 429 to report');

  assert.ok(renderTelegramSection(snapshot, 'ru').includes('35% использовано (сообщения в группу, 1 мин)'));
  assert.ok(renderTelegramSection(snapshot, 'ru').includes('7/20 запросов, пик 7'));
  assert.ok(renderTelegramSection(snapshot, 'ru').includes('Ответов 429 с момента запуска: 0'));
  assert.ok(renderTelegramSection(snapshot, 'zh').includes('35% 已用 (每个群组的消息，1 分钟)'));
  assert.ok(renderTelegramSection(snapshot, 'zh').includes('7/20 个请求, 峰值 7'));
  assert.ok(renderTelegramSection(snapshot, 'hi').includes('35% उपयोग (प्रति समूह संदेश, 1 मिनट)'));
  assert.ok(renderTelegramSection(snapshot, 'hi').includes('7/20 अनुरोध, शिखर 7'));
});

await test('answering /limits in a group reports real usage instead of zeroes', () => {
  const { tracker, accept } = makeTracker();
  // What the /limits command itself does: a placeholder message, then an edit.
  accept('getUpdates', {});
  accept('sendMessage', { chat_id: -100123 });
  accept('editMessageText', { chat_id: -100123 });

  const message = renderTelegramSection(tracker.getSnapshot());
  assert.ok(message.includes('10% used (messages per group, 1m)'), message);
  assert.ok(message.includes('2/20 requests, peak 2'));
});

await test('shows a full bar while flood control is still counting down', () => {
  const { tracker, accept, refuse, advance } = makeTracker();
  for (let i = 0; i < 9; i++) accept('sendMessage', { chat_id: -100123 });
  refuse('sendMessage', { chat_id: -100123 }, 8);
  advance(1_000);
  const snapshot = tracker.getSnapshot();

  const message = renderTelegramSection(snapshot);
  assert.ok(message.includes('100% ⚠️ (flood control, retry in 7s)'), message);
  assert.ok(message.includes('9/9 requests (observed limit), peak 9'));
  assert.ok(message.includes('429 responses since startup: 1'));
  assert.ok(message.includes('Last 429: sendMessage'));
  assert.ok(!message.includes('% used'), 'A throttled bar is not a usage estimate');
  assert.ok(renderTelegramSection(snapshot, 'ru').includes('(контроль флуда, повтор через 7 с)'));

  // Telegram returns retry_after values spanning three orders of magnitude.
  const { tracker: slow, accept: acceptSlow, refuse: refuseSlow, advance: advanceSlow } = makeTracker();
  for (let i = 0; i < 9; i++) acceptSlow('sendMessage', { chat_id: -100123 });
  refuseSlow('sendMessage', { chat_id: -100123 }, 2282);
  advanceSlow(1_000);
  assert.ok(renderTelegramSection(slow.getSnapshot()).includes('(flood control, retry in 38m 1s)'));
});

await test('returns to a measured bar once the throttle expires', () => {
  const { tracker, accept, refuse, advance } = makeTracker();
  for (let i = 0; i < 9; i++) accept('sendMessage', { chat_id: -100123 });
  refuse('sendMessage', { chat_id: -100123 }, 8);
  advance(9_000);

  const message = renderTelegramSection(tracker.getSnapshot());
  assert.ok(message.includes('100% ⚠️ (messages per group, 1m)'), message);
  assert.ok(message.includes('9/9 requests (observed limit), peak 9'), 'The learned ceiling survives the throttle');
  assert.ok(message.includes('Last 429: sendMessage'));
});

await test('omits the Telegram section when nothing has been measured', () => {
  const message = formatUsageMessage(null, null, null, null, null, 'Claude unavailable', [], { telegramRateLimit: null });
  assert.ok(!message.includes('Telegram Bot API'));
});

console.log(`\nTests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
if (failed > 0) process.exit(1);
