#!/usr/bin/env node

/**
 * End-to-end evidence for issues #2207 and #2208 against the *real* published
 * Formal AI images and a real Docker daemon.
 *
 * The simulated regressions in `tests/` prove the logic; this proves the
 * premise, which is what issue #2209 asked for: that the release accepted by an
 * idle update is the process that answers the next task's requests, and that
 * asking the endpoint is what tells us so.
 *
 * Usage:
 *   node experiments/issue-2209/real-image-evidence.mjs [--from <tag>] [--to <tag>]
 *
 * It uses a private state directory and cleans up the container, network and
 * memory volume it creates.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { FORMAL_AI_IMAGE_REPOSITORY } from '../../src/formal-ai-image.lib.mjs';
import { probeFormalAiBackend } from '../../src/formal-ai-runtime.lib.mjs';
import { FORMAL_AI_MEMORY_VOLUME_NAME, FORMAL_AI_SIDECAR_CONTAINER_NAME, FORMAL_AI_SIDECAR_NETWORK_NAME, acquireFormalAiSidecar, readFormalAiSidecarState, releaseFormalAiSidecar, writeFormalAiSidecarState } from '../../src/formal-ai-sidecar.lib.mjs';
import { updateFormalAiSidecarWhenIdle } from '../../src/formal-ai-updater.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION } from '../../src/formal-ai-version.lib.mjs';

const execFileAsync = promisify(execFile);
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};

const fromTag = arg('--from', FORMAL_AI_BOOTSTRAP_VERSION);
const toTag = arg('--to', 'latest');
const fromImage = `${FORMAL_AI_IMAGE_REPOSITORY}:${fromTag}`;
const log = async message => console.log(message);
const docker = async args => (await execFileAsync('docker', args, { maxBuffer: 32 * 1024 * 1024 })).stdout.trim();

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formal-ai-real-evidence-'));
const env = { ...process.env, HIVE_MIND_STATE_DIR: stateDir, HIVE_MIND_FORMAL_AI_UPDATE_TAG: toTag, HIVE_MIND_FORMAL_AI_IMAGE: '' };
const options = { env, log, verbose: true };

const cleanup = async () => {
  for (const args of [
    ['rm', '--force', FORMAL_AI_SIDECAR_CONTAINER_NAME],
    ['network', 'rm', FORMAL_AI_SIDECAR_NETWORK_NAME],
    ['volume', 'rm', FORMAL_AI_MEMORY_VOLUME_NAME],
  ]) {
    await docker(args).catch(() => {});
  }
  fs.rmSync(stateDir, { recursive: true, force: true });
};

const evidence = {};
try {
  // Start from a host that is running the bootstrap release, the way a fresh
  // Hive Mind installation does.
  await cleanup();
  console.log(`\n=== pulling the starting release ${fromImage} ===`);
  await docker(['pull', fromImage]);
  const fromDigest = await docker(['image', 'inspect', fromImage, '--format', '{{.Id}}']);
  writeFormalAiSidecarState({ image: fromImage, imageDigest: fromDigest, leases: [] }, { env });
  evidence.start = { image: fromImage, digest: fromDigest };

  console.log(`\n=== idle update to ${FORMAL_AI_IMAGE_REPOSITORY}:${toTag} ===`);
  const update = await updateFormalAiSidecarWhenIdle(options);
  evidence.update = { status: update.status, image: update.image, digest: update.digest, version: update.health?.version ?? null, memorySchemaVersion: update.health?.memory?.schema_version ?? null };
  console.log(JSON.stringify(evidence.update, null, 2));
  if (update.status !== 'updated') {
    console.log(`\nThe registry is not serving a newer build than ${fromImage} right now (status: ${update.status}).`);
    console.log('Re-run with --from <older tag> to exercise a real transition.');
    process.exitCode = 2;
  } else {
    assert.equal(await docker(['ps', '--all', '--filter', `name=^${FORMAL_AI_SIDECAR_CONTAINER_NAME}$`, '--format', '{{.Names}}']), '', 'the updater leaves no sidecar running');

    console.log('\n=== the next task acquires a sidecar ===');
    const first = await acquireFormalAiSidecar({ sessionId: 'issue-2209-evidence-a', ...options });
    // What the daemon says is running, independent of any Hive Mind bookkeeping.
    const runningDigest = await docker(['inspect', FORMAL_AI_SIDECAR_CONTAINER_NAME, '--format', '{{.Image}}']);
    // What the process itself says, over HTTP, from outside the container.
    const probe = await probeFormalAiBackend({ baseUrl: first.baseUrl });
    evidence.firstTask = { image: first.imageReference, imageSource: first.imageSource, leaseDigest: first.imageDigest, dockerReportsDigest: runningDigest, baseUrl: first.baseUrl, probedVersion: probe.version, probedMemorySchema: probe.memory?.schema_version ?? null };
    console.log(JSON.stringify(evidence.firstTask, null, 2));

    assert.equal(first.imageDigest, update.digest, 'the accepted image is what the next task leased');
    assert.equal(runningDigest, update.digest, 'and what Docker actually started');
    assert.equal(probe.version, update.health.version, 'and what the serving process reports over HTTP');
    assert.notEqual(probe.version, null);

    await releaseFormalAiSidecar({ sessionId: 'issue-2209-evidence-a', ...options });

    console.log('\n=== a later task, after the sidecar was stopped again ===');
    const second = await acquireFormalAiSidecar({ sessionId: 'issue-2209-evidence-b', ...options });
    const secondProbe = await probeFormalAiBackend({ baseUrl: second.baseUrl });
    evidence.secondTask = { leaseDigest: second.imageDigest, probedVersion: secondProbe.version };
    console.log(JSON.stringify(evidence.secondTask, null, 2));
    assert.equal(second.imageDigest, update.digest);
    assert.equal(secondProbe.version, update.health.version);
    await releaseFormalAiSidecar({ sessionId: 'issue-2209-evidence-b', ...options });

    evidence.persistedState = readFormalAiSidecarState({ env }).lastUpdate;
    console.log(`\n=== persisted acceptance ===\n${JSON.stringify(evidence.persistedState, null, 2)}`);
    console.log(`\nPASS: ${evidence.update.version} (${update.digest}) was accepted, started and observed serving both tasks.`);
  }
} finally {
  await cleanup();
}
