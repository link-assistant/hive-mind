#!/usr/bin/env node

/**
 * Formal AI's memory volume, its logging failures and its stdout (issue #3583).
 *
 * The report: since 2026-08 the shared `hive-mind-formal-ai-memory` volume was
 * owned by root, so `formal-ai` (running as `box`) wrote neither `memory.lino`
 * nor `logs/`. It said so on stdout — a `logging_failure` record at startup and
 * a `[dialog-log] failed to record exchange` line per dialog — and kept
 * serving; nothing read that stdout, and `docker rm` deleted it at the next
 * idle stop. This file drives the lifecycle against the in-memory Docker
 * daemon and asserts what the issue asked for:
 *
 *   1. every sidecar start checks, as `box`, that the volume is writable, and
 *      repairs a root-owned one with `chown -R` — never a healthy one;
 *   2. a `logging_failure` in the first lines of a fresh sidecar becomes a
 *      warning in the bot log and in the task's solve log;
 *   3. `docker logs --timestamps` is saved to a rotated file in the bot log
 *      directory before every `docker rm` of the sidecar;
 *   4. a pre-existing root-owned volume is fixed by the next start, after which
 *      Formal AI writes `memory.lino` and `logs/`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3583
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { dockerExecFileAsync } from '../src/docker-pull-detached.lib.mjs';
import { buildFormalAiTaskEnv, FORMAL_AI_SIDECAR_WARNING_ENV } from '../src/formal-ai-isolation.lib.mjs';
import { FORMAL_AI_IMAGE_REPOSITORY } from '../src/formal-ai-image.lib.mjs';
import { prepareFormalAiRuntime, readFormalAiSidecarWarning, resetFormalAiRuntimeCache } from '../src/formal-ai-runtime.lib.mjs';
import { archiveFormalAiSidecarLogs, checkFormalAiSidecarLogging, describeFormalAiLoggingFailure, formatFormalAiSidecarLogStamp, parseFormalAiLoggingFailures, pruneFormalAiSidecarLogs, resolveFormalAiSidecarLogKeep } from '../src/formal-ai-sidecar-logs.lib.mjs';
import { FORMAL_AI_MEMORY_MOUNT, FORMAL_AI_MEMORY_VOLUME_NAME, FORMAL_AI_SIDECAR_CONTAINER_NAME, FORMAL_AI_SIDECAR_LABEL, acquireFormalAiSidecar, buildFormalAiMemoryChownArgs, buildFormalAiMemoryProbeArgs, ensureFormalAiMemoryVolume, parseFormalAiMemoryProbe, readFormalAiSidecarState, releaseFormalAiSidecar, stopFormalAiSidecar, writeFormalAiSidecarState } from '../src/formal-ai-sidecar.lib.mjs';
import { unloadIdleFormalAiSidecar } from '../src/formal-ai-unload.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION, FORMAL_AI_MINIMUM_VERSION } from '../src/formal-ai-version.lib.mjs';
import { buildDockerIsolationStartArgs } from '../src/isolation-runner.lib.mjs';
import { BOX_OWNER, ROOT_OWNER, createDockerSimulator } from './formal-ai-docker-simulator.mjs';

const SIDECAR_IMAGE = `${FORMAL_AI_IMAGE_REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}`;
const FIXTURE = fs.readFileSync(new URL('./fixtures/formal-ai-sidecar-logging-failure-3583.txt', import.meta.url), 'utf8');
const fast = { healthAttempts: 1, healthDelayMs: 0, sleepImpl: async () => {} };

const dirs = [];
const makeEnv = (extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-3583-'));
  dirs.push(dir);
  return { HIVE_MIND_STATE_DIR: dir, HIVE_MIND_LOG_DIR: path.join(dir, 'logs'), ...extra };
};
process.on('exit', () => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const makeDocker = (options = {}) => createDockerSimulator({ images: { [SIDECAR_IMAGE]: 'sha256:sidecar' }, ...options });
const collect = () => {
  const lines = [];
  const log = async line => void lines.push(line);
  return { lines, log };
};
const callsMatching = (docker, pattern) => docker.calls.filter(call => pattern.test(call));
const isProbe = call => call.startsWith('run --rm') && call.includes('--user box') && call.includes('--entrypoint sh');
const isChown = call => call.startsWith('run --rm') && call.includes('--entrypoint chown');
const archiveIndex = docker => docker.calls.findIndex(call => call === `logs --timestamps ${FORMAL_AI_SIDECAR_CONTAINER_NAME}`);
const rmIndex = docker => docker.calls.findIndex(call => call.startsWith('rm ') && call.endsWith(FORMAL_AI_SIDECAR_CONTAINER_NAME));
const archivesIn = env => (fs.existsSync(env.HIVE_MIND_LOG_DIR) ? fs.readdirSync(env.HIVE_MIND_LOG_DIR).filter(name => name.startsWith('formal-ai-sidecar-')) : []);

/** A daemon on which `chown` cannot change anything, e.g. a volume on a read-only or root-squashed filesystem. */
const withBrokenChown = docker => async (command, args, options) => {
  if (args[0] === 'run' && args.includes('chown')) {
    docker.calls.push(args.join(' '));
    throw Object.assign(new Error('chown: /home/box/.formal-ai: Operation not permitted'), { stderr: 'chown: /home/box/.formal-ai: Operation not permitted' });
  }
  return docker.run(command, args, options);
};

