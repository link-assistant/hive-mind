#!/usr/bin/env node
/**
 * Regression coverage for issue #3001: the Docker disk-space preflight never ran
 * when the bot used the host Docker socket from a container.
 *
 * Production log on every start:
 *
 *   [VERBOSE] isolation-runner: docker storage driver: overlayfs
 *   [VERBOSE] isolation-runner: could not parse df output for Docker disk space
 *
 * `docker info` returns the HOST's data root (`/var/lib/docker`), which does not
 * exist in the bot container, so `df` exited 1. command-stream resolves on a
 * non-zero exit, the empty stdout failed to parse, and the probe returned null:
 * the check was skipped with a misleading verbose line.
 *
 * The fake `run` below replays that topology: the daemon's `Name` is the host,
 * not this container, and `df` on the host path fails here.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3001
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkDockerDiskSpace, parseDfAvailableKb, parseDockerInfo, resolveDockerStoragePaths, runCommand, DOCKER_DISK_PROBE_MOUNT } from '../src/docker-disk-space.lib.mjs';
import { checkDockerImagePresent, checkTmuxSessionRunning, preflightDockerIsolation } from '../src/isolation-runner.lib.mjs';
import { assertCommandSucceeded } from '../src/start-command-cli.lib.mjs';

const TASK_IMAGE = 'konard/hive-mind:2.35.7';
const KB_PER_GIB = 1024 * 1024;

const dockerInfo = overrides => JSON.stringify({ Name: 'prod-host', DockerRootDir: '/var/lib/docker', Driver: 'overlay2', DriverStatus: [], Containerd: { Address: '/run/containerd/containerd.sock' }, ...overrides });
const dfOutput = (gib, mount = DOCKER_DISK_PROBE_MOUNT) => `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 500000000 1 ${Math.round(gib * KB_PER_GIB)} 50% ${mount}\n`;

/**
 * Fake runner for the bot container: `df` only sees `localPaths`; a daemon-side
 * `docker run` sees `hostDisk` and only images in `images`.
 */
function fakeDocker({ info = dockerInfo(), infoCode = 0, localPaths = {}, hostDisk = {}, images = [TASK_IMAGE], listedImages = images } = {}) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    if (file === 'docker' && args[0] === 'info') return infoCode === 0 ? { code: 0, stdout: info, stderr: '' } : { code: infoCode, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n' };
    if (file === 'df') {
      const path = args[1];
      if (path in localPaths) return { code: 0, stdout: dfOutput(localPaths[path], path), stderr: '' };
      return { code: 1, stdout: '', stderr: `df: ${path}: No such file or directory\n` };
    }
    if (file === 'docker' && args[0] === 'image' && args[1] === 'ls') return { code: 0, stdout: listedImages.join('\n'), stderr: '' };
    if (file === 'docker' && args[0] === 'run') {
      const source = /source=([^,]+)/.exec(args[args.indexOf('--mount') + 1])[1];
      const image = args[args.indexOf('--mount') + 2];
      if (!images.includes(image)) return { code: 125, stdout: '', stderr: `docker: Error response from daemon: No such image: ${image}\n` };
      if (!(source in hostDisk)) return { code: 125, stdout: '', stderr: `docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: ${source}\n` };
      return { code: 0, stdout: dfOutput(hostDisk[source]), stderr: '' };
    }
    return { code: 127, stdout: '', stderr: `${file}: command not found` };
  };
  return { run, calls };
}

function captureLogger() {
  const logs = [];
  const warns = [];
  return { logs, warns, log: (...a) => logs.push(a.join(' ')), warn: (...a) => warns.push(a.join(' ')) };
}

test('host Docker socket: the host data root is measured through the daemon in the task image', async () => {
  const { run, calls } = fakeDocker({ hostDisk: { '/var/lib/docker': 25 } });
  const disk = await checkDockerDiskSpace(false, { image: TASK_IMAGE, run, hostname: 'hive-mind-container' });
  assert.equal(disk.daemonIsLocal, false);
  assert.equal(disk.via, 'daemon');
  assert.equal(disk.dataRoot, '/var/lib/docker');
  assert.equal(Math.round(disk.availableGiB), 25);
  assert.equal(disk.error, null);
  assert.equal(
    calls.some(c => c[0] === 'df'),
    false,
    'the bot container path is not the daemon path, so it is not measured locally'
  );
  const dockerRun = calls.find(c => c[1] === 'run');
  for (const flag of ['--rm', '--pull', 'never', '--network', 'none', '--entrypoint', 'df', TASK_IMAGE]) assert.ok(dockerRun.includes(flag), `docker run uses ${flag}`);
  assert.ok(dockerRun.includes(`type=bind,source=/var/lib/docker,target=${DOCKER_DISK_PROBE_MOUNT},readonly`), 'read-only --mount that never creates a missing host path');
});

