/**
 * @hive-mind-test-suite default
 * Issue #3208: the idle updater pulled and accepted `formal-ai:latest` on a
 * host that was served by the Hive Mind image and that no task used again; the
 * 5-hour unload then deleted it, and the next task had to re-pull 7 GB or fail
 * closed — although that update had migrated nothing (`migrationId` and
 * `memorySchemaVersion` were both null). Around it: the unload said "no Formal
 * AI image on this host" while the Hive Mind image was serving Formal AI,
 * `bytesFreed` did not say how it was obtained, and a `/health` without a
 * memory schema was logged as `memory schema=unknown`.
 *
 * Every Docker call is answered by an in-memory stub or the shared simulator:
 * nothing here touches a real daemon or the network.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3208
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { FORMAL_AI_IMAGE_REPOSITORY, FORMAL_AI_IMAGE_SOURCES, ensureFormalAiSidecarImage, readAcceptedFormalAiImage, resolveFormalAiSidecarImageCandidates } from '../src/formal-ai-image.lib.mjs';
import { acquireFormalAiSidecar, readFormalAiSidecarState, releaseFormalAiSidecar, writeFormalAiSidecarState } from '../src/formal-ai-sidecar.lib.mjs';
import { unloadIdleFormalAiSidecar } from '../src/formal-ai-unload.lib.mjs';
import { updateFormalAiSidecarWhenIdle } from '../src/formal-ai-updater.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION } from '../src/formal-ai-version.lib.mjs';
import { createDockerSimulator } from './formal-ai-docker-simulator.mjs';

const LATEST = `${FORMAL_AI_IMAGE_REPOSITORY}:latest`;
const FULL = `${FORMAL_AI_IMAGE_REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}`;
const SLIM = `${FULL}-slim`;
const HIVE_MIND = 'konard/hive-mind-dind:latest';
const UPDATE_DIGEST = 'sha256:01da160c';
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-14T05:20:00Z');
const at = ms => () => new Date(ms);
const fast = { healthAttempts: 1, healthDelayMs: 0, sleepImpl: async () => {} };

/** The acceptance record from the issue: nothing was migrated. */
const UNMIGRATED = { image: LATEST, digest: UPDATE_DIGEST, version: '0.353.2', migrationId: null, memorySchemaVersion: null, updatedAt: '2026-10-13T23:22:54.764Z' };

const stateDirs = [];
after(() => {
  for (const dir of stateDirs) fs.rmSync(dir, { recursive: true, force: true });
});
const makeEnv = (extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-3208-'));
  stateDirs.push(dir);
  return { HIVE_MIND_STATE_DIR: dir, HIVE_MIND_IMAGE_VARIANT: 'dind', ...extra };
};

/** A daemon stub that also answers `formal-ai --version` inside a local image. */
const stubDocker = ({ local = {}, versions = {} } = {}) => {
  const calls = [];
  const run = async (command, args) => {
    assert.equal(command, 'docker', 'only docker is shelled out to');
    calls.push(args.join(' '));
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (!(args[2] in local)) throw Object.assign(new Error(`No such image: ${args[2]}`), { stderr: `Error: No such image: ${args[2]}` });
      return { stdout: `${local[args[2]]}\n` };
    }
    if (args[0] === 'run' && args.includes('--version')) {
      const reference = args[args.indexOf('--version') - 1];
      if (!versions[reference]) throw new Error('executable file not found');
      return { stdout: `formal-ai ${versions[reference]}\n` };
    }
    if (args[0] === 'pull') throw Object.assign(new Error(`Command failed: docker ${args.join(' ')}`), { killed: true, signal: 'SIGTERM', stderr: '' });
    throw new Error(`unexpected docker ${args.join(' ')}`);
  };
  return { run, calls, pulls: () => calls.filter(call => call.startsWith('pull ')) };
};

test('the acceptance record exposes whether the update migrated memory', () => {
  assert.equal(readAcceptedFormalAiImage({ lastUpdate: UNMIGRATED }).migrationId, null);
  assert.equal(readAcceptedFormalAiImage({ lastUpdate: { ...UNMIGRATED, migrationId: 'events-v1-to-v2' } }).migrationId, 'events-v1-to-v2');
});

