#!/usr/bin/env node

/**
 * Regression coverage for issue #2207 — a verified Formal AI update must
 * survive into the next task.
 *
 * `updateFormalAiSidecarWhenIdle` pulls a candidate image, runs the
 * persisted-memory preflight, migrates with a backup, boots the image and only
 * then records the acceptance. All of that work was thrown away by the very
 * next cold task: `acquireFormalAiSidecar` rebuilt its candidate list from
 * `FORMAL_AI_BOOTSTRAP_VERSION` and never consulted the accepted image, so the
 * sidecar came back on the old release — against memory the accepted release
 * had already migrated — and then overwrote the state with the old digest.
 *
 * These tests therefore assert on *state*, never on a release number: the
 * accepted identity is read back from the update result, so a bootstrap bump
 * cannot make them pass for the wrong reason.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2207
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FORMAL_AI_IMAGE_REPOSITORY, FORMAL_AI_IMAGE_SOURCES, readAcceptedFormalAiImage, resolveFormalAiSidecarImageCandidates } from '../src/formal-ai-image.lib.mjs';
import { acquireFormalAiSidecar, readFormalAiSidecarState, releaseFormalAiSidecar, writeFormalAiSidecarState } from '../src/formal-ai-sidecar.lib.mjs';
import { updateFormalAiSidecarWhenIdle } from '../src/formal-ai-updater.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION } from '../src/formal-ai-version.lib.mjs';
import { createDockerSimulator } from './formal-ai-docker-simulator.mjs';

const BOOTSTRAP_IMAGE = `${FORMAL_AI_IMAGE_REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}`;
const UPDATE_IMAGE = `${FORMAL_AI_IMAGE_REPOSITORY}:latest`;
const BOOTSTRAP_DIGEST = 'sha256:bootstrap';
const ACCEPTED_DIGEST = 'sha256:accepted';
/** The release the accepted image reports; deliberately *not* the bootstrap one. */
const ACCEPTED_VERSION = '0.346.0';
const MEMORY = { compatible: true, schema_version: 2, migration_required: false, migration_state: 'current' };

const stateDirs = [];
const makeEnv = (extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-2207-'));
  stateDirs.push(dir);
  return { HIVE_MIND_STATE_DIR: dir, ...extra };
};

/**
 * A daemon that already has the bootstrap image and can pull the update.
 *
 * @param {object} [options.images] - Extra local images, merged over the bootstrap one.
 */
const makeDocker = ({ images = {}, pull = { [UPDATE_IMAGE]: ACCEPTED_DIGEST }, health = null } = {}) =>
  createDockerSimulator({
    images: { [BOOTSTRAP_IMAGE]: BOOTSTRAP_DIGEST, ...images },
    pull,
    health: health || ((reference, digest) => ({ version: digest === ACCEPTED_DIGEST ? ACCEPTED_VERSION : FORMAL_AI_BOOTSTRAP_VERSION, memory: MEMORY })),
    memory: { 'upgrade-status': { ...MEMORY, path_exists: false } },
  });

const fast = { healthAttempts: 1, healthDelayMs: 0, sleepImpl: async () => {} };

// ---------------------------------------------------------------------------
// Candidate selection: the accepted image outranks the bootstrap pin, and the
// operator pin outranks both.
// ---------------------------------------------------------------------------

assert.equal(readAcceptedFormalAiImage({}), null, 'a state without an accepted update has no accepted image');
assert.equal(readAcceptedFormalAiImage({ lastUpdate: { image: '', digest: '' } }), null);

const acceptedCandidates = resolveFormalAiSidecarImageCandidates({}, { accepted: { image: UPDATE_IMAGE, digest: ACCEPTED_DIGEST } });
assert.equal(acceptedCandidates[0].image, ACCEPTED_DIGEST, 'the immutable digest is tried first, so a moved tag cannot divert the boot');
assert.equal(acceptedCandidates[0].source, FORMAL_AI_IMAGE_SOURCES.ACCEPTED);
assert.equal(acceptedCandidates[1].expectDigest, ACCEPTED_DIGEST, 'the tag is only a way to fetch the accepted digest, and is verified against it');
assert.equal(
  acceptedCandidates.some(candidate => candidate.image === BOOTSTRAP_IMAGE),
  false,
  'an accepted update is exclusive: falling back to the older release would run it against migrated memory'
);

