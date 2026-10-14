/**
 * @hive-mind-test-suite default
 *
 * Issue #3214: a Docker-isolated task resumed in place (`docker start` of the
 * stopped container, or a container derived from `docker commit`) keeps the
 * previous run's /var/run/docker.pid. Inside the new PID namespace that PID
 * belongs to an unrelated process, so the nested dockerd refuses to start:
 * `delete /var/run/docker.pid: process with PID 25 is still running`.
 *
 * The hive-mind-dind image clears such pid files at every container start,
 * before box-dind's entrypoint launches dockerd. These tests run the cleanup
 * script against a temporary root (fake /var/run and /proc) and check that the
 * image wires it in front of the box-dind entrypoint.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cleanupScript = path.join(repoRoot, 'scripts/dind/clear-stale-dind-pids.sh');
const entrypointScript = path.join(repoRoot, 'scripts/dind/hive-mind-dind-entrypoint.sh');
const sudoersFile = path.join(repoRoot, 'scripts/dind/hive-mind-dind.sudoers');

const PID_FILES = {
  docker: 'var/run/docker.pid',
  managedContainerd: 'var/run/docker/containerd/containerd.pid',
  containerd: 'var/run/containerd/containerd.pid',
};

const makeRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dind-pids-3214-'));

const writeFile = (root, relative, content) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};

const fakeProcess = (root, pid, comm) => writeFile(root, `proc/${pid}/comm`, `${comm}\n`);

const runCleanup = root => {
  const result = spawnSync('sh', [cleanupScript], {
    env: { PATH: process.env.PATH, HIVE_MIND_DIND_STATE_ROOT: root },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.error, undefined, String(result.error));
  return result;
};

const exists = (root, relative) => fs.existsSync(path.join(root, relative));

test('removes docker.pid whose PID is alive but is not dockerd (the #3214 incident)', () => {
  const root = makeRoot();
  try {
    writeFile(root, PID_FILES.docker, '25');
    fakeProcess(root, 25, 'sudo');
    const result = runCleanup(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(exists(root, PID_FILES.docker), false);
    assert.match(result.stdout, /removed stale \/var\/run\/docker\.pid \(pid 25 is not a running dockerd\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removes pid files whose PID no longer exists or is not a number', () => {
  const root = makeRoot();
  try {
    writeFile(root, PID_FILES.docker, '4242\n');
    writeFile(root, PID_FILES.managedContainerd, 'not-a-pid');
    writeFile(root, PID_FILES.containerd, '');
    const result = runCleanup(root);
    assert.equal(result.status, 0, result.stderr);
    for (const relative of Object.values(PID_FILES)) assert.equal(exists(root, relative), false, relative);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps pid files that name a running dockerd/containerd', () => {
  const root = makeRoot();
  try {
    writeFile(root, PID_FILES.docker, '25\n');
    fakeProcess(root, 25, 'dockerd');
    writeFile(root, PID_FILES.managedContainerd, '56');
    fakeProcess(root, 56, 'containerd');
    writeFile(root, PID_FILES.containerd, '57');
    fakeProcess(root, 57, 'containerd');
    const result = runCleanup(root);
    assert.equal(result.status, 0, result.stderr);
    for (const relative of Object.values(PID_FILES)) assert.equal(exists(root, relative), true, relative);
    assert.equal(result.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checks the process name expected for each pid file', () => {
  const root = makeRoot();
  try {
    // A containerd PID recorded in docker.pid (and vice versa) is still stale.
    writeFile(root, PID_FILES.docker, '56');
    fakeProcess(root, 56, 'containerd');
    writeFile(root, PID_FILES.managedContainerd, '25');
    fakeProcess(root, 25, 'dockerd');
    const result = runCleanup(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(exists(root, PID_FILES.docker), false);
    assert.equal(exists(root, PID_FILES.managedContainerd), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('is a silent no-op when there are no pid files', () => {
  const root = makeRoot();
  try {
    const result = runCleanup(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reads real /proc entries: a live process named dockerd is kept, any other live PID is not', { timeout: 15000 }, async () => {
  const root = makeRoot();
  const sleepBinary = spawnSync('sh', ['-c', 'command -v sleep'], { encoding: 'utf8' }).stdout.trim();
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dind-pids-3214-bin-'));
  const fakeDockerd = path.join(binDir, 'dockerd');
  fs.copyFileSync(sleepBinary, fakeDockerd);
  fs.chmodSync(fakeDockerd, 0o755);
  const dockerd = spawn(fakeDockerd, ['30'], { stdio: 'ignore' });
  const other = spawn(sleepBinary, ['30'], { stdio: 'ignore' });
  try {
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.symlinkSync('/proc', path.join(root, 'proc'));
    writeFile(root, PID_FILES.docker, String(dockerd.pid));
    writeFile(root, PID_FILES.containerd, String(other.pid));
    const result = runCleanup(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(exists(root, PID_FILES.docker), true);
    assert.equal(exists(root, PID_FILES.containerd), false);
  } finally {
    dockerd.kill('SIGKILL');
    other.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('the scripts are POSIX sh and parse cleanly', () => {
  for (const script of [cleanupScript, entrypointScript]) {
    const content = fs.readFileSync(script, 'utf8');
    assert.match(content, /^#!\/bin\/sh\n/, `${script} should use /bin/sh`);
    const parsed = spawnSync('sh', ['-n', script], { encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.ok(fs.statSync(script).mode & 0o111, `${script} should be executable`);
  }
});

test('the entrypoint clears stale pid files before handing off to the box-dind entrypoint', () => {
  const content = fs.readFileSync(entrypointScript, 'utf8');
  assert.match(content, /^cleanup=\/usr\/local\/sbin\/hive-mind-dind-clear-stale-pids$/m);
  const cleanupAt = content.indexOf('sudo -n "$cleanup"');
  const handoffAt = content.indexOf('exec /usr/local/bin/dind-entrypoint.sh "$@"');
  assert.ok(cleanupAt > 0, 'the entrypoint should run the cleanup through sudo as box');
  assert.ok(handoffAt > cleanupAt, 'the cleanup should run before box-dind starts dockerd');
});

test('sudoers lets box run only the argument-less cleanup as root', () => {
  const lines = fs
    .readFileSync(sudoersFile, 'utf8')
    .split('\n')
    .filter(line => line.trim() && !line.trim().startsWith('#'));
  assert.deepEqual(lines, ['box ALL=(root) NOPASSWD: /usr/local/sbin/hive-mind-dind-clear-stale-pids ""']);
});

test('Dockerfile.dind installs the cleanup and makes the wrapper the image entrypoint', () => {
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile.dind'), 'utf8');
  assert.match(dockerfile, /^COPY --chmod=0755 scripts\/dind\/clear-stale-dind-pids\.sh \/usr\/local\/sbin\/hive-mind-dind-clear-stale-pids$/m);
  assert.match(dockerfile, /^COPY --chmod=0755 scripts\/dind\/hive-mind-dind-entrypoint\.sh \/usr\/local\/bin\/hive-mind-dind-entrypoint\.sh$/m);
  assert.match(dockerfile, /^COPY --chmod=0440 scripts\/dind\/hive-mind-dind\.sudoers \/etc\/sudoers\.d\/hive-mind-dind$/m);
  assert.match(dockerfile, /^RUN sudo -n \/usr\/local\/sbin\/hive-mind-dind-clear-stale-pids$/m);
  assert.match(dockerfile, /^ENTRYPOINT \["\/usr\/local\/bin\/hive-mind-dind-entrypoint\.sh"\]$/m);
  // Setting ENTRYPOINT resets the CMD inherited from box-dind.
  assert.match(dockerfile, /^CMD \["\/bin\/bash"\]$/m);
  assert.ok(dockerfile.indexOf('ENTRYPOINT [') < dockerfile.indexOf('CMD ["/bin/bash"]'));
});

test('changes to the in-image dind scripts trigger the Docker build checks', () => {
  const detect = fs.readFileSync(path.join(repoRoot, 'scripts/detect-code-changes.mjs'), 'utf8');
  const match = detect.match(/const dockerPattern = \/(.+)\/([a-z]*);/);
  assert.ok(match, 'dockerPattern should exist');
  const dockerPattern = new RegExp(match[1], match[2]);
  assert.ok(dockerPattern.test('scripts/dind/clear-stale-dind-pids.sh'));
  assert.ok(dockerPattern.test('Dockerfile.dind'));
  assert.ok(!dockerPattern.test('scripts/detect-code-changes.mjs'));
});
