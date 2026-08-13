#!/usr/bin/env node

/**
 * Regression coverage for the Formal AI launch failure reported in issue #2154.
 *
 * Three Telegram commands (`/codex`, `/claude`, `/agent`) sent with
 * `--model formal-ai` died identically:
 *
 * ```text
 * Formal AI sidecar could not be started, so the task was not launched (issue #2146):
 * Command failed: docker run --detach --name hive-mind-formal-ai … ghcr.io/link-assistant/formal-ai:0.339.1 …
 * Unable to find image 'ghcr.io/link-assistant/formal-ai:0.339.1' locally
 * docker: Error response from daemon: error from registry: unauthorized
 * ```
 *
 * The published GHCR package is private (packages pushed with `GITHUB_TOKEN`
 * are private by default) and Hive Mind never authenticates to a registry, so
 * the implicit pull behind `docker run` could not succeed on any host. The tests
 * below pin the three properties that turn that dead end into a working — and,
 * where it cannot work, an explainable — launch:
 *
 *  1. The sidecar falls back to the local Hive Mind image, which bakes
 *     `/usr/local/bin/formal-ai` at the same pinned version.
 *  2. When nothing resolves, the error names every candidate, the cause and the
 *     fix — instead of dumping the `docker run` argv.
 *  3. The task still fails closed (issue #2146): no silent switch to another
 *     model, and no sidecar older than the supported floor.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2154
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { classifyDockerRegistryError, ensureFormalAiSidecarImage, resolveFormalAiSidecarImageCandidates } from '../src/formal-ai-image.lib.mjs';
import { acquireFormalAiSidecarForTask } from '../src/formal-ai-isolation.lib.mjs';
import { FORMAL_AI_SIDECAR_CONTAINER_NAME, acquireFormalAiSidecar } from '../src/formal-ai-sidecar.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION, FORMAL_AI_MINIMUM_VERSION } from '../src/formal-ai-version.lib.mjs';
import { createDockerSimulator } from './formal-ai-docker-simulator.mjs';

const PUBLISHED_IMAGE = `ghcr.io/link-assistant/formal-ai:${FORMAL_AI_BOOTSTRAP_VERSION}`;
const HIVE_MIND_IMAGE = 'konard/hive-mind-dind:latest';
/** Verbatim from the issue: what the daemon says about a private GHCR package. */
const UNAUTHORIZED = 'docker: Error response from daemon: error from registry: unauthorized';

const stateDirs = [];
const makeEnv = (extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-image-'));
  stateDirs.push(dir);
  return { HIVE_MIND_STATE_DIR: dir, HIVE_MIND_IMAGE_VARIANT: 'dind', ...extra };
};

const fastSidecar = { healthAttempts: 2, healthDelayMs: 0, sleepImpl: async () => {} };

// ---------------------------------------------------------------------------
// Candidate order: published image first, local Hive Mind image as the fallback.
// ---------------------------------------------------------------------------

{
  const candidates = resolveFormalAiSidecarImageCandidates({ HIVE_MIND_IMAGE_VARIANT: 'dind' });
  assert.deepEqual(
    candidates.map(candidate => candidate.image),
    [PUBLISHED_IMAGE, HIVE_MIND_IMAGE]
  );
  assert.equal(candidates[0].pullable, true);
  // The fallback's whole value is that it is already on the host; pulling it
  // would mean pulling the *larger* of the two images.
  assert.equal(candidates[1].pullable, false, 'the Hive Mind image is used, never pulled');

  // An operator pin is exact: naming an image means that image, with no fallback.
  assert.deepEqual(resolveFormalAiSidecarImageCandidates({ HIVE_MIND_FORMAL_AI_IMAGE: 'local/formal-ai:dev' }), [{ image: 'local/formal-ai:dev', source: 'operator-pin', pullable: true }]);

  // A deployment may name its own fallback (e.g. an internal mirror).
  assert.equal(resolveFormalAiSidecarImageCandidates({ HIVE_MIND_FORMAL_AI_FALLBACK_IMAGE: 'mirror/hive-mind:2.12.2' })[1].image, 'mirror/hive-mind:2.12.2');
}

