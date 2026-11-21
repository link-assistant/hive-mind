#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Regression tests for issue #2801: a Docker task that keeps every CPU busy
 * for 15 minutes is capped to 2 CPUs until it averages below 65% of that cap
 * for 15 minutes; then it is observed afresh and capped again if it keeps
 * every CPU busy for another 15 minutes.
 */

import assert from 'node:assert/strict';

import { DOCKER_CPU_PENALTY_DEFAULTS, evaluateDockerCpuPenalty, formatDockerCpuPenaltySection, getDockerHostCpus, normalizeDockerCpuPenaltyConfig, parseDockerStatsCpuOutput, parseDurationMs, resetDockerCpuPenaltyCachesForTests, runDockerCpuPenaltyPass, updateDockerContainerCpus } from '../src/docker-cpu-penalty.lib.mjs';
import { resolveTelegramDockerCpuPenalty } from '../src/telegram-container-resource-limits.lib.mjs';
import { __setIsolationRunnerForTests, monitorSessions, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';
import { serializeSessionInfo } from '../src/session-store.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error?.stack || error);
    failed++;
  }
}

const MINUTE = 60 * 1000;
const TICK = 30 * 1000;
const config = normalizeDockerCpuPenaltyConfig({});

/** Feed `cores` every 30 s for `minutes`; return the state and the actions taken (applied as Docker would). */
function simulate(state, { from, minutes, cores, capacityCpus = 6, restoreCpus = capacityCpus, cfg = config }) {
  const actions = [];
  let now = from;
  for (let at = from; at <= from + minutes * MINUTE; at += TICK) {
    now = at;
    const decision = evaluateDockerCpuPenalty(state, { now, cores: typeof cores === 'function' ? cores(at) : cores, capacityCpus, restoreCpus, config: cfg });
    state = decision.state;
    if (decision.action) {
      actions.push({ ...decision.action, at, averageCores: decision.averageCores });
      state = { ...state, samples: [], phaseStartedAt: at, phase: decision.action.type === 'apply' ? 'penalized' : 'observing', limitCpus: decision.action.type === 'apply' ? decision.action.cpus : null };
    }
  }
  return { state, actions, now };
}

await test('defaults follow the issue: 2 CPUs, all CPUs for 15 min, below 65% for 15 min', () => {
  assert.equal(config.enabled, true);
  assert.equal(config.penaltyCpus, 2);
  assert.equal(config.triggerPercent, DOCKER_CPU_PENALTY_DEFAULTS.triggerPercent);
  assert.equal(config.triggerWindowMs, 15 * MINUTE);
  assert.equal(config.releasePercent, 65);
  assert.equal(config.releaseWindowMs, 15 * MINUTE);
});

await test('settings accept CLI strings and reject invalid values', () => {
  const custom = normalizeDockerCpuPenaltyConfig({ enabled: 'false', penaltyCpus: '1.5', triggerPercent: '90%', triggerWindowMs: '10m', releasePercent: '50', releaseWindowMs: '900s' });
  assert.deepEqual([custom.enabled, custom.penaltyCpus, custom.triggerPercent, custom.triggerWindowMs, custom.releasePercent, custom.releaseWindowMs], [false, 1.5, 90, 10 * MINUTE, 50, 15 * MINUTE]);
  assert.equal(parseDurationMs('1h'), 60 * MINUTE);
  assert.equal(parseDurationMs('20'), 20 * MINUTE);
  assert.equal(parseDurationMs('90000ms'), 90 * 1000);
  assert.throws(() => normalizeDockerCpuPenaltyConfig({ triggerPercent: '150%' }), /between 0 and 100/);
  assert.throws(() => normalizeDockerCpuPenaltyConfig({ penaltyCpus: '0' }), /at least 0.01/);
  assert.throws(() => normalizeDockerCpuPenaltyConfig({ releaseWindowMs: 'soon' }), /duration/);
  assert.throws(() => normalizeDockerCpuPenaltyConfig({ enabled: 'maybe' }), /true or false/);
});

await test('the penalty is only enabled for Docker isolation', () => {
  assert.equal(resolveTelegramDockerCpuPenalty({ containerCpuPenalty: true }, 'docker').enabled, true);
  assert.equal(resolveTelegramDockerCpuPenalty({ containerCpuPenalty: true }, 'screen').enabled, false);
  assert.equal(resolveTelegramDockerCpuPenalty({ containerCpuPenalty: false }, 'docker').enabled, false);
  assert.equal(resolveTelegramDockerCpuPenalty({ containerCpuPenaltyCpus: '3' }, 'docker').penaltyCpus, 3);
});

