/** @hive-mind-test-suite default */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { shareScopedCodexSessions } from '../src/codex-sessions.lib.mjs';
import { getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../src/isolation-runner.lib.mjs';

const directory = 'rollout-migrations';
const journal = '019f2a1b-0000-7000-8000-000000003785.pending';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-journal-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, base: path.join(root, '.codex'), owner: path.join(root, 'owner'), peer: path.join(root, 'peer') };
}

test('native migration handoff keeps its inode across private owner disposal', async t => {
  const { base, owner, peer } = await fixture(t);
  for (const codexHome of [owner, peer]) assert.equal((await shareScopedCodexSessions({ baseCodexHome: base, codexHome })).status, 'shared');
  await fs.writeFile(path.join(owner, directory, journal), '', { mode: 0o600 });
  const before = await fs.stat(path.join(owner, directory, journal));
  await fs.rm(owner, { recursive: true });
  const canonical = await fs.stat(path.join(base, directory, journal));
  const visible = await fs.stat(path.join(peer, directory, journal));
  assert.deepEqual([canonical.dev, canonical.ino, visible.dev, visible.ino], [before.dev, before.ino, before.dev, before.ino]);
  assert.equal(canonical.mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(base, directory))).mode & 0o777, 0o700);
});

test('private pending migration journals refuse online copying or renaming', async t => {
  const { base, owner } = await fixture(t);
  const privateDirectory = path.join(owner, directory);
  await fs.mkdir(privateDirectory, { recursive: true });
  const pending = path.join(privateDirectory, journal);
  await fs.writeFile(pending, 'preserve pending handoff evidence');
  const before = await fs.stat(pending);
  const outcome = await shareScopedCodexSessions({ baseCodexHome: base, codexHome: owner });
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.error, /migration.*offline/iu);
  assert.equal((await fs.stat(pending)).ino, before.ino);
  assert.equal(await fs.readFile(pending, 'utf8'), 'preserve pending handoff evidence');
  assert.equal(await fs.readFile(path.join(base, directory, journal), 'utf8').catch(error => error.code), 'ENOENT');
});

test('empty private journal namespaces can join canonical migration recovery', async t => {
  const { base, owner } = await fixture(t);
  await fs.mkdir(path.join(owner, directory), { recursive: true });
  assert.equal((await shareScopedCodexSessions({ baseCodexHome: base, codexHome: owner })).status, 'shared');
  assert.equal(await fs.realpath(path.join(owner, directory)), path.join(base, directory));
});

test('linked canonical migration journals refuse projection without changing their target', async t => {
  const { root, base, owner } = await fixture(t);
  const foreign = path.join(root, 'foreign');
  await fs.mkdir(base);
  await fs.mkdir(foreign);
  const sentinel = path.join(foreign, journal);
  await fs.writeFile(sentinel, 'foreign evidence');
  const before = await fs.stat(sentinel);
  await fs.symlink(foreign, path.join(base, directory));
  assert.equal((await shareScopedCodexSessions({ baseCodexHome: base, codexHome: owner })).status, 'failed');
  assert.equal((await fs.stat(sentinel)).ino, before.ino);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'foreign evidence');
});

test('Docker persists migration recovery separately from private configuration', async t => {
  const { root } = await fixture(t);
  const source = path.join(root, '.codex', directory);
  const prepared = await prepareDockerIsolationHostPaths({ tool: 'codex', homeDir: root, env: {} });
  assert.ok(prepared.created.includes(source));
  const mounts = await getDockerIsolationAuthMounts({
    tool: 'codex',
    homeDir: root,
    env: {},
    existsSync: async file =>
      fs.access(file).then(
        () => true,
        () => false
      ),
  });
  assert.ok(mounts.some(mount => mount.source === source && mount.target === `/home/box/.codex/${directory}`));
  await fs.rm(source, { recursive: true });
  await assert.rejects(getDockerIsolationAuthMounts({ tool: 'codex', homeDir: root, env: {}, existsSync: file => file !== source }), /history.*unavailable/iu);
  const routed = await getDockerIsolationAuthMounts({ tool: 'codex', homeDir: root, env: {}, existsSync: () => true, useRouter: true });
  assert.equal(
    routed.some(mount => mount.target.startsWith('/home/box/.codex/')),
    false
  );
});

for (const role of ['canonical', 'private']) {
  test(`linked ${role} history parents cannot redirect scoped directory creation`, async t => {
    const { root, base, owner } = await fixture(t);
    const foreign = path.join(root, 'foreign');
    await fs.mkdir(foreign);
    const sentinel = path.join(foreign, 'sentinel');
    await fs.writeFile(sentinel, 'unrelated operator state', { mode: 0o600 });
    const before = await fs.stat(sentinel);
    await fs.symlink(foreign, role === 'canonical' ? base : owner);
    assert.equal((await shareScopedCodexSessions({ baseCodexHome: base, codexHome: owner })).status, 'failed');
    assert.deepEqual(await fs.readdir(foreign), ['sentinel']);
    assert.equal((await fs.stat(sentinel)).ino, before.ino);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'unrelated operator state');
  });
}

test('canonical parent replacement cannot redirect scoped history mkdir', async t => {
  const { root, base, owner } = await fixture(t);
  const foreign = path.join(root, 'foreign');
  await fs.mkdir(base);
  await fs.mkdir(foreign);
  let replaced = false;
  const fsImpl = {
    ...fs,
    mkdir: async (target, options) => {
      if (!replaced && path.basename(target) === 'thread-writer-locks') {
        replaced = true;
        await fs.rename(base, `${base}.detached`);
        await fs.symlink(foreign, base);
      }
      return fs.mkdir(target, options);
    },
  };
  assert.equal((await shareScopedCodexSessions({ baseCodexHome: base, codexHome: owner, fsImpl })).status, 'failed');
  assert.equal(replaced, true);
  assert.deepEqual(await fs.readdir(foreign), []);
});
