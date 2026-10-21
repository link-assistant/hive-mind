/**
 * @hive-mind-test-suite default
 * Docker task memory (#3125): a larger hard limit plus a soft reservation
 * (`docker update --memory-reservation`), so a task can burst into idle host
 * RAM and is reclaimed first under host pressure instead of being OOM-killed
 * at a small fixed cap. `--container-memory` overrides both defaults and
 * `unlimited` opts out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDockerContainerResourceLimits, buildDockerUpdateArgs, hasContainerResourceLimits, normalizeContainerResourceLimits, resolveContainerResourceLimits } from '../src/container-resource-limits.lib.mjs';
import { DEFAULT_DOCKER_TASK_MEMORY, DEFAULT_DOCKER_TASK_MEMORY_RESERVATION, initializeTelegramContainerResourceLimits, resolveTelegramContainerResourceLimits } from '../src/telegram-container-resource-limits.lib.mjs';
import { hasSessionContainerResourceLimits } from '../src/session-kill-resume.in-place.lib.mjs';

const GiB = 1024 ** 3;
const capacity = { cpuCores: 8, memoryBytes: 16 * GiB, diskBytes: 100 * GiB };

test('the memory reservation is validated and resolved like the other limits', () => {
  const requested = normalizeContainerResourceLimits({ memory: '60%', memoryReservation: '25%' });
  assert.equal(requested.memoryReservation, '25%');
  assert.ok(hasContainerResourceLimits({ memoryReservation: '1GiB' }));
  const resolved = resolveContainerResourceLimits(requested, capacity);
  assert.equal(resolved.memoryBytes, Math.floor(16 * GiB * 0.6));
  assert.equal(resolved.memoryReservationBytes, 4 * GiB);
  assert.equal(resolved.requested.memoryReservation, '25%', 'resume paths reapply the requested reservation');
  assert.throws(() => normalizeContainerResourceLimits({ memoryReservation: 'half' }), /memory reservation/i);
});

test('a reservation at or above the hard limit is rejected', () => {
  assert.throws(() => normalizeContainerResourceLimits({ memory: '2GiB', memoryReservation: '4GiB' }), /reservation must be below/i);
  assert.throws(() => normalizeContainerResourceLimits({ memory: '25%', memoryReservation: '25%' }), /reservation must be below/i);
  // Mixed units are compared once the host capacity is known.
  assert.equal(resolveContainerResourceLimits({ memory: '1GiB', memoryReservation: '25%' }, capacity).memoryReservationBytes, null);
});

test('`unlimited` clears a limit', () => {
  assert.deepEqual(normalizeContainerResourceLimits({ cpu: 'unlimited', memory: 'UNLIMITED', memoryReservation: 'unlimited', disk: 'unlimited' }), { cpu: null, memory: null, memoryReservation: null, disk: null });
});

test('docker update receives --memory-reservation below the hard limit', () => {
  const memoryBytes = Math.floor(16 * GiB * 0.6);
  assert.deepEqual(buildDockerUpdateArgs({ memoryBytes, memoryReservationBytes: 4 * GiB }), ['update', '--memory', String(memoryBytes), '--memory-swap', String(memoryBytes), '--memory-reservation', String(4 * GiB)]);
  assert.deepEqual(buildDockerUpdateArgs({ memoryReservationBytes: 4 * GiB }), ['update', '--memory-reservation', String(4 * GiB)], 'a soft limit alone is valid');
  assert.deepEqual(buildDockerUpdateArgs({ memoryBytes: GiB, memoryReservationBytes: 2 * GiB }), ['update', '--memory', String(GiB), '--memory-swap', String(GiB)], 'Docker rejects a reservation above the limit');
});

test('applying limits passes the reservation to Docker', async () => {
  const calls = [];
  const result = await applyDockerContainerResourceLimits('session-3125', { memory: '60%', memoryReservation: '25%' }, { capacity, runDocker: async args => (calls.push(args), { success: true }) });
  assert.equal(result.success, true);
  assert.ok(calls[0].includes('--memory-reservation'));
  assert.equal(calls[0][calls[0].indexOf('--memory-reservation') + 1], String(4 * GiB));
  assert.equal(calls[0].at(-1), 'session-3125');
});

test('Telegram defaults: 60% hard limit with a 25% reservation on Docker', () => {
  assert.equal(DEFAULT_DOCKER_TASK_MEMORY, '60%');
  assert.equal(DEFAULT_DOCKER_TASK_MEMORY_RESERVATION, '25%');
  const { limits, summary } = resolveTelegramContainerResourceLimits({}, 'docker');
  assert.equal(limits.memory, '60%');
  assert.equal(limits.memoryReservation, '25%');
  assert.match(summary, /RAM=60% \(reservation 25%\)/);
  assert.equal(resolveTelegramContainerResourceLimits({}, 'screen').limits.memoryReservation, null);
});

test('--container-memory overrides both defaults; an explicit reservation is kept', () => {
  const explicit = resolveTelegramContainerResourceLimits({ containerMemory: '4GiB' }, 'docker').limits;
  assert.equal(explicit.memory, '4GiB');
  assert.equal(explicit.memoryReservation, null);
  const both = resolveTelegramContainerResourceLimits({ containerMemory: '8GiB', containerMemoryReservation: '2GiB' }, 'docker').limits;
  assert.deepEqual([both.memory, both.memoryReservation], ['8GiB', '2GiB']);
  const unlimited = resolveTelegramContainerResourceLimits({ containerMemory: 'unlimited' }, 'docker').limits;
  assert.deepEqual([unlimited.memory, unlimited.memoryReservation], [null, null]);
  assert.throws(() => resolveTelegramContainerResourceLimits({ containerMemoryReservation: '1GiB' }, 'screen'), /require --isolation docker/i);
});

test('the reservation can come from TELEGRAM_CONTAINER_MEMORY_RESERVATION', () => {
  const previous = process.env.TELEGRAM_CONTAINER_MEMORY_RESERVATION;
  process.env.TELEGRAM_CONTAINER_MEMORY_RESERVATION = '10%';
  try {
    assert.equal(resolveTelegramContainerResourceLimits({}, 'docker').limits.memoryReservation, '10%');
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_CONTAINER_MEMORY_RESERVATION;
    else process.env.TELEGRAM_CONTAINER_MEMORY_RESERVATION = previous;
  }
});

test('the startup log names the reservation', () => {
  const logs = [];
  initializeTelegramContainerResourceLimits({}, 'docker', { log: m => logs.push(m), warn: m => logs.push(m), logError: m => logs.push(m), exit: () => {} });
  assert.match(logs.join('\n'), /📏 Docker task limits enabled: CPU=50%, RAM=60% \(reservation 25%\), disk=unlimited/);
});

test('a session with only a reservation still counts as limited for in-place resume', () => {
  assert.equal(hasSessionContainerResourceLimits({ containerResourceLimits: { memoryReservationBytes: GiB } }), true);
});

test('a resume that recreates the container re-applies the reservation with docker update, never through `$`', async () => {
  const { resumeKilledSessionInPlace } = await import('../src/session-kill-resume.in-place.lib.mjs');
  const { RESUME_MODES } = await import('../src/isolation-runner.resume.lib.mjs');
  const session = 'session-3125';
  const requested = { cpu: '50%', memory: '60%', memoryReservation: '25%', disk: null };
  const dockerCalls = [];
  const resumeCalls = [];
  const runner = {
    getStartCommandVersion: async () => '0.38.0',
    checkDockerContainerExists: async () => true,
    resumeIsolatedSession: async (identifier, options) => (resumeCalls.push({ identifier, options }), { success: true, uuid: 'uuid-3125', mode: RESUME_MODES.DOCKER_SNAPSHOT, sessionName: `${session}-resume-1` }),
    applyDockerContainerResourceLimits: (name, limits) => applyDockerContainerResourceLimits(name, limits, { capacity, runDocker: async args => (dockerCalls.push(args), { success: true }) }),
  };
  const sessionInfo = { isolationBackend: 'docker', sessionId: session, executionUuid: 'uuid-3125', command: 'solve', tool: 'claude', containerResourceLimits: { ...resolveContainerResourceLimits(requested, capacity), requested }, args: ['https://github.com/o/r/pull/1'] };
  const plan = { command: { args: ['--resume', 'tool-session'], display: 'solve --resume tool-session' }, shouldResume: true, attempt: 1, maxAttempts: 1 };
  const result = await resumeKilledSessionInPlace({ sessionName: session, sessionInfo, plan, runner });
  assert.equal(result.resumed, true);
  assert.equal(dockerCalls.length, 1);
  assert.deepEqual(dockerCalls[0].slice(dockerCalls[0].indexOf('--memory-reservation')), ['--memory-reservation', String(4 * GiB), `${session}-resume-1`]);
  assert.ok(!JSON.stringify(resumeCalls).includes('memory-reservation'), 'start-command has no --memory-reservation option');
});
