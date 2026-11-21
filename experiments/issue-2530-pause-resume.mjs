/** With Docker and start-command 0.44.0 on PATH: node experiments/issue-2530-pause-resume.mjs */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import * as runner from '../src/isolation-runner.lib.mjs';
import { createSessionPauseControls } from '../src/session-pause.lib.mjs';
import { TASK_PAUSE_MARKER } from '../src/task-pause-marker.lib.mjs';

const run = promisify(execFile);
const docker = async args => (await run('docker', args)).stdout.trim();
const cli = async args => (await run('$', args)).stdout;
const name = randomUUID();
const containers = new Set([name]);
const root = await mkdtemp(join(tmpdir(), 'hive-pause-smoke-'));
process.env.START_TEMP_ROOT = root;
const script = 'ulimit -v 65536; mkdir -p /task; test -f /task/uncommitted || echo retained-work > /task/uncommitted; i=$(cat /task/progress 2>/dev/null || echo 0); trap "exit 0" TERM; while [ "$i" -lt 90 ]; do i=$((i+1)); echo "$i" > /task/progress; echo "progress=$i"; sleep 1; done';
const activeSessions = new Map();
const controls = createSessionPauseControls({ activeSessions, sessionsInFlight: new Set(), findSession: id => ({ sessionName: id, sessionInfo: activeSessions.get(id) }), getRunner: async () => runner, persist: () => {} });

async function until(read, predicate, description) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(500);
  }
  assert.fail(description);
}

function checked(result) {
  assert.equal(result.success, true, result.error);
  return result;
}

try {
  await docker(['pull', 'alpine:3.23']);
  console.log(await cli(['--isolated', 'docker', '--image', 'alpine:3.23', '--shell', 'sh', '--detached', '--keep-container', '--memory', '64m', '--memory-swap', '64m', '--cpus', '0.2', '--session-id', name, '--session', name, '--', 'sh', '-c', script]));
  const status = await runner.querySessionStatus(name);
  activeSessions.set(name, { sessionId: name, executionUuid: status.uuid, isolationBackend: 'docker', command: 'sh', args: ['-c', script], logPath: status.logPath, startTime: new Date(), containerResourceLimits: { memoryBytes: 64 * 1024 * 1024, cpuCores: 0.2 } });
  const pid = async () => Number(await docker(['inspect', '--format', '{{.State.Pid}}', name]));
  const log = () => docker(['logs', name]);
  await until(log, value => value.includes('progress=1'), 'task never started');
  const originalPid = await pid();
  assert.ok(originalPid > 0);

  // Reproduce the externally paused task from the issue before testing the
  // Telegram control path. The real status probe must see the paused container.
  await docker(['pause', name]);
  assert.equal(checked(await controls.getDockerTaskControlState(name)).state, 'paused');
  const list = async () => JSON.parse(await cli(['--list', '--output-format', 'json'])).executions.find(record => record.uuid === status.uuid);
  assert.equal((await list()).paused, true);
  assert.equal(checked(await controls.pauseTrackedSession(name)).alreadyPaused, true);
  assert.match((await controls.resumeStoppedSession(name)).error, /\/unpause/);
  const frozenOutput = await log();
  await delay(1500);
  assert.equal(await log(), frozenOutput);
  assert.equal(await pid(), originalPid);
  checked(await controls.unpauseTrackedSession(name, { requestedBy: 'ci' }));
  await until(log, value => value !== frozenOutput, 'the process never continued');
  assert.equal(await pid(), originalPid);
  assert.notEqual((await list()).paused, true);
  assert.equal(checked(await controls.unpauseTrackedSession(name)).notPaused, true);
  console.log(`Docker freeze, no task output and unfreeze verified for PID ${originalPid}.`);

  checked(await controls.pauseTrackedSession(name, { requestedBy: 'ci', reason: 'stop from paused' }));
  checked(await controls.stopTrackedDockerSession(name, { requestedBy: 'ci' }));
  assert.equal(await runner.inspectDockerContainerState(name), 'exited');
  const resumed = checked(await controls.resumeStoppedSession(name));
  const next = resumed.sessionId;
  containers.add(next);
  assert.equal(await docker(['exec', next, 'cat', '/task/uncommitted']), 'retained-work');
  await docker(['exec', next, 'test', '!', '-e', TASK_PAUSE_MARKER]);
  const limits = JSON.parse(await docker(['inspect', '--format', '{{json .HostConfig}}', next]));
  assert.equal(limits.Memory, 64 * 1024 * 1024);
  assert.equal(limits.NanoCpus, 200000000);
  console.log('Stop while frozen, retained filesystem resume, and CPU/RAM limits verified.');
} finally {
  for (const container of containers) await docker(['rm', '-f', container]).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