// ---------------------------------------------------------------------------
// 1. Ownership is checked on every start and repaired only when broken.
// ---------------------------------------------------------------------------

test('the probe runs as box with the memory volume mounted, and chown hands the volume to box', () => {
  const probe = buildFormalAiMemoryProbeArgs({ image: SIDECAR_IMAGE });
  assert.deepEqual(probe.slice(0, 8), ['run', '--rm', '--network', 'none', '--user', 'box', '--volume', `${FORMAL_AI_MEMORY_VOLUME_NAME}:${FORMAL_AI_MEMORY_MOUNT}`]);
  assert.equal(probe[probe.length - 1], FORMAL_AI_MEMORY_MOUNT);
  const chown = buildFormalAiMemoryChownArgs({ image: SIDECAR_IMAGE });
  assert.deepEqual(chown.slice(-3), ['-R', 'box:box', FORMAL_AI_MEMORY_MOUNT]);
  assert.equal(chown[chown.indexOf('--user') + 1], '0:0', 'chown runs as root even when the image defaults to box');
});

test('the probe output is parsed strictly', () => {
  assert.deepEqual(parseFormalAiMemoryProbe('owner=1001:1001\nwritable=yes'), { ok: true, known: true, owner: '1001:1001', writable: true, foreign: null });
  assert.equal(parseFormalAiMemoryProbe('owner=0:0\nwritable=no').ok, false);
  assert.deepEqual(parseFormalAiMemoryProbe('owner=1001:1001\nwritable=yes\nforeign=0:0 /home/box/.formal-ai/logs').foreign, { owner: '0:0', path: '/home/box/.formal-ai/logs' });
  assert.equal(parseFormalAiMemoryProbe('owner=1001:1001\nwritable=yes\nforeign=0:0 /home/box/.formal-ai/logs').ok, false, 'a root-owned entry inside a box-owned volume is still broken');
  assert.deepEqual(parseFormalAiMemoryProbe('formal-ai container entrypoint'), { ok: false, known: false, owner: null, writable: null, foreign: null }, 'output without the keys is unknown, never healthy');
});

test('a pre-existing root-owned volume is fixed by the next start, and Formal AI then writes memory.lino and logs/', async () => {
  const env = makeEnv();
  const docker = makeDocker();
  // Left behind by a Hive Mind that only chowned volumes it created itself.
  const volume = docker.seedVolume(FORMAL_AI_MEMORY_VOLUME_NAME, { owner: ROOT_OWNER });
  const { lines, log } = collect();

  const sidecar = await acquireFormalAiSidecar({ sessionId: 'task-1', env, run: docker.run, log, ...fast });

  assert.ok(lines.includes(`[formal-ai] memory volume was owned by ${ROOT_OWNER}; fixed`), `the repair is logged in the issue's words:\n${lines.join('\n')}`);
  assert.equal(volume.owner, BOX_OWNER);
  assert.equal(callsMatching(docker, /--entrypoint chown/).length, 1);
  assert.ok(volume.files.has('memory.lino') && volume.files.has('logs/'), 'the sidecar wrote its memory and logs');
  assert.equal(sidecar.loggingWarning, null, 'a repaired volume produces no logging warning');
  const probeAt = docker.calls.findIndex(isProbe);
  const chownAt = docker.calls.findIndex(isChown);
  const startAt = docker.calls.findIndex(call => call.startsWith('run ') && call.includes(`--name ${FORMAL_AI_SIDECAR_CONTAINER_NAME}`));
  assert.ok(probeAt >= 0 && probeAt < chownAt && chownAt < startAt, 'probe, then chown, then the sidecar');
});