await test('docker stats output parses to cores (100% = one core)', () => {
  const cores = parseDockerStatsCpuOutput('task-a\t598.40%\ntask-b\t0.00%\nbroken\t--\n\n');
  assert.equal(cores.get('task-a'), 5.984);
  assert.equal(cores.get('task-b'), 0);
  assert.equal(cores.has('broken'), false);
});

await test('all 6 CPUs busy for 15 minutes caps the task to 2 CPUs, not earlier', () => {
  const { actions } = simulate(null, { from: 0, minutes: 20, cores: 5.9 });
  assert.equal(actions.length, 1);
  assert.deepEqual([actions[0].type, actions[0].cpus, actions[0].at], ['apply', 2, 15 * MINUTE]);
});

await test('14 minutes of full load followed by a short pause is not penalized', () => {
  const { actions } = simulate(null, { from: 0, minutes: 30, cores: at => (at % (15 * MINUTE) < 14 * MINUTE ? 6 : 0) });
  assert.equal(actions.length, 0);
});

await test('the trigger follows the host CPU count (dynamic) and the base --container-cpu limit', () => {
  // 12-CPU host: 6 busy cores are only half of the machine.
  assert.equal(simulate(null, { from: 0, minutes: 20, cores: 6, capacityCpus: 12 }).actions.length, 0);
  // A task already limited to 4 CPUs that uses all 4 is penalized.
  const limited = simulate(null, { from: 0, minutes: 20, cores: 3.9, capacityCpus: 4 });
  assert.deepEqual(
    limited.actions.map(action => action.type),
    ['apply']
  );
  // A 2-CPU penalty cannot restrict a task that only has 2 CPUs.
  const decision = evaluateDockerCpuPenalty(null, { now: 0, cores: 2, capacityCpus: 2, restoreCpus: 2, config });
  assert.equal(decision.reason, 'penalty-not-below-capacity');
});

await test('the cap is lifted after 15 minutes below 65% of it (32.5% + 32.5% of total) and observation restarts', () => {
  const penalized = simulate(null, { from: 0, minutes: 15, cores: 6 });
  assert.equal(penalized.state.phase, 'penalized');
  // 1.31 cores = 65.5% of 2 CPUs: still too busy.
  const busy = simulate(penalized.state, { from: penalized.now + TICK, minutes: 30, cores: 1.31 });
  assert.equal(busy.actions.length, 0);
  // Saturating the cap right before the quiet period keeps the rolling average up.
  const saturated = simulate(busy.state, { from: busy.now + TICK, minutes: 5, cores: 2 });
  assert.equal(saturated.actions.length, 0);
  // 1.29 cores = 64.5% of 2 CPUs, held for 15 minutes: lifted to all 6 CPUs.
  const quiet = simulate(saturated.state, { from: saturated.now + TICK, minutes: 16, cores: 1.29 });
  assert.equal(quiet.actions.length, 1);
  assert.deepEqual([quiet.actions[0].type, quiet.actions[0].cpus], ['lift', 6]);
  assert.equal(quiet.actions[0].at - (saturated.now + TICK), 15 * MINUTE);
  assert.equal(quiet.state.phase, 'observing');
  assert.ok(
    quiet.state.samples.every(sample => sample.at > quiet.actions[0].at),
    'the next 15-minute observation starts from scratch'
  );
});

await test('a lifted task that again uses all CPUs for 15 minutes is capped again', () => {
  const first = simulate(null, { from: 0, minutes: 15, cores: 6 });
  const lifted = simulate(first.state, { from: first.now + TICK, minutes: 15, cores: 0.5 });
  assert.deepEqual(
    lifted.actions.map(action => action.type),
    ['lift']
  );
  const again = simulate(lifted.state, { from: lifted.now + TICK, minutes: 15, cores: 6 });
  assert.deepEqual(
    again.actions.map(action => action.type),
    ['apply']
  );
  assert.equal(again.actions[0].at - lifted.actions[0].at, 15 * MINUTE, 'observed for 15 minutes from the lift');
});

