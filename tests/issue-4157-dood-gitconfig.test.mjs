/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DockerMountBackingError, resolveDockerIsolationMountSources } from '../src/docker-mount-namespace.lib.mjs';
import { getDockerIsolationAuthMounts } from '../src/isolation-runner.mounts.lib.mjs';

const execute = promisify(execFile);
const home = '/home/box';
const gitconfig = `${home}/.gitconfig`;
const gitConfigContents = '[user]\n  name = Hive Test\n  email = fixture@example.invalid\n';

function parentBind(relativePath, hostPath) {
  return { Type: 'bind', Source: `/daemon/state/${hostPath}`, Destination: `${home}/${relativePath}` };
}

test('DooD names the unbacked Git config and accepts either persisted deployment layout', { timeout: 5_000 }, async () => {
  const id = 'a'.repeat(64);
  const gitDirectory = `${home}/.config/git`;
  const managedSource = `${gitDirectory}/config`;
  const directory = { dev: 1n, ino: 1n, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
  const file = { ...directory, ino: 2n, isFile: () => true, isDirectory: () => false };
  const identityFor = source => ([gitconfig, managedSource].includes(source) || source.endsWith('.json') ? file : directory);
  const io = {
    lstat: async source => identityFor(source),
    open: async () => ({
      read: async (buffer, offset) => ({ bytesRead: offset === 0 ? buffer.write(`/containers/${id}/hostname /etc/hostname `) : 0 }),
      close: async () => {},
    }),
  };

  for (const tool of ['codex', 'claude']) {
    const baseMounts = [parentBind('.config/gh', 'gh'), parentBind('.codex', 'codex'), parentBind('.claude', 'claude')];

    async function resolve(parents, env = {}) {
      const mounts = await getDockerIsolationAuthMounts({ tool, env, homeDir: home, existsSync: async source => !source.endsWith('/.config/git') || Boolean(env.GIT_CONFIG_GLOBAL) });
      const run = async (_binary, args) => {
        if (args[0] === 'inspect') return { stdout: JSON.stringify(parents) };
        if (args[0] !== 'run') return { stdout: '' };
        if (args.some(arg => arg.startsWith(`type=bind,source=${home}/`))) throw new Error('Docker stderr sentinel');
        const identities = mounts.map(({ source }) => {
          const { ino } = identityFor(source);
          return `1:${ino}:${ino === 2n ? 'file' : 'directory'}`;
        });
        return { stdout: JSON.stringify(identities) };
      };
      return resolveDockerIsolationMountSources({ mounts, image: 'synthetic:1', env: { DOCKER_HOST: 'unix:///synthetic.sock' }, io, run });
    }

    await assert.rejects(resolve(baseMounts), error => {
      assert.ok(error instanceof DockerMountBackingError);
      assert.match(error.message, /source "\/home\/box\/\.gitconfig"/u);
      assert.match(error.message, /Persist .*bind or volume/u);
      assert.doesNotMatch(error.message, /Docker stderr sentinel/u);
      return true;
    });

    const manual = await resolve([...baseMounts, parentBind('.gitconfig', 'gitconfig')]);
    assert.deepEqual(
      manual.find(mount => mount.target === gitconfig),
      { source: '/daemon/state/gitconfig', target: gitconfig }
    );

    const managed = await resolve([...baseMounts, parentBind('.config/git', 'git')], { GIT_CONFIG_GLOBAL: managedSource });
    assert.deepEqual(
      managed.find(mount => mount.target === gitconfig),
      { source: '/daemon/state/git/config', target: gitconfig }
    );
  }
});

test('a managed setup seeds its persistent Git config from the saved DooD identity once', { timeout: 10_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-4157-manager-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = path.join(root, 'state');
  const legacy = path.join(state, 'gitconfig');
  const config = path.join(state, 'git', 'config');
  const socket = path.join(root, 'docker.sock');
  const server = net.createServer().listen(socket);
  t.after(() => server.close());
  await once(server, 'listening');
  await fs.mkdir(state);
  await fs.writeFile(legacy, gitConfigContents, { mode: 0o600 });
  await fs.writeFile(
    path.join(root, 'docker'),
    `#!/usr/bin/env bash
set -eu
case "$1 $2" in
  'container inspect') [[ $4 == *'.State.Health'* ]] && printf 'healthy\\n' ;;
  'image inspect') printf 'sha256:fixture\\n' ;;
  'run --pull')
    for argument; do
      case "$argument" in
        type=bind,source=*,target=/mnt)
          stage=\${argument#type=bind,source=}
          stage=\${stage%,target=/mnt}
          [[ -e $stage/git/config ]] || touch "$stage/git/config" ;;
      esac
    done ;;
  'create --pull')
    printf '%s\\n' "$@" > docker-create
    printf 'candidate-id\\n' ;;
  'rename candidate-id'|'start candidate-id') ;;
  *) exit 99 ;;
esac
`,
    { mode: 0o700 }
  );

  const cli = fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));
  const deploy = () => execute('bash', [cli, 'deploy', '--state-dir', state, '--docker-socket', socket, '--setup', '--no-pull', 'apply'], { cwd: root, env: { ...process.env, PATH: `${root}:${process.env.PATH}`, XDG_RUNTIME_DIR: root } });
  await deploy();
  assert.equal(await fs.readFile(config, 'utf8'), gitConfigContents);
  assert.equal((await fs.stat(config)).mode & 0o777, 0o600);
  const create = (await fs.readFile(path.join(root, 'docker-create'), 'utf8')).split('\n');
  assert.ok(create.includes(`type=bind,source=${socket},target=/var/run/docker.sock`));
  assert.ok(create.includes(`type=bind,source=${state}/git,target=${home}/.config/git`));
  assert.ok(create.includes(`GIT_CONFIG_GLOBAL=${home}/.config/git/config`));

  const updated = gitConfigContents.replace('Hive Test', 'Updated Hive Test');
  await fs.writeFile(config, updated);
  await deploy();
  assert.equal(await fs.readFile(config, 'utf8'), updated);
  assert.equal(await fs.readFile(legacy, 'utf8'), gitConfigContents);
});