test('a healthy volume is never walked by chown', async () => {
  const env = makeEnv();
  const docker = makeDocker();
  docker.seedVolume(FORMAL_AI_MEMORY_VOLUME_NAME, { owner: BOX_OWNER, files: ['memory.lino', 'logs/'] });
  const { lines, log } = collect();

  await acquireFormalAiSidecar({ sessionId: 'task-1', env, run: docker.run, log, ...fast });

  assert.equal(docker.calls.filter(isProbe).length, 1, 'one probe per start');
  assert.equal(docker.calls.filter(isChown).length, 0);
  assert.equal(
    lines.some(line => line.includes('memory volume was')),
    false
  );
});

test('a fresh volume is handed to box without claiming it was broken', async () => {
  const env = makeEnv();
  const docker = makeDocker();
  const { lines, log } = collect();

  await acquireFormalAiSidecar({ sessionId: 'task-1', env, run: docker.run, log, ...fast });

  assert.equal(docker.volumeOf(FORMAL_AI_MEMORY_VOLUME_NAME).owner, BOX_OWNER);
  assert.equal(docker.calls.filter(isChown).length, 1);
  assert.equal(
    lines.some(line => line.includes('memory volume was')),
    false,
    'a volume this call created is expected to need the chown'
  );
});

test('a box-owned volume holding a root-owned entry is repaired too', async () => {
  const env = makeEnv();
  const docker = makeDocker();
  const volume = docker.seedVolume(FORMAL_AI_MEMORY_VOLUME_NAME, { owner: BOX_OWNER, foreign: [{ path: `${FORMAL_AI_MEMORY_MOUNT}/logs`, owner: ROOT_OWNER }] });
  const { lines, log } = collect();

  await acquireFormalAiSidecar({ sessionId: 'task-1', env, run: docker.run, log, ...fast });

  assert.ok(lines.includes(`[formal-ai] memory volume was owned by ${BOX_OWNER} but held ${FORMAL_AI_MEMORY_MOUNT}/logs owned by ${ROOT_OWNER}; fixed`), lines.join('\n'));
  assert.deepEqual(volume.foreign, []);
  assert.ok(volume.files.has('logs/'));
});

test('a probe that cannot run falls back to chown and says when box still cannot write', async () => {
  const docker = makeDocker({ probeFails: true });
  docker.seedVolume(FORMAL_AI_MEMORY_VOLUME_NAME, { owner: ROOT_OWNER });
  const { lines, log } = collect();

  const result = await ensureFormalAiMemoryVolume({ image: SIDECAR_IMAGE, run: docker.run, log });

  assert.equal(docker.calls.filter(isChown).length, 1, 'an unknown ownership is repaired rather than trusted');
  assert.equal(result.fixed, false);
  assert.equal(result.writable, null);
  assert.ok(
    lines.some(line => line.startsWith(`⚠️ [formal-ai] memory volume '${FORMAL_AI_MEMORY_VOLUME_NAME}' is of unknown ownership`) && line.includes('unable to find user box') && line.endsWith('Formal AI will keep no logs or memory')),
    lines.join('\n')
  );
});

test('a running sidecar is leased without another probe', async () => {
  const env = makeEnv();
  const docker = makeDocker();
  await acquireFormalAiSidecar({ sessionId: 'task-1', env, run: docker.run, ...fast });
  const probes = docker.calls.filter(isProbe).length;

  await acquireFormalAiSidecar({ sessionId: 'task-2', env, run: docker.run, ...fast });

  assert.equal(docker.calls.filter(isProbe).length, probes);
  assert.equal(docker.calls.filter(isChown).length, 1);
});

// ---------------------------------------------------------------------------
// 2. Logging failures reach the bot log and the solve log.
// ---------------------------------------------------------------------------

test('the logging failures of the issue #3583 sidecar log are recognised', () => {
  const failures = parseFormalAiLoggingFailures(FIXTURE);
  assert.ok(failures.count >= 2, `found ${failures.count}`);
  assert.deepEqual(failures.reasons, ['file_write_failed']);
  assert.ok(failures.messages.includes('logging_failed_check_log_directory_permissions_and_space'));
  const warning = describeFormalAiLoggingFailure(failures, { memoryVolume: FORMAL_AI_MEMORY_VOLUME_NAME, memoryMount: FORMAL_AI_MEMORY_MOUNT });
  assert.match(warning, /^Formal AI cannot write its logs or memory \(.*file_write_failed.*\): dialogs of this session will not be kept$/);
  assert.ok(warning.includes(`'${FORMAL_AI_MEMORY_VOLUME_NAME}'`));
  assert.equal(parseFormalAiLoggingFailures('(formal-ai-log-v1 (object (field kind (string native_diagnostic))))').count, 0);
  assert.equal(describeFormalAiLoggingFailure(parseFormalAiLoggingFailures(''), {}), null);
});

