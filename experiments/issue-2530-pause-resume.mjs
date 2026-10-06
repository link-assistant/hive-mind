/**
 * Real Docker filesystem/resource check for explicit task pause/resume.
 * Run: START_COMMAND_BINARY=/path/to/$ node experiments/issue-2530-pause-resume.mjs
 * Requires Docker and start-command >= 0.35.0. Uses one 64 MiB container,
 * a finite 30-iteration task, and removes only its own containers/snapshots.
 * On hosts without cgroup controls, PAUSE_EXPERIMENT_SKIP_LIMITS=1 tests only
 * filesystem retention; the shell still has a 64 MiB virtual-memory limit.
 */
/* global process, console */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createSessionPauseControls } from '../src/session-pause.lib.mjs';
import { parseSessionStatusOutput } from '../src/isolation-runner.lib.mjs';
import { parseExecutionResumeOutput } from '../src/isolation-runner.resume.lib.mjs';
import { TASK_PAUSE_MARKER } from '../src/task-pause-marker.lib.mjs';
import { markDockerTaskPaused } from '../src/docker-container-control.lib.mjs';

const exec = promisify(execFile);
const binary = process.env.START_COMMAND_BINARY || '$';
const checkLimits = process.env.PAUSE_EXPERIMENT_SKIP_LIMITS !== '1';
const name = randomUUID();
const created = new Set([name]);
const images = new Set();
const cli = async args => (await exec(binary, args)).stdout;
const docker = async args => (await exec('docker', args)).stdout.trim();
const script = 'ulimit -v 65536; mkdir -p /task; test -f /task/uncommitted || echo retained-work > /task/uncommitted; i=$(cat /task/progress 2>/dev/null || echo 0); while [ "$i" -lt 30 ]; do i=$((i+1)); echo "$i" > /task/progress; sleep 1; done';
const runner = {
  querySessionStatus: async id => parseSessionStatusOutput(await cli(['--status', id, '--output-format', 'json'])),
  checkDockerContainerRunning: async id => (await docker(['inspect', '--format', '{{.State.Running}}', id])) === 'true',
  checkDockerContainerExists: async id => {
    try {
      await docker(['inspect', id]);
      return true;
    } catch {
      return false;
    }
  },
  markDockerTaskPaused,
  stopIsolatedSession: async id => {
    await cli(['--stop', id]);
    return { success: true };
  },
  getDockerContainerWritableLayerSize: async id => Number(await docker(['inspect', '--size', '--format', '{{.SizeRw}}', id])),
  getStartCommandVersion: async () => cli(['--version']),
  resumeIsolatedSession: async (id, { command }) => {
    const result = parseExecutionResumeOutput(await cli(['--resume', id, '--output-format', 'json', '--', command]));
    if (result.sessionName) created.add(result.sessionName);
    if (result.snapshotImage) images.add(result.snapshotImage);
    return { success: true, ...result };
  },
};
const activeSessions = new Map();
const controls = createSessionPauseControls({ activeSessions, sessionsInFlight: new Set(), getRunner: async () => runner, persist: () => {} });
try {
  console.log(await cli(['--isolated', 'docker', '--image', 'alpine:3.22', '--shell', 'sh', '--detached', '--keep-container', '--session-id', name, '--session', name, '--', 'sh', '-c', script]));
  if (checkLimits) await docker(['update', '--memory', '64m', '--memory-swap', '64m', '--cpus', '0.1', name]);
  const status = await runner.querySessionStatus(name);
  activeSessions.set(name, { sessionId: name, executionUuid: status.uuid, isolationBackend: 'docker', command: 'sh', args: ['-c', script], logPath: status.logPath, startTime: new Date(), ...(checkLimits ? { containerResourceLimits: { memoryBytes: 64 * 1024 * 1024, cpuCores: 0.1 } } : {}) });
  const before = Number(await docker(['exec', name, 'cat', '/task/progress']));
  assert.equal((await controls.pauseTrackedSession(name)).success, true);
  assert.equal(await runner.checkDockerContainerRunning(name), false);
  console.log('Paused: container stopped; CPU/RAM execution released.');
  const result = await controls.resumePausedSession(name);
  assert.equal(result.success, true, result.error);
  const next = result.sessionId;
  assert.equal(await docker(['exec', next, 'cat', '/task/uncommitted']), 'retained-work');
  await docker(['exec', next, 'test', '!', '-e', TASK_PAUSE_MARKER]);
  const limits = JSON.parse(await docker(['inspect', '--format', '{{json .HostConfig}}', next]));
  if (checkLimits) {
    assert.equal(limits.Memory, 64 * 1024 * 1024);
    assert.equal(limits.NanoCpus, 100000000);
  }
  let after = 0;
  for (let attempt = 0; attempt < 10 && after <= before; attempt++) {
    after = Number(await docker(['exec', next, 'cat', '/task/progress']));
    if (after <= before) await delay(500);
  }
  assert.ok(after > before, `progress did not continue: ${before} -> ${after}`);
  console.log(`Resumed: retained file verified; progress ${before} -> ${after}. Resource limits ${checkLimits ? 'verified' : 'skipped (host cgroup controls unavailable)'}.`);
} finally {
  for (const container of created) await docker(['rm', '-f', container]).catch(() => {});
  for (const image of images) await docker(['image', 'rm', image]).catch(() => {});
}
