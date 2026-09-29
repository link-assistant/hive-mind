#!/usr/bin/env node
/**
 * Issue #2305 reproduction: run twelve maintenance ticks (one hour at the
 * five-minute cadence) on a host that never ran a `--model formal-ai` task,
 * against the in-memory Docker daemon, and print what reached "docker".
 *
 *   node experiments/issue-2305/unused-host-ticks.mjs
 *
 * Before #2305 every tick pulls `ghcr.io/link-assistant/formal-ai:latest` and
 * the first new release is booted for verification; after it, nothing runs.
 *
 * Measured on 2026-09-27 (same simulator, pre-fix tree at 3252aae8):
 *   before: docker calls: 75; pull: 12; run: 3; images on host: 1
 *   after:  docker calls: 84; pull: 0; run: 0; images on host: 0
 * The remaining calls are local `inspect`/`ps`/`image ls` queries; pass
 * `--calls` to list them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runFormalAiMaintenanceTick } from '../../src/formal-ai-maintenance.lib.mjs';
import { createDockerSimulator } from '../../tests/formal-ai-docker-simulator.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-2305-'));
const env = { HIVE_MIND_STATE_DIR: dir, HIVE_MIND_IMAGE_VARIANT: 'dind' };
const docker = createDockerSimulator({
  health: { version: '0.346.0', memory: { compatible: true, schema_version: 3, migration_required: false, migration_state: 'current' } },
  memory: { 'upgrade-status': { compatible: true, path_exists: true, migration_required: false, migration_state: 'current', detected_schema_version: 3 } },
  pull: { 'ghcr.io/link-assistant/formal-ai:latest': 'sha256:v1' },
  registry: { 'ghcr.io/link-assistant/formal-ai:latest': 'sha256:v1' },
});
for (let tick = 0; tick < 12; tick += 1) await runFormalAiMaintenanceTick({ env, run: docker.run, updateClis: async () => ({ status: 'skipped' }), healthAttempts: 1, healthDelayMs: 0, sleepImpl: async () => {} });
const count = prefix => docker.calls.filter(call => call.startsWith(prefix)).length;
if (process.argv.includes('--calls')) console.log([...new Set(docker.calls)].join('\n'));
console.log(`docker calls: ${docker.calls.length}; pull: ${count('pull')}; run: ${count('run')}; images on host: ${docker.digests.size}`);
fs.rmSync(dir, { recursive: true, force: true });