// ---------------------------------------------------------------------------
// Registry errors are diagnosed, not echoed.
// ---------------------------------------------------------------------------

{
  const unauthorized = classifyDockerRegistryError(UNAUTHORIZED);
  assert.equal(unauthorized.kind, 'unauthorized');
  assert.match(unauthorized.remediation.join(' '), /public/, 'the private-package fix is named');
  assert.match(unauthorized.remediation.join(' '), /read:packages/, 'the credential fix is named');

  // GHCR distinguishes "exists but private" (unauthorized) from "cannot see it" (denied).
  assert.equal(classifyDockerRegistryError('denied: permission_denied: read_package').kind, 'denied');
  assert.equal(classifyDockerRegistryError('manifest unknown').kind, 'not-found');
  assert.equal(classifyDockerRegistryError('failed to copy: write /var/lib/docker: no space left on device').kind, 'disk-full');
  assert.equal(classifyDockerRegistryError('dial tcp 140.82.121.33:443: i/o timeout').kind, 'network');
}

// ---------------------------------------------------------------------------
// The reported failure, reproduced: an unpullable published image.
// ---------------------------------------------------------------------------

{
  // Exactly the production host: the Hive Mind image is present (every isolated
  // task runs from it) and the published Formal AI image cannot be pulled.
  const docker = createDockerSimulator({ images: { [HIVE_MIND_IMAGE]: 'sha256:hive-mind' }, pullError: UNAUTHORIZED });
  const logs = [];
  const resolved = await ensureFormalAiSidecarImage({ env: { HIVE_MIND_IMAGE_VARIANT: 'dind' }, run: docker.run, log: async line => logs.push(line) });

  assert.equal(resolved.image, HIVE_MIND_IMAGE, 'the task runs on the image that is actually here');
  assert.equal(resolved.source, 'hive-mind-image');
  assert.equal(resolved.pulled, false);
  assert.equal(resolved.attempts[0].kind, 'unauthorized', 'the published image was tried first and diagnosed');
  assert.match(logs.join('\n'), /Could not pull ghcr\.io\/link-assistant\/formal-ai.*unauthorized/s, 'the registry refusal is logged rather than swallowed');
}

// ---------------------------------------------------------------------------
// End to end: the sidecar starts from the fallback and the task launches.
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  const docker = createDockerSimulator({ images: { [HIVE_MIND_IMAGE]: 'sha256:hive-mind' }, pullError: UNAUTHORIZED });
  const sidecar = await acquireFormalAiSidecar({ sessionId: 'task-2154', model: 'formal-ai', env, run: docker.run, ...fastSidecar });

  assert.equal(sidecar.image, HIVE_MIND_IMAGE);
  assert.equal(sidecar.imageSource, 'hive-mind-image');
  assert.equal(sidecar.leaseCount, 1);
  assert.equal(docker.containers.get(FORMAL_AI_SIDECAR_CONTAINER_NAME).running, true, 'the sidecar that failed to start in production now starts');
  assert.equal(sidecar.baseUrl.startsWith('http://172.28.0.'), true);

  // The fallback changes which image serves Formal AI, never how it is reached:
  // still the internal network, still no published port.
  const runCall = docker.calls.find(call => call.startsWith('run --detach'));
  assert.equal(runCall.includes(HIVE_MIND_IMAGE), true);
  assert.equal(/ -p | --publish /.test(runCall), false);
}

