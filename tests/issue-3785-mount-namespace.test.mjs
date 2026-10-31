/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { mapDockerMountSources, resolveDockerIsolationMountSources } from '../src/docker-mount-namespace.lib.mjs';
import { buildDockerIsolationStartArgs, executeWithIsolation } from '../src/isolation-runner.lib.mjs';

const diagnostic = 'Docker mount backing could not be verified. Persist the source in a root-container bind or volume visible to the selected local daemon before launching a task.';
const source = '/operator/.codex/sessions';
const mount = { source, target: '/home/box/.codex/sessions', readOnly: true };
const parent = { Type: 'bind', Source: '/host/state', Destination: '/operator' };
test('root bind and nested volume paths use the most specific daemon source', () => {
  assert.deepEqual(mapDockerMountSources([mount], [parent]), [{ ...mount, source: '/host/state/.codex/sessions' }]);
  assert.deepEqual(mapDockerMountSources([mount], [parent, { Type: 'volume', Source: '/var/lib/docker/volumes/evidence/_data', Destination: source }]), [{ ...mount, source: '/var/lib/docker/volumes/evidence/_data' }]);
  assert.deepEqual(mapDockerMountSources([mount], [{ ...parent, Destination: '/', Source: '/daemon/root' }]), [{ ...mount, source: '/daemon/root/operator/.codex/sessions' }]);
});
for (const [name, mounts, parents] of [
  ['unpersisted layer', [mount], []],
  ['prefix sibling', [mount], [{ ...parent, Destination: '/oper' }]],
  ['duplicate mapping', [mount], [parent, parent]],
  ['unsupported nested mount', [mount], [parent, { Type: 'tmpfs', Destination: '/operator/.codex' }]],
  ['relative path', [{ ...mount, source: 'operator/auth.json' }], [parent]],
  ['path traversal', [{ ...mount, source: '/operator/../private' }], [parent]],
  ['ambiguous volume argument', [{ ...mount, source: '/operator/private:other' }], [parent]],
  ['ambiguous CSV argument', [{ ...mount, source: '/operator/private,other' }], [parent]],
]) {
  test(`daemon mount mapping rejects ${name}`, () =>
    assert.throws(
      () => mapDockerMountSources(mounts, parents),
      error => error.message === diagnostic
    ));
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-mount-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const auth = path.join(root, 'auth.json');
  await fs.writeFile(auth, 'synthetic-protected-state');
  const info = await fs.lstat(auth, { bigint: true });
  return { root, auth, identity: `${info.dev}:${info.ino}:file`, mounts: [{ source: auth, target: '/probe-auth.json' }] };
}

test('a same-namespace source requires a bounded read-only backing probe and reaps it', { timeout: 5000 }, async t => {
  const value = await fixture(t);
  const calls = [];
  const run = async (_binary, args) => {
    calls.push(args);
    if (args[0] === 'context') return { stdout: '"unix:///var/run/docker.sock"' };
    if (args[0] === 'run') {
      assert.ok(args.includes('--read-only') && args.includes('none') && args.includes('no-new-privileges'));
      assert.equal(args.includes('--cgroup-parent'), false, 'production inherits the daemon cgroup policy');
      assert.ok(args.includes(`type=bind,source=${value.auth},target=/__hive_mount_probe/0,readonly`));
      return { stdout: JSON.stringify([value.identity]) };
    }
    return { stdout: '' };
  };
  assert.deepEqual(await resolveDockerIsolationMountSources({ mounts: value.mounts, image: 'synthetic:image', env: {}, run }), value.mounts);
  assert.equal(calls.filter(args => args[0] === 'rm').length, 1);
  assert.equal(await fs.readFile(value.auth, 'utf8'), 'synthetic-protected-state');
});

test('host-socket translation is verified after a wrong same-path identity', { timeout: 5000 }, async t => {
  const value = await fixture(t);
  const id = 'a'.repeat(64);
  const chunks = ['1 0 1:1 / / rw - overlay overlay rw\n', `2 1 1:1 /var/lib/docker/containers/${id}/hostname /etc/hostname rw - ext4 /dev/x rw\n`, ''];
  const io = { ...fs, open: async () => ({ read: async (buffer, offset) => ({ bytesRead: buffer.write(chunks.shift(), offset) }), close: async () => {} }) };
  let probes = 0;
  const run = async (_binary, args) => {
    if (args[0] === 'run') {
      probes++;
      if (probes === 1) return { stdout: '["wrong:private:file"]' };
      assert.ok(args.includes('type=bind,source=/daemon/state/auth.json,target=/__hive_mount_probe/0,readonly'));
      return { stdout: JSON.stringify([value.identity]) };
    }
    if (args[0] === 'inspect') {
      assert.equal(args.at(-1), id);
      return { stdout: JSON.stringify([{ Type: 'bind', Source: '/daemon/state', Destination: value.root }]) };
    }
    return { stdout: '' };
  };
  assert.deepEqual(await resolveDockerIsolationMountSources({ mounts: value.mounts, image: 'synthetic:image', env: { DOCKER_HOST: 'unix:///daemon.sock' }, io, run }), [{ ...value.mounts[0], source: '/daemon/state/auth.json' }]);
  assert.equal(probes, 2);
});