test('an accepted update that migrated nothing is preferred but not exclusive', () => {
  const candidates = resolveFormalAiSidecarImageCandidates({ HIVE_MIND_IMAGE_VARIANT: 'dind' }, { accepted: readAcceptedFormalAiImage({ lastUpdate: UNMIGRATED }) });
  assert.equal(candidates[0].image, UPDATE_DIGEST, 'the accepted build still comes first');
  assert.equal(candidates[0].source, FORMAL_AI_IMAGE_SOURCES.ACCEPTED);
  const images = candidates.map(candidate => candidate.image);
  for (const fallback of [SLIM, FULL, HIVE_MIND]) assert.ok(images.includes(fallback), `${fallback} is a fallback: ${images.join(', ')}`);
  assert.ok(images.indexOf(HIVE_MIND) > images.indexOf(UPDATE_DIGEST));
});

test('an accepted update that migrated memory stays exclusive', () => {
  for (const migrated of [{ migrationId: 'events-v1-to-v2' }, { memorySchemaVersion: 2 }]) {
    const candidates = resolveFormalAiSidecarImageCandidates({ HIVE_MIND_IMAGE_VARIANT: 'dind' }, { accepted: readAcceptedFormalAiImage({ lastUpdate: { ...UNMIGRATED, ...migrated } }) });
    assert.deepEqual(
      candidates.filter(candidate => candidate.source !== FORMAL_AI_IMAGE_SOURCES.ACCEPTED),
      [],
      JSON.stringify(migrated)
    );
  }
});

test('the reported host: an unmigrated, unloaded update falls back to the local Hive Mind image with a warning and no pull', async () => {
  const docker = stubDocker({ local: { [HIVE_MIND]: 'sha256:hive' }, versions: { [HIVE_MIND]: FORMAL_AI_BOOTSTRAP_VERSION } });
  const logs = [];
  const resolved = await ensureFormalAiSidecarImage({ env: { HIVE_MIND_IMAGE_VARIANT: 'dind' }, accepted: readAcceptedFormalAiImage({ lastUpdate: UNMIGRATED }), run: docker.run, log: async line => logs.push(line) });
  assert.equal(resolved.image, HIVE_MIND);
  assert.deepEqual(docker.pulls(), [], 'no 7 GB download stands between the task and the image already on the host');
  const warning = logs.find(line => line.includes(LATEST));
  assert.ok(warning, logs.join('\n'));
  assert.match(warning, /^⚠️/);
  assert.match(warning, /did not migrate the persisted memory/);
});

test('an accepted update that migrated memory still fails closed rather than downgrade', async () => {
  const docker = stubDocker({ local: { [HIVE_MIND]: 'sha256:hive' }, versions: { [HIVE_MIND]: FORMAL_AI_BOOTSTRAP_VERSION } });
  const error = await ensureFormalAiSidecarImage({ env: { HIVE_MIND_IMAGE_VARIANT: 'dind' }, accepted: readAcceptedFormalAiImage({ lastUpdate: { ...UNMIGRATED, migrationId: 'events-v1-to-v2' } }), run: docker.run }).catch(caught => caught);
  assert.ok(error instanceof Error);
  assert.match(error.message, /already migrated/);
  assert.equal(
    docker.calls.some(call => call.includes(HIVE_MIND)),
    false,
    'the Hive Mind image is not even considered'
  );
});

test('the updater does not download a Formal AI image for a host served by the Hive Mind image', async () => {
  const env = makeEnv();
  const docker = createDockerSimulator({ images: { [HIVE_MIND]: 'sha256:hive' }, pull: { [LATEST]: UPDATE_DIGEST }, registry: { [LATEST]: UPDATE_DIGEST } });
  writeFormalAiSidecarState({ image: HIVE_MIND, imageReference: HIVE_MIND, imageDigest: 'sha256:hive', leases: [], lastUsedAt: new Date(NOW - 10 * 60 * 1000).toISOString(), serving: { image: HIVE_MIND, imageDigest: 'sha256:hive', version: '0.352.1', memorySchemaVersion: null } }, { env });
  const result = await updateFormalAiSidecarWhenIdle({ env, run: docker.run, now: at(NOW), ...fast });
  assert.equal(result.status, 'not-present');
  assert.equal(docker.ran(/^pull /), false, 'nothing is pulled');
  assert.equal(readFormalAiSidecarState({ env }).lastUpdate, null, 'nothing is accepted');
});