// ---------------------------------------------------------------------------
// Nothing usable: fail closed, but say why and how to fix it.
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  // A host with neither image — e.g. a fresh Compose deployment.
  const docker = createDockerSimulator({ images: {}, pullError: UNAUTHORIZED });
  const error = await acquireFormalAiSidecar({ sessionId: 'task-none', model: 'formal-ai', env, run: docker.run, ...fastSidecar }).then(
    () => null,
    caught => caught
  );

  assert.notEqual(error, null, 'a sidecar cannot be conjured from nothing');
  assert.match(error.message, /No Formal AI image could be resolved/);
  assert.match(error.message, /ghcr\.io\/link-assistant\/formal-ai/, 'the published candidate is named');
  assert.match(error.message, /konard\/hive-mind-dind:latest/, 'the fallback candidate is named');
  assert.match(error.message, /make the package public/, 'the operator is told what to do');
  assert.match(error.message, /fail closed/i, 'and told that the task was refused rather than downgraded');
  // The raw `docker run` argv from the issue must not be what the operator sees.
  assert.equal(/Command failed: docker run/.test(error.message), false);
  assert.equal(docker.containers.has(FORMAL_AI_SIDECAR_CONTAINER_NAME), false);

  // Issue #2146's rule survives the new fallback path: the task is refused.
  const refused = await acquireFormalAiSidecarForTask({
    backend: 'docker',
    model: 'formal-ai',
    sessionId: 'task-none',
    env,
    acquire: async () => {
      throw error;
    },
  });
  assert.equal(refused.sidecar, null);
  assert.match(refused.error, /No Formal AI image could be resolved/);
  assert.match(refused.error, /make the package public/, 'the remediation reaches the Telegram reply');
}

// ---------------------------------------------------------------------------
// An operator pin is honoured exactly, and never silently replaced.
// ---------------------------------------------------------------------------

{
  const env = makeEnv({ HIVE_MIND_FORMAL_AI_IMAGE: 'registry.internal/formal-ai:0.339.1' });
  const docker = createDockerSimulator({ images: { [HIVE_MIND_IMAGE]: 'sha256:hive-mind' }, pull: { 'registry.internal/formal-ai:0.339.1': 'sha256:pinned' } });
  const sidecar = await acquireFormalAiSidecar({ sessionId: 'task-pinned', model: 'formal-ai', env, run: docker.run, ...fastSidecar });
  assert.equal(sidecar.image, 'registry.internal/formal-ai:0.339.1');
  assert.equal(sidecar.imageSource, 'operator-pin');

  const failing = makeEnv({ HIVE_MIND_FORMAL_AI_IMAGE: 'registry.internal/formal-ai:0.339.1' });
  const brokenDocker = createDockerSimulator({ images: { [HIVE_MIND_IMAGE]: 'sha256:hive-mind' }, pullError: UNAUTHORIZED });
  const pinFailure = await acquireFormalAiSidecar({ sessionId: 'task-pinned', model: 'formal-ai', env: failing, run: brokenDocker.run, ...fastSidecar }).then(
    () => null,
    caught => caught
  );
  assert.notEqual(pinFailure, null, 'a pinned image that cannot be pulled is an error, not a reason to pick another image');
  assert.equal(pinFailure.message.includes(HIVE_MIND_IMAGE), false, 'the fallback is not smuggled in behind the pin');
}

// ---------------------------------------------------------------------------
// The version floor is enforced against the running process, not the tag.
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  // A stale Hive Mind image on the host would otherwise serve an unsupported
  // formal-ai over a healthy-looking /health.
  const docker = createDockerSimulator({
    images: { [HIVE_MIND_IMAGE]: 'sha256:stale' },
    pullError: UNAUTHORIZED,
    health: { version: '0.300.0', memory: { compatible: true, schema_version: 2 } },
  });
  const error = await acquireFormalAiSidecar({ sessionId: 'task-stale', model: 'formal-ai', env, run: docker.run, ...fastSidecar }).then(
    () => null,
    caught => caught
  );
  assert.notEqual(error, null);
  assert.match(error.message, new RegExp(`runs formal-ai 0\\.300\\.0.*requires >= ${FORMAL_AI_MINIMUM_VERSION.replaceAll('.', '\\.')}`, 's'));
}

for (const dir of stateDirs) fs.rmSync(dir, { recursive: true, force: true });

console.log('PASS: issue #2154 Formal AI image resolution (local fallback, diagnosed registry failures, fail-closed launch, enforced version floor)');
