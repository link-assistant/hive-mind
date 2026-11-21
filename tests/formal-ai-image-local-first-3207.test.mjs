/**
 * @hive-mind-test-suite default
 * Issue #3207: a Formal AI task waited ten minutes on `docker pull
 * ghcr.io/link-assistant/formal-ai:<v>` although the local Hive Mind image
 * already bakes that very `formal-ai` release, then reported the killed pull as
 * "the pull failed (unknown)", and said nothing about the content an
 * interrupted pull can leave behind.
 *
 * Every Docker call is answered by an in-memory stub: nothing here touches a
 * real daemon or the network.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3207
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { FORMAL_AI_IMAGE_SOURCES, classifyDockerRegistryError, ensureFormalAiSidecarImage, readFormalAiImageCommand, resolveFormalAiSidecarImageCandidates } from '../src/formal-ai-image.lib.mjs';
import { buildFormalAiSidecarRunArgs, writeFormalAiSidecarState } from '../src/formal-ai-sidecar.lib.mjs';
import { updateFormalAiSidecarWhenIdle } from '../src/formal-ai-updater.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION } from '../src/formal-ai-version.lib.mjs';
import { createDockerSimulator } from './formal-ai-docker-simulator.mjs';

const REPOSITORY = 'ghcr.io/link-assistant/formal-ai';
const FULL = `${REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}`;
const SLIM = `${REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}-slim`;
const HIVE_MIND = 'konard/hive-mind-dind:2.35.9';
const ENV = { HIVE_MIND_IMAGE_VARIANT: 'dind', HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: '2.35.9' };

/** What `execFile` rejects with when its `timeout` kills `docker pull`. */
const killedPull = image => Object.assign(new Error(`Command failed: docker pull ${image}\n`), { killed: true, signal: 'SIGTERM', code: null, stdout: '', stderr: '' });

/**
 * A daemon stub: `local` maps a reference to its image ID, `versions` maps a
 * reference to what `formal-ai --version` prints inside it, `pulls` maps a
 * reference to the outcome of pulling it (an image ID, or an Error to throw).
 */
const stubDocker = ({ local = {}, versions = {}, pulls = {}, entrypoints = {} } = {}) => {
  const images = new Map(Object.entries(local));
  const calls = [];
  const run = async (command, args) => {
    assert.equal(command, 'docker', 'only docker is shelled out to');
    calls.push(args.join(' '));
    if (args[0] === 'image' && args[1] === 'inspect') {
      const reference = args[2];
      if (!images.has(reference)) throw Object.assign(new Error(`No such image: ${reference}`), { stderr: `Error: No such image: ${reference}` });
      const format = args[args.indexOf('--format') + 1];
      if (format.includes('Entrypoint')) return { stdout: `${JSON.stringify(entrypoints[reference] ?? ['/usr/local/bin/entrypoint.sh'])}\n` };
      return { stdout: `${images.get(reference)}\n` };
    }
    if (args[0] === 'run' && args.includes('--rm') && args.includes('--version')) {
      const reference = args[args.indexOf('--version') - 1];
      if (!images.has(reference)) throw new Error(`Unable to find image '${reference}' locally`);
      if (!versions[reference]) throw Object.assign(new Error('exec: "formal-ai": executable file not found'), { stderr: 'executable file not found' });
      return { stdout: `formal-ai ${versions[reference]}\n` };
    }
    if (args[0] === 'pull') {
      const reference = args[args.length - 1];
      const outcome = pulls[reference];
      if (outcome instanceof Error) throw outcome;
      if (!outcome) throw Object.assign(new Error(`Command failed: docker pull ${reference}`), { stderr: `Error response from daemon: manifest for ${reference} not found: manifest unknown` });
      images.set(reference, outcome);
      return { stdout: '' };
    }
    throw new Error(`unexpected docker ${args.join(' ')}`);
  };
  return { run, calls, pulls: () => calls.filter(call => call.startsWith('pull ')) };
};

test('cold-start candidates try the slim published image, then the full one, then the local Hive Mind image', () => {
  const candidates = resolveFormalAiSidecarImageCandidates(ENV);
  assert.deepEqual(
    candidates.map(candidate => [candidate.image, candidate.source, candidate.pullable]),
    [
      [SLIM, FORMAL_AI_IMAGE_SOURCES.PUBLISHED, true],
      [FULL, FORMAL_AI_IMAGE_SOURCES.PUBLISHED, true],
      [HIVE_MIND, FORMAL_AI_IMAGE_SOURCES.HIVE_MIND, false],
    ]
  );
});

test('a local Hive Mind image that bakes the required release is used without any pull', async () => {
  const docker = stubDocker({ local: { [HIVE_MIND]: 'sha256:hive' }, versions: { [HIVE_MIND]: FORMAL_AI_BOOTSTRAP_VERSION }, pulls: { [SLIM]: killedPull(SLIM), [FULL]: killedPull(FULL) } });
  const resolved = await ensureFormalAiSidecarImage({ env: ENV, run: docker.run });
  assert.equal(resolved.image, HIVE_MIND);
  assert.equal(resolved.source, FORMAL_AI_IMAGE_SOURCES.HIVE_MIND);
  assert.equal(resolved.pulled, false);
  assert.deepEqual(docker.pulls(), [], 'nothing is pulled while a local image qualifies');
});

test('an already-present published image still wins over probing the Hive Mind image', async () => {
  const docker = stubDocker({ local: { [FULL]: 'sha256:full', [HIVE_MIND]: 'sha256:hive' }, versions: { [HIVE_MIND]: FORMAL_AI_BOOTSTRAP_VERSION } });
  const resolved = await ensureFormalAiSidecarImage({ env: ENV, run: docker.run });
  assert.equal(resolved.image, FULL);
  assert.deepEqual(docker.pulls(), []);
});

