// Required integration gate after both release-shaped PR images are built.
// This checks the installed launcher against the host and nested daemons;
// it does not claim native CLI rotation/history lifecycle coverage.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startDetachedDockerPull } from '../src/docker-pull-detached.lib.mjs';
import { TASK_IMAGE_PULL_TIMEOUT_MS } from '../src/task-image-refresh.lib.mjs';
import { waitForPackagedDockerDaemon } from './docker-pr-daemon-ready.lib.mjs';

const execute = promisify(execFile);
const docker = (args, budget = 60_000) => execute('docker', args, { maxBuffer: 1024 * 1024, signal: AbortSignal.timeout(budget) });
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-packaged-mounts-'));
const probeImage = process.env.HIVE_MOUNT_TEST_IMAGE || 'node:24-alpine';
const script = fileURLToPath(new URL('./verify-mounted-task-backing.mjs', import.meta.url));
const dataScript = fileURLToPath(new URL('./verify-mounted-tool-data.mjs', import.meta.url));
const socket = '/var/run/docker.sock';
const socketGroup = String((await fs.stat(socket)).gid);
try {
  const historyDirectories = ['sessions', 'archived_sessions', 'thread-writer-locks'];
  for (const directory of historyDirectories) await fs.mkdir(path.join(fixture, 'home/.codex', directory), { recursive: true });
  for (const relative of ['', 'home', 'home/.codex', ...historyDirectories.map(directory => `home/.codex/${directory}`)]) await fs.chmod(path.join(fixture, relative), 0o777);
  await fs.writeFile(path.join(fixture, 'home/.codex/auth.json'), '{"synthetic":"canonical"}', { mode: 0o644 });
  try {
    await docker(['image', 'inspect', '--format', '{{.Id}}', probeImage]);
  } catch {
    await startDetachedDockerPull(['pull', probeImage], { timeoutMs: TASK_IMAGE_PULL_TIMEOUT_MS });
  }
  await docker(['image', 'save', '-o', path.join(fixture, 'probe-image.tar'), probeImage]);
  for (const [variant, image] of [
    ['host', `${process.env.IMAGE_NAME || 'konard/hive-mind'}:test`],
    ['nested', `${process.env.DIND_IMAGE_NAME || 'konard/hive-mind-dind'}:test`],
  ]) {
    for (const directory of historyDirectories) for (const index of [0, 1]) await fs.rm(path.join(fixture, `home/.codex/${directory}/task-${index}`), { force: true });
    const name = `hive-packaged-mount-${randomUUID()}`;
    try {
      const args = ['run', '--detach', '--pull', 'never', '--name', name, '--env', 'DIND_HOST_PASSTHROUGH=off', '--mount', `type=bind,source=${fixture},target=/mount-fixture`, '--mount', `type=bind,source=${script},target=/verify-mounted-task-backing.mjs,readonly`];
      args.push('--mount', `type=bind,source=${dataScript},target=/verify-mounted-tool-data.mjs,readonly`);
      if (variant === 'host') args.push('--group-add', socketGroup, '--mount', `type=bind,source=${socket},target=${socket}`);
      else args.push('--privileged');
      args.push(image, 'sleep', 'infinity');
      await docker(args);
      await waitForPackagedDockerDaemon({ docker, name, variant });
      if (variant === 'nested') await docker(['exec', name, 'docker', 'image', 'load', '-i', '/mount-fixture/probe-image.tar']);
      const expectedHome = variant === 'host' ? path.join(fixture, 'home') : '/mount-fixture/home';
      const result = await docker(['exec', '--env', `HIVE_MOUNT_TEST_IMAGE=${probeImage}`, '--env', `HIVE_MOUNT_TEST_EXPECTED_HOME=${expectedHome}`, name, 'bash', '-lc', 'node --max-old-space-size=128 /verify-mounted-task-backing.mjs "$(command -v hive)"'], 120_000);
      process.stdout.write(`${variant}: ${result.stdout}`);
      // The small filesystem fixture has Node but no search binary. Exercise
      // the executable actually installed in this release image, mounted from
      // the shared fixture in the selected daemon's filesystem namespace.
      await fs.rm(path.join(fixture, 'rg'), { force: true });
      await docker(['cp', `${name}:/home/box/.local/bin/rg`, path.join(fixture, 'rg')]);
      const searchSource = path.join(path.dirname(expectedHome), 'rg');
      const dataResult = await docker(['exec', '--env', `HIVE_MOUNT_TEST_IMAGE=${probeImage}`, '--env', `HIVE_MOUNT_TEST_EXPECTED_HOME=${expectedHome}`, '--env', `HIVE_MOUNT_TEST_SEARCH_SOURCE=${searchSource}`, name, 'bash', '-lc', 'node --max-old-space-size=128 /verify-mounted-tool-data.mjs "$(command -v hive)"'], 120_000);
      process.stdout.write(`${variant}: ${dataResult.stdout}`);
      for (const directory of historyDirectories) for (const index of [0, 1]) assert.equal(await fs.readFile(path.join(fixture, `home/.codex/${directory}/task-${index}`), 'utf8'), 'persisted');
    } finally {
      await docker(['rm', '-f', name]).catch(() => {});
    }
  }
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}