test('an unreadable sidecar log is not a logging failure', async () => {
  const result = await checkFormalAiSidecarLogging({
    containerName: 'gone',
    run: async () => {
      throw new Error('No such container: gone');
    },
  });
  assert.equal(result.warning, null);
  assert.match(result.error, /No such container/);
});

test('a sidecar that cannot write its logs is reported in the bot log, every lease, the task env and the solve log', async () => {
  const env = makeEnv();
  const docker = makeDocker();
  docker.seedVolume(FORMAL_AI_MEMORY_VOLUME_NAME, { owner: ROOT_OWNER });
  const run = withBrokenChown(docker);
  const { lines, log } = collect();

  const first = await acquireFormalAiSidecar({ sessionId: 'task-1', env, run, log, ...fast });

  assert.match(first.loggingWarning, /^Formal AI cannot write its logs or memory \(.*\): dialogs of this session will not be kept$/);
  assert.ok(lines.includes(`⚠️ ${first.loggingWarning}`), `bot log:\n${lines.join('\n')}`);
  assert.ok(lines.some(line => line.startsWith('⚠️ [formal-ai] memory volume') && line.includes('chown failed')));
  assert.equal(docker.volumeOf(FORMAL_AI_MEMORY_VOLUME_NAME).files.size, 0, 'nothing was written');
  assert.equal((await readFormalAiSidecarState({ env })).loggingWarning, first.loggingWarning);

  // The verdict belongs to the running sidecar, so a later task hears it too.
  const second = collect();
  const again = await acquireFormalAiSidecar({ sessionId: 'task-2', env, run, log: second.log, ...fast });
  assert.equal(again.loggingWarning, first.loggingWarning);
  assert.ok(second.lines.includes(`⚠️ ${first.loggingWarning}`));

  // Into the task container…
  const taskEnv = buildFormalAiTaskEnv({ sidecar: again, env: { [FORMAL_AI_SIDECAR_WARNING_ENV]: 'stale' } });
  assert.equal(taskEnv[FORMAL_AI_SIDECAR_WARNING_ENV], first.loggingWarning);
  assert.equal(buildFormalAiTaskEnv({ sidecar: { ...again, loggingWarning: null }, env: { [FORMAL_AI_SIDECAR_WARNING_ENV]: 'stale' } })[FORMAL_AI_SIDECAR_WARNING_ENV], undefined, 'a healthy lease never inherits an old warning');
  const startArgs = await buildDockerIsolationStartArgs('solve', ['https://example.test/issues/3583'], { sessionId: 's-3583', tool: 'claude', env: { HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'konard/hive-mind:latest', ...taskEnv }, homeDir: '/home/box', existsSync: target => ['/home/box/.claude/projects', '/home/box/.claude/sessions'].includes(target), installGuard: () => null });
  const envFlags = startArgs.filter((value, index) => startArgs[index - 1] === '-e');
  assert.ok(envFlags.includes(`${FORMAL_AI_SIDECAR_WARNING_ENV}=${first.loggingWarning}`), 'start-command passes it as one argv entry');

  // …and into the solve log, as a warning.
  const solveLog = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-3583-home-'));
  dirs.push(home);
  resetFormalAiRuntimeCache();
  try {
    await prepareFormalAiRuntime({
      tool: 'agent',
      workdir: home,
      env: { HIVE_MIND_FORMAL_AI_BASE_URL: 'http://formal-ai:8080', HIVE_MIND_FORMAL_AI_HOME_ROOT: home, [FORMAL_AI_SIDECAR_WARNING_ENV]: first.loggingWarning },
      log: async (message, options = {}) => void solveLog.push({ message, level: options.level ?? 'info' }),
      deps: {
        readVersionImpl: async () => FORMAL_AI_MINIMUM_VERSION,
        probeBackendImpl: async () => ({ ok: true, kind: 'ok', status: 200, version: FORMAL_AI_MINIMUM_VERSION, memory: { compatible: true }, health: { version: FORMAL_AI_MINIMUM_VERSION }, error: null }),
        hiveMindVersionImpl: async () => null,
        mkdtempImpl: async () => home,
        loadRegistryImpl: async () => [{ id: 'agent', global_configs: [] }],
        seedImpl: async () => [],
        configureImpl: async () => {},
        ghAuthImpl: async () => ({}),
      },
    });
  } finally {
    resetFormalAiRuntimeCache();
  }
  assert.ok(
    solveLog.some(entry => entry.message === `⚠️ ${first.loggingWarning}` && entry.level === 'warn'),
    JSON.stringify(solveLog, null, 2)
  );
  assert.equal(readFormalAiSidecarWarning({}), null);
});

