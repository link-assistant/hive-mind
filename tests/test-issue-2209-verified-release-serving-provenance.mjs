#!/usr/bin/env node

/**
 * The interaction issue #2209 asked for: a verified Formal AI release must both
 * survive into the next task (#2207) and be the release that task's provenance
 * names (#2208).
 *
 * Neither half is sufficient alone. With only #2207 fixed, the accepted image
 * boots and the task still records the local wrapper's version. With only #2208
 * fixed, the task honestly records that it is being served by the *old*
 * bootstrap release. This file therefore drives the whole chain — update →
 * stopped sidecar → acquire → probe the endpoint the lease points at → release →
 * acquire, across a process restart — and asserts the identity is the same
 * accepted, immutable digest at every step.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2209
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { FORMAL_AI_IMAGE_REPOSITORY, FORMAL_AI_IMAGE_SOURCES } from '../src/formal-ai-image.lib.mjs';
import { buildFormalAiTaskEnv } from '../src/formal-ai-isolation.lib.mjs';
import { prepareFormalAiRuntime, resetFormalAiRuntimeCache } from '../src/formal-ai-runtime.lib.mjs';
import { acquireFormalAiSidecar, readFormalAiSidecarState, releaseFormalAiSidecar, writeFormalAiSidecarState } from '../src/formal-ai-sidecar.lib.mjs';
import { updateFormalAiSidecarWhenIdle } from '../src/formal-ai-updater.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION, FORMAL_AI_MINIMUM_VERSION } from '../src/formal-ai-version.lib.mjs';
import { createDockerSimulator } from './formal-ai-docker-simulator.mjs';

const BOOTSTRAP_IMAGE = `${FORMAL_AI_IMAGE_REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}`;
const UPDATE_IMAGE = `${FORMAL_AI_IMAGE_REPOSITORY}:latest`;
const BOOTSTRAP_DIGEST = 'sha256:bootstrap';
const ACCEPTED_DIGEST = 'sha256:accepted';
const ACCEPTED_VERSION = '0.346.0';
const MEMORY = { compatible: true, schema_version: 3, migration_required: false, migration_state: 'current' };
const fast = { healthAttempts: 1, healthDelayMs: 0, sleepImpl: async () => {} };

const makeDocker = (images = {}) =>
  createDockerSimulator({
    images: { [BOOTSTRAP_IMAGE]: BOOTSTRAP_DIGEST, ...images },
    pull: { [UPDATE_IMAGE]: ACCEPTED_DIGEST },
    health: (reference, digest) => ({ version: digest === ACCEPTED_DIGEST ? ACCEPTED_VERSION : FORMAL_AI_BOOTSTRAP_VERSION, memory: digest === ACCEPTED_DIGEST ? MEMORY : { ...MEMORY, schema_version: 2 } }),
    memory: { 'upgrade-status': { compatible: true, path_exists: true, migration_required: false, migration_state: 'current', detected_schema_version: 2 } },
  });

/**
 * The container the lease points at, answering `/health` the way the running
 * sidecar does. `served` is what the process behind the endpoint reports, which
 * is the whole point of issue #2208: it is observed, never assumed.
 */
