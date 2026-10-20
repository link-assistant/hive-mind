/**
 * @hive-mind-test-suite default
 * Issue #3614: polling loops in the bot never overlap themselves.
 *
 * `setInterval(asyncTick)` starts a new tick every interval even while the
 * previous one is still waiting on Docker, so a slow daemon multiplied the
 * processes the bot started. Covered here:
 *   - startSerialPoller() schedules the next tick only after the current one
 *     settled, keeps going after a failed tick, and stops cleanly;
 *   - sidecar maintenance (router / formal-ai) skips a tick while one runs;
 *   - monitorSessions() with a per-session budget does not let one slow
 *     completion hold up the other sessions, and does not start it twice.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { startSerialPoller } from '../src/serial-poller.lib.mjs';
import { startSidecarMaintenance } from '../src/docker-sidecar.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function deferred() {
  let resolve;
  const promise = new Promise(res => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Manual timer: tests fire the pending timeout explicitly. */
function manualTimers() {
  const pending = new Set();
  return {
    pending,
    setTimeoutImpl: (fn, ms) => {
      const timer = { fn, ms };
      pending.add(timer);
      return timer;
    },
    clearTimeoutImpl: timer => pending.delete(timer),
    fire() {
      const [timer] = pending;
      assert.ok(timer, 'a timer is pending');
      pending.delete(timer);
      timer.fn();
    },
  };
}

test('startSerialPoller runs the first tick at once and schedules the next only after it settles', async () => {
  const timers = manualTimers();
  const gate = deferred();
  let ticks = 0;
  const poller = startSerialPoller(
    () => {
      ticks += 1;
      return gate.promise;
    },
    { intervalMs: 1000, setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl }
  );
  assert.equal(ticks, 1);
  assert.equal(poller.isTickRunning(), true);
  assert.equal(timers.pending.size, 0, 'no timer while the tick is still running');
  gate.resolve();
  await poller.whenIdle();
  assert.equal(timers.pending.size, 1);
  assert.equal([...timers.pending][0].ms, 1000);
  timers.fire();
  assert.equal(ticks, 2);
  await poller.whenIdle();
  poller.stop();
  assert.equal(timers.pending.size, 0, 'stop() clears the pending timer');
  assert.equal(poller.isStopped(), true);
});

test('startSerialPoller never overlaps a slow tick with real timers', async () => {
  let running = 0;
  let maxRunning = 0;
  let ticks = 0;
  const poller = startSerialPoller(
    async () => {
      ticks += 1;
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await sleep(30); // three times the interval
      running -= 1;
    },
    { intervalMs: 10 }
  );
  await sleep(200);
  poller.stop();
  await poller.whenIdle();
  assert.equal(maxRunning, 1);
  assert.ok(ticks >= 2 && ticks <= 6, `ticks: ${ticks}`);
});

test('startSerialPoller keeps polling after a failed tick and reports the error', async () => {
  const timers = manualTimers();
  const errors = [];
  let ticks = 0;
  const poller = startSerialPoller(
    async () => {
      ticks += 1;
      if (ticks === 1) throw new Error('docker down');
    },
    { intervalMs: 5, onError: error => errors.push(error.message), setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl }
  );
  await poller.whenIdle();
  assert.deepEqual(errors, ['docker down']);
  timers.fire();
  await poller.whenIdle();
  assert.equal(ticks, 2);
  poller.stop();
});

test('startSerialPoller with runImmediately: false waits one interval; stop() during a tick prevents rescheduling', async () => {
  const timers = manualTimers();
  const gate = deferred();
  let ticks = 0;
  const poller = startSerialPoller(() => (ticks++, gate.promise), { intervalMs: 2000, runImmediately: false, setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl });
  assert.equal(ticks, 0);
  timers.fire();
  assert.equal(ticks, 1);
  poller.stop();
  gate.resolve();
  await poller.whenIdle();
  await sleep(0);
  assert.equal(timers.pending.size, 0);
});

test('sidecar maintenance skips a tick while the previous one is still running', async () => {
  let intervalTick;
  let cleared = false;
  const gate = deferred();
  let runs = 0;
  const handle = startSidecarMaintenance({
    runTick: () => (runs++, gate.promise),
    intervalMs: 1000,
    setIntervalImpl: fn => ((intervalTick = fn), { unref() {} }),
    clearIntervalImpl: () => {
      cleared = true;
    },
  });
  await sleep(0);
  assert.equal(runs, 1, 'the first tick runs immediately');
  intervalTick();
  intervalTick();
  await sleep(0);
  assert.equal(runs, 1, 'overdue ticks are skipped while one is in flight');
  gate.resolve();
  await sleep(0);
  await sleep(0);
  intervalTick();
  await sleep(0);
  assert.equal(runs, 2, 'the next tick runs once the previous one finished');
  handle.stop();
  assert.equal(cleared, true);
});

test('monitorSessions with a session budget does not let one slow session hold up the others', async () => {
  resetSessionMonitorForTests();
  const slow = deferred();
  const statusCalls = [];
  const options = {
    sessionBudgetMs: 1500,
    statusProvider: async sessionName => {
      statusCalls.push(sessionName);
      if (sessionName === 'slow-session') await slow.promise;
      return { exists: true, status: 'executing', exitCode: null };
    },
    backendAlive: async () => true,
    exitFromLog: () => null,
    dockerContainerSizeProvider: async () => null,
  };
  const bot = { telegram: { editMessageText: async () => {}, sendMessage: async () => ({ chat: { id: 1 }, message_id: 1 }) } };
  const info = { chatId: 1, messageId: 1, startTime: new Date(), command: 'solve', tool: 'claude', isolationBackend: 'docker', url: 'https://github.com/o/r/issues/1' };
  try {
    trackSession('slow-session', { ...info, sessionId: 'slow-session' }, false);
    trackSession('fast-session', { ...info, sessionId: 'fast-session' }, false);
    const started = Date.now();
    await monitorSessions(bot, false, options);
    assert.ok(Date.now() - started < 5000, 'the pass returned after the budget, not after the slow session');
    assert.ok(statusCalls.includes('fast-session'), 'the other session was checked');
    statusCalls.length = 0;
    await monitorSessions(bot, false, options);
    assert.ok(!statusCalls.includes('slow-session'), 'the slow session is not started a second time while it is still handled');
    assert.ok(statusCalls.includes('fast-session'));
  } finally {
    slow.resolve();
    await sleep(10);
    resetSessionMonitorForTests();
  }
});
