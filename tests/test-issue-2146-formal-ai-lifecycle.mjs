#!/usr/bin/env node

/**
 * Regression coverage for the on-demand Formal AI sidecar (issue #2146, PR
 * #2147 review).
 *
 * The review asked for a container that exists only while Formal AI tasks run,
 * reachable from those tasks over an internal Docker network and nowhere else,
 * with memory that survives every stop. Each of those properties is checked
 * here against an in-memory Docker daemon, because a broken lifecycle is
 * otherwise only visible in production: the failure mode is a Formal AI task
 * that starts, cannot reach its model, and — which issue #2146 forbids —
 * continues on a different one.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { acquireFormalAiSidecarForTask, attachFormalAiTaskContainer, releaseFormalAiSidecarForTask } from '../src/formal-ai-isolation.lib.mjs';
import { FORMAL_AI_MEMORY_MOUNT, FORMAL_AI_MEMORY_VOLUME_NAME, FORMAL_AI_SIDECAR_CONTAINER_NAME, FORMAL_AI_SIDECAR_NETWORK_ALIAS, FORMAL_AI_SIDECAR_NETWORK_NAME, acquireFormalAiSidecar, attachTaskToFormalAiNetwork, buildFormalAiSidecarRunArgs, isFormalAiSidecarEnabled, isFormalAiTask, readFormalAiSidecarState, reconcileFormalAiSidecar, releaseFormalAiSidecar, writeFormalAiSidecarState } from '../src/formal-ai-sidecar.lib.mjs';
import { createDockerSimulator } from './formal-ai-docker-simulator.mjs';

const SIDECAR_IMAGE = 'ghcr.io/link-assistant/formal-ai:0.339.1';
const stateDirs = [];

const makeEnv = (extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-lifecycle-'));
  stateDirs.push(dir);
  return { HIVE_MIND_STATE_DIR: dir, ...extra };
};

const fastSidecar = { healthAttempts: 2, healthDelayMs: 0, sleepImpl: async () => {} };

// ---------------------------------------------------------------------------
// The `docker run` contract the review specified.
// ---------------------------------------------------------------------------

const runArgs = buildFormalAiSidecarRunArgs({ image: SIDECAR_IMAGE, env: {} });
assert.equal(runArgs.join(' ').includes(`--network ${FORMAL_AI_SIDECAR_NETWORK_NAME}`), true, 'the sidecar joins the internal network');
assert.equal(runArgs.join(' ').includes(`--network-alias ${FORMAL_AI_SIDECAR_NETWORK_ALIAS}`), true);
assert.equal(runArgs.join(' ').includes(`--volume ${FORMAL_AI_MEMORY_VOLUME_NAME}:${FORMAL_AI_MEMORY_MOUNT}`), true, 'memory lives on a named volume');
// "internal docker network only": nothing is published to the host.
assert.equal(
  runArgs.some(arg => arg === '-p' || arg === '--publish'),
  false
);
// The image only serves HTTP here, so it needs no inner Docker daemon and no privileges.
assert.equal(runArgs.includes('DIND_SKIP_DAEMON=1'), true);
assert.equal(runArgs.includes('--privileged'), false);
assert.equal(buildFormalAiSidecarRunArgs({ image: SIDECAR_IMAGE, env: { HIVE_MIND_FORMAL_AI_PRIVILEGED: '1' } }).includes('--privileged'), true, 'privileged stays an explicit opt-in');

assert.equal(isFormalAiTask({ args: ['--model', 'formalai/formal-ai'] }), true);
assert.equal(isFormalAiTask({ model: 'formal-ai' }), true);
assert.equal(isFormalAiTask({ args: ['--model', 'sonnet'] }), false);
assert.equal(isFormalAiSidecarEnabled({}), true);
assert.equal(isFormalAiSidecarEnabled({ HIVE_MIND_FORMAL_AI_SIDECAR: '0' }), false, 'Compose deployments opt out');

// ---------------------------------------------------------------------------
// Lease counting: one sidecar, N tasks, stopped only after the last one.
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  const docker = createDockerSimulator({ images: { [SIDECAR_IMAGE]: 'sha256:sidecar' } });
  const options = { env, run: docker.run, ...fastSidecar };

  const first = await acquireFormalAiSidecar({ sessionId: 'task-a', model: 'formal-ai', ...options });
  assert.equal(first.leaseCount, 1);
  assert.equal(docker.networks.get(FORMAL_AI_SIDECAR_NETWORK_NAME).internal, true, 'the network carries no egress');
  assert.equal(docker.volumes.has(FORMAL_AI_MEMORY_VOLUME_NAME), true);
  // Tasks are attached after creation, so the endpoint is the address rather
  // than a DNS alias that may not be wired up yet.
  assert.equal(first.baseUrl, 'http://172.28.0.2:8080');
  assert.equal(first.dnsBaseUrl, `http://${FORMAL_AI_SIDECAR_NETWORK_ALIAS}:8080`);
  assert.equal(first.health.version, '0.339.1');

  docker.createContainer('task-a');
  assert.deepEqual(await attachTaskToFormalAiNetwork({ sessionId: 'task-a', run: docker.run }), { attached: true, error: null });
  // Docker reports a re-attach as an error; the lifecycle must read it as success.
  assert.deepEqual(await attachTaskToFormalAiNetwork({ sessionId: 'task-a', run: docker.run }), { attached: true, error: null });
  assert.equal(docker.containers.get('task-a').networks.has(FORMAL_AI_SIDECAR_NETWORK_NAME), true);

  docker.createContainer('task-b');
  const second = await acquireFormalAiSidecar({ sessionId: 'task-b', model: 'formal-ai', ...options });
  assert.equal(second.leaseCount, 2, 'a second Formal AI task shares the running sidecar');
  assert.equal(docker.calls.filter(call => call.startsWith('run --detach')).length, 1, 'the sidecar is started once');

  docker.containers.delete('task-a');
  const afterFirst = await releaseFormalAiSidecar({ sessionId: 'task-a', ...options });
  assert.deepEqual(afterFirst, { leaseCount: 1, stopped: false }, 'a still-running task keeps the sidecar up');
  assert.equal(docker.containers.get(FORMAL_AI_SIDECAR_CONTAINER_NAME).running, true);

  docker.containers.delete('task-b');
  const afterSecond = await releaseFormalAiSidecar({ sessionId: 'task-b', ...options });
  assert.deepEqual(afterSecond, { leaseCount: 0, stopped: true }, 'the last release stops the sidecar');
  assert.equal(docker.containers.has(FORMAL_AI_SIDECAR_CONTAINER_NAME), false);
  assert.equal(docker.networks.has(FORMAL_AI_SIDECAR_NETWORK_NAME), false, 'the internal network goes away with it');
  // "Memory for formal-ai should be preserved between tasks and between restarts."
  assert.equal(docker.volumes.has(FORMAL_AI_MEMORY_VOLUME_NAME), true);
  assert.equal(docker.ran(/^volume rm/), false, 'the memory volume is never removed');
  assert.deepEqual(readFormalAiSidecarState({ env }).leases, []);
}

// ---------------------------------------------------------------------------
// A crashed task must not pin the sidecar; a starting one must not lose it.
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  const docker = createDockerSimulator({ images: { [SIDECAR_IMAGE]: 'sha256:sidecar' } });
  const base = readFormalAiSidecarState({ env });

  // Taken seconds ago, container not created yet: this is the launch window
  // between acquiring the lease and start-command creating the container.
  writeFormalAiSidecarState({ ...base, leases: [{ sessionId: 'starting', acquiredAt: new Date().toISOString() }] }, { env });
  assert.equal((await reconcileFormalAiSidecar({ env, run: docker.run })).leaseCount, 1, 'a launching task keeps its lease');

  // Same lease an hour later, still no container: the launch failed.
  writeFormalAiSidecarState({ ...base, leases: [{ sessionId: 'starting', acquiredAt: new Date(Date.now() - 61 * 60 * 1000).toISOString() }] }, { env });
  assert.equal((await reconcileFormalAiSidecar({ env, run: docker.run })).leaseCount, 0, 'the launch grace window is bounded');

  // A container that was once seen and is now gone is stale immediately.
  writeFormalAiSidecarState({ ...base, leases: [{ sessionId: 'crashed', acquiredAt: new Date().toISOString(), containerSeen: true }] }, { env });
  assert.equal((await reconcileFormalAiSidecar({ env, run: docker.run })).leaseCount, 0, 'a crashed task releases the sidecar');

  // A running container is marked as seen, so it stops relying on the grace window.
  docker.createContainer('running-task');
  writeFormalAiSidecarState({ ...base, leases: [{ sessionId: 'running-task', acquiredAt: new Date(Date.now() - 61 * 60 * 1000).toISOString() }] }, { env });
  const reconciled = await reconcileFormalAiSidecar({ env, run: docker.run });
  assert.equal(reconciled.leaseCount, 1);
  assert.equal(reconciled.state.leases[0].containerSeen, true);
}

// ---------------------------------------------------------------------------
// Launch policy: Formal AI failures stop the task instead of changing model.
// ---------------------------------------------------------------------------

{
  let acquireCalls = 0;
  const acquire = async () => {
    acquireCalls += 1;
    return { baseUrl: 'http://172.28.0.2:8080' };
  };

  assert.deepEqual(await acquireFormalAiSidecarForTask({ backend: 'docker', model: 'sonnet', sessionId: 's', env: {}, acquire }), { sidecar: null, error: null });
  assert.deepEqual(await acquireFormalAiSidecarForTask({ backend: 'none', model: 'formal-ai', sessionId: 's', env: {}, acquire }), { sidecar: null, error: null }, 'only Docker tasks can be attached to a network');
  assert.deepEqual(await acquireFormalAiSidecarForTask({ backend: 'docker', model: 'formal-ai', sessionId: 's', env: { HIVE_MIND_FORMAL_AI_SIDECAR: '0' }, acquire }), { sidecar: null, error: null });
  assert.equal(acquireCalls, 0, 'nothing is started for a task that is not driven by Formal AI');

  const taken = await acquireFormalAiSidecarForTask({ backend: 'docker', args: ['--model', 'formalai/formal-ai'], sessionId: 's', env: {}, acquire });
  assert.equal(taken.sidecar.baseUrl, 'http://172.28.0.2:8080');
  assert.equal(acquireCalls, 1);

  const refused = await acquireFormalAiSidecarForTask({
    backend: 'docker',
    model: 'formal-ai',
    sessionId: 's',
    env: {},
    acquire: async () => {
      throw new Error('did not become healthy');
    },
  });
  assert.equal(refused.sidecar, null);
  assert.match(refused.error, /sidecar could not be started.*did not become healthy/i);

  assert.equal(await attachFormalAiTaskContainer({ sidecar: null, sessionId: 's' }), null, 'non-Formal-AI tasks are untouched');
  assert.equal(await attachFormalAiTaskContainer({ sidecar: {}, sessionId: 's', attach: async () => ({ attached: true, error: null }) }), null);
  assert.equal(await attachFormalAiTaskContainer({ sidecar: {}, sessionId: 's', attach: async () => ({ attached: false, error: 'no such network' }) }), 'no such network');

  // A failed release must not mask the launch error that caused it.
  assert.equal(
    await releaseFormalAiSidecarForTask({
      sidecar: {},
      sessionId: 's',
      release: async () => {
        throw new Error('docker daemon gone');
      },
    }),
    null
  );
}

for (const dir of stateDirs) fs.rmSync(dir, { recursive: true, force: true });

console.log('PASS: issue #2146 Formal AI sidecar lifecycle (internal network, lease counting, preserved memory, fail-closed launch)');