await test('a 15-minute average needs samples across the whole window (bot restart, docker stats outage)', () => {
  // Only the last 3 minutes of a 15-minute-old phase were observed.
  let state = { phase: 'observing', phaseStartedAt: 0, samples: [], penaltyCount: 0, penalizedMs: 0 };
  let decision;
  for (let at = 12 * MINUTE; at <= 15 * MINUTE; at += TICK) {
    decision = evaluateDockerCpuPenalty(state, { now: at, cores: 6, capacityCpus: 6, restoreCpus: 6, config });
    state = decision.state;
  }
  assert.equal(decision.action, null);
  assert.equal(decision.reason, 'window-not-covered');
  // Missing samples are not counted as busy or idle.
  decision = evaluateDockerCpuPenalty(state, { now: 15 * MINUTE + TICK, cores: null, capacityCpus: 6, restoreCpus: 6, config });
  assert.equal(decision.state.samples.length, state.samples.length);
});

function stubDocker({ usage = new Map(), inspect = null, updateResults = [] } = {}) {
  const updates = [];
  return {
    updates,
    deps: {
      sampleCpu: async () => usage,
      hostCpus: async () => 6,
      inspectCpus: async () => inspect,
      updateCpus: async (name, cpus) => {
        updates.push({ name, cpus });
        return updateResults.length ? updateResults.shift() : { success: true };
      },
    },
  };
}

await test('the monitor pass applies the cap with docker update, persists it and reports it', async () => {
  const sessionInfo = { isolationBackend: 'docker', sessionId: 'task-1', containerResourceLimits: null };
  const usage = new Map([
    ['task-1', 6],
    ['other', 6],
  ]);
  const docker = stubDocker({ usage });
  const persisted = [];
  const events = [];
  for (let at = 0; at <= 15 * MINUTE; at += TICK) {
    await runDockerCpuPenaltyPass([{ sessionName: 's1', sessionInfo }], { ...docker.deps, config, now: at, persist: name => persisted.push(name), logEvent: type => events.push(type) });
  }
  assert.deepEqual(docker.updates, [{ name: 'task-1', cpus: 2 }]);
  assert.equal(sessionInfo.cpuPenalty.phase, 'penalized');
  assert.equal(sessionInfo.cpuPenalty.limitCpus, 2);
  assert.ok(persisted.length >= 2, 'state is persisted when created and when the cap is applied');
  assert.deepEqual(events, ['cpu_penalty_applied']);
  assert.ok(serializeSessionInfo(sessionInfo).cpuPenalty, 'the penalty survives a bot restart');
  assert.match(formatDockerCpuPenaltySection(sessionInfo, { now: 25 * MINUTE }), /capped once \(10 min in total\)/);
  assert.equal(formatDockerCpuPenaltySection({ cpuPenalty: { penaltyCount: 0 } }), '');
});

await test('the cap is lifted back to the base --container-cpu limit when one is set', async () => {
  const sessionInfo = { isolationBackend: 'docker', sessionId: 'task-2', containerResourceLimits: { cpuCores: 4 }, cpuPenalty: { phase: 'penalized', phaseStartedAt: 0, samples: [], penaltyCount: 1, penalizedMs: 0, penalizedAt: 0, limitCpus: 2 } };
  const docker = stubDocker({ usage: new Map([['task-2', 0.2]]) });
  for (let at = 0; at <= 15 * MINUTE; at += TICK) await runDockerCpuPenaltyPass([{ sessionName: 's2', sessionInfo }], { ...docker.deps, config, now: at });
  assert.deepEqual(docker.updates, [{ name: 'task-2', cpus: 4 }]);
  assert.equal(sessionInfo.cpuPenalty.phase, 'observing');
  assert.equal(sessionInfo.cpuPenalty.penalizedMs, 15 * MINUTE);
});

await test('a container that already has a cap below its capacity (resumed from a penalized snapshot) is watched as penalized', async () => {
  const sessionInfo = { isolationBackend: 'docker', sessionId: 'task-3' };
  const docker = stubDocker({ usage: new Map([['task-3', 0.1]]), inspect: 2 });
  for (let at = 0; at <= 15 * MINUTE; at += TICK) await runDockerCpuPenaltyPass([{ sessionName: 's3', sessionInfo }], { ...docker.deps, config, now: at });
  assert.deepEqual(docker.updates, [{ name: 'task-3', cpus: 6 }]);
});

