import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateFormalAiSidecarWhenIdle } from '../../src/formal-ai-updater.lib.mjs';
import { acquireFormalAiSidecar, readFormalAiSidecarState, writeFormalAiSidecarState } from '../../src/formal-ai-sidecar.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION } from '../../src/formal-ai-version.lib.mjs';
import { createDockerSimulator } from '../../tests/formal-ai-docker-simulator.mjs';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formal-ai-update-acquire-'));
const env = { HIVE_MIND_STATE_DIR: stateDir };
const repository = 'ghcr.io/link-assistant/formal-ai';
const bootstrap = `${repository}:${FORMAL_AI_BOOTSTRAP_VERSION}`;
const latest = `${repository}:latest`;
const memory = { compatible: true, schema_version: 2, migration_required: false, migration_state: 'current' };
const docker = createDockerSimulator({
  images: { [bootstrap]: 'sha256:old' },
  pull: { [latest]: 'sha256:new' },
  health: image => ({ version: image === latest ? '0.346.0' : FORMAL_AI_BOOTSTRAP_VERSION, memory }),
  memory: { 'upgrade-status': { ...memory, path_exists: false } },
});
const options = { env, run: docker.run, healthAttempts: 1, healthDelayMs: 0, sleepImpl: async () => {} };
try {
  writeFormalAiSidecarState({ image: bootstrap, imageDigest: 'sha256:old', leases: [] }, { env });
  const update = await updateFormalAiSidecarWhenIdle(options);
  assert.equal(update.status, 'updated');
  assert.equal(readFormalAiSidecarState({ env }).imageDigest, 'sha256:new');
  const task = await acquireFormalAiSidecar({ sessionId: 'release-verification-task', ...options });
  console.log(JSON.stringify({ updateStatus: update.status, updatedVersion: update.health.version, updatedDigest: update.digest, taskImage: task.image, taskVersion: task.health.version, taskDigest: task.imageDigest }, null, 2));
  assert.equal(task.imageDigest, update.digest, 'the next task must consume the successfully verified update');
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}