test('a stopped sidecar forgets its warning, and a repaired start clears it', async () => {
  const env = makeEnv();
  const docker = makeDocker();
  docker.seedVolume(FORMAL_AI_MEMORY_VOLUME_NAME, { owner: ROOT_OWNER });
  await acquireFormalAiSidecar({ sessionId: 'task-1', env, run: withBrokenChown(docker), ...fast });
  await releaseFormalAiSidecar({ sessionId: 'task-1', env, run: docker.run, ...fast });
  assert.equal((await readFormalAiSidecarState({ env })).loggingWarning, null);

  const healthy = await acquireFormalAiSidecar({ sessionId: 'task-2', env, run: docker.run, ...fast });
  assert.equal(healthy.loggingWarning, null);
  assert.ok(docker.volumeOf(FORMAL_AI_MEMORY_VOLUME_NAME).files.has('memory.lino'));
});

// ---------------------------------------------------------------------------
// 3. Stdout is saved before every `docker rm`.
// ---------------------------------------------------------------------------

test('releasing the last lease saves the sidecar stdout before removing the container', async () => {
  const env = makeEnv();
  const docker = makeDocker();
  docker.seedVolume(FORMAL_AI_MEMORY_VOLUME_NAME, { owner: ROOT_OWNER });
  const { lines, log } = collect();
  await acquireFormalAiSidecar({ sessionId: 'task-1', env, run: withBrokenChown(docker), ...fast });
  docker.appendLog(FORMAL_AI_SIDECAR_CONTAINER_NAME, '[dialog-log] failed to record exchange: Permission denied (os error 13)');

  const released = await releaseFormalAiSidecar({ sessionId: 'task-1', env, run: docker.run, log, ...fast });

  assert.equal(released.stopped, true);
  assert.ok(archiveIndex(docker) >= 0 && archiveIndex(docker) < rmIndex(docker), docker.calls.join('\n'));
  const [archive] = archivesIn(env);
  assert.equal(archive, 'formal-ai-sidecar-2026-10-20T08-00-00-000Z.log', 'named after the container start');
  const text = fs.readFileSync(path.join(env.HIVE_MIND_LOG_DIR, archive), 'utf8');
  assert.ok(text.includes('2026-10-20T08:00:00.000123456Z (formal-ai-log-v1'), 'with Docker timestamps');
  assert.ok(text.includes('logging_failure') && text.includes('[dialog-log] failed to record exchange'));
  assert.ok(lines.some(line => line.startsWith(`📝 Formal AI sidecar log saved to ${path.join(env.HIVE_MIND_LOG_DIR, archive)}`)));
});

test('a stopped sidecar container is archived before acquire removes it', async () => {
  const env = makeEnv();
  const docker = makeDocker();
  await acquireFormalAiSidecar({ sessionId: 'task-1', env, run: docker.run, ...fast });
  docker.containers.get(FORMAL_AI_SIDECAR_CONTAINER_NAME).running = false;
  docker.calls.length = 0;

  await acquireFormalAiSidecar({ sessionId: 'task-2', env, run: docker.run, ...fast });

  assert.ok(archiveIndex(docker) >= 0 && archiveIndex(docker) < rmIndex(docker), docker.calls.join('\n'));
  assert.equal(archivesIn(env).length, 1);
});

