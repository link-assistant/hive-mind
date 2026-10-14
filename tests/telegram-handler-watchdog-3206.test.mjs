#!/usr/bin/env node
/**
 * Unit tests for the pieces that keep the Telegram update loop free:
 * the handler watchdog, the background-task helpers, the update error
 * handler's treatment of Telegraf's handler timeout, and the heartbeat field.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installHandlerWatchdog } from '../src/telegram-handler-watchdog.lib.mjs';
import { createKeyClaims, createSerialLane, detachHandler, getBackgroundTaskStats, runInBackground } from '../src/telegram-background-task.lib.mjs';
import { createUpdateErrorHandler, isTelegrafHandlerTimeoutError } from '../src/telegram-update-error.lib.mjs';
import { createHeartbeat } from '../src/bot-lifecycle.lib.mjs';

function recordingLogger() {
  const lines = { warn: [], error: [], log: [] };
  return { lines, warn: (...args) => lines.warn.push(args.join(' ')), error: (...args) => lines.error.push(args.join(' ')), log: (...args) => lines.log.push(args.join(' ')) };
}

/** A minimal Telegraf-like composer: `command` registers through `use`, like Telegraf does. */
function fakeBot() {
  const middlewares = [];
  const bot = {
    use(...fns) {
      middlewares.push(...fns);
      return this;
    },
    command(trigger, ...fns) {
      return this.use((ctx, next) => (ctx.command === trigger ? fns[0](ctx, next) : next()));
    },
    on(type, ...fns) {
      return this.use((ctx, next) => fns[0](ctx, next));
    },
    async handle(ctx) {
      const run = index => (index === middlewares.length ? Promise.resolve() : Promise.resolve(middlewares[index](ctx, () => run(index + 1))));
      await run(0);
    },
  };
  return bot;
}

/** A manual clock with timers that fire when time is advanced. */
function manualClock() {
  let now = 0;
  const timers = new Set();
  return {
    now: () => now,
    setTimeout(fn, delay) {
      const timer = { fn, at: now + delay };
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) {
      timers.delete(timer);
    },
    advance(ms) {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at <= now) {
          timers.delete(timer);
          timer.fn();
        }
      }
    },
  };
}

test('the watchdog warns while a handler holds the update loop and when it ends', async () => {
  const clock = manualClock();
  const logger = recordingLogger();
  const bot = fakeBot();
  const watchdog = installHandlerWatchdog(bot, { thresholdMs: 2000, logger, now: clock.now, setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout });
  let release;
  bot.command('slow', () => new Promise(resolve => (release = resolve)));
  const ctx = { command: 'slow', update: { update_id: 5 }, chat: { id: -1 }, message: { text: '/slow now' } };
  const handled = bot.handle(ctx);
  clock.advance(1999);
  assert.equal(logger.lines.warn.length, 0, 'no warning before the threshold');
  clock.advance(1);
  assert.equal(logger.lines.warn.length, 1);
  assert.match(logger.lines.warn[0], /command\(slow\) has been running for 2000 ms on update 5 in chat -1 \(\/slow\)/);
  assert.equal(watchdog.getStats().running, 1);
  clock.advance(1500);
  release();
  await handled;
  assert.equal(logger.lines.warn.length, 2);
  assert.match(logger.lines.warn[1], /held update 5 .* for 3500 ms/);
  const stats = watchdog.getStats();
  assert.equal(stats.slow, 1);
  assert.equal(stats.stalled, 1);
  assert.equal(stats.running, 0);
  assert.equal(stats.slowestHandler, 'command(slow)');
});

test('time spent in next() is not charged to the calling middleware, and handlers are wrapped once', async () => {
  const clock = manualClock();
  const logger = recordingLogger();
  const bot = fakeBot();
  const watchdog = installHandlerWatchdog(bot, { thresholdMs: 2000, logger, now: clock.now, setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout });
  bot.use(async function logEverything(ctx, next) {
    await next();
  });
  let release;
  bot.on('message', () => new Promise(resolve => (release = resolve)));
  const handled = bot.handle({ update: { update_id: 9 }, chat: { id: 1 } });
  clock.advance(5000);
  release();
  await handled;
  assert.equal(watchdog.getStats().handled, 2, 'two middlewares ran, each counted once');
  assert.equal(watchdog.getStats().slow, 1, 'only the slow handler is reported');
  assert.ok(
    logger.lines.warn.every(line => line.includes('on(message)')),
    logger.lines.warn.join('\n')
  );
});

test('fast and synchronous handlers pass through untouched', async () => {
  const logger = recordingLogger();
  const bot = fakeBot();
  const watchdog = installHandlerWatchdog(bot, { logger });
  let seen = null;
  bot.command('help', ctx => {
    seen = ctx.command;
    return 'sync result';
  });
  await bot.handle({ command: 'help' });
  assert.equal(seen, 'help');
  assert.equal(logger.lines.warn.length, 0);
  assert.equal(watchdog.getStats().handled, 1);
  const failing = fakeBot();
  installHandlerWatchdog(failing, { logger });
  failing.command('boom', () => {
    throw new Error('boom');
  });
  await assert.rejects(failing.handle({ command: 'boom' }), /boom/);
});

