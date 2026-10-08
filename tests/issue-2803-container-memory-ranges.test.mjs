/**
 * @hive-mind-test-suite default
 * Issue #2803: Telegram Docker tasks ran under a fixed 25%-of-host RAM cap (2.9 GB on the 11.7 GB
 * host), and the cgroup OOM killer took Claude at that cap while the host still had 7.5 GB free.
 * Every task had the same cap, so tasks under the same load hit it together, and a task restarted
 * after an OOM kill came back with the cap that had just killed it.
 *
 * Now a RAM limit may be a percentage range picked at random per launch: tasks default to
 * 90%-100% of host RAM, and a task restarted after an OOM kill gets 70%-80%. Both are configurable.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeContainerResourceLimits, resolveContainerResourceLimits, hasContainerResourceLimits, selectRecoveryContainerResourceLimits, buildDockerUpdateArgs, applyDockerContainerResourceLimits } from '../src/container-resource-limits.lib.mjs';
import { resolveTelegramContainerResourceLimits, DEFAULT_DOCKER_TASK_MEMORY, DEFAULT_DOCKER_TASK_MEMORY_AFTER_OOM } from '../src/telegram-container-resource-limits.lib.mjs';
import { startKillRecoverySession } from '../src/session-kill-resume.lib.mjs';

const GiB = 1024 ** 3;
const HOST = { cpuCores: 6, memoryBytes: 100 * GiB, diskBytes: 1000 * GiB };
const ENV_KEYS = ['TELEGRAM_CONTAINER_MEMORY', 'TELEGRAM_CONTAINER_MEMORY_AFTER_OOM', 'TELEGRAM_CONTAINER_CPU', 'TELEGRAM_CONTAINER_DISK'];

function withCleanEnv(fn) {
  const saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS)
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
}

test('a percentage range resolves to a random value inside it', () => {
  const at = random => resolveContainerResourceLimits({ memory: '90%-100%' }, HOST, { random }).memoryBytes;
  assert.equal(
    at(() => 0),
    Math.floor(90 * GiB)
  );
  assert.equal(
    at(() => 0.5),
    Math.floor(95 * GiB)
  );
  assert.equal(
    at(() => 0.999999),
    Math.floor((HOST.memoryBytes * (90 + 10 * 0.999999)) / 100)
  );
  assert.equal(
    at(() => 7),
    100 * GiB,
    'an out-of-range random value is clamped'
  );
  assert.equal(resolveContainerResourceLimits({ memory: '70 % - 80 %' }, HOST, { random: () => 1 }).memoryBytes, 80 * GiB, 'spaces are allowed');
  assert.equal(resolveContainerResourceLimits({ memory: '25%' }, HOST, { random: () => 0.9 }).memoryBytes, 25 * GiB, 'a single percentage is not randomised');
  assert.equal(resolveContainerResourceLimits({ cpu: '50%-100%' }, HOST, { random: () => 0.5 }).cpuCores, 4.5, 'CPU accepts ranges too');
});

test('two tasks launched together get different RAM limits by default', () => {
  const draws = [0.1, 0.8];
  const limits = draws.map(value => resolveContainerResourceLimits({ memory: DEFAULT_DOCKER_TASK_MEMORY }, HOST, { random: () => value }).memoryBytes);
  assert.notEqual(limits[0], limits[1]);
  assert.ok(limits.every(bytes => bytes >= 90 * GiB && bytes <= 100 * GiB));
});

test('malformed ranges are rejected at startup', () => {
  assert.throws(() => normalizeContainerResourceLimits({ memory: '100%-90%' }), /lower to the higher/);
  assert.throws(() => normalizeContainerResourceLimits({ memory: '90%-101%' }), /between 0 and 100/);
  assert.throws(() => normalizeContainerResourceLimits({ memory: '0%-10%' }), /between 0 and 100/);
  assert.throws(() => normalizeContainerResourceLimits({ memoryAfterOom: 'lots' }), /memory after oom limit/i);
  assert.deepEqual(normalizeContainerResourceLimits({ memory: '90%-100%', memoryAfterOom: '70%-80%' }), { cpu: null, memory: '90%-100%', disk: null, memoryAfterOom: '70%-80%' });
});

test('the post-OOM limit alone is not a limit, and docker update never receives it', () => {
  assert.equal(hasContainerResourceLimits({ memoryAfterOom: '70%-80%' }), false);
  const resolved = resolveContainerResourceLimits({ memory: '90%', memoryAfterOom: '70%-80%' }, HOST);
  assert.deepEqual(buildDockerUpdateArgs(resolved), ['update', '--memory', String(Math.floor(90 * GiB)), '--memory-swap', String(Math.floor(90 * GiB))]);
  assert.equal(resolved.requested.memoryAfterOom, '70%-80%', 'kept so the recovery can find it');
});

test('applyDockerContainerResourceLimits uses the injected random value', async () => {
  const calls = [];
  const result = await applyDockerContainerResourceLimits('task', { memory: '70%-80%' }, { capacity: HOST, random: () => 0.5, runDocker: async args => (calls.push(args), { success: true }) });
  assert.equal(result.success, true);
  assert.equal(result.resolved.memoryBytes, 75 * GiB);
  assert.deepEqual(calls[0], ['update', '--memory', String(75 * GiB), '--memory-swap', String(75 * GiB), 'task']);
});

test('Telegram Docker tasks default to 90%-100% RAM and 70%-80% after an OOM kill', () => {
  withCleanEnv(() => {
    assert.equal(DEFAULT_DOCKER_TASK_MEMORY, '90%-100%');
    assert.equal(DEFAULT_DOCKER_TASK_MEMORY_AFTER_OOM, '70%-80%');
    const defaults = resolveTelegramContainerResourceLimits({}, 'docker');
    assert.equal(defaults.limits.memory, '90%-100%');
    assert.equal(defaults.limits.memoryAfterOom, '70%-80%');
    assert.match(defaults.summary, /RAM=90%-100%, RAM after OOM=70%-80%/);
    assert.deepEqual(resolveTelegramContainerResourceLimits({}, 'screen'), { limits: { cpu: null, memory: null, disk: null, memoryAfterOom: null }, summary: null }, 'non-Docker backends get no limits');
  });
});

test('both RAM limits are configurable by option and environment, and the post-OOM one can be turned off', () => {
  withCleanEnv(() => {
    assert.equal(resolveTelegramContainerResourceLimits({ containerMemory: '60%-65%', containerMemoryAfterOom: '40%-50%' }, 'docker').limits.memoryAfterOom, '40%-50%');
    assert.equal(resolveTelegramContainerResourceLimits({ containerMemory: '4GiB' }, 'docker').limits.memoryAfterOom, null, 'an explicit RAM limit is not raised by the default post-OOM range');
    assert.equal(resolveTelegramContainerResourceLimits({ containerMemoryAfterOom: 'off' }, 'docker').limits.memoryAfterOom, null);
    process.env.TELEGRAM_CONTAINER_MEMORY = '80%-90%';
    process.env.TELEGRAM_CONTAINER_MEMORY_AFTER_OOM = '50%-60%';
    const fromEnv = resolveTelegramContainerResourceLimits({}, 'docker').limits;
    assert.equal(fromEnv.memory, '80%-90%');
    assert.equal(fromEnv.memoryAfterOom, '50%-60%');
  });
});

test('selectRecoveryContainerResourceLimits lowers RAM only after an OOM kill', () => {
  const requested = { cpu: null, memory: '90%-100%', disk: '10%', memoryAfterOom: '70%-80%' };
  assert.deepEqual(selectRecoveryContainerResourceLimits(requested, { outOfMemory: true }), { limits: { ...requested, memory: '70%-80%' }, changed: true });
  assert.deepEqual(selectRecoveryContainerResourceLimits(requested, { outOfMemory: false }), { limits: requested, changed: false });
  assert.deepEqual(selectRecoveryContainerResourceLimits({ ...requested, memoryAfterOom: null }, { outOfMemory: true }).changed, false);
  assert.deepEqual(selectRecoveryContainerResourceLimits(null, { outOfMemory: true }), { limits: null, changed: false });
});

const PLAN = { shouldResume: true, attempt: 1, maxAttempts: 3, command: { command: 'solve', args: ['https://github.com/o/r/issues/1', '--resume', 'abc'], display: 'solve … --resume abc', shell: 'solve https://github.com/o/r/issues/1 --resume abc' } };
const LIMITED_SESSION = {
  isolationBackend: 'docker',
  sessionId: 'killed-task',
  executionUuid: 'exec-1',
  args: ['https://github.com/o/r/issues/1'],
  containerResourceLimits: { cpuCores: null, memoryBytes: 95 * GiB, diskBytes: null, requested: { cpu: null, memory: '90%-100%', disk: null, memoryAfterOom: '70%-80%' } },
};
const recover = (runner, outOfMemory, sessionInfo = LIMITED_SESSION) => {
  const tracked = [];
  return startKillRecoverySession({ sessionName: 'killed-task', sessionInfo: { ...sessionInfo }, plan: PLAN, runner, trackSession: (id, info) => tracked.push({ id, info }), env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' }, sleep: async () => {}, outOfMemory }).then(started => ({ started, tracked }));
};

test('a fresh recovery after an OOM kill launches under the post-OOM RAM limit', async () => {
  for (const outOfMemory of [true, false]) {
    const launches = [];
    const runner = {
      generateSessionId: () => 'recovery',
      checkDockerContainerExists: async () => false,
      executeWithIsolation: async (command, args, options) => (launches.push(options), { success: true, executionUuid: 'exec-2', containerResourceLimits: { memoryBytes: 75 * GiB, requested: options.containerResourceLimits } }),
    };
    const { started, tracked } = await recover(runner, outOfMemory);
    assert.equal(started.resumed, true, started.reason);
    assert.equal(started.inPlace, false);
    assert.equal(launches[0].containerResourceLimits.memory, outOfMemory ? '70%-80%' : '90%-100%');
    assert.equal(launches[0].containerResourceLimits.memoryAfterOom, '70%-80%', 'a second OOM kill lowers it the same way');
    assert.equal(started.memoryLimitLowered, outOfMemory);
    assert.equal(tracked[0].info.containerResourceLimits.memoryBytes, 75 * GiB, 'the tracked session records the new limit');
  }
});

test('a same-container resume after an OOM kill changes the RAM limit even when Docker keeps the old one', async () => {
  for (const outOfMemory of [true, false]) {
    const applied = [];
    const runner = {
      getStartCommandVersion: async () => '0.35.4',
      checkDockerContainerExists: async () => true,
      resumeIsolatedSession: async () => ({ success: true, mode: 'docker-start', sessionName: 'killed-task', uuid: 'exec-1' }),
      applyDockerContainerResourceLimits: async (container, requested) => (applied.push({ container, requested }), { success: true, error: null, resolved: { cpuCores: null, memoryBytes: 72 * GiB, diskBytes: null, requested } }),
      generateSessionId: () => 'unused',
      executeWithIsolation: async () => assert.fail('must resume in place'),
    };
    const { started, tracked } = await recover(runner, outOfMemory);
    assert.equal(started.inPlace, true, started.reason);
    if (outOfMemory) {
      assert.equal(applied.length, 1);
      assert.equal(applied[0].container, 'killed-task');
      assert.equal(applied[0].requested.memory, '70%-80%');
      assert.equal(tracked[0].info.containerResourceLimits.memoryBytes, 72 * GiB);
      assert.equal(started.memoryLimitBytes, 72 * GiB);
    } else {
      assert.equal(applied.length, 0, 'docker-start keeps the HostConfig limits; nothing to change');
      assert.equal(tracked[0].info.containerResourceLimits.memoryBytes, 95 * GiB);
    }
  }
});
