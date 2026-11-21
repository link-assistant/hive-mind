// Exercise production mount construction inside a root container talking to
// the host daemon. No operator state enters this bounded, disposable probe.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const execute = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-mounts-'));
const label = `hive-3785-mounts=${process.pid}`;
try {
  const home = path.join(root, 'canonical-home');
  await mkdir(path.join(home, '.codex/sessions'), { recursive: true });
  await writeFile(path.join(home, '.codex/auth.json'), '{"synthetic":"canonical"}');
  const script = path.join(root, 'root.mjs');
  await writeFile(
    script,
    `
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import * as runner from '/work/src/isolation-runner.lib.mjs';
const execute = promisify(execFile);
const image = 'node:24-alpine';
// This test container has an empty cgroup namespace. Keep that harness-only
// workaround out of production, which must inherit its daemon's cgroup policy.
const run = (command, args, options) => execute(command, args[0] === 'run' ? ['run', '--cgroup-parent', '/', ...args.slice(1)] : args, options);
const resolve = options => runner.resolveDockerIsolationMountSources({...options, run});
const direct = [{source: ${JSON.stringify(path.join(home, '.codex/auth.json'))}, target: '/probe-auth'}];
assert.deepEqual(await resolve({mounts: direct, image}), direct);
console.log('Verified: already-shared daemon paths retain their backing identity.');
await fs.mkdir('/synthetic-private');
await fs.writeFile('/synthetic-private/auth.json', '{"synthetic":"private"}');
await assert.rejects(resolve({mounts: [{source: '/synthetic-private/auth.json', target: '/probe-auth'}], image}), /Docker mount backing could not be verified/u);
console.log('Verified: a private container-layer source is rejected.');
const args = await runner.buildDockerIsolationStartArgs('solve', [], {homeDir: '/operator', tool: 'codex', env: {...process.env, HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'node:24-alpine'}, sessionId: 'synthetic-mount-probe', resolveMountSources: resolve});
const mounts = args.flatMap((arg, index) => arg === '--volume' ? [{source: args[index+1].split(':')[0], target: args[index+1].split(':')[1]}] : []);
const resolved = mounts;
const auth = resolved.find(mount => mount.target.endsWith('/.codex/auth.json'));
const sessions = resolved.find(mount => mount.target.endsWith('/.codex/sessions'));
assert.equal(auth?.source, ${JSON.stringify(path.join(home, '.codex/auth.json'))}, 'production mount source stayed in the root-container namespace');
assert.equal(sessions?.source, ${JSON.stringify(path.join(home, '.codex/sessions'))});
await execute('docker', ['run', '--rm', '--cgroup-parent', '/', '--label', ${JSON.stringify(label)}, '--network', 'none', '--pids-limit', '32', '--ulimit', 'data=1073741824:1073741824', '--entrypoint', 'node', '--mount', 'type=bind,source='+auth.source+',target=/probe/auth.json', '--mount', 'type=bind,source='+sessions.source+',target=/probe/sessions', 'node:24-alpine', '--max-old-space-size=64', '-e', 'const fs=require("node:fs");if(JSON.parse(fs.readFileSync("/probe/auth.json")).synthetic!=="canonical")process.exit(1);fs.writeFileSync("/probe/sessions/synthetic-history", "persisted");']);
console.log('Verified: production mount sources resolve through the root bind into the daemon namespace; task writes reach the disposable host directory.');
`
  );
  const args = ['run', '--rm', '--cgroup-parent', '/', '--label', label, '--network', 'none', '--pids-limit', '64', '--ulimit', 'data=1073741824:1073741824', '--entrypoint', 'node', '--mount', `type=bind,source=${process.cwd()},target=/work,readonly`, '--mount', `type=bind,source=${root},target=/fixture`, '--mount', `type=bind,source=${home},target=/operator`, '--mount', `type=bind,source=${home},target=${home}`, '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock', '--mount', 'type=bind,source=/usr/bin/docker,target=/usr/local/bin/docker,readonly', '--mount', 'type=bind,source=/lib/x86_64-linux-gnu/libc.so.6,target=/lib/x86_64-linux-gnu/libc.so.6,readonly', '--mount', 'type=bind,source=/lib64/ld-linux-x86-64.so.2,target=/lib64/ld-linux-x86-64.so.2,readonly', 'node:24-alpine', '--max-old-space-size=128', '/fixture/root.mjs'];
  const { stdout } = await execute('docker', args, { maxBuffer: 64 * 1024 });
  process.stdout.write(stdout);
  assert.equal(await readFile(path.join(home, '.codex/sessions/synthetic-history'), 'utf8'), 'persisted');
} finally {
  const { stdout } = await execute('docker', ['ps', '-aq', '--filter', `label=${label}`]);
  const containers = stdout.trim().split(/\s+/u).filter(Boolean);
  if (containers.length) await execute('docker', ['rm', '-f', ...containers]);
  await rm(root, { recursive: true, force: true });
}