await test('a failed docker update keeps the phase and is retried on the next tick', async () => {
  const sessionInfo = { isolationBackend: 'docker', sessionId: 'task-4' };
  const docker = stubDocker({ usage: new Map([['task-4', 6]]), updateResults: [{ success: false, error: 'daemon busy' }] });
  const originalError = console.error;
  const errors = [];
  console.error = message => errors.push(message);
  try {
    for (let at = 0; at <= 15 * MINUTE + TICK; at += TICK) await runDockerCpuPenaltyPass([{ sessionName: 's4', sessionInfo }], { ...docker.deps, config, now: at });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(
    docker.updates.map(update => update.cpus),
    [2, 2]
  );
  assert.equal(sessionInfo.cpuPenalty.phase, 'penalized');
  assert.equal(sessionInfo.cpuPenalty.lastError, null);
  assert.equal(errors.length, 1);
});

await test('non-Docker, finished and disabled sessions are never sampled', async () => {
  let sampled = 0;
  const deps = { sampleCpu: async () => (sampled++, new Map()), hostCpus: async () => 6, inspectCpus: async () => null, updateCpus: async () => ({ success: true }) };
  await runDockerCpuPenaltyPass([{ sessionName: 'a', sessionInfo: { isolationBackend: 'screen', sessionId: 'a' } }], { ...deps, config });
  await runDockerCpuPenaltyPass([{ sessionName: 'b', sessionInfo: { isolationBackend: 'docker', sessionId: 'b', completionNotifiedAt: 'x' } }], { ...deps, config });
  await runDockerCpuPenaltyPass([{ sessionName: 'c', sessionInfo: { isolationBackend: 'docker', sessionId: 'c' } }], { ...deps, config: { ...config, enabled: false } });
  assert.equal(sampled, 0);
});

await test('docker commands: update raises the cap to lift it, host CPUs come from docker info', async () => {
  const calls = [];
  const fakeSpawn = (command, args) => {
    calls.push([command, ...args]);
    const listeners = {};
    const stream = text => ({ on: (event, fn) => event === 'data' && text && setImmediate(() => fn(Buffer.from(text))) });
    const child = { stdout: stream(args[0] === 'info' ? '8\n' : ''), stderr: stream(''), on: (event, fn) => (listeners[event] = fn), kill: () => {} };
    setImmediate(() => setImmediate(() => listeners.close?.(0)));
    return child;
  };
  assert.equal((await updateDockerContainerCpus('task-5', 6, { spawnImpl: fakeSpawn })).success, true);
  resetDockerCpuPenaltyCachesForTests();
  assert.equal(await getDockerHostCpus({ spawnImpl: fakeSpawn, now: 0 }), 8);
  assert.equal(await getDockerHostCpus({ spawnImpl: fakeSpawn, now: MINUTE }), 8, 'cached');
  resetDockerCpuPenaltyCachesForTests();
  assert.deepEqual(calls, [
    ['docker', 'update', '--cpus', '6', 'task-5'],
    ['docker', 'info', '--format', '{{.NCPU}}'],
  ]);
});

await test('monitorSessions runs the pass for running Docker sessions only when the penalty is configured', async () => {
  resetSessionMonitorForTests();
  __setIsolationRunnerForTests({
    isExecutingSessionStatus: status => status === 'executing',
    isTerminalSessionStatus: status => ['executed', 'completed', 'failed', 'killed'].includes(status),
    isUnknownDockerExitCode: exitCode => exitCode === null || exitCode === undefined || Number(exitCode) === -1,
    isSessionRunning: async () => true,
    readSessionExitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
  });
  try {
    trackSession('issue-2801-session', { chatId: 1, messageId: 2, startTime: new Date(), url: 'https://github.com/example/project/issues/2801', command: 'solve', isolationBackend: 'docker', sessionId: 'issue-2801-container' }, false);
    const statusProvider = async () => ({ exists: true, status: 'executing', exitCode: null, raw: '' });
    const bot = { telegram: { editMessageText: async () => {}, sendMessage: async () => {} } };
    let sampled = 0;
    const cpuPenaltyDeps = { sampleCpu: async () => (sampled++, new Map([['issue-2801-container', 1]])), hostCpus: async () => 6, inspectCpus: async () => null, updateCpus: async () => ({ success: true }) };
    await monitorSessions(bot, false, { statusProvider, dockerContainerSizeProvider: async () => null, cpuPenaltyDeps });
    assert.equal(sampled, 0, 'no pass without a penalty config');
    await monitorSessions(bot, false, { statusProvider, dockerContainerSizeProvider: async () => null, cpuPenalty: config, cpuPenaltyDeps });
    assert.equal(sampled, 1);
  } finally {
    __setIsolationRunnerForTests(null);
    resetSessionMonitorForTests();
  }
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
