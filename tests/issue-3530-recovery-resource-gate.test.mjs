/**
 * @hive-mind-test-suite default
 * A kill recovery waits for free and stable resources, like a queued task (#3530).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RECOVERY_RESOURCE_DEFAULTS, resolveRecoveryResourceGateConfig, createQueueRecoveryResourceGate, waitForRecoveryResources } from '../src/session-kill-resume.resource-gate.lib.mjs';
import { startKillRecoverySession } from '../src/session-kill-resume.lib.mjs';
import { formatRecoveryLifecycle } from '../src/session-recovery-lifecycle.lib.mjs';

const ENV = { HIVE_MIND_RECOVERY_RESOURCE_POLL_SECONDS: '10', HIVE_MIND_RECOVERY_RESOURCE_STABLE_CHECKS: '3', HIVE_MIND_RECOVERY_RESOURCE_MAX_WAIT_MINUTES: '5' };

function clock() {
  let ms = 1_000_000;
  const sleeps = [];
  return {
    now: () => ms,
    sleep: async delay => {
      sleeps.push(delay);
      ms += delay;
    },
    sleeps,
  };
}

function scriptedGate(results, reserveResults = [{ startReserved: true }]) {
  const checks = [];
  const reserves = [];
  return {
    checks,
    reserves,
    gate: {
      check: async options => {
        checks.push(options);
        const next = results.length > 1 ? results.shift() : results[0];
        if (next instanceof Error) throw next;
        return next;
      },
      reserve: async options => (reserves.push(options), reserveResults.length > 1 ? reserveResults.shift() : reserveResults[0]),
    },
  };
}

const PASS = { canStart: true, rejected: false, reasons: [] };
const LOW_RAM = { canStart: false, rejected: false, reasons: ['RAM usage is 91% (threshold 65%)'] };

test('configuration has documented defaults and accepts overrides', () => {
  assert.deepEqual(resolveRecoveryResourceGateConfig({}), { pollMs: RECOVERY_RESOURCE_DEFAULTS.pollSeconds * 1000, stableChecks: 3, maxWaitMs: 360 * 60 * 1000 });
  assert.deepEqual(resolveRecoveryResourceGateConfig(ENV), { pollMs: 10_000, stableChecks: 3, maxWaitMs: 5 * 60 * 1000 });
  assert.equal(resolveRecoveryResourceGateConfig({ HIVE_MIND_RECOVERY_RESOURCE_STABLE_CHECKS: 'nope' }).stableChecks, 3);
  assert.equal(resolveRecoveryResourceGateConfig({ HIVE_MIND_RECOVERY_RESOURCE_STABLE_CHECKS: '-1' }).stableChecks, 3, 'non-positive values fall back');
});

test('without a gate the recovery is not delayed (behaviour before #3530)', async () => {
  assert.deepEqual(await waitForRecoveryResources({ sessionName: 's', gate: null }), { ready: true, reason: null, waitedMs: 0, checks: 0 });
});

test('the recovery waits until resources pass several checks in a row, then reserves its slot', async () => {
  const c = clock();
  const g = scriptedGate([LOW_RAM, LOW_RAM, PASS, LOW_RAM, PASS, PASS, PASS]);
  const events = [];
  const result = await waitForRecoveryResources({ sessionName: 's', sessionInfo: { tool: 'codex', locale: 'en' }, attempt: 1, maxAttempts: 3, gate: g.gate, notify: async event => events.push(event), sleep: c.sleep, now: c.now, env: ENV });
  assert.equal(result.ready, true);
  assert.equal(result.checks, 7);
  assert.equal(result.waitedMs, 60_000);
  assert.deepEqual(c.sleeps, Array(6).fill(10_000));
  assert.deepEqual(g.checks[0], { tool: 'codex', locale: 'en' }, 'the same per-tool limits as a queued task');
  assert.equal(g.reserves.length, 1, 'the slot is reserved once, after the last stable check');
  // Telegram learns about every change, not about every unchanged poll.
  assert.deepEqual(
    events.map(event => [event.resourceState, event.stablePasses]),
    [
      ['blocked', 0],
      ['stabilizing', 1],
      ['blocked', 0],
      ['stabilizing', 1],
      ['stabilizing', 2],
    ]
  );
  assert.ok(events.every(event => event.phase === 'waiting-resources' && event.attempt === 1 && event.maxAttempts === 3));
  assert.match(events[0].reason, /RAM usage is 91%/);
});

test('a slot taken between the check and the reservation restarts the stability count', async () => {
  const c = clock();
  const g = scriptedGate([PASS], [{ startReserved: false, reason: 'another command started 5s ago' }, { startReserved: true }]);
  const events = [];
  const result = await waitForRecoveryResources({ sessionName: 's', gate: g.gate, notify: async event => events.push(event), sleep: c.sleep, now: c.now, env: { ...ENV, HIVE_MIND_RECOVERY_RESOURCE_STABLE_CHECKS: '2' } });
  assert.equal(result.ready, true);
  assert.equal(g.reserves.length, 2);
  assert.equal(result.checks, 4);
  assert.ok(events.some(event => event.resourceState === 'blocked' && /another command started/.test(event.reason)));
});

test('a queue that rejects work and a failing check both keep the recovery waiting', async () => {
  const c = clock();
  const g = scriptedGate([{ canStart: false, rejected: true, rejectReason: 'disk is full' }, new Error('free(1) missing'), PASS]);
  const events = [];
  const result = await waitForRecoveryResources({ sessionName: 's', gate: g.gate, notify: async event => events.push(event), sleep: c.sleep, now: c.now, env: { ...ENV, HIVE_MIND_RECOVERY_RESOURCE_STABLE_CHECKS: '1' } });
  assert.equal(result.ready, true);
  assert.deepEqual(
    events.map(event => event.reason),
    ['disk is full', 'the resource check failed: free(1) missing']
  );
});

test('the wait is bounded and says why it gave up', async () => {
  const c = clock();
  const g = scriptedGate([LOW_RAM]);
  const result = await waitForRecoveryResources({ sessionName: 's', gate: g.gate, sleep: c.sleep, now: c.now, env: ENV });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'resource-wait-timeout');
  assert.match(result.detail, /did not become stable within 5 minutes/);
  assert.match(result.detail, /RAM usage is 91%/);
  assert.equal(result.waitedMs, 5 * 60 * 1000);
  assert.equal(g.reserves.length, 0);
});

test('/stop while waiting cancels the recovery', async () => {
  const c = clock();
  const info = {};
  const g = scriptedGate([LOW_RAM]);
  const sleep = async ms => {
    await c.sleep(ms);
    info.stopRequestedByUser = true;
  };
  const result = await waitForRecoveryResources({ sessionName: 's', sessionInfo: info, gate: g.gate, sleep, now: c.now, env: ENV });
  assert.deepEqual([result.ready, result.reason, result.checks], [false, 'stopped-by-user', 1]);
});

test('the queue adapter uses the queue the bot uses for every task', () => {
  const calls = [];
  const queue = { canStartCommand: options => (calls.push(['check', options]), PASS), reserveStartSlot: options => (calls.push(['reserve', options]), { startReserved: true }) };
  const gate = createQueueRecoveryResourceGate(() => queue);
  gate.check({ tool: 'claude' });
  gate.reserve({ tool: 'claude' });
  assert.deepEqual(calls, [
    ['check', { tool: 'claude' }],
    ['reserve', { tool: 'claude' }],
  ]);
});

test('a recovery whose resources never settle is not launched, and Telegram shows the wait', async () => {
  const c = clock();
  const events = [];
  const launches = [];
  const result = await startKillRecoverySession({
    sessionName: 'killed',
    sessionInfo: { startTime: new Date(0), isolationBackend: 'screen', args: [], url: 'https://github.com/o/r/pull/1' },
    plan: { shouldResume: true, attempt: 1, maxAttempts: 2, command: { args: ['https://github.com/o/r/pull/1'], display: 'solve' } },
    env: { ...ENV, HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    sleep: c.sleep,
    now: c.now,
    resourceGate: scriptedGate([LOW_RAM]).gate,
    onLifecycle: async event => events.push(event),
    runner: { generateSessionId: () => 'new', executeWithIsolation: async (...args) => (launches.push(args), { success: true }) },
    trackSession: () => {},
  });
  assert.equal(result.resumed, false);
  assert.equal(result.reason, 'resource-wait-timeout');
  assert.equal(launches.length, 0);
  assert.deepEqual(
    events.map(event => event.phase),
    ['waiting', 'waiting-resources', 'failed']
  );
  const text = formatRecoveryLifecycle({ kind: 'container', ...events[1], at: new Date(0).toISOString(), startedAt: new Date(0).toISOString() });
  assert.match(text, /waiting for free and stable resources/i);
  assert.match(text, /attempt 1\/2/);
  assert.match(text, /RAM usage is 91%/);
});
