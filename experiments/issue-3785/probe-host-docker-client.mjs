/* global AbortSignal, URL, console, process */
// Validate the exact client copied by the image definition without downloading
// the multi-language Box image into this memory-constrained workspace.
// Docker info is read-only; no auth/config directory is shared with the probe.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);
const docker = args => execute('docker', args, { maxBuffer: 128 * 1024, signal: AbortSignal.timeout(60_000) });
const source = await fs.readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');
const clientImage = /^COPY --from=(docker:[\w.-]+) \/usr\/local\/bin\/docker \/usr\/local\/bin\/docker$/mu.exec(source)?.[1];
assert.ok(clientImage, 'root image must explicitly supply its client');
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-docker-client-'));
const name = `hive-client-${randomUUID()}`;
try {
  await docker(['create', '--name', name, clientImage]);
  await docker(['cp', `${name}:/usr/local/bin/docker`, path.join(fixture, 'docker')]);
  const group = String((await fs.stat('/var/run/docker.sock')).gid);
  // / is a workaround for this workspace's outer cgroup layout, not production
  // launch configuration. The client/daemon commands stay otherwise identical.
  const args = ['run', '--rm', '--cgroup-parent', '/', '--network', 'none', '--pids-limit', '32', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000', '--group-add', group, '--ulimit', 'data=536870912:536870912'];
  await assert.rejects(docker([...args, 'node:24-alpine', 'docker', '--version']));
  const mounts = ['--mount', `type=bind,source=${path.join(fixture, 'docker')},target=/usr/local/bin/docker,readonly`, '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock'];
  const version = await docker([...args, ...mounts, 'node:24-alpine', 'docker', '--version']);
  assert.match(version.stdout, /^Docker version 29\.9\.2,/u);
  const server = await docker([...args, ...mounts, 'node:24-alpine', 'docker', 'info', '--format', '{{.ServerVersion}}']);
  assert.ok(server.stdout.trim());
  console.log('Verified: client-free runtime refuses Docker execution; the exact copied client runs as UID 1000 and reaches the host daemon through its socket group.');
  process.stdout.write(version.stdout);
} finally {
  await docker(['rm', '-f', name]).catch(() => {});
  await fs.rm(fixture, { recursive: true, force: true });
}