test('a missing image is pulled before probing, using the selected daemon environment', { timeout: 5000 }, async t => {
  const value = await fixture(t);
  const env = { DOCKER_HOST: 'unix:///synthetic-daemon.sock' };
  let installed = false;
  let probes = 0;
  const run = async (_binary, args) => {
    if (args[0] === 'image' && !installed) throw new Error('missing');
    if (args[0] === 'run') {
      assert.equal(installed, true);
      assert.equal(args[args.indexOf('--pull') + 1], 'never');
      probes++;
      return { stdout: JSON.stringify([value.identity]) };
    }
    return { stdout: '' };
  };
  const pull = async options => {
    assert.deepEqual(options, { image: 'synthetic:image', env });
    installed = true;
  };
  await resolveDockerIsolationMountSources({ mounts: value.mounts, image: 'synthetic:image', env, run, pull });
  assert.equal(probes, 1);
});

for (const variant of ['remote', 'malformed', 'changed', 'symlink']) {
  test(`backing admission rejects ${variant} without exposing Docker diagnostics`, { timeout: 5000 }, async t => {
    const value = await fixture(t);
    let stats = 0;
    const io = {
      ...fs,
      lstat: async (...args) => {
        const info = await fs.lstat(...args);
        if ((variant === 'changed' && stats++ > 0) || variant === 'symlink') return { ...info, ino: info.ino + 1n, isSymbolicLink: () => variant === 'symlink', isFile: () => true, isDirectory: () => false };
        return info;
      },
      open: async () => {
        throw new Error('private-path-sentinel');
      },
    };
    const run = async (_binary, args) => ({ stdout: args[0] === 'run' ? (variant === 'malformed' ? 'private-response-sentinel' : JSON.stringify([value.identity])) : '' });
    await assert.rejects(resolveDockerIsolationMountSources({ mounts: value.mounts, image: 'synthetic:image', env: { DOCKER_HOST: variant === 'remote' ? 'tcp://remote:2376' : 'unix:///daemon.sock' }, run, io }), error => error.message === diagnostic);
  });
}

test('the launcher builder uses attested sources and preserves mount flags', async () => {
  let called = false;
  const args = await buildDockerIsolationStartArgs('solve', [], {
    sessionId: 'synthetic',
    tool: 'codex',
    env: {},
    homeDir: '/operator',
    existsSync: async () => true,
    resolveMountSources: async ({ mounts }) => {
      called = true;
      return mounts.map(entry => ({ ...entry, source: `/daemon${entry.source}` }));
    },
  });
  assert.equal(called, true);
  assert.ok(args.includes('/daemon/operator/.codex/auth.json:/home/box/.codex/auth.json'));
  assert.equal(
    args.some(arg => arg.startsWith('/operator/')),
    false
  );
});

test('production launch refuses unverifiable mounts before invoking start-command', { timeout: 5000 }, async t => {
  const value = await fixture(t);
  const bin = path.join(value.root, 'bin');
  const callsPath = path.join(value.root, 'calls.jsonl');
  await fs.mkdir(bin);
  await fs.mkdir(path.join(value.root, '.codex'));
  await fs.writeFile(path.join(value.root, '.codex/auth.json'), 'synthetic-protected-state');
  await fs.writeFile(path.join(bin, 'docker'), `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(callsPath)},JSON.stringify(args)+'\\n');if(args[0]==='image')console.log('sha256:synthetic');else if(args[0]==='context')console.log(JSON.stringify('unix:///synthetic.sock'));else{console.error('private-docker-diagnostic-sentinel');process.exitCode=1;}`, { mode: 0o700 });
  const oldUse = globalThis.use;
  const oldPath = process.env.PATH;
  const oldError = console.error;
  let startCalls = 0;
  const messages = [];
  try {
    process.env.PATH = bin;
    globalThis.use = async () => ({
      $: () => async strings => {
        startCalls++;
        assert.equal(strings[0], 'which $');
        return { stdout: '/synthetic/start-command' };
      },
    });
    console.error = (...args) => messages.push(args.join(' '));
    const result = await executeWithIsolation('solve', [], { backend: 'docker', homeDir: value.root, tool: 'codex', sessionId: 'synthetic-refused', env: { PATH: bin, HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'synthetic:1', HIVE_MIND_DOCKER_ISOLATION_PULL: 'never' } });
    assert.equal(result.success, false);
    assert.match(result.error, /Task mount preparation failed/u);
    assert.equal(startCalls, 1, 'only the binary lookup runs; no task command is invoked');
    assert.equal(messages.join('').includes('private-docker-diagnostic-sentinel'), false);
    const calls = (await fs.readFile(callsPath, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.ok(
      calls.some(args => args[0] === 'run'),
      'the production path performs the backing probe'
    );
    assert.ok(
      calls.some(args => args[0] === 'rm'),
      'the failed probe is reaped'
    );
    assert.equal(await fs.readFile(path.join(value.root, '.codex/auth.json'), 'utf8'), 'synthetic-protected-state');
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    console.error = oldError;
    if (oldUse === undefined) delete globalThis.use;
    else globalThis.use = oldUse;
  }
});
