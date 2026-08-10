#!/usr/bin/env node

/**
 * Regression coverage for the idle-only updates the PR #2147 review asked for:
 *
 *   "Auto update formal-ai docker container when no formal-ai tasks running …
 *    when stopped and new version available update to latest … do same auto
 *    update for claude, codex, agent and other agentic CLIs."
 *
 * The dangerous part of an unattended image replacement is the persisted
 * memory, so the interesting assertions here are the ones that prove Hive Mind
 * follows Formal AI's upgrade contract (formal-ai#982) exactly: a
 * side-effect-free preflight, a migration that produces a byte-exact backup and
 * a receipt, verification that the new binary can actually serve the migrated
 * memory, and a rollback when it cannot.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AGENTIC_CLI_TARGETS, listAgenticCliUpdateTargets, parseCliVersion, readAgenticCliState, updateAgenticClisWhenIdle } from '../src/agentic-cli-updater.lib.mjs';
import { FORMAL_AI_MEMORY_PATH, FORMAL_AI_MEMORY_VOLUME_NAME, FORMAL_AI_SIDECAR_CONTAINER_NAME, readFormalAiSidecarState, writeFormalAiSidecarState } from '../src/formal-ai-sidecar.lib.mjs';
import { isFormalAiAutoUpdateEnabled, parseJsonBlock, resolveFormalAiUpdateImage, updateFormalAiSidecarWhenIdle } from '../src/formal-ai-updater.lib.mjs';
import { createDockerSimulator } from './formal-ai-docker-simulator.mjs';

const UPDATE_IMAGE = 'ghcr.io/link-assistant/formal-ai:latest';
const ORIGINAL_SHA = 'a1b2c3d4e5f6';
const stateDirs = [];

const makeEnv = (extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-update-'));
  stateDirs.push(dir);
  return { HIVE_MIND_STATE_DIR: dir, ...extra };
};

const preflight = {
  compatible: true,
  path_exists: true,
  migration_required: true,
  migration_state: 'upgrade_required',
  detected_schema_version: 1,
  target_schema_version: 2,
  migration_id: 'events-v1-to-v2',
  source_sha256: ORIGINAL_SHA,
};

const receipt = {
  migration_id: 'events-v1-to-v2',
  from_schema_version: 1,
  to_schema_version: 2,
  event_count: 128,
  memory_path: FORMAL_AI_MEMORY_PATH,
  backup_path: '/home/box/.formal-ai/memory.lino.schema-1.bak',
  original_sha256: ORIGINAL_SHA,
  rollback_supported: true,
  rollback_strategy: 'restore_backup_path',
};

const healthyOn = version => ({ version, memory: { compatible: true, schema_version: 2, migration_required: false, migration_state: 'current' } });
const fastUpdate = { healthAttempts: 2, healthDelayMs: 0, sleepImpl: async () => {} };
const seedRunningSidecar = (env, digest) => writeFormalAiSidecarState({ ...readFormalAiSidecarState({ env }), image: UPDATE_IMAGE, imageDigest: digest }, { env });

// ---------------------------------------------------------------------------
// Which image an update pulls, and when it refuses to run at all.
// ---------------------------------------------------------------------------

assert.equal(resolveFormalAiUpdateImage({}), UPDATE_IMAGE, 'only the initial version is pinned; updates follow the moving tag');
assert.equal(resolveFormalAiUpdateImage({ HIVE_MIND_FORMAL_AI_UPDATE_TAG: 'edge' }), 'ghcr.io/link-assistant/formal-ai:edge');
assert.equal(isFormalAiAutoUpdateEnabled({}), true);
assert.equal(isFormalAiAutoUpdateEnabled({ HIVE_MIND_FORMAL_AI_AUTO_UPDATE: 'off' }), false);
assert.equal(isFormalAiAutoUpdateEnabled({ HIVE_MIND_FORMAL_AI_IMAGE: 'ghcr.io/link-assistant/formal-ai:0.336.0' }), false, 'an operator pin is a decision, not a default');

// The image entrypoint prints a banner before the JSON payload.
assert.deepEqual(parseJsonBlock('formal-ai container\n{"compatible": true}\n'), { compatible: true });
assert.throws(() => parseJsonBlock('no payload here'), /Expected a JSON object/);

assert.deepEqual(await updateFormalAiSidecarWhenIdle({ env: makeEnv({ HIVE_MIND_FORMAL_AI_IMAGE: 'ghcr.io/link-assistant/formal-ai:0.336.0' }) }), { status: 'disabled', reason: 'HIVE_MIND_FORMAL_AI_IMAGE pins a specific build' });

// ---------------------------------------------------------------------------
// Running Formal AI tasks defer the update; an unchanged digest is a no-op.
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  const docker = createDockerSimulator({ images: { [UPDATE_IMAGE]: 'sha256:old' } });
  docker.createContainer('task-x');
  writeFormalAiSidecarState({ ...readFormalAiSidecarState({ env }), leases: [{ sessionId: 'task-x', acquiredAt: new Date().toISOString(), containerSeen: true }] }, { env });

  assert.deepEqual(await updateFormalAiSidecarWhenIdle({ env, run: docker.run, ...fastUpdate }), { status: 'busy', leaseCount: 1 });
  assert.equal(docker.ran('pull'), false, 'a busy host does not even reach the registry');
}

{
  const env = makeEnv();
  const docker = createDockerSimulator({ images: { [UPDATE_IMAGE]: 'sha256:same' }, memory: { 'upgrade-status': preflight } });
  seedRunningSidecar(env, 'sha256:same');

  assert.deepEqual(await updateFormalAiSidecarWhenIdle({ env, run: docker.run, ...fastUpdate }), { status: 'up-to-date', image: UPDATE_IMAGE, digest: 'sha256:same' });
  assert.equal(docker.ran(/memory upgrade-status/), false, 'memory is not touched when nothing changed');
}

// ---------------------------------------------------------------------------
// The happy path: pull → preflight → migrate → verify → stay stopped.
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  const docker = createDockerSimulator({
    images: { [UPDATE_IMAGE]: 'sha256:old' },
    pull: { [UPDATE_IMAGE]: 'sha256:new' },
    memory: { 'upgrade-status': preflight, migrate: receipt },
    health: healthyOn('0.338.0'),
  });
  docker.volumes.add(FORMAL_AI_MEMORY_VOLUME_NAME);
  seedRunningSidecar(env, 'sha256:old');

  const result = await updateFormalAiSidecarWhenIdle({ env, run: docker.run, ...fastUpdate });
  assert.equal(result.status, 'updated');
  assert.equal(result.digest, 'sha256:new');
  assert.equal(result.previousDigest, 'sha256:old');
  assert.equal(result.receipt.migration_id, 'events-v1-to-v2');
  assert.equal(result.health.version, '0.338.0');

  // The contract, step by step.
  assert.equal(docker.ran(/memory upgrade-status --path .* --format json/), true, 'the preflight is side-effect free and runs first');
  assert.equal(docker.ran(/memory migrate .*--backup .*memory\.lino\.schema-1\.bak --receipt .*memory-upgrade-receipt\.json/), true, 'the migration produces a backup and a receipt');
  assert.ok(docker.calls.findIndex(call => call.includes('memory upgrade-status')) < docker.calls.findIndex(call => call.includes('memory migrate')));
  assert.equal(docker.ran(/^run --detach/), true, 'the new image must prove it can serve the migrated memory');
  assert.equal(docker.containers.has(FORMAL_AI_SIDECAR_CONTAINER_NAME), false, 'verification is not a deployment: the sidecar stays stopped while idle');
  assert.equal(docker.volumes.has(FORMAL_AI_MEMORY_VOLUME_NAME), true);
  assert.equal(docker.ran(/^volume rm/), false, 'memory survives the version change');

  const state = readFormalAiSidecarState({ env });
  assert.equal(state.imageDigest, 'sha256:new');
  assert.equal(state.lastUpdate.version, '0.338.0');
  assert.equal(state.lastUpdate.migrationId, 'events-v1-to-v2');
  assert.equal(state.lastUpdate.memorySchemaVersion, 2);
}

// ---------------------------------------------------------------------------
// Anything that goes wrong after the migration restores the backup.
// ---------------------------------------------------------------------------

{
  const env = makeEnv();
  const docker = createDockerSimulator({
    images: { [UPDATE_IMAGE]: 'sha256:old' },
    pull: { [UPDATE_IMAGE]: 'sha256:broken' },
    memory: { 'upgrade-status': preflight, migrate: receipt },
    // The new binary starts but reports it cannot serve the memory it was given.
    health: { version: '0.339.0', memory: { compatible: false, schema_version: 3, migration_required: true, migration_state: 'unsupported' } },
    memorySha256: ORIGINAL_SHA,
  });
  seedRunningSidecar(env, 'sha256:old');

  const result = await updateFormalAiSidecarWhenIdle({ env, run: docker.run, ...fastUpdate });
  assert.equal(result.status, 'rolled-back');
  assert.equal(result.stage, 'verify');
  assert.deepEqual(result.rollback, { restored: true, verified: true, sha256: ORIGINAL_SHA, error: null });
  assert.equal(docker.ran(/--entrypoint sh .*cp -- '\/home\/box\/\.formal-ai\/memory\.lino\.schema-1\.bak'/), true, 'the receipt names the file the rollback restores');
  assert.equal(readFormalAiSidecarState({ env }).imageDigest, 'sha256:old', 'the previous image stays in service');
  assert.equal(readFormalAiSidecarState({ env }).lastUpdate, null);
}

{
  // A preflight that changed the file would break the contract's core promise.
  const env = makeEnv();
  const docker = createDockerSimulator({
    images: { [UPDATE_IMAGE]: 'sha256:old' },
    pull: { [UPDATE_IMAGE]: 'sha256:new' },
    memory: { 'upgrade-status': preflight, migrate: { ...receipt, original_sha256: 'mutated-by-preflight' } },
    health: healthyOn('0.338.0'),
    memorySha256: 'mutated-by-preflight',
  });
  seedRunningSidecar(env, 'sha256:old');

  const result = await updateFormalAiSidecarWhenIdle({ env, run: docker.run, ...fastUpdate });
  assert.equal(result.status, 'rolled-back');
  assert.equal(result.stage, 'preflight-side-effect');
  assert.equal(result.rollback.verified, true);
}

{
  // A refused preflight leaves memory and the running image untouched.
  const env = makeEnv();
  const docker = createDockerSimulator({ images: { [UPDATE_IMAGE]: 'sha256:old' }, pull: { [UPDATE_IMAGE]: 'sha256:new' }, memory: {} });
  seedRunningSidecar(env, 'sha256:old');

  const result = await updateFormalAiSidecarWhenIdle({ env, run: docker.run, ...fastUpdate });
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'preflight');
  assert.equal(docker.ran(/memory migrate/), false, 'nothing is migrated after a refusal');
}

{
  // An unreachable registry is not a reason to disturb a working install.
  const env = makeEnv();
  const docker = createDockerSimulator({ images: { [UPDATE_IMAGE]: 'sha256:old' }, pullError: 'Error response from daemon: unauthorized' });
  seedRunningSidecar(env, 'sha256:old');

  const result = await updateFormalAiSidecarWhenIdle({ env, run: docker.run, ...fastUpdate });
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'pull');
  assert.equal(docker.ran(/^stop/), false);
}

// ---------------------------------------------------------------------------
// The same idle rule for the agentic CLIs.
// ---------------------------------------------------------------------------

const packages = AGENTIC_CLI_TARGETS.map(target => target.package);
assert.equal(packages.includes('@link-assistant/hive-mind'), false, 'the bot never replaces the package that owns its own process');
assert.equal(packages.includes('start-command'), false, 'start-command stays pinned by the Dockerfile');
assert.deepEqual(
  listAgenticCliUpdateTargets({ HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY: 'claude, codex' }).map(target => target.id),
  ['claude', 'codex']
);
assert.equal(
  listAgenticCliUpdateTargets({ HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE: 'claude' })
    .map(target => target.id)
    .includes('claude'),
  false
);
assert.equal(parseCliVersion('claude 2.0.1 (Claude Code)'), '2.0.1');
assert.equal(parseCliVersion('codex-cli 0.9.0-alpha.3\n'), '0.9.0-alpha.3');
assert.equal(parseCliVersion('unknown'), null);

{
  const installed = { claude: '1.0.0', codex: '0.9.0' };
  const published = { '@anthropic-ai/claude-code': '1.1.0', '@openai/codex': '0.9.0' };
  const commands = [];
  const run = async (command, args) => {
    commands.push([command, ...args].join(' '));
    if (args[0] === '--version') {
      if (!(command in installed)) throw new Error(`spawn ${command} ENOENT`);
      return { stdout: `${command} ${installed[command]}\n` };
    }
    if (command === 'npm') return { stdout: `${published[args[1]]}\n` };
    // `claude update` is the supported refresh path for the native installer.
    if (command === 'claude' && args[0] === 'update') {
      installed.claude = published['@anthropic-ai/claude-code'];
      return { stdout: 'updated' };
    }
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  };

  const env = makeEnv({ HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY: 'claude,codex,agent' });
  const idle = { env, run, getActiveTasksImpl: async () => [] };

  const busy = await updateAgenticClisWhenIdle({ ...idle, getActiveTasksImpl: async () => [{ id: 'task-1' }] });
  assert.equal(busy.status, 'busy', 'a running task must never have its toolchain swapped underneath it');
  assert.equal(busy.activeTaskCount, 1);
  assert.equal(commands.length, 0);

  const result = await updateAgenticClisWhenIdle(idle);
  assert.equal(result.status, 'checked');
  assert.deepEqual(result.updated, [{ id: 'claude', from: '1.0.0', to: '1.1.0' }]);
  assert.deepEqual(result.upToDate, [{ id: 'codex', version: '0.9.0' }]);
  assert.deepEqual(result.failed, [], 'a CLI that is not installed here is skipped, not failed');
  assert.equal(commands.includes('claude update'), true);
  assert.equal(
    commands.some(command => command.startsWith('bun install')),
    false,
    'nothing is reinstalled when the registry matches'
  );
  assert.equal(readAgenticCliState({ env }).tools.claude.version, '1.1.0');

  // The registry is polled on a schedule, not on every maintenance tick.
  assert.equal((await updateAgenticClisWhenIdle(idle)).status, 'throttled');
  assert.equal((await updateAgenticClisWhenIdle({ ...idle, force: true })).status, 'checked');
  assert.equal((await updateAgenticClisWhenIdle({ ...idle, env: { ...env, HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE: '0' } })).status, 'disabled');
}

for (const dir of stateDirs) fs.rmSync(dir, { recursive: true, force: true });

console.log('PASS: issue #2146 idle-only Formal AI image updates with memory migration and rollback, and idle-only agentic CLI refresh');