const withServingContainer = async (served, body) => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(served()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await body(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
};

/** What a task launched with this lease would record about its model. */
const provenanceOfTask = async ({ sidecar, baseUrl, hostEnv, workdir }) => {
  const taskEnv = buildFormalAiTaskEnv({ sidecar, env: hostEnv });
  resetFormalAiRuntimeCache();
  const runtime = await prepareFormalAiRuntime({
    tool: 'agent',
    workdir,
    // The isolated task reaches the sidecar over the internal network; here the
    // address is the local one the fake container listens on.
    env: { ...taskEnv, HIVE_MIND_FORMAL_AI_BASE_URL: baseUrl, HIVE_MIND_FORMAL_AI_HOME_ROOT: workdir },
    deps: {
      // Deliberately old: the wrapper next to Hive Mind is not what serves the task.
      readVersionImpl: async () => FORMAL_AI_MINIMUM_VERSION,
      mkdtempImpl: async () => workdir,
      loadRegistryImpl: async () => [{ id: 'agent', global_configs: [] }],
      seedImpl: async () => [],
      configureImpl: async () => {},
    },
  });
  try {
    return { formalAiVersion: runtime.formalAiVersion, formalAiWrapperVersion: runtime.formalAiWrapperVersion, backend: runtime.backend };
  } finally {
    await runtime.stop();
    resetFormalAiRuntimeCache();
  }
};

test('an accepted update is the backend that serves, and is named by, every later task', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-2209-'));
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-2209-task-'));
  const env = { HIVE_MIND_STATE_DIR: stateDir };
  try {
    const docker = makeDocker();
    const options = { env, run: docker.run, ...fast };
    writeFormalAiSidecarState({ image: BOOTSTRAP_IMAGE, imageDigest: BOOTSTRAP_DIGEST, leases: [] }, { env });

    // 1. The idle updater accepts a new release: pulled, preflighted, migrated,
    //    booted, verified — and then stopped again.
    const update = await updateFormalAiSidecarWhenIdle(options);
    assert.equal(update.status, 'updated');
    assert.equal(update.digest, ACCEPTED_DIGEST);
    assert.equal(docker.containers.has('hive-mind-formal-ai'), false, 'the sidecar is left stopped for the next task to start');

    // 2. The next cold task starts the sidecar from the accepted image…
    const first = await acquireFormalAiSidecar({ sessionId: 'task-a', ...options });
    assert.equal(first.imageDigest, update.digest);
    assert.equal(first.imageSource, FORMAL_AI_IMAGE_SOURCES.ACCEPTED);

    // 3. …and what it records is what the endpoint says, not what the local
    //    wrapper says.
    const firstProvenance = await withServingContainer(
      () => ({ version: update.health.version, memory: MEMORY }),
      baseUrl => provenanceOfTask({ sidecar: first, baseUrl, hostEnv: env, workdir })
    );
    assert.equal(firstProvenance.formalAiVersion, update.health.version, 'the task is served by the accepted release');
    assert.equal(firstProvenance.formalAiWrapperVersion, FORMAL_AI_MINIMUM_VERSION, 'the local wrapper is recorded separately');
    assert.notEqual(firstProvenance.formalAiVersion, firstProvenance.formalAiWrapperVersion);
    assert.equal(firstProvenance.backend.imageDigest, update.digest, 'the evidence names the immutable image, not a moving tag');
    assert.equal(firstProvenance.backend.managed, true);

    await releaseFormalAiSidecar({ sessionId: 'task-a', ...options });

    // 4. A later task, in a *new* Hive Mind process with only the state file and
    //    the host's images to go on, reaches the same conclusion.
    const restarted = makeDocker({ [UPDATE_IMAGE]: ACCEPTED_DIGEST });
    const second = await acquireFormalAiSidecar({ sessionId: 'task-b', env, run: restarted.run, ...fast });
    assert.equal(second.imageDigest, update.digest);
    assert.equal(second.servingVersion, update.health.version);
    const secondProvenance = await withServingContainer(
      () => ({ version: update.health.version, memory: MEMORY }),
      baseUrl => provenanceOfTask({ sidecar: second, baseUrl, hostEnv: env, workdir })
    );
    assert.equal(secondProvenance.backend.imageDigest, update.digest);
    assert.equal(secondProvenance.formalAiVersion, update.health.version);
    await releaseFormalAiSidecar({ sessionId: 'task-b', env, run: restarted.run, ...fast });

    assert.equal(readFormalAiSidecarState({ env }).lastUpdate.digest, update.digest, 'the acceptance record survives the whole cycle');
    assert.equal(readFormalAiSidecarState({ env }).serving.version, update.health.version, 'and the state names the release that last served a lease');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('a sidecar that regressed to the pre-update release is refused, not recorded', async () => {
  // This is the original defect made visible: the lease says the accepted
  // release, the endpoint answers with the bootstrap one. Before issue #2208 the
  // task ran anyway and reported the local wrapper's version.
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-2209-task-'));
  try {
    const sidecar = { baseUrl: 'http://172.28.0.2:41235', imageReference: UPDATE_IMAGE, image: ACCEPTED_DIGEST, imageDigest: ACCEPTED_DIGEST, imageSource: FORMAL_AI_IMAGE_SOURCES.ACCEPTED, servingVersion: ACCEPTED_VERSION };
    await withServingContainer(
      () => ({ version: FORMAL_AI_BOOTSTRAP_VERSION, memory: { ...MEMORY, schema_version: 2 } }),
      async baseUrl => {
        await assert.rejects(provenanceOfTask({ sidecar, baseUrl, hostEnv: {}, workdir }), new RegExp(`serves Formal AI ${FORMAL_AI_BOOTSTRAP_VERSION.replace(/\./g, '\\.')}, but the leased Hive Mind sidecar image was verified as ${ACCEPTED_VERSION.replace(/\./g, '\\.')}`));
      }
    );
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});
