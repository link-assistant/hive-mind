/**
 * @hive-mind-test-suite default
 *
 * Issue #2571: the Telegram rate-limit tracker must restrain the bot, not just
 * count 429s. These tests replay the failure from the production log — a big
 * queue editing ~20 waiting cards in one group every minute — against a small
 * Telegram simulator that enforces 20 messages per group per sliding minute.
 */

import assert from 'node:assert/strict';

import { TelegramRateLimitTracker, LIMIT_EVIDENCE_TTL_MS, createTelegramLocalThrottleError, installTelegramRateLimitTracker, isTelegramLocalThrottleError, isTelegramRateLimitError, withTelegramRequestPriority, getTelegramRequestPriority } from '../src/telegram-rate-limit.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.error(`❌ ${name}: ${error.stack || error.message}`);
    failed++;
  }
}

const GROUP = -1002975819706;
const OTHER_GROUP = -100777;

/**
 * Virtual time: `sleep()` parks the caller until `run()` advances the clock to
 * its deadline, so concurrent waiters see a consistent clock.
 */
function makeClock(start = 5_000_000) {
  const clock = { now: start, timers: [] };
  clock.sleep = ms =>
    new Promise(resolve => {
      clock.timers.push({ at: clock.now + ms, resolve });
    });
  clock.run = async promise => {
    let settled = false;
    const wrapped = promise.then(
      value => {
        settled = true;
        return value;
      },
      error => {
        settled = true;
        throw error;
      }
    );
    wrapped.catch(() => {});
    for (let guard = 0; guard < 10_000; guard++) {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      if (settled) break;
      if (!clock.timers.length) {
        await new Promise(resolve => setImmediate(resolve));
        continue;
      }
      clock.timers.sort((a, b) => a.at - b.at);
      const next = clock.timers.shift();
      clock.now = Math.max(clock.now, next.at);
      next.resolve();
    }
    return wrapped;
  };
  return clock;
}

/** A Telegram that refuses the 21st message to a group within any 60s, like production did. */
function makeTelegramSimulator(clock, { groupLimit = 20, retryAfter: fixedRetryAfter = null, notModified = () => false } = {}) {
  const sim = { calls: [], refused: 0, accepted: [] };
  sim.client = {
    async callApi(method, payload = {}) {
      sim.calls.push({ method, chatId: payload.chat_id, at: clock.now });
      const chatId = payload.chat_id;
      if (chatId !== undefined && String(chatId).startsWith('-') && method !== 'getUpdates') {
        const recent = sim.calls.filter(call => call.chatId === chatId && call.at > clock.now - 60_000 && call.method !== 'sendChatAction');
        if (recent.length > groupLimit) {
          sim.refused++;
          // Unless a test pins it, retry_after is honest: the time until the oldest call leaves the window.
          const retryAfter = fixedRetryAfter ?? Math.max(1, Math.ceil((recent[0].at + 60_000 - clock.now) / 1000));
          throw Object.assign(new Error(`429: Too Many Requests: retry after ${retryAfter}`), {
            code: 429,
            response: { ok: false, error_code: 429, description: `Too Many Requests: retry after ${retryAfter}`, parameters: { retry_after: retryAfter } },
          });
        }
      }
      if (method === 'editMessageText' && notModified(payload)) {
        throw Object.assign(new Error('400: Bad Request: message is not modified'), {
          code: 400,
          response: { ok: false, error_code: 400, description: 'Bad Request: message is not modified' },
        });
      }
      sim.accepted.push({ method, chatId, at: clock.now });
      return { message_id: sim.calls.length };
    },
  };
  return sim;
}

function maxInAnyMinute(entries, chatId) {
  const times = entries.filter(entry => entry.chatId === chatId).map(entry => entry.at);
  let max = 0;
  for (const at of times) max = Math.max(max, times.filter(other => other > at - 60_000 && other <= at).length);
  return max;
}

function governed(options = {}) {
  const clock = makeClock();
  const tracker = new TelegramRateLimitTracker({ now: () => clock.now });
  const sim = makeTelegramSimulator(clock, options.sim);
  const telegram = installTelegramRateLimitTracker(sim.client, { tracker, sleep: clock.sleep, ...options.install });
  return { clock, tracker, sim, telegram };
}

const quiet = async fn => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
};

console.log('\nTelegram Bot API governor tests (Issue #2571)\n');

await test('priority defaults to normal and is scoped to the async call tree', async () => {
  assert.equal(getTelegramRequestPriority(), 'normal');
  const seen = await withTelegramRequestPriority('low', async () => {
    await Promise.resolve();
    return getTelegramRequestPriority();
  });
  assert.equal(seen, 'low');
  assert.equal(getTelegramRequestPriority(), 'normal', 'The priority must not leak out of the callback');
});

