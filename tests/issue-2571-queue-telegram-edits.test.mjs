/**
 * @hive-mind-test-suite default
 *
 * Issue #2571: a queue of 20+ waiting cards in one group edited every card every
 * consumer cycle, because CPU %, process counts and countdowns changed each
 * reason text. Telegram refused the 21st edit of every burst (86 429s) and 38% of
 * all edits re-sent text the message already showed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SolveQueue, QueueItemStatus, QUEUE_CONFIG, waitingReasonSkeleton } from '../src/telegram-solve-queue.lib.mjs';
import { createTelegramLocalThrottleError, getTelegramRequestPriority } from '../src/telegram-rate-limit.lib.mjs';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';

await initI18n('en');
await preloadAllLocales();

const GROUP = -1002975819706;

function recordingTelegram({ refuseAfter = Infinity } = {}) {
  const edits = [];
  return {
    edits,
    editMessageText: async (chatId, messageId, _inline, text) => {
      if (edits.length >= refuseAfter) throw createTelegramLocalThrottleError({ method: 'editMessageText', chatId, retryAfterMs: 30_000, reason: 'group_window' });
      edits.push({ chatId, messageId, text, priority: getTelegramRequestPriority() });
      return true;
    },
  };
}

function queueWithCards(count, telegram, reasons) {
  // No background consumer: the test drives the cycles itself.
  const queue = new SolveQueue({ verbose: false, autoStart: false });
  queue.log = () => {};
  let cycle = 0;
  queue.canStartCommand = async () => ({ canStart: false, reason: reasons(cycle) });
  const items = [];
  for (let i = 0; i < count; i++) {
    const item = queue.enqueue({ url: `https://github.com/test/repo/issues/${i + 1}`, args: '', requester: 'user', infoBlock: `Issue ${i + 1}`, tool: 'claude' });
    item.messageInfo = { chatId: GROUP, messageId: 100 + i };
    item.ctx = { telegram };
    items.push(item);
  }
  return { queue, items, nextCycle: () => cycle++ };
}

test('waiting reasons that only differ in numbers have the same skeleton', () => {
  assert.equal(waitingReasonSkeleton('CPU usage is 91.5% (threshold: 90%)'), waitingReasonSkeleton('CPU usage is 87% (threshold: 90%)'));
  assert.equal(waitingReasonSkeleton('Minimum interval between commands not reached (3m 12s remaining)'), waitingReasonSkeleton('Minimum interval between commands not reached (9s remaining)'));
  assert.notEqual(waitingReasonSkeleton('CPU usage is 91%'), waitingReasonSkeleton('Disk usage is 91%'));
  assert.notEqual(waitingReasonSkeleton('Claude process is already running (1 processes)'), waitingReasonSkeleton('Claude process is already running (1 processes)\nCodex process is already running (1 processes)'));
  assert.equal(waitingReasonSkeleton(null), null);
});

test('production replay: changing numbers no longer edit every card every cycle', async () => {
  const telegram = recordingTelegram();
  // The reasons seen in the production log: CPU and the countdown change every minute.
  const { queue, items, nextCycle } = queueWithCards(25, telegram, cycle => `CPU usage is ${90 + (cycle % 7)}% (threshold: 90%)\nClaude process is already running (${1 + (cycle % 2)} processes)`);
  try {
    await queue.updateAllWaitingItems();
    assert.equal(telegram.edits.length, 25, 'Every card shows its waiting reason once');
    for (let cycle = 1; cycle < 5; cycle++) {
      nextCycle();
      await queue.updateAllWaitingItems();
    }
    assert.equal(telegram.edits.length, 25, 'Number-only changes wait for the periodic refresh');
    assert.ok(QUEUE_CONFIG.MESSAGE_UPDATE_INTERVAL_MS >= 5 * 60_000 || process.env.HIVE_MIND_MESSAGE_UPDATE_INTERVAL_MS, 'The default refresh must keep 20+ cards under 20 edits per minute');
    assert.ok(
      telegram.edits.every(edit => edit.priority === 'low'),
      'Waiting-card edits must never compete with replies'
    );

    // A new kind of reason is news and is shown at once.
    queue.canStartCommand = async () => ({ canStart: false, reason: 'Disk usage is 95% (threshold: 90%)' });
    await queue.updateAllWaitingItems();
    assert.equal(telegram.edits.length, 50);
    assert.ok(items.every(item => item.status === QueueItemStatus.WAITING));
  } finally {
    queue.stop();
  }
});

test('a periodic refresh never re-sends the text the message already shows', async () => {
  const telegram = recordingTelegram();
  const { queue, items } = queueWithCards(3, telegram, () => 'Claude process is already running (1 processes)');
  try {
    await queue.updateAllWaitingItems();
    for (const item of items) item.lastMessageUpdateTime = Date.now() - QUEUE_CONFIG.MESSAGE_UPDATE_INTERVAL_MS - 1;
    await queue.updateAllWaitingItems();
    assert.equal(telegram.edits.length, 3, 'Identical text must not reach Telegram ("message is not modified" still counts)');
    assert.ok(
      items.every(item => Date.now() - item.lastMessageUpdateTime < 1000),
      'The skipped refresh still counts as fresh'
    );
  } finally {
    queue.stop();
  }
});

test('a position change is shown at once', async () => {
  const telegram = recordingTelegram();
  const { queue, items } = queueWithCards(3, telegram, () => 'Claude process is already running (1 processes)');
  try {
    await queue.updateAllWaitingItems();
    queue.queues.claude.shift();
    await queue.updateAllWaitingItems();
    assert.equal(telegram.edits.length, 5, 'Both remaining cards move up one position');
    assert.match(telegram.edits.at(-1).text, /queue #2\)/);
    assert.equal(items[2].lastRenderedPosition, 2);
  } finally {
    queue.stop();
  }
});

test('after a rate-limit refusal the rest of that chat waits for the next cycle, without error logs', async () => {
  const telegram = recordingTelegram({ refuseAfter: 15 });
  const { queue, items } = queueWithCards(25, telegram, () => 'Claude process is already running (1 processes)');
  const logged = [];
  queue.log = message => logged.push(message);
  const calls = [];
  const edit = telegram.editMessageText;
  telegram.editMessageText = (...args) => {
    calls.push(args[1]);
    return edit(...args);
  };
  try {
    await queue.updateAllWaitingItems();
    assert.equal(telegram.edits.length, 15);
    assert.deepEqual(calls, [...items.slice(0, 16).map(item => item.messageInfo.messageId)], 'One refusal stops the cycle for that chat');
    assert.deepEqual(logged, [], 'A deferred refresh is not a failure');
    assert.ok(
      items.slice(15).every(item => item.lastRenderedText === null && item.lastMessageUpdateTime === null),
      'Deferred cards are retried next cycle'
    );
  } finally {
    queue.stop();
  }
});