test('same machine but the data root is missing locally: df failure is recorded and the daemon measures', async () => {
  const { run } = fakeDocker({ info: dockerInfo({ Name: 'hive-mind-container' }), hostDisk: { '/var/lib/docker': 80 } });
  const disk = await checkDockerDiskSpace(false, { image: TASK_IMAGE, run, hostname: 'hive-mind-container' });
  assert.equal(disk.via, 'daemon');
  assert.equal(Math.round(disk.availableGiB), 80);
  assert.match(disk.errors[0], /df failed: df: \/var\/lib\/docker: No such file or directory/);
});

test('local daemon (bot on the host or nested dind): measured locally, no container started', async () => {
  const { run, calls } = fakeDocker({ info: dockerInfo({ Name: 'box' }), localPaths: { '/var/lib/docker': 120 } });
  const disk = await checkDockerDiskSpace(false, { image: TASK_IMAGE, run, hostname: 'box' });
  assert.equal(disk.via, 'local');
  assert.equal(Math.round(disk.availableGiB), 120);
  assert.equal(
    calls.some(c => c[1] === 'run'),
    false
  );
});

test('containerd image store: /var/lib/containerd is measured too and the smaller free space wins', async () => {
  const info = dockerInfo({ Driver: 'overlayfs', DriverStatus: [['driver-type', 'io.containerd.snapshotter.v1']] });
  const { run } = fakeDocker({ info, hostDisk: { '/var/lib/docker': 200, '/var/lib/containerd': 12 } });
  const disk = await checkDockerDiskSpace(false, { image: TASK_IMAGE, run, hostname: 'hive-mind-container' });
  assert.deepEqual(
    disk.measurements.map(m => m.path),
    ['/var/lib/docker', '/var/lib/containerd']
  );
  assert.equal(disk.dataRoot, '/var/lib/containerd');
  assert.equal(Math.round(disk.availableGiB), 12);
});

test('containerd store detection and containerd root resolution', () => {
  // The production log only reported the driver name `overlayfs` (the
  // containerd snapshotter; the legacy graph driver is `overlay2`).
  assert.equal(parseDockerInfo(dockerInfo({ Driver: 'overlayfs' })).containerdStore, true);
  assert.equal(parseDockerInfo(dockerInfo({ Driver: 'overlay2' })).containerdStore, false);
  const managed = parseDockerInfo(dockerInfo({ Driver: 'overlayfs', Containerd: { Address: '/var/run/docker/containerd/containerd.sock' } }));
  assert.deepEqual(resolveDockerStoragePaths(managed, {}), ['/var/lib/docker'], 'dockerd-managed containerd keeps its root under the data root');
  const system = parseDockerInfo(dockerInfo({ Driver: 'overlayfs' }));
  assert.deepEqual(resolveDockerStoragePaths(system, {}), ['/var/lib/docker', '/var/lib/containerd']);
  assert.deepEqual(resolveDockerStoragePaths(system, { HIVE_MIND_DOCKER_CONTAINERD_ROOT: '/srv/containerd' }), ['/var/lib/docker', '/srv/containerd']);
});

test('task image absent: another local image is used; none at all gives the real reason', async () => {
  const fallback = fakeDocker({ hostDisk: { '/var/lib/docker': 60 }, images: ['alpine:3'] });
  const disk = await checkDockerDiskSpace(false, { image: TASK_IMAGE, run: fallback.run, hostname: 'hive-mind-container' });
  assert.equal(disk.measurements[0].image, 'alpine:3');
  assert.equal(Math.round(disk.availableGiB), 60);

  const none = fakeDocker({ hostDisk: { '/var/lib/docker': 60 }, images: [] });
  const unknown = await checkDockerDiskSpace(false, { image: null, run: none.run, hostname: 'hive-mind-container' });
  assert.equal(unknown.availableGiB, null);
  assert.match(unknown.error, /no local image to run df in/);
});