await test('local throttle errors look like Telegram 429s but say they never left the bot', () => {
  const error = createTelegramLocalThrottleError({ method: 'editMessageText', chatId: GROUP, retryAfterMs: 4_200, reason: 'group_window' });
  assert.equal(error.response.error_code, 429);
  assert.equal(error.response.parameters.retry_after, 5);
  assert.ok(isTelegramLocalThrottleError(error));
  assert.ok(isTelegramRateLimitError(error));
  assert.ok(isTelegramRateLimitError({ response: { error_code: 429, description: 'Too Many Requests: retry after 3' } }));
  assert.ok(!isTelegramLocalThrottleError({ response: { error_code: 429 } }));
  assert.ok(!isTelegramRateLimitError({ response: { error_code: 400, description: 'Bad Request: message is not modified' } }));
});

await test('production replay: 25 low-priority queue edits in one group never reach a 429', async () => {
  const { clock, tracker, sim, telegram } = governed();
  // Every consumer cycle (60s) the queue edits every waiting card, back to back.
  for (let cycle = 0; cycle < 5; cycle++) {
    for (let card = 0; card < 25; card++) {
      await clock.run(withTelegramRequestPriority('low', () => telegram.callApi('editMessageText', { chat_id: GROUP, message_id: card, text: `cycle ${cycle}` })).catch(error => error));
    }
    clock.now += 60_000;
  }
  assert.equal(sim.refused, 0, 'The governor must keep the bot inside Telegram limits');
  assert.ok(maxInAnyMinute(sim.accepted, GROUP) <= 15, 'Low priority must leave a quarter of the group window free');
  assert.equal(tracker.getSnapshot().heldRequests, 5 * 10, 'Edits beyond the low-priority share are held locally, not sent');
});

await test('a reply to a person still fits after periodic edits used up their share', async () => {
  const { clock, sim, telegram } = governed();
  for (let card = 0; card < 25; card++) {
    await clock.run(withTelegramRequestPriority('low', () => telegram.callApi('editMessageText', { chat_id: GROUP, message_id: card })).catch(() => {}));
  }
  const startedAt = clock.now;
  await clock.run(telegram.callApi('sendMessage', { chat_id: GROUP, text: '✅ Queued' }));
  assert.equal(clock.now, startedAt, 'The reserve exists so a reply is not delayed');
  assert.equal(sim.refused, 0);
});

await test('normal-priority requests are paced to the window instead of refused', async () => {
  const { clock, tracker, sim, telegram } = governed();
  const startedAt = clock.now;
  for (let i = 0; i < 25; i++) await clock.run(telegram.callApi('sendMessage', { chat_id: GROUP, text: String(i) }));
  assert.equal(sim.refused, 0);
  assert.equal(sim.accepted.length, 25, 'Every normal-priority message is delivered');
  assert.ok(maxInAnyMinute(sim.accepted, GROUP) <= 20);
  assert.ok(clock.now - startedAt >= 60_000, 'The 21st message waits for the oldest one to leave the window');
  // The first 20 left together, so a single wait frees the window for the other four.
  assert.equal(tracker.getSnapshot().delayedRequests, 1);
});

await test('concurrent senders cannot both take the last slot', async () => {
  const { clock, sim, telegram } = governed();
  const sends = Array.from({ length: 30 }, (_, i) => telegram.callApi('sendMessage', { chat_id: GROUP, text: String(i) }));
  await clock.run(Promise.all(sends));
  assert.equal(sim.refused, 0);
  assert.equal(sim.accepted.length, 30);
  assert.ok(maxInAnyMinute(sim.accepted, GROUP) <= 20);
});

await test('unchanged edits count against the window, as the production log proved', async () => {
  const { clock, sim, telegram } = governed({ sim: { notModified: () => true } });
  for (let i = 0; i < 25; i++) {
    await clock.run(telegram.callApi('editMessageText', { chat_id: GROUP, message_id: i }).catch(() => {}));
  }
  assert.equal(sim.refused, 0, '"message is not modified" calls still use up the group window');
  assert.ok(maxInAnyMinute(sim.calls, GROUP) <= 20);
});

await test('a 429 holds the chat for retry_after: low priority is dropped without calling Telegram', async () => {
  const { clock, tracker, sim, telegram } = governed({ sim: { groupLimit: 3, retryAfter: 40 } });
  // Telegram's real limit here is lower than documented, so the 4th call is refused.
  await quiet(async () => {
    for (let i = 0; i < 4; i++) await clock.run(withTelegramRequestPriority('low', () => telegram.callApi('editMessageText', { chat_id: GROUP, message_id: i })).catch(error => error));
  });
  assert.equal(sim.refused, 1);
  const callsAfterRefusal = sim.calls.length;

  const held = await clock.run(withTelegramRequestPriority('low', () => telegram.callApi('editMessageText', { chat_id: GROUP, message_id: 9 })).catch(error => error));
  assert.ok(isTelegramLocalThrottleError(held), 'The edit must fail locally');
  assert.equal(held.reason, 'retry_after');
  assert.equal(held.response.parameters.retry_after, 40);
  assert.equal(sim.calls.length, callsAfterRefusal, 'Nothing may reach Telegram while it said to wait');

  // Another chat is not under flood control and is unaffected.
  await clock.run(withTelegramRequestPriority('low', () => telegram.callApi('editMessageText', { chat_id: OTHER_GROUP, message_id: 1 })));
  // Long polling has no chat and must never be stalled by a chat's flood control.
  await clock.run(telegram.callApi('getUpdates', { timeout: 30 }));
  assert.equal(sim.calls.length, callsAfterRefusal + 2);
  assert.equal(tracker.getSnapshot().blocks.length, 1);
});

