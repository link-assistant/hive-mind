// Runs inside a packaged root image. Only disposable synthetic state is mounted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const entry = await fs.realpath(process.argv[2]);
const { buildDockerIsolationStartArgs, resolveDockerIsolationMountSources } = await import(pathToFileURL(path.join(path.dirname(entry), 'isolation-runner.lib.mjs')));
const image = process.env.HIVE_MOUNT_TEST_IMAGE;
const expectedHome = process.env.HIVE_MOUNT_TEST_EXPECTED_HOME;
const fixture = process.env.HIVE_MOUNT_TEST_FIXTURE || '/mount-fixture';
assert.ok(image && expectedHome, 'the packaged-image gate requires an explicit fixture and image');
const env = { PATH: process.env.PATH, DOCKER_HOST: 'unix:///var/run/docker.sock', HIVE_MIND_DOCKER_ISOLATION_IMAGE: image };
const args = await buildDockerIsolationStartArgs('solve', [], { homeDir: path.join(fixture, 'home'), tool: 'codex', sessionId: 'mount-contract-check', env, resolveMountSources: resolveDockerIsolationMountSources });
const mounts = args.flatMap((arg, index) => (arg === '--volume' ? [{ source: args[index + 1].split(':')[0], target: args[index + 1].split(':')[1] }] : []));
const auth = mounts.find(mount => mount.target === '/home/box/.codex/auth.json');
const history = mounts.find(mount => mount.target === '/home/box/.codex/sessions');
assert.equal(auth?.source, path.join(expectedHome, '.codex/auth.json'));
assert.equal(history?.source, path.join(expectedHome, '.codex/sessions'));
const names = [0, 1].map(() => `hive-mount-contract-${randomUUID()}`);
const docker = args => execute('docker', args, { env, maxBuffer: 128 * 1024, signal: AbortSignal.timeout(60_000) });
try {
  const results = await Promise.allSettled(names.map((name, index) => docker(['run', '--rm', '--name', name, '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '32', '--ulimit', 'data=1073741824:1073741824', '--env', 'NODE_OPTIONS=', '--entrypoint', 'node', '--mount', `type=bind,source=${auth.source},target=/probe/auth.json,readonly`, '--mount', `type=bind,source=${history.source},target=/probe/history`, image, '--max-old-space-size=64', '-e', 'const fs=require("node:fs");if(JSON.parse(fs.readFileSync("/probe/auth.json")).synthetic!=="canonical")process.exit(1);fs.writeFileSync("/probe/history/task-"+process.argv[1],"persisted");', String(index)])));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  for (const index of [0, 1]) assert.equal(await fs.readFile(path.join(fixture, `home/.codex/sessions/task-${index}`), 'utf8'), 'persisted');
  assert.equal(await fs.readFile(path.join(fixture, 'home/.codex/auth.json'), 'utf8'), '{"synthetic":"canonical"}');
  console.log('Installed-package mount backing verified: both task writes reached the root fixture.');
} finally {
  await Promise.all(names.map(name => docker(['rm', '-f', name]).catch(() => {})));
}
