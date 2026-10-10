#!/usr/bin/env node

/**
 * Formal AI must cost nothing on a host that does not use it (issue #2305).
 *
 * The report: every five minutes the maintenance tick pulled
 * `ghcr.io/link-assistant/formal-ai:latest`, booted each new release to verify
 * it and never removed the superseded ~24 GB image — on hosts that had never
 * run a `--model formal-ai` task. Each sidecar creation also leaked anonymous
 * volumes for the image's `VOLUME`s.
 *
 * This file drives the maintenance modules against the in-memory Docker daemon
 * and asserts the behaviour the issue asked for:
 *
 *   - no Formal AI task → zero pulls, zero registry queries, zero boots;
 *   - an unchanged registry digest → no pull;
 *   - a verified update removes the image it replaced;
 *   - 5h without a task → the current *and* previous images are removed, the
 *     memory volume is untouched, and the next task pulls the accepted build
 *     back even though `:latest` has moved on;
 *   - an acquire racing the unload waits on the sidecar lock;
 *   - no sidecar leaves an anonymous volume behind.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2305
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { FORMAL_AI_IMAGE_REPOSITORY } from '../src/formal-ai-image.lib.mjs';
import { formatDockerSize, parseDockerSize } from '../src/formal-ai-image-store.lib.mjs';
import { runFormalAiMaintenanceTick, stopIdleFormalAiSidecar } from '../src/formal-ai-maintenance.lib.mjs';
import { FORMAL_AI_MEMORY_VOLUME_NAME, FORMAL_AI_SIDECAR_CONTAINER_NAME, FORMAL_AI_SIDECAR_NETWORK_NAME, FORMAL_AI_SIDECAR_SCRATCH_PATHS, acquireFormalAiSidecar, buildFormalAiSidecarRunArgs, readFormalAiSidecarState, releaseFormalAiSidecar, writeFormalAiSidecarState } from '../src/formal-ai-sidecar.lib.mjs';
import { unloadIdleFormalAiSidecar } from '../src/formal-ai-unload.lib.mjs';
import { updateFormalAiSidecarWhenIdle } from '../src/formal-ai-updater.lib.mjs';
import { DEFAULT_FORMAL_AI_UNLOAD_AFTER_MS, describeFormalAiUsage, formatFormalAiDuration, isFormalAiPrefetchEnabled, parseFormalAiDurationMs, resolveFormalAiUnloadAfterMs, resolveFormalAiUpdateCheckIntervalMs } from '../src/formal-ai-usage.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION } from '../src/formal-ai-version.lib.mjs';
import { createDockerSimulator, manifestDigestOf } from './formal-ai-docker-simulator.mjs';

const LATEST = `${FORMAL_AI_IMAGE_REPOSITORY}:latest`;
const BOOTSTRAP_IMAGE = `${FORMAL_AI_IMAGE_REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}`;
const FALLBACK_IMAGE = 'konard/hive-mind-dind:latest';
const HOUR = 60 * 60 * 1000;
const VERSION = '0.346.0';
const MEMORY = { compatible: true, schema_version: 3, migration_required: false, migration_state: 'current' };
const fast = { healthAttempts: 1, healthDelayMs: 0, sleepImpl: async () => {} };
const noopClis = async () => ({ status: 'skipped' });

const stateDirs = [];
const makeEnv = (extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-2305-'));
  stateDirs.push(dir);
  return { HIVE_MIND_STATE_DIR: dir, HIVE_MIND_IMAGE_VARIANT: 'dind', ...extra };
};
process.on('exit', () => {
  for (const dir of stateDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const makeDocker = (options = {}) =>
  createDockerSimulator({
    health: { version: VERSION, memory: MEMORY },
    memory: { 'upgrade-status': { compatible: true, path_exists: true, migration_required: false, migration_state: 'current', detected_schema_version: 3 } },
    imageVolumes: ['/var/lib/docker', '/root/.formal-ai'],
    ...options,
  });

const at = ms => () => new Date(ms);
const count = (docker, pattern) => docker.calls.filter(call => (typeof pattern === 'string' ? call.startsWith(pattern) : pattern.test(call))).length;
const formalAiImagesOn = docker => [...docker.digests].filter(id => docker.tagsOf(id).some(tag => tag.startsWith(`${FORMAL_AI_IMAGE_REPOSITORY}:`)) || docker.repoDigests.has(id));

test('durations, opt-outs and usage are read the way operators write them', () => {
  assert.equal(parseFormalAiDurationMs('5h'), 5 * HOUR);
  assert.equal(parseFormalAiDurationMs('1h30m'), 1.5 * HOUR);
  assert.equal(parseFormalAiDurationMs('90m'), 1.5 * HOUR);
  assert.equal(parseFormalAiDurationMs('3600'), HOUR, 'a bare number is seconds');
  assert.equal(parseFormalAiDurationMs('250ms'), 250);
  assert.equal(parseFormalAiDurationMs('off'), 0);
  assert.equal(parseFormalAiDurationMs('0'), 0);
  assert.equal(parseFormalAiDurationMs('soon'), null, 'garbage is not silently read as "disabled"');

  assert.equal(resolveFormalAiUnloadAfterMs({}), DEFAULT_FORMAL_AI_UNLOAD_AFTER_MS);
  assert.equal(DEFAULT_FORMAL_AI_UNLOAD_AFTER_MS, 5 * HOUR);
  assert.equal(resolveFormalAiUnloadAfterMs({ HIVE_MIND_FORMAL_AI_UNLOAD_AFTER: 'soon' }), 5 * HOUR);
  assert.equal(resolveFormalAiUnloadAfterMs({ HIVE_MIND_FORMAL_AI_UNLOAD_AFTER: '0' }), 0);
  assert.equal(resolveFormalAiUpdateCheckIntervalMs({}), HOUR, 'updates are checked hourly, not every 5 minutes');
  assert.equal(isFormalAiPrefetchEnabled({}), false, 'lazy is the default');
  assert.equal(isFormalAiPrefetchEnabled({ HIVE_MIND_FORMAL_AI_PREFETCH: 'true' }), true);
  assert.equal(formatFormalAiDuration(5 * HOUR + 30 * 60 * 1000), '5h30m');

  assert.equal(parseDockerSize('24.29GB'), 24_290_000_000);
  assert.equal(parseDockerSize('512kB'), 512_000);
  assert.equal(parseDockerSize('0B'), 0);
  assert.equal(parseDockerSize('n/a'), null);
  assert.equal(formatDockerSize(24_290_000_000), '24.29GB');

  const now = at(Date.parse('2026-09-27T12:00:00Z'));
  assert.deepEqual(describeFormalAiUsage({ state: {}, env: {}, now }).used, false, 'a fresh record has never been used');
  assert.equal(describeFormalAiUsage({ state: { lastUsedAt: '2026-09-27T08:00:00Z' }, env: {}, now }).recent, true);
  assert.equal(describeFormalAiUsage({ state: { lastUsedAt: '2026-09-27T06:00:00Z' }, env: {}, now }).recent, false);
  // Records written before #2305 only know when the sidecar last served.
  assert.equal(describeFormalAiUsage({ state: { serving: { observedAt: '2026-09-27T11:00:00Z' } }, env: {}, now }).recent, true);
  assert.equal(describeFormalAiUsage({ state: { lastUsedAt: '2026-01-01T00:00:00Z' }, env: { HIVE_MIND_FORMAL_AI_UNLOAD_AFTER: '0' }, now }).recent, true, 'with unloading off, "recent" means "ever used"');
});

test('a host that never ran a Formal AI task never pulls, queries or boots it', async () => {
  const env = makeEnv();
  const docker = makeDocker({ registry: { [LATEST]: 'sha256:v1', [BOOTSTRAP_IMAGE]: 'sha256:v1' } });
  for (let tick = 0; tick < 12; tick += 1) {
    const result = await runFormalAiMaintenanceTick({ env, run: docker.run, updateClis: noopClis });
    assert.deepEqual(result.errors, []);
    assert.equal(result.formalAi.status, 'unused');
    assert.equal(result.unload.status, 'nothing-to-unload');
  }
  assert.equal(count(docker, 'pull'), 0, 'no image is downloaded before the first Formal AI task');
  assert.equal(count(docker, 'buildx'), 0, 'not even the registry is asked');
  assert.equal(count(docker, 'run'), 0, 'and nothing is booted for "verification"');
  assert.equal(docker.volumes.size, 0);

  // A host upgraded from the eager behaviour carries images it never used: the
  // first tick removes all of them, and the memory volume stays.
  const upgradedEnv = makeEnv();
  const upgraded = makeDocker({ images: { [LATEST]: 'sha256:v2', [BOOTSTRAP_IMAGE]: 'sha256:v1' } });
  upgraded.volumes.add(FORMAL_AI_MEMORY_VOLUME_NAME);
  const logs = [];
  const first = await runFormalAiMaintenanceTick({ env: upgradedEnv, run: upgraded.run, updateClis: noopClis, log: async line => logs.push(line) });
  assert.equal(first.unload.status, 'unloaded');
  assert.deepEqual(formalAiImagesOn(upgraded), []);
  assert.equal(upgraded.volumes.has(FORMAL_AI_MEMORY_VOLUME_NAME), true);
  assert.match(logs.join('\n'), /Formal AI unloaded \(never used on this host\): removed 2 image\(s\).*freeing 48\.00GB/);
  assert.equal(count(upgraded, 'pull') + count(upgraded, 'run'), 0);
});

test('an unchanged registry digest costs one manifest lookup and no pull', async () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  const env = makeEnv();
  const docker = makeDocker({ images: { [LATEST]: 'sha256:v1' }, registry: { [LATEST]: 'sha256:v1' } });
  writeFormalAiSidecarState({ image: LATEST, imageDigest: 'sha256:v1', leases: [], lastUsedAt: new Date(now - HOUR).toISOString() }, { env });

  assert.deepEqual(await updateFormalAiSidecarWhenIdle({ env, run: docker.run, now: at(now), ...fast }), { status: 'up-to-date', image: LATEST, digest: 'sha256:v1' });
  assert.equal(count(docker, 'buildx imagetools inspect'), 1);
  assert.equal(count(docker, 'pull'), 0, 'the digest matched, so nothing was pulled');
  assert.equal(count(docker, 'run'), 0, 'and nothing was booted');

  // The next tick inside the check interval does not even ask the registry.
  const throttled = await updateFormalAiSidecarWhenIdle({ env, run: docker.run, now: at(now + 5 * 60 * 1000), ...fast });
  assert.equal(throttled.status, 'throttled');
  assert.equal(count(docker, 'buildx imagetools inspect'), 1);

  // A host without buildx falls back to the old pull, which is still correct.
  const noBuildx = makeDocker({ images: { [LATEST]: 'sha256:v1' } });
  const fallbackEnv = makeEnv();
  writeFormalAiSidecarState({ image: LATEST, imageDigest: 'sha256:v1', leases: [], lastUsedAt: new Date(now - HOUR).toISOString() }, { env: fallbackEnv });
  assert.equal((await updateFormalAiSidecarWhenIdle({ env: fallbackEnv, run: noBuildx.run, now: at(now), ...fast })).status, 'up-to-date');
  assert.equal(count(noBuildx, 'pull'), 1);
});

test('updates wait for a recent task, and a verified update removes the image it replaced', async () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  const env = makeEnv();
  const docker = makeDocker({ images: { [LATEST]: 'sha256:v1', [`${FORMAL_AI_IMAGE_REPOSITORY}:0.345.0`]: 'sha256:v1' }, registry: { [LATEST]: 'sha256:v2' } });

  // Last used 6h ago: past the unload window, so no update is attempted.
  writeFormalAiSidecarState({ image: LATEST, imageDigest: 'sha256:v1', leases: [], lastUsedAt: new Date(now - 6 * HOUR).toISOString() }, { env });
  assert.equal((await updateFormalAiSidecarWhenIdle({ env, run: docker.run, now: at(now), ...fast })).status, 'unused');
  assert.equal(count(docker, 'pull') + count(docker, 'buildx'), 0);

  writeFormalAiSidecarState({ ...readFormalAiSidecarState({ env }), lastUsedAt: new Date(now - HOUR).toISOString() }, { env });
  const logs = [];
  const result = await updateFormalAiSidecarWhenIdle({ env, run: docker.run, now: at(now), log: async line => logs.push(line), ...fast });
  assert.equal(result.status, 'updated');
  assert.equal(result.digest, 'sha256:v2');
  assert.deepEqual(result.cleanup.removed, ['sha256:v1'], 'the superseded build is removed after verification');
  assert.equal(result.cleanup.bytesFreed, 24_000_000_000);
  assert.equal(docker.digests.has('sha256:v1'), false);
  assert.equal(docker.digests.has('sha256:v2'), true, 'the new build stays');
  assert.equal(docker.ran(/^rmi .*:0\.345\.0$/), true, 'a tagged previous build is removed by its tag, never forced');
  assert.equal(docker.ran('rmi --force'), false);
  assert.match(logs.join('\n'), /Removed 1 superseded Formal AI image\(s\), freeing 24\.00GB/);

  const state = readFormalAiSidecarState({ env });
  assert.equal(state.lastUpdate.repoDigest, `${FORMAL_AI_IMAGE_REPOSITORY}@${manifestDigestOf('sha256:v2')}`, 'the accepted build is recorded by an immutable, pullable reference');
  assert.equal(state.lastUpdate.previousDigest, 'sha256:v1');
  assert.equal(docker.volumes.has(FORMAL_AI_MEMORY_VOLUME_NAME), true);
  assert.deepEqual(docker.anonymousVolumes(), [], 'the verification boot leaked no anonymous volume');
});

test('five idle hours unload the current and previous images, never the memory volume or the task image', async () => {
  const start = Date.parse('2026-09-27T06:00:00Z');
  const env = makeEnv();
  const docker = makeDocker({
    images: { [LATEST]: 'sha256:v2', [FALLBACK_IMAGE]: 'sha256:hive-mind' },
    registry: { [LATEST]: 'sha256:v2' },
  });
  // A previous release left behind as a dangling image (the pre-#2305 leak).
  docker.digests.add('sha256:v1');
  docker.repoDigests.set('sha256:v1', new Set([`${FORMAL_AI_IMAGE_REPOSITORY}@${manifestDigestOf('sha256:v1')}`]));
  writeFormalAiSidecarState({ image: LATEST, imageDigest: 'sha256:v2', leases: [], lastUpdate: { image: LATEST, digest: 'sha256:v2', repoDigest: `${FORMAL_AI_IMAGE_REPOSITORY}@${manifestDigestOf('sha256:v2')}`, version: VERSION, updatedAt: new Date(start).toISOString() } }, { env });

  // A task runs and finishes.
  await acquireFormalAiSidecar({ sessionId: 'task-1', env, run: docker.run, now: at(start), ...fast });
  await releaseFormalAiSidecar({ sessionId: 'task-1', env, run: docker.run, now: at(start + 10 * 60 * 1000), ...fast });
  await stopIdleFormalAiSidecar({ env, run: docker.run });
  assert.equal(docker.containers.has(FORMAL_AI_SIDECAR_CONTAINER_NAME), false);

  // 4h later it is still wanted.
  assert.equal((await unloadIdleFormalAiSidecar({ env, run: docker.run, now: at(start + 4 * HOUR) })).status, 'recently-used');
  assert.equal(count(docker, 'rmi'), 0);

  // 5h after the last use it is not.
  const logs = [];
  const result = await unloadIdleFormalAiSidecar({ env, run: docker.run, now: at(start + 10 * 60 * 1000 + 5 * HOUR + 1), log: async line => logs.push(line) });
  assert.equal(result.status, 'unloaded');
  assert.deepEqual([...result.images].sort(), ['sha256:v1', 'sha256:v2'], 'current and previous builds are both removed');
  assert.equal(result.bytesFreed, 48_000_000_000);
  assert.deepEqual(formalAiImagesOn(docker), []);
  assert.equal(docker.digests.has('sha256:hive-mind'), true, 'the task image is never touched');
  assert.equal(docker.volumes.has(FORMAL_AI_MEMORY_VOLUME_NAME), true, 'the persisted memory survives the unload');
  assert.equal(docker.ran(/volume rm/), false);
  assert.match(logs.join('\n'), /Formal AI unloaded \(unused for 5h\): removed 2 image\(s\) .* freeing 48\.00GB; memory volume 'hive-mind-formal-ai-memory' preserved/);

  const state = readFormalAiSidecarState({ env });
  assert.equal(state.image, null);
  assert.equal(state.lastUpdate.digest, 'sha256:v2', 'the accepted build is still remembered');
  assert.equal(state.lastUnload.bytesFreed, 48_000_000_000);

  // Nothing left: later ticks are quiet no-ops and do not update either.
  const later = at(start + 7 * HOUR);
  assert.equal((await unloadIdleFormalAiSidecar({ env, run: docker.run, now: later })).status, 'nothing-to-unload');
  assert.equal((await updateFormalAiSidecarWhenIdle({ env, run: docker.run, now: later, ...fast })).status, 'unused');

  // `:latest` moves on while the host is idle. The next task must still get
  // exactly the build that was verified against the memory file.
  docker.calls.length = 0;
  const registry = { [LATEST]: 'sha256:v3', [`${FORMAL_AI_IMAGE_REPOSITORY}:${VERSION}`]: 'sha256:v2' };
  const redocker = makeDocker({ registry: { ...registry, [BOOTSTRAP_IMAGE]: 'sha256:v0' } });
  redocker.volumes.add(FORMAL_AI_MEMORY_VOLUME_NAME);
  const sidecar = await acquireFormalAiSidecar({ sessionId: 'task-2', env, run: redocker.run, now: later, ...fast });
  assert.equal(sidecar.imageDigest, 'sha256:v2', 'the accepted build is pulled back by its registry digest');
  assert.equal(redocker.ran(`pull ${LATEST}`), false, 'the moved tag is not consulted');
  assert.equal(redocker.ran(/^pull .*@sha256:manifest-v2$/), true);
});

test('an acquire that races the unload waits for it on the sidecar lock', async () => {
  const start = Date.parse('2026-09-27T00:00:00Z');
  const env = makeEnv();
  const docker = makeDocker({ images: { [LATEST]: 'sha256:v2' }, registry: { [LATEST]: 'sha256:v2' } });
  writeFormalAiSidecarState({ image: LATEST, imageDigest: 'sha256:v2', leases: [], lastUsedAt: new Date(start).toISOString(), lastUpdate: { image: LATEST, digest: 'sha256:v2', repoDigest: `${FORMAL_AI_IMAGE_REPOSITORY}@${manifestDigestOf('sha256:v2')}`, version: VERSION } }, { env });

  let reachedRmi;
  const rmiReached = new Promise(resolve => (reachedRmi = resolve));
  let releaseRmi;
  const rmiGate = new Promise(resolve => (releaseRmi = resolve));
  const events = [];
  const run = async (command, args) => {
    if (args[0] === 'rmi' && !events.includes('rmi')) {
      events.push('rmi');
      reachedRmi();
      await rmiGate;
    }
    return docker.run(command, args);
  };
  const realSleep = { sleepImpl: () => new Promise(resolve => setTimeout(resolve, 5)), lockOptions: { pollMs: 5 } };

  const unloading = unloadIdleFormalAiSidecar({ env, run, now: at(start + 6 * HOUR), ...realSleep });
  await rmiReached;
  const callsBefore = docker.calls.length;
  const acquiring = acquireFormalAiSidecar({ sessionId: 'task-racing', env, run, now: at(start + 6 * HOUR), healthAttempts: 1, healthDelayMs: 0, ...realSleep }).then(result => {
    events.push('acquired');
    return result;
  });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(docker.calls.length, callsBefore, 'the acquire issued no docker command while the unload held the lock');
  assert.equal(events.includes('acquired'), false);

  releaseRmi();
  const unloaded = await unloading;
  const sidecar = await acquiring;
  assert.equal(unloaded.status, 'unloaded');
  assert.equal(sidecar.imageDigest, 'sha256:v2', 'the acquire pulled the image back after the unload and booted it');
  assert.equal(readFormalAiSidecarState({ env }).leases.length, 1);
  await releaseFormalAiSidecar({ sessionId: 'task-racing', env, run: docker.run, now: at(start + 6 * HOUR) });
});

test('a running task, prefetch or UNLOAD_AFTER=0 keeps the image', async () => {
  const start = Date.parse('2026-09-27T00:00:00Z');
  const tenHoursLater = at(start + 10 * HOUR);

  const busyEnv = makeEnv();
  const busy = makeDocker({ images: { [LATEST]: 'sha256:v2' } });
  busy.createContainer('task-long');
  writeFormalAiSidecarState({ image: LATEST, imageDigest: 'sha256:v2', leases: [{ sessionId: 'task-long', acquiredAt: new Date(start).toISOString(), containerSeen: true }], lastUsedAt: new Date(start).toISOString() }, { env: busyEnv });
  assert.deepEqual(await unloadIdleFormalAiSidecar({ env: busyEnv, run: busy.run, now: tenHoursLater }), { status: 'busy', leaseCount: 1 });
  assert.equal(busy.digests.has('sha256:v2'), true);
  // A task that runs for hours keeps the host "in use" for its whole duration.
  assert.equal(Date.parse(readFormalAiSidecarState({ env: busyEnv }).lastUsedAt), start + 10 * HOUR);

  for (const extra of [{ HIVE_MIND_FORMAL_AI_PREFETCH: 'true' }, { HIVE_MIND_FORMAL_AI_UNLOAD_AFTER: '0' }, { HIVE_MIND_FORMAL_AI_SIDECAR: '0' }]) {
    const env = makeEnv(extra);
    const docker = makeDocker({ images: { [LATEST]: 'sha256:v2' } });
    assert.equal((await unloadIdleFormalAiSidecar({ env, run: docker.run, now: tenHoursLater })).status, 'disabled', JSON.stringify(extra));
    assert.equal(count(docker, 'rmi'), 0);
  }

  // Prefetch restores the old eager behaviour: a never-used host still follows releases.
  const eagerEnv = makeEnv({ HIVE_MIND_FORMAL_AI_PREFETCH: 'true' });
  const eager = makeDocker({ registry: { [LATEST]: 'sha256:v2' } });
  eager.volumes.add(FORMAL_AI_MEMORY_VOLUME_NAME);
  assert.equal((await updateFormalAiSidecarWhenIdle({ env: eagerEnv, run: eager.run, now: tenHoursLater, ...fast })).status, 'updated');
});

test('the sidecar mounts tmpfs over the image VOLUMEs and leaks no anonymous volume', async () => {
  const args = buildFormalAiSidecarRunArgs({ image: LATEST, env: {} });
  for (const scratch of FORMAL_AI_SIDECAR_SCRATCH_PATHS)
    assert.equal(
      args.some((arg, index) => arg === '--tmpfs' && args[index + 1] === scratch),
      true,
      scratch
    );
  assert.deepEqual(FORMAL_AI_SIDECAR_SCRATCH_PATHS, ['/var/lib/docker', '/root/.formal-ai']);

  const env = makeEnv();
  const docker = makeDocker({ images: { [LATEST]: 'sha256:v2' } });
  writeFormalAiSidecarState({ lastUpdate: { image: LATEST, digest: 'sha256:v2', version: VERSION } }, { env });
  for (let task = 0; task < 3; task += 1) {
    await acquireFormalAiSidecar({ sessionId: `task-${task}`, env, run: docker.run, ...fast });
    await releaseFormalAiSidecar({ sessionId: `task-${task}`, env, run: docker.run });
    await stopIdleFormalAiSidecar({ env, run: docker.run });
  }
  assert.deepEqual(docker.anonymousVolumes(), []);
  assert.deepEqual([...docker.volumes], [FORMAL_AI_MEMORY_VOLUME_NAME]);

  // Without the tmpfs mounts the same three tasks would have leaked six volumes.
  const leaky = makeDocker({ images: { [LATEST]: 'sha256:v2' } });
  await leaky.run('docker', ['network', 'create', '--internal', FORMAL_AI_SIDECAR_NETWORK_NAME]);
  for (let task = 0; task < 3; task += 1) {
    await leaky.run(
      'docker',
      buildFormalAiSidecarRunArgs({ image: LATEST, env: {}, containerName: `leaky-${task}` }).filter((arg, index, all) => arg !== '--tmpfs' && all[index - 1] !== '--tmpfs')
    );
    await leaky.run('docker', ['rm', '--force', `leaky-${task}`]);
  }
  assert.equal(leaky.anonymousVolumes().length, 6);
});