test('the updater does not pull again while the last accepted update has not served a task', async () => {
  const env = makeEnv();
  const docker = createDockerSimulator({ images: { [LATEST]: UPDATE_DIGEST }, pull: { [LATEST]: 'sha256:newer' }, registry: { [LATEST]: 'sha256:newer' } });
  writeFormalAiSidecarState({ image: LATEST, imageDigest: UPDATE_DIGEST, leases: [], lastUsedAt: new Date(NOW - 2 * HOUR).toISOString(), lastUpdate: { ...UNMIGRATED, updatedAt: new Date(NOW - HOUR).toISOString() } }, { env });
  const result = await updateFormalAiSidecarWhenIdle({ env, run: docker.run, now: at(NOW), ...fast });
  assert.equal(result.status, 'unused');
  assert.equal(docker.ran(/^pull /), false);
});

test('an idle unload keeps the Hive Mind image and says that it serves Formal AI', async () => {
  const env = makeEnv();
  const docker = createDockerSimulator({ images: { [HIVE_MIND]: 'sha256:hive' } });
  writeFormalAiSidecarState({ image: HIVE_MIND, imageDigest: 'sha256:hive', leases: [], lastUsedAt: new Date(NOW - 10 * HOUR).toISOString() }, { env });
  const logs = [];
  const result = await unloadIdleFormalAiSidecar({ env, run: docker.run, now: at(NOW), verbose: true, log: async line => logs.push(line) });
  assert.equal(result.status, 'nothing-to-unload');
  assert.equal(docker.digests.has('sha256:hive'), true, 'the Hive Mind image is never removed');
  const text = logs.join('\n');
  assert.doesNotMatch(text, /no Formal AI image on this host/);
  assert.match(text, new RegExp(`${HIVE_MIND.replace(/[.:/-]/g, '\\$&')}.*kept`));
});

test('bytesFreed says whether it was measured or estimated', async () => {
  const measuredEnv = makeEnv();
  const measured = createDockerSimulator({ images: { [LATEST]: UPDATE_DIGEST, [HIVE_MIND]: 'sha256:hive' } });
  writeFormalAiSidecarState({ image: LATEST, imageDigest: UPDATE_DIGEST, leases: [], lastUsedAt: new Date(NOW - 10 * HOUR).toISOString() }, { env: measuredEnv });
  const measuredLogs = [];
  const unloaded = await unloadIdleFormalAiSidecar({ env: measuredEnv, run: measured.run, now: at(NOW), log: async line => measuredLogs.push(line) });
  assert.equal(unloaded.status, 'unloaded');
  assert.equal(unloaded.bytesFreedSource, 'measured');
  assert.equal(readFormalAiSidecarState({ env: measuredEnv }).lastUnload.bytesFreedSource, 'measured');
  assert.match(measuredLogs.join('\n'), /freeing 24\.00GB \(measured by `docker system df`\)/);

  const estimatedEnv = makeEnv();
  const simulator = createDockerSimulator({ images: { [LATEST]: UPDATE_DIGEST, [HIVE_MIND]: 'sha256:hive' } });
  const run = async (command, args, options) => {
    if (args[0] === 'system' && args[1] === 'df') throw new Error('docker system df: unsupported');
    return simulator.run(command, args, options);
  };
  writeFormalAiSidecarState({ image: LATEST, imageDigest: UPDATE_DIGEST, leases: [], lastUsedAt: new Date(NOW - 10 * HOUR).toISOString() }, { env: estimatedEnv });
  const estimatedLogs = [];
  const estimated = await unloadIdleFormalAiSidecar({ env: estimatedEnv, run, now: at(NOW), log: async line => estimatedLogs.push(line) });
  assert.equal(estimated.bytesFreedSource, 'estimated');
  assert.match(estimatedLogs.join('\n'), /freeing up to 24\.00GB \(estimated/);
});

test('a /health without a memory schema is logged as not reported, not unknown', async () => {
  const env = makeEnv();
  const docker = createDockerSimulator({ images: { [FULL]: 'sha256:full' }, health: { version: FORMAL_AI_BOOTSTRAP_VERSION, memory: { compatible: true } } });
  const logs = [];
  await acquireFormalAiSidecar({ sessionId: 'task-3208', env, run: docker.run, verbose: true, log: async line => logs.push(line), ...fast });
  await releaseFormalAiSidecar({ sessionId: 'task-3208', env, run: docker.run });
  const text = logs.join('\n');
  assert.doesNotMatch(text, /memory schema=unknown/);
  assert.match(text, /memory schema=not reported/);
});