await test('a 429 delays a normal-priority request until retry_after, then sends it once', async () => {
  const { clock, tracker, sim, telegram } = governed({ sim: { groupLimit: 3 } });
  await quiet(async () => {
    for (let i = 0; i < 3; i++) await clock.run(telegram.callApi('sendMessage', { chat_id: GROUP, text: String(i) }));
    const refusedAt = clock.now;
    // The 4th is refused by Telegram ("retry after 60"), then retried by the governor once that passed.
    await clock.run(telegram.callApi('sendMessage', { chat_id: GROUP, text: 'queued confirmation' }));
    assert.ok(clock.now - refusedAt >= 60_000, 'The retry must wait out retry_after');
  });
  assert.equal(sim.refused, 1, 'Only the first attempt may be refused');
  assert.equal(sim.accepted.at(-1).method, 'sendMessage');
  assert.equal(tracker.getSnapshot().retriedRequests, 1);
});

await test('low-priority requests are never retried after a real 429', async () => {
  const { clock, sim, telegram } = governed({ sim: { groupLimit: 0, retryAfter: 5 } });
  const error = await quiet(() => clock.run(withTelegramRequestPriority('low', () => telegram.callApi('editMessageText', { chat_id: GROUP })).catch(e => e)));
  assert.equal(error.response.error_code, 429);
  assert.ok(!isTelegramLocalThrottleError(error), 'The real refusal is rethrown');
  assert.equal(sim.calls.length, 1);
});

await test('a retry_after longer than the wait budget fails fast instead of blocking the bot', async () => {
  const { clock, sim, telegram } = governed({ sim: { groupLimit: 0, retryAfter: 2282 } });
  const refused = await quiet(() => clock.run(telegram.callApi('sendMessage', { chat_id: GROUP }).catch(e => e)));
  assert.equal(refused.response.parameters.retry_after, 2282);
  assert.equal(sim.calls.length, 1, 'No retry when Telegram asks for 38 minutes');

  const startedAt = clock.now;
  const held = await clock.run(telegram.callApi('sendMessage', { chat_id: GROUP }).catch(e => e));
  assert.ok(isTelegramLocalThrottleError(held));
  assert.equal(clock.now, startedAt, 'A wait beyond the budget must not be slept at all');
  assert.equal(sim.calls.length, 1);
});

await test('a refusal outranks contradicting successes until it is old news', () => {
  const clock = { now: 9_000_000 };
  const tracker = new TelegramRateLimitTracker({ now: () => clock.now });
  const accept = () => tracker.recordSuccess(tracker.recordRequest('editMessageText', { chat_id: GROUP }));
  const refuse = () => tracker.recordError({ response: { error_code: 429, description: 'Too Many Requests: retry after 30', parameters: { retry_after: 30 } } }, tracker.recordRequest('editMessageText', { chat_id: GROUP }));
  const group = () => tracker.getSnapshot().rules.find(rule => rule.id === 'group');

  // Refused at 20 in our window: the limit is 19.
  for (let i = 0; i < 19; i++) accept();
  assert.equal(refuse().ruleId, 'group');
  assert.equal(group().limit, 19);

  // Minutes later Telegram's misaligned window lets 23 through. That must not
  // talk the estimate back up into the next refusal ("observed limit 21, peak 23").
  clock.now += 2 * 60_000;
  for (let i = 0; i < 23; i++) accept();
  assert.equal(group().limit, 19);
  assert.equal(group().peak, 23);

  // Once the refusal is older than the evidence horizon the documented value returns.
  clock.now += LIMIT_EVIDENCE_TTL_MS + 60_000;
  accept();
  assert.equal(group().limit, 20);
  assert.equal(group().limitSource, 'documented');
});

await test('a refusal at the estimated limit is explained and does not lower it', () => {
  const clock = { now: 9_000_000 };
  const tracker = new TelegramRateLimitTracker({ now: () => clock.now });
  for (let i = 0; i < 20; i++) tracker.recordSuccess(tracker.recordRequest('sendMessage', { chat_id: GROUP }));
  const observed = tracker.recordError({ response: { error_code: 429, description: 'Too Many Requests: retry after 9', parameters: { retry_after: 9 } } }, tracker.recordRequest('sendMessage', { chat_id: GROUP }));
  assert.equal(observed.ruleId, 'group');
  assert.equal(observed.windowCount, 21);
  const group = tracker.getSnapshot().rules.find(rule => rule.id === 'group');
  assert.equal(group.limit, 20, 'The 21st was refused, which is exactly what the limit of 20 predicts');
  assert.equal(group.limitSource, 'documented');
});

console.log(`\nTests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
if (failed > 0) process.exit(1);