const pinnedCandidates = resolveFormalAiSidecarImageCandidates({ HIVE_MIND_FORMAL_AI_IMAGE: 'registry.example/formal-ai:pinned' }, { accepted: { image: UPDATE_IMAGE, digest: ACCEPTED_DIGEST } });
assert.deepEqual(
  pinnedCandidates.map(candidate => candidate.image),
  ['registry.example/formal-ai:pinned'],
  'an explicit operator pin stays authoritative over an accepted update'
);

assert.equal(resolveFormalAiSidecarImageCandidates({}, { accepted: null })[0].image, BOOTSTRAP_IMAGE, 'without an accepted update the bootstrap pin is still the starting point');

// ---------------------------------------------------------------------------
// update → stopped sidecar → acquire → release → acquire
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  const docker = makeDocker();
  const options = { env, run: docker.run, ...fast };
  writeFormalAiSidecarState({ image: BOOTSTRAP_IMAGE, imageDigest: BOOTSTRAP_DIGEST, leases: [] }, { env });

  const update = await updateFormalAiSidecarWhenIdle(options);
  assert.equal(update.status, 'updated');
  assert.equal(docker.containers.has('hive-mind-formal-ai'), false, 'the updater leaves the sidecar stopped');

  const first = await acquireFormalAiSidecar({ sessionId: 'task-1', ...options });
  assert.equal(first.imageDigest, update.digest, 'the first cold task after an update must run the accepted image');
  assert.equal(first.servingVersion, update.health.version, 'and must therefore serve the accepted release');
  assert.equal(first.imageSource, FORMAL_AI_IMAGE_SOURCES.ACCEPTED);
  assert.equal(first.acceptedDigest, update.digest);

  await releaseFormalAiSidecar({ sessionId: 'task-1', ...options });
  const afterRelease = readFormalAiSidecarState({ env });
  assert.equal(afterRelease.lastUpdate.digest, update.digest, 'releasing a lease must not erase the acceptance record');
  assert.equal(afterRelease.imageDigest, update.digest, 'and must not restore the pre-update digest');

  const second = await acquireFormalAiSidecar({ sessionId: 'task-2', ...options });
  assert.equal(second.imageDigest, update.digest, 'every later task consumes the same accepted image');
  assert.notEqual(second.imageDigest, BOOTSTRAP_DIGEST);
  await releaseFormalAiSidecar({ sessionId: 'task-2', ...options });

  // A restart: nothing survives in memory, only the state file on disk and the
  // images on the host. This is the shape of the original report — the update
  // ran in one bot process and the task was launched by another.
  const restarted = makeDocker({ images: { [UPDATE_IMAGE]: ACCEPTED_DIGEST } });
  const third = await acquireFormalAiSidecar({ sessionId: 'task-3', env, run: restarted.run, ...fast });
  assert.equal(third.imageDigest, update.digest, 'a fresh process must read the acceptance from persisted state');
  assert.equal(
    restarted.calls.some(call => call.startsWith(`run `) && call.includes(BOOTSTRAP_IMAGE)),
    false,
    'the bootstrap release must never be started once an update has been accepted'
  );
}

// ---------------------------------------------------------------------------
// A moved tag cannot bypass the memory verification the acceptance recorded.
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  const docker = makeDocker();
  const options = { env, run: docker.run, ...fast };
  writeFormalAiSidecarState({ image: BOOTSTRAP_IMAGE, imageDigest: BOOTSTRAP_DIGEST, leases: [] }, { env });
  const update = await updateFormalAiSidecarWhenIdle(options);

  // Upstream publishes a newer build under the same tag; it has *not* been
  // through this host's preflight, migration and verification.
  docker.retag(UPDATE_IMAGE, 'sha256:unverified');
  const task = await acquireFormalAiSidecar({ sessionId: 'moved-tag', ...options });
  assert.equal(task.imageDigest, update.digest, 'selection follows the accepted digest, not whatever the tag points at now');
  assert.notEqual(task.imageDigest, 'sha256:unverified');
  await releaseFormalAiSidecar({ sessionId: 'moved-tag', ...options });
}