test('the unload archives every sidecar container it removes', async () => {
  const start = Date.parse('2026-10-20T06:00:00Z');
  const env = makeEnv();
  const docker = makeDocker();
  await writeFormalAiSidecarState({ image: SIDECAR_IMAGE, imageDigest: 'sha256:sidecar', leases: [], lastUsedAt: new Date(start).toISOString() }, { env });
  // A sidecar container left behind, e.g. by a crash between start and stop.
  docker.createContainer(FORMAL_AI_SIDECAR_CONTAINER_NAME, { image: SIDECAR_IMAGE, running: false });
  docker.containers.get(FORMAL_AI_SIDECAR_CONTAINER_NAME).labels = [`${FORMAL_AI_SIDECAR_LABEL}=sidecar`];
  docker.appendLog(FORMAL_AI_SIDECAR_CONTAINER_NAME, 'the last words of a crashed sidecar');

  await unloadIdleFormalAiSidecar({ env, run: docker.run, now: () => new Date(start + 6 * 60 * 60 * 1000) });

  if (rmIndex(docker) < 0) return assert.fail(`the unload removed no sidecar container:\n${docker.calls.join('\n')}`);
  assert.ok(archiveIndex(docker) >= 0 && archiveIndex(docker) < rmIndex(docker), docker.calls.join('\n'));
  const [archive] = archivesIn(env);
  assert.ok(fs.readFileSync(path.join(env.HIVE_MIND_LOG_DIR, archive), 'utf8').includes('the last words of a crashed sidecar'));
});

test('archives are rotated, and HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP=0 turns them off', async () => {
  assert.equal(resolveFormalAiSidecarLogKeep({}), 50);
  assert.equal(resolveFormalAiSidecarLogKeep({ HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP: '3' }), 3);
  assert.equal(resolveFormalAiSidecarLogKeep({ HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP: 'many' }), 50);
  assert.equal(formatFormalAiSidecarLogStamp('2026-10-20T08:27:40.061753117Z'), '2026-10-20T08-27-40-061Z');

  const env = makeEnv({ HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP: '2' });
  const docker = makeDocker();
  for (const session of ['a', 'b', 'c']) {
    await acquireFormalAiSidecar({ sessionId: session, env, run: docker.run, ...fast });
    await stopFormalAiSidecar({ env, run: docker.run });
  }
  assert.deepEqual(archivesIn(env).sort(), ['formal-ai-sidecar-2026-10-20T08-00-01-000Z.log', 'formal-ai-sidecar-2026-10-20T08-00-02-000Z.log'], 'the oldest start is pruned');
  assert.deepEqual(await pruneFormalAiSidecarLogs({ dir: path.join(env.HIVE_MIND_LOG_DIR, 'missing'), keep: 1 }), []);

  const off = makeEnv({ HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP: '0' });
  const quiet = makeDocker();
  await acquireFormalAiSidecar({ sessionId: 'a', env: off, run: quiet.run, ...fast });
  await stopFormalAiSidecar({ env: off, run: quiet.run });
  assert.equal(archiveIndex(quiet), -1);
  assert.deepEqual(archivesIn(off), []);
});

test('with the real runner the log is streamed to disk rather than buffered', async () => {
  const env = makeEnv();
  const spawned = [];
  const spawnImpl = (command, args, options) => {
    spawned.push({ command, args, stdio: options.stdio });
    const child = new EventEmitter();
    child.kill = () => {};
    // The child writes straight into the archive's file descriptor.
    fs.writeSync(options.stdio[1], '2026-10-20T08:27:40.061753117Z streamed line\n');
    setImmediate(() => child.emit('close', 0, null));
    return child;
  };
  const result = await archiveFormalAiSidecarLogs({ containerName: 'hive-mind-formal-ai-3583-absent', env, run: dockerExecFileAsync, spawnImpl, startedAt: '2026-10-20T08:27:40.061753117Z' });
  assert.equal(result.archived, true, result.error);
  assert.equal(path.basename(result.path), 'formal-ai-sidecar-2026-10-20T08-27-40-061Z.log');
  assert.deepEqual(spawned[0].args, ['logs', '--timestamps', 'hive-mind-formal-ai-3583-absent']);
  assert.equal(fs.readFileSync(result.path, 'utf8'), '2026-10-20T08:27:40.061753117Z streamed line\n');

  const failed = await archiveFormalAiSidecarLogs({
    containerName: 'hive-mind-formal-ai-3583-absent',
    env,
    run: dockerExecFileAsync,
    startedAt: '2026-10-20T09:00:00Z',
    spawnImpl: () => {
      const child = new EventEmitter();
      child.kill = () => {};
      setImmediate(() => child.emit('close', 1, null));
      return child;
    },
  });
  assert.equal(failed.archived, false, 'a failed copy is reported, never thrown');
  assert.match(failed.error, /exited with code 1/);
});
