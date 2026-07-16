#!/usr/bin/env node
/**
 * Tests for the bot lifecycle helpers (issue #1927).
 *
 * These three concerns — heartbeat, resume-on-launch, and shutdown — were inline
 * in telegram-bot.mjs (the untestable entrypoint). Extracting them into
 * bot-lifecycle.lib.mjs lets us assert the behaviour directly with injected
 * logger / process / console / timer doubles, with zero production change.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import { createHeartbeat, resumeSessionsOnLaunch, createShutdownHandler } from '../src/bot-lifecycle.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1927: bot lifecycle helpers');
console.log('='.repeat(60));

function captureLogger() {
  const events = [];
  const heartbeats = [];
  const errors = [];
  return {
    events,
    heartbeats,
    errors,
    event: (type, data) => events.push({ type, data }),
    heartbeat: data => heartbeats.push(data),
    error: (message, meta) => errors.push({ message, meta }),
    debug() {},
    info() {},
    warn() {},
  };
}

function captureConsole() {
  const log = [];
  const error = [];
  return { log, error, impl: { log: m => log.push(String(m)), error: m => error.push(String(m)) } };
}

// A fake timer registry so start()/stop() are observable without real timers.
function fakeTimers() {
  let nextId = 1;
  const active = new Map();
  return {
    active,
    setInterval: (fn, ms) => {
      const id = {
        id: nextId++,
        fn,
        ms,
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        },
      };
      active.set(id, fn);
      return id;
    },
    clearInterval: id => {
      active.delete(id);
    },
  };
}

// =============================================================================
// createHeartbeat
// =============================================================================
{
  const logger = captureLogger();
  const timers = fakeTimers();
  const proc = { uptime: () => 42 };
  const hb = createHeartbeat({
    logger,
    getActiveSessionCount: () => 3,
    intervalMs: 1000,
    processImpl: proc,
    setIntervalImpl: timers.setInterval,
    clearIntervalImpl: timers.clearInterval,
    captureResources: () => ({
      phase: 'bot_heartbeat',
      timestamp: '2026-06-29T18:00:00.000Z',
      cpu: { load1: 1, load5: 0.5, load15: 0.25, cpuCount: 4 },
      memory: { totalBytes: 16, availableBytes: 8, usedBytes: 8, processRssBytes: 4 },
      disk: { path: '/', totalBytes: 100, availableBytes: 75, usedBytes: 25, usedPercent: 25, error: null },
    }),
  });

  assert(hb.timer === null, 'heartbeat starts with no timer');
  hb.start();
  assert(logger.heartbeats.length === 1, 'start() writes an immediate beat (no waiting a full interval)');
  assert(logger.heartbeats[0].activeSessions === 3 && logger.heartbeats[0].uptimeSec === 42, 'beat carries active session count and integer uptime');
  assert(logger.heartbeats[0].resources.disk.usedBytes === 25, 'beat carries a structured resource snapshot for outside-container logs');
  assert(hb.timer && timers.active.size === 1, 'start() registers exactly one interval');
  assert(hb.timer.unrefCalled === true, "the interval is unref'd so it never keeps the process alive on its own");
  assert(hb.timer.ms === 1000, 'the configured interval is used');

  hb.start(); // idempotent
  assert(timers.active.size === 1 && logger.heartbeats.length === 1, 'start() is idempotent (no second timer, no extra beat)');

  hb.timer.fn(); // simulate an interval tick
  assert(logger.heartbeats.length === 2, 'each interval tick writes a heartbeat');

  hb.stop();
  assert(hb.timer === null && timers.active.size === 0, 'stop() clears the interval');
  hb.stop(); // idempotent, no throw
  assert(true, 'stop() is safe to call twice');
}

// A heartbeat whose logger throws must never crash the bot.
{
  const proc = { uptime: () => 1 };
  const timers = fakeTimers();
  const throwingLogger = {
    heartbeat: () => {
      throw new Error('disk full');
    },
  };
  const hb = createHeartbeat({ logger: throwingLogger, getActiveSessionCount: () => 0, processImpl: proc, setIntervalImpl: timers.setInterval, clearIntervalImpl: timers.clearInterval });
  let threw = false;
  try {
    hb.start();
    hb.beat();
  } catch {
    threw = true;
  }
  assert(threw === false, 'a heartbeat logging failure is swallowed (never crashes the bot)');
}

// A resource probe failure must not suppress the heartbeat itself.
{
  const logger = captureLogger();
  const timers = fakeTimers();
  const proc = { uptime: () => 9 };
  const hb = createHeartbeat({
    logger,
    getActiveSessionCount: () => 1,
    processImpl: proc,
    setIntervalImpl: timers.setInterval,
    clearIntervalImpl: timers.clearInterval,
    captureResources: () => {
      throw new Error('statfs failed');
    },
  });
  hb.start();
  assert(logger.heartbeats.length === 1, 'a failed resource probe still writes a heartbeat');
  assert(logger.heartbeats[0].resources === null, 'failed resource probe is recorded as null resources');
}

// =============================================================================
// resumeSessionsOnLaunch
// =============================================================================
{
  const logger = captureLogger();
  const con = captureConsole();
  let calledWith = null;
  const resumeTrackedSessions = async opts => {
    calledWith = opts;
    return { resumed: [{ sessionName: 'uuid-a' }, { sessionName: 'uuid-b' }], skipped: [{ sessionName: 'uuid-c', reason: 'started-after-bot-start' }] };
  };
  const out = await resumeSessionsOnLaunch({ resumeTrackedSessions, botStartTime: 1000, verbose: true, logger, consoleImpl: con.impl });

  assert(calledWith.botStartTime === 1000 && calledWith.verbose === true, 'resume passes botStartTime and verbose through');
  assert(out.resumed.length === 2 && out.skipped.length === 1, 'resume returns the resumed/skipped breakdown');
  assert(
    con.log.some(l => /Resumed 2 session\(s\)/.test(l)),
    'a non-empty resume prints a user-facing line'
  );
  const evt = logger.events.find(e => e.type === 'sessions_resumed');
  assert(evt && evt.data.resumed === 2 && evt.data.skipped === 1, 'a sessions_resumed event records the counts');
  assert(JSON.stringify(evt.data.sessions) === JSON.stringify(['uuid-a', 'uuid-b']), 'the event lists the resumed session names');
}

// No resumed sessions: no user-facing line, but the event is still recorded.
{
  const logger = captureLogger();
  const con = captureConsole();
  const out = await resumeSessionsOnLaunch({ resumeTrackedSessions: async () => ({ resumed: [], skipped: [] }), botStartTime: 1, logger, consoleImpl: con.impl });
  assert(out.resumed.length === 0, 'no sessions resumed');
  assert(con.log.length === 0, 'nothing is printed when there is nothing to resume');
  assert(
    logger.events.some(e => e.type === 'sessions_resumed' && e.data.resumed === 0),
    'a sessions_resumed event is still recorded (resumed: 0)'
  );
}

// A resume failure must never stop the bot from coming up.
{
  const logger = captureLogger();
  const con = captureConsole();
  const out = await resumeSessionsOnLaunch({
    resumeTrackedSessions: async () => {
      throw new Error('snapshot unreadable');
    },
    botStartTime: 1,
    logger,
    consoleImpl: con.impl,
  });
  assert(out.resumed.length === 0 && out.error instanceof Error, 'resume swallows the error and returns an empty result');
  assert(
    con.error.some(l => /Failed to resume/.test(l)),
    'the failure is surfaced on the console'
  );
  assert(
    logger.errors.some(e => /Failed to resume/.test(e.message)),
    'the failure is logged'
  );
}

// =============================================================================
// createShutdownHandler
// =============================================================================
{
  const logger = captureLogger();
  const con = captureConsole();
  const order = [];
  const proc = { pid: 111, ppid: 222, uptime: () => 7 };
  const bot = { stop: sig => order.push(`stop:${sig}`) };
  const handle = createShutdownHandler({
    logger,
    getActiveSessionCount: () => 4,
    verbose: true,
    bot,
    processImpl: proc,
    consoleImpl: con.impl,
    onShutdown: () => order.push('onShutdown'),
    cleanup: () => order.push('cleanup'),
  });

  handle('SIGTERM');
  assert(order[0] === 'onShutdown', 'onShutdown runs first (sets the shutting-down flag before anything else)');
  assert(order.includes('cleanup'), 'cleanup runs (aborts retry loop, clears timers, stops queue)');
  assert(order[order.length - 1] === 'stop:SIGTERM', 'bot.stop(signal) runs last, with the real signal');
  const evt = logger.events.find(e => e.type === 'bot_shutdown');
  assert(evt && evt.data.signal === 'SIGTERM' && evt.data.pid === 111 && evt.data.activeSessions === 4, 'a timestamped bot_shutdown event records the signal, pid and active sessions');
  assert(
    con.log.some(l => /\[VERBOSE\] Signal: SIGTERM/.test(l)),
    'verbose mode logs the signal/pid'
  );
}

// Neither a logging failure nor a cleanup failure may block bot.stop.
{
  const stopped = [];
  const handle = createShutdownHandler({
    logger: {
      event: () => {
        throw new Error('log down');
      },
    },
    getActiveSessionCount: () => {
      throw new Error('count down');
    },
    bot: { stop: sig => stopped.push(sig) },
    processImpl: { pid: 1, ppid: 2, uptime: () => 0 },
    consoleImpl: captureConsole().impl,
    onShutdown: () => {},
    cleanup: () => {
      throw new Error('cleanup boom');
    },
  });
  let threw = false;
  try {
    handle('SIGINT');
  } catch {
    threw = true;
  }
  assert(threw === false, 'shutdown never throws even if logging and cleanup both fail');
  assert(stopped.length === 1 && stopped[0] === 'SIGINT', 'bot.stop(signal) still runs after logging/cleanup failures');
}

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