// ---------------------------------------------------------------------------
// A rolled-back update is not an acceptance.
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  // The candidate answers /health with nothing at all, so the post-migration
  // verification fails and the updater rolls back.
  const docker = makeDocker({ health: (reference, digest) => (digest === ACCEPTED_DIGEST ? null : { version: FORMAL_AI_BOOTSTRAP_VERSION, memory: MEMORY }) });
  const options = { env, run: docker.run, ...fast };
  writeFormalAiSidecarState({ image: BOOTSTRAP_IMAGE, imageDigest: BOOTSTRAP_DIGEST, leases: [] }, { env });

  const update = await updateFormalAiSidecarWhenIdle(options);
  assert.equal(update.status, 'rolled-back');
  assert.equal(readFormalAiSidecarState({ env }).lastUpdate, null, 'a rollback records no acceptance');

  const task = await acquireFormalAiSidecar({ sessionId: 'after-rollback', ...options });
  assert.equal(task.imageDigest, BOOTSTRAP_DIGEST, 'a rejected candidate must not be promoted to the next task');
  await releaseFormalAiSidecar({ sessionId: 'after-rollback', ...options });
}

// ---------------------------------------------------------------------------
// An accepted image that is no longer on the host fails closed.
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  const docker = makeDocker();
  const options = { env, run: docker.run, ...fast };
  writeFormalAiSidecarState({ image: BOOTSTRAP_IMAGE, imageDigest: BOOTSTRAP_DIGEST, leases: [] }, { env });
  await updateFormalAiSidecarWhenIdle(options);

  // `docker image prune` removed the accepted image and the tag now resolves to
  // a build this host never verified.
  const pruned = createDockerSimulator({
    images: { [BOOTSTRAP_IMAGE]: BOOTSTRAP_DIGEST },
    pull: { [UPDATE_IMAGE]: 'sha256:something-else' },
    health: () => ({ version: FORMAL_AI_BOOTSTRAP_VERSION, memory: MEMORY }),
  });
  await assert.rejects(
    acquireFormalAiSidecar({ sessionId: 'pruned', env, run: pruned.run, ...fast }),
    error => {
      assert.match(error.message, /accepted/i);
      assert.match(error.message, /HIVE_MIND_FORMAL_AI_IMAGE/, 'the refusal says how the operator can override it');
      return true;
    },
    'Hive Mind must refuse rather than downgrade to a release the migrated memory predates'
  );
  assert.equal(
    pruned.calls.some(call => call.startsWith('run ') && call.includes(BOOTSTRAP_IMAGE)),
    false,
    'no silent fallback to the bootstrap release'
  );
}

// ---------------------------------------------------------------------------
// An explicit operator pin still wins, and a busy lease is left alone.
// ---------------------------------------------------------------------------

{
  const env = makeEnv({ HIVE_MIND_FORMAL_AI_IMAGE: 'registry.example/formal-ai:pinned' });
  const docker = createDockerSimulator({
    images: { [BOOTSTRAP_IMAGE]: BOOTSTRAP_DIGEST, 'registry.example/formal-ai:pinned': 'sha256:pinned' },
    health: () => ({ version: ACCEPTED_VERSION, memory: MEMORY }),
  });
  const options = { env, run: docker.run, ...fast };
  writeFormalAiSidecarState({ image: BOOTSTRAP_IMAGE, imageDigest: BOOTSTRAP_DIGEST, leases: [], lastUpdate: { image: UPDATE_IMAGE, digest: ACCEPTED_DIGEST, version: ACCEPTED_VERSION, updatedAt: new Date().toISOString() } }, { env });

  const pinned = await acquireFormalAiSidecar({ sessionId: 'pinned-task', ...options });
  assert.equal(pinned.imageDigest, 'sha256:pinned', 'the operator pin overrides the accepted update');

  // Second lease on the same running sidecar: the image is not re-resolved and
  // the container is not restarted underneath the task that already holds it.
  const shared = await acquireFormalAiSidecar({ sessionId: 'pinned-task-2', ...options });
  assert.equal(shared.leaseCount, 2);
  assert.equal(shared.imageDigest, 'sha256:pinned');

  const update = await updateFormalAiSidecarWhenIdle({ ...options, env: { ...env, HIVE_MIND_FORMAL_AI_IMAGE: '' } });
  assert.equal(update.status, 'busy', 'a held lease blocks the update instead of swapping the image under a running task');
  assert.equal(update.leaseCount, 2);

  await releaseFormalAiSidecar({ sessionId: 'pinned-task', ...options });
  await releaseFormalAiSidecar({ sessionId: 'pinned-task-2', ...options });
}

for (const dir of stateDirs) fs.rmSync(dir, { recursive: true, force: true });

console.log('PASS: issue #2207 a verified Formal AI update is consumed by the next task (accepted digest, restart, rollback, pruned image, operator pin, busy lease)');