test('docker info failure is reported with its stderr, not as a parse error', async () => {
  const { run } = fakeDocker({ infoCode: 1 });
  const disk = await checkDockerDiskSpace(false, { run, hostname: 'hive-mind-container' });
  assert.equal(disk.availableGiB, null);
  assert.match(disk.error, /^docker info failed: Cannot connect to the Docker daemon/);
});

test('parseDfAvailableKb: GNU and busybox output, and busybox failure (header only)', () => {
  assert.equal(parseDfAvailableKb('Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 202051056 56271388 145763284 28% /docker-root\n'), 145763284);
  assert.equal(parseDfAvailableKb('Filesystem           1024-blocks    Used Available Capacity Mounted on\n'), null, 'busybox prints the header even when it fails');
  assert.equal(parseDfAvailableKb(''), null);
});

test('runCommand resolves with the exit status instead of throwing', async () => {
  const missing = await runCommand('df', ['-Pk', '/definitely/not/here-3001']);
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /here-3001/);
  const absent = await runCommand('hive-mind-no-such-binary-3001', []);
  assert.equal(absent.code, 127);
});

test('preflight: an unmeasurable disk is a visible warning with the real reason', async () => {
  const logger = captureLogger();
  const result = await preflightDockerIsolation({
    env: {},
    existsSync: () => true,
    logger,
    checkImagePresent: async () => true,
    checkStorageDriver: async () => 'overlayfs',
    checkDiskSpace: async () => ({ availableGiB: null, dataRoot: null, error: '/var/lib/docker: df failed: df: /var/lib/docker: No such file or directory' }),
  });
  assert.equal(result.diskAvailableGiB, null);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /DISABLED/);
  assert.match(result.warnings[0], /No such file or directory/);
  assert.match(result.warnings[0], /#3001/);
  assert.doesNotMatch(result.warnings[0], /could not parse/);
  assert.equal(logger.warns.length, 1, 'routed to logger.warn, not to verbose output');
});

test('preflight: the task image is handed to the probe and the daemon measurement is reported', async () => {
  const logger = captureLogger();
  let probeOptions = null;
  const result = await preflightDockerIsolation({
    env: {},
    existsSync: () => true,
    logger,
    checkImagePresent: async () => true,
    checkStorageDriver: async () => 'overlay2',
    checkDiskSpace: async (verbose, options) => {
      probeOptions = options;
      return { availableGiB: 90, dataRoot: '/var/lib/docker', via: 'daemon', error: null };
    },
  });
  assert.equal(probeOptions.image, result.image);
  assert.equal(result.warnings.length, 0);
  assert.ok(logger.logs.some(line => line.includes('90 GiB free on /var/lib/docker (measured through the Docker daemon)')));
});

test('preflight: low disk measured through the daemon still predicts the pull failure', async () => {
  const result = await preflightDockerIsolation({
    env: {},
    existsSync: () => true,
    logger: captureLogger(),
    checkImagePresent: async () => false,
    checkStorageDriver: async () => 'overlayfs',
    checkDiskSpace: async () => ({ availableGiB: 12, dataRoot: '/var/lib/containerd', via: 'daemon', error: null }),
  });
  assert.ok(result.warnings.some(w => w.includes('12 GiB free on /var/lib/containerd')));
});

test('assertCommandSucceeded turns a resolved non-zero exit into a throw', () => {
  assert.deepEqual(assertCommandSucceeded({ code: 0, stdout: 'ok' }), { code: 0, stdout: 'ok' });
  assert.throws(
    () => assertCommandSucceeded({ code: 1, stdout: '', stderr: 'Error: No such image: x\n' }, 'docker image inspect'),
    error => error.code === 1 && /docker image inspect exited with code 1: Error: No such image: x/.test(error.message)
  );
});

test('probes built on command-stream no longer report a failed command as success', async () => {
  // command-stream resolves with code 1 (missing image/session) or 127 (no
  // docker/tmux binary); both used to come back as "present"/"running".
  assert.equal(await checkDockerImagePresent('konard/hive-mind-does-not-exist-3001:none'), false);
  assert.equal(await checkTmuxSessionRunning('hive-mind-no-such-session-3001'), false);
});
