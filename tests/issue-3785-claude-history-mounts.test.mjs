/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../src/isolation-runner.mounts.lib.mjs';

async function fixture(t) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-claude-history-mounts-'));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(homeDir, '.claude'));
  return { homeDir, tool: 'claude', env: {} };
}

for (const name of ['projects', 'sessions']) {
  test(`missing Claude ${name} storage refuses mount selection`, async t => {
    const options = await fixture(t);
    const missing = path.join(options.homeDir, '.claude', name);
    await assert.rejects(getDockerIsolationAuthMounts({ ...options, existsSync: target => target !== missing }), /Claude history.*unavailable/iu);
  });

  test(`linked Claude ${name} storage refuses preparation without changing its target`, async t => {
    const options = await fixture(t);
    const destination = path.join(options.homeDir, 'private-history');
    await fs.mkdir(destination);
    const transcript = path.join(destination, 'synthetic.jsonl');
    await fs.writeFile(transcript, 'synthetic protected conversation');
    const before = await fs.stat(transcript);
    await fs.symlink(destination, path.join(options.homeDir, '.claude', name));
    await assert.rejects(prepareDockerIsolationHostPaths(options), /Claude history.*unavailable/iu);
    assert.equal(await fs.readFile(transcript, 'utf8'), 'synthetic protected conversation');
    assert.equal((await fs.stat(transcript)).ino, before.ino);
  });

  test(`non-directory Claude ${name} storage refuses preparation`, async t => {
    const options = await fixture(t);
    const target = path.join(options.homeDir, '.claude', name);
    await fs.writeFile(target, 'preserve this file for investigation');
    await assert.rejects(prepareDockerIsolationHostPaths(options), /Claude history.*unavailable/iu);
    assert.equal(await fs.readFile(target, 'utf8'), 'preserve this file for investigation');
  });
}

test('read-only Claude history creation refuses preparation rather than falling back to a task layer', async t => {
  const options = await fixture(t);
  const fsImpl = {
    promises: {
      ...fs,
      mkdir: async () => {
        throw Object.assign(new Error('synthetic read-only history'), { code: 'EROFS' });
      },
    },
  };
  await assert.rejects(prepareDockerIsolationHostPaths({ ...options, fsImpl }), /Claude history.*unavailable/iu);
});

test('fresh Claude history is private, idempotent and leaves authentication untouched', async t => {
  const options = await fixture(t);
  const auth = path.join(options.homeDir, '.claude', '.credentials.json');
  await fs.writeFile(auth, 'synthetic protected credential');
  const before = await fs.stat(auth);
  const result = await prepareDockerIsolationHostPaths(options);
  assert.deepEqual(
    result.created,
    ['projects', 'sessions'].map(name => path.join(options.homeDir, '.claude', name))
  );
  for (const target of result.created) assert.equal((await fs.stat(target)).mode & 0o777, 0o700);
  assert.deepEqual((await prepareDockerIsolationHostPaths(options)).created, []);
  assert.equal(await fs.readFile(auth, 'utf8'), 'synthetic protected credential');
  assert.equal((await fs.stat(auth)).ino, before.ino);
});

test('explicit Router selection prepares and mounts no vendor Claude history', async t => {
  const options = { ...(await fixture(t)), useRouter: true };
  assert.deepEqual(await prepareDockerIsolationHostPaths(options), { created: [], missingAuth: [] });
  const mounts = await getDockerIsolationAuthMounts({ ...options, existsSync: () => true });
  assert.equal(
    mounts.some(mount => mount.target.startsWith('/home/box/.claude')),
    false
  );
  assert.deepEqual(await fs.readdir(path.join(options.homeDir, '.claude')), []);
});