test('a detached handler returns at once and reports its failure with the update context', async () => {
  const errors = [];
  let finish;
  const handler = detachHandler(
    async ctx => {
      await new Promise(resolve => (finish = resolve));
      throw new Error(`failed for ${ctx.update.update_id}`);
    },
    { onError: (error, ctx) => errors.push([error.message, ctx.update.update_id]) }
  );
  const before = getBackgroundTaskStats();
  const returned = handler({ update: { update_id: 11 } });
  assert.equal(returned, undefined, 'the update path gets nothing to await');
  assert.equal(getBackgroundTaskStats().running, before.running + 1);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, [['failed for 11', 11]]);
  assert.equal(getBackgroundTaskStats().running, before.running);
  assert.equal(getBackgroundTaskStats().failed, before.failed + 1);
});

test('runInBackground never rejects, even when the task throws synchronously or the reporter fails', async () => {
  const logger = recordingLogger();
  await runInBackground(
    () => {
      throw new Error('sync');
    },
    { logger }
  );
  assert.match(logger.lines.error[0], /background task failed/);
  await runInBackground(
    async () => {
      throw new Error('async');
    },
    {
      logger,
      onError: () => {
        throw new Error('reporter');
      },
    }
  );
  assert.match(logger.lines.error[1], /reporting the failure failed too/);
});

test('a serial lane runs detached handlers one after another, past failures', async () => {
  const lane = createSerialLane();
  const order = [];
  let releaseFirst;
  const first = lane(async () => {
    order.push('first:start');
    await new Promise(resolve => (releaseFirst = resolve));
    order.push('first:end');
    throw new Error('first failed');
  });
  const second = lane(async () => order.push('second'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['first:start']);
  releaseFirst();
  await assert.rejects(first, /first failed/);
  await second;
  assert.deepEqual(order, ['first:start', 'first:end', 'second']);
});

test('key claims refuse a second launch for the same URL until the first is released', () => {
  const claims = createKeyClaims();
  const release = claims.claim('https://github.com/o/r/issues/1');
  assert.equal(typeof release, 'function');
  assert.equal(claims.claim('https://github.com/o/r/issues/1'), null);
  assert.equal(typeof claims.claim('https://github.com/o/r/issues/2'), 'function');
  assert.equal(claims.size, 2);
  release();
  release();
  assert.equal(claims.has('https://github.com/o/r/issues/1'), false);
  assert.equal(typeof claims.claim('https://github.com/o/r/issues/1'), 'function');
});

test("Telegraf's handler timeout is logged, not reported or answered", () => {
  const timeout = new Error('Promise timed out after 60000 milliseconds');
  timeout.name = 'TimeoutError';
  assert.equal(isTelegrafHandlerTimeoutError(timeout), true);
  assert.equal(isTelegrafHandlerTimeoutError(new Error('Promise timed out after 60000 milliseconds')), true);
  assert.equal(isTelegrafHandlerTimeoutError(new Error('docker pull timed out')), false);
  assert.equal(isTelegrafHandlerTimeoutError(null), false);
  const logger = recordingLogger();
  const reported = [];
  const replies = [];
  const handleUpdateError = createUpdateErrorHandler({ logger, reportError: error => reported.push(error), safeReply: async (ctx, text) => replies.push(text) });
  handleUpdateError(timeout, { update: { update_id: 3 }, reply: async () => {} });
  assert.deepEqual(reported, []);
  assert.deepEqual(replies, []);
  assert.match(logger.lines.warn[0], /Update 3 is still being handled/);
});

test('other errors keep the existing report and reply, with secrets redacted', async () => {
  const logger = recordingLogger();
  const reported = [];
  const replies = [];
  const handleUpdateError = createUpdateErrorHandler({ logger, reportError: (error, context) => reported.push(context), safeReply: async (ctx, text) => replies.push(text) });
  handleUpdateError(new Error('token=abc123 rejected'), { update: { update_id: 4 }, chat: { id: 8, type: 'group' }, from: { id: 2 }, message: { text: '/solve https://x' }, reply: async () => {} });
  assert.equal(reported[0].telegramContext.command, '/solve');
  assert.equal(replies.length, 1);
  assert.match(replies[0], /An error occurred while processing your request/);
  assert.doesNotMatch(replies[0], /abc123/);
});

test('the heartbeat carries the handler counters', () => {
  const beats = [];
  const heartbeat = createHeartbeat({
    logger: { heartbeat: data => beats.push(data) },
    getActiveSessionCount: () => 0,
    captureResources: null,
    setIntervalImpl: () => null,
    getHandlerStats: () => ({ slow: 2, background: { running: 1 } }),
  });
  heartbeat.beat();
  assert.deepEqual(beats[0].handlers, { slow: 2, background: { running: 1 } });
  const without = [];
  createHeartbeat({ logger: { heartbeat: data => without.push(data) }, captureResources: null }).beat();
  assert.equal('handlers' in without[0], false);
});
