#!/usr/bin/env node
// Production mount-builder regression; all state is synthetic and disposable.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../../src/isolation-runner.mounts.lib.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-effective-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'operator');
  const configuration = path.join(root, 'selected-config');
  const credentials = path.join(root, 'selected-credentials');
  for (const directory of [homeDir, path.join(homeDir, '.claude'), configuration, credentials]) await fs.mkdir(directory, { mode: 0o700 });
  const credentialFile = path.join(credentials, '.credentials.json');
  await fs.writeFile(credentialFile, '{}', { mode: 0o600 });
  return { root, configuration, credentialFile, options: { tool: 'claude', homeDir, env: { CLAUDE_CONFIG_DIR: configuration, CLAUDE_SECURESTORAGE_CONFIG_DIR: credentials } } };
}

test('preparation creates Claude history in its selected configuration root', { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const before = await fs.stat(f.credentialFile);
  const result = await prepareDockerIsolationHostPaths(f.options);
  assert.deepEqual(
    result.created,
    ['projects', 'sessions'].map(name => path.join(f.configuration, name))
  );
  assert.deepEqual(await fs.readdir(path.join(f.options.homeDir, '.claude')), []);
  assert.equal((await fs.stat(f.credentialFile)).ino, before.ino);
  assert.equal(await fs.readFile(f.credentialFile, 'utf8'), '{}');
});

for (const name of ['projects', 'sessions']) {
  test(`Claude mounts selected ${name} and preserves competing conventional evidence`, { timeout: 10_000 }, async t => {
    const f = await fixture(t);
    for (const root of [f.configuration, path.join(f.options.homeDir, '.claude')]) {
      for (const entry of ['projects', 'sessions']) await fs.mkdir(path.join(root, entry), { mode: 0o700 });
      await fs.writeFile(path.join(root, name, 'synthetic-history.jsonl'), root === f.configuration ? 'selected history' : 'retained legacy evidence');
    }
    const mounts = await getDockerIsolationAuthMounts(f.options);
    const target = path.join('/home/box/.claude', name);
    assert.deepEqual(
      mounts.find(mount => mount.target === target),
      { source: path.join(f.configuration, name), target }
    );
    assert.equal(await fs.readFile(path.join(f.options.homeDir, '.claude', name, 'synthetic-history.jsonl'), 'utf8'), 'retained legacy evidence');
  });

  test(`Claude refuses linked selected ${name} despite healthy conventional storage`, { timeout: 10_000 }, async t => {
    const f = await fixture(t);
    for (const entry of ['projects', 'sessions']) await fs.mkdir(path.join(f.options.homeDir, '.claude', entry), { mode: 0o700 });
    const protectedRoot = path.join(f.root, 'protected-evidence');
    await fs.mkdir(protectedRoot, { mode: 0o700 });
    await fs.writeFile(path.join(protectedRoot, 'witness'), 'preserved evidence');
    await fs.symlink(protectedRoot, path.join(f.configuration, name));
    await assert.rejects(prepareDockerIsolationHostPaths(f.options), /Claude history.*unavailable/iu);
    assert.equal(await fs.readFile(path.join(protectedRoot, 'witness'), 'utf8'), 'preserved evidence');
  });

  test(`Claude refuses missing selected ${name} despite healthy conventional storage`, { timeout: 10_000 }, async t => {
    const f = await fixture(t);
    for (const entry of ['projects', 'sessions']) await fs.mkdir(path.join(f.options.homeDir, '.claude', entry), { mode: 0o700 });
    await fs.mkdir(path.join(f.configuration, name === 'projects' ? 'sessions' : 'projects'), { mode: 0o700 });
    await assert.rejects(getDockerIsolationAuthMounts(f.options), /Claude history.*unavailable/iu);
    assert.deepEqual(await fs.readdir(f.configuration), [name === 'projects' ? 'sessions' : 'projects']);
  });
}

test('selected Claude history mounts keep operator configuration private', { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.configuration, 'settings.json'), '{"syntheticPrivateSetting":true}');
  await fs.mkdir(path.join(f.configuration, 'plugins'), { mode: 0o700 });
  await prepareDockerIsolationHostPaths(f.options);
  const mounts = await getDockerIsolationAuthMounts(f.options);
  assert.deepEqual(
    mounts
      .filter(mount => mount.source.startsWith(`${f.configuration}${path.sep}`))
      .map(mount => path.basename(mount.source))
      .sort(),
    ['projects', 'sessions']
  );
  assert.equal(
    mounts.some(mount => mount.source === f.configuration),
    false
  );
  assert.equal(await fs.readFile(path.join(f.configuration, 'settings.json'), 'utf8'), '{"syntheticPrivateSetting":true}');
});

test('Router mode suppresses selected Claude history before filesystem preparation', { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const options = { ...f.options, useRouter: true };
  assert.deepEqual(await prepareDockerIsolationHostPaths(options), { created: [], missingAuth: [] });
  assert.equal(
    (await getDockerIsolationAuthMounts(options)).some(mount => mount.target.startsWith('/home/box/.claude') || mount.source.startsWith(f.configuration)),
    false
  );
  assert.deepEqual(await fs.readdir(f.configuration), []);
});

for (const selected of ['relative-config', '/tmp/selected/../configuration', '/tmp/selected\nconfiguration', '/tmp/selected:configuration', '/tmp/selected,configuration']) {
  test(`unsafe selected Claude history root is refused: ${JSON.stringify(selected)}`, { timeout: 10_000 }, async t => {
    const f = await fixture(t);
    const options = { ...f.options, env: { CLAUDE_CONFIG_DIR: selected } };
    await assert.rejects(prepareDockerIsolationHostPaths(options), /Claude history.*unavailable/iu);
    await assert.rejects(getDockerIsolationAuthMounts(options), /Claude history.*unavailable/iu);
    assert.deepEqual(await fs.readdir(path.join(f.options.homeDir, '.claude')), []);
  });
}