test('a Hive Mind image with an older formal-ai is not preferred over pulling, and the slim tag is pulled first', async () => {
  const docker = stubDocker({ local: { [HIVE_MIND]: 'sha256:hive' }, versions: { [HIVE_MIND]: '0.340.0' }, pulls: { [SLIM]: 'sha256:slim' } });
  const resolved = await ensureFormalAiSidecarImage({ env: ENV, run: docker.run });
  assert.equal(resolved.image, SLIM);
  assert.equal(resolved.pulled, true);
  assert.deepEqual(docker.pulls(), [`pull ${SLIM}`]);
});

test('without a slim tag the full published image is pulled', async () => {
  const docker = stubDocker({ pulls: { [FULL]: 'sha256:full' } });
  const resolved = await ensureFormalAiSidecarImage({ env: ENV, run: docker.run });
  assert.equal(resolved.image, FULL);
  assert.deepEqual(docker.pulls(), [`pull ${SLIM}`, `pull ${FULL}`]);
});

test('a Hive Mind image whose version cannot be confirmed is still the last resort when nothing can be pulled', async () => {
  const docker = stubDocker({ local: { [HIVE_MIND]: 'sha256:hive' } });
  const logs = [];
  const resolved = await ensureFormalAiSidecarImage({ env: ENV, run: docker.run, log: async line => logs.push(line) });
  assert.equal(resolved.image, HIVE_MIND);
  assert.match(logs.join('\n'), /could not confirm/i);
});

test('a killed or timed-out docker pull is classified as a timeout, never as unknown', () => {
  const killed = classifyDockerRegistryError('Command failed: docker pull x', { error: killedPull('x'), timeoutMs: 600_000 });
  assert.equal(killed.kind, 'timeout');
  assert.match(killed.reason, /did not finish in 10 min/);

  const etimedout = classifyDockerRegistryError('spawn docker ETIMEDOUT', { error: Object.assign(new Error('spawn docker ETIMEDOUT'), { code: 'ETIMEDOUT' }), timeoutMs: 90_000 });
  assert.equal(etimedout.kind, 'timeout');

  // A plain message keeps its existing classification.
  assert.equal(classifyDockerRegistryError('error from registry: unauthorized').kind, 'unauthorized');
});

test('a sidecar pull that times out is reported as such and warns about containerd-leased content', async () => {
  const docker = stubDocker({ pulls: { [SLIM]: killedPull(SLIM), [FULL]: killedPull(FULL) } });
  const logs = [];
  const error = await ensureFormalAiSidecarImage({ env: ENV, run: docker.run, timeoutMs: 600_000, log: async line => logs.push(line) }).catch(caught => caught);
  assert.ok(error instanceof Error, 'nothing resolved, so the acquire fails closed');
  const pulled = error.formalAiImageAttempts.filter(attempt => attempt.source === FORMAL_AI_IMAGE_SOURCES.PUBLISHED);
  assert.deepEqual(
    pulled.map(attempt => attempt.kind),
    ['timeout', 'timeout']
  );
  assert.match(error.message, /did not finish in 10 min/);
  assert.doesNotMatch(error.message, /\(unknown\)|the pull failed/);
  assert.match(logs.join('\n'), /containerd lease/);
});

const stateDirs = [];
after(() => {
  for (const dir of stateDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('an update pull that times out is classified as a timeout and warns about leased content', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-3207-'));
  stateDirs.push(dir);
  const env = { HIVE_MIND_STATE_DIR: dir, HIVE_MIND_LOG_DIR: path.join(dir, 'logs'), HIVE_MIND_IMAGE_VARIANT: 'dind' };
  await writeFormalAiSidecarState({ lastUsedAt: new Date().toISOString() }, { env });
  const simulator = createDockerSimulator({ images: { [`${REPOSITORY}:latest`]: 'sha256:old' } });
  const run = async (command, args, options) => {
    if (args[0] === 'pull') throw killedPull(args[args.length - 1]);
    return simulator.run(command, args, options);
  };
  const logs = [];
  const result = await updateFormalAiSidecarWhenIdle({ env, run, pullTimeoutMs: 30 * 60 * 1000, log: async line => logs.push(line), healthAttempts: 1, healthDelayMs: 0, sleepImpl: async () => {} });
  assert.equal(result.status, 'failed');
  assert.equal(result.classification, 'timeout');
  const warning = logs.find(line => line.includes('Could not pull'));
  assert.match(warning, /did not finish in 30 min \(timeout\)/);
  assert.match(logs.join('\n'), /containerd lease/);
});

test('a slim image, whose entrypoint is formal-ai itself, is started without a second formal-ai argument', async () => {
  const docker = stubDocker({ local: { [SLIM]: 'sha256:slim', [FULL]: 'sha256:full' }, entrypoints: { [SLIM]: ['/usr/local/bin/formal-ai'] } });
  assert.deepEqual(await readFormalAiImageCommand(SLIM, { run: docker.run }), []);
  assert.deepEqual(await readFormalAiImageCommand(FULL, { run: docker.run }), ['formal-ai']);

  const slimArgs = buildFormalAiSidecarRunArgs({ image: SLIM, env: {}, command: [] });
  assert.deepEqual(slimArgs.slice(slimArgs.indexOf(SLIM)), [SLIM, 'serve', '--agent-mode', '--host', '0.0.0.0', '--port', '8080']);
  const fullArgs = buildFormalAiSidecarRunArgs({ image: FULL, env: {} });
  assert.deepEqual(fullArgs.slice(fullArgs.indexOf(FULL), fullArgs.indexOf(FULL) + 3), [FULL, 'formal-ai', 'serve']);
});
